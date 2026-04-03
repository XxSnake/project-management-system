'use client';

import { useEffect, useMemo, useState } from 'react';

const ROLE_LABELS = { '编写': '编写', '主检': '主检', '审核': '审核', '批准': '批准' };

function formatCurrency(value) {
    return `CNY ${Number(value || 0).toFixed(2)}`;
}

function getRoleStaff(report, roleType) {
    const role = (report.roles || []).find((r) => r.roleType === roleType);
    return role?.staff?.name || '';
}

function getReportTotalValue(report) {
    return (report.productionValues || []).reduce((sum, pv) => sum + Number(pv.value || 0), 0);
}

function getRoleValue(report, roleType) {
    const pv = (report.productionValues || []).find((v) => v.roleType === roleType);
    return Number(pv?.value || 0);
}

export default function TestReportsPage() {
    const [rawText, setRawText] = useState('');
    const [result, setResult] = useState(null);
    const [reports, setReports] = useState([]);
    const [selectedIds, setSelectedIds] = useState([]);
    const [loading, setLoading] = useState(true);
    const [importing, setImporting] = useState(false);
    const [deletingBatch, setDeletingBatch] = useState(false);
    const [editingReport, setEditingReport] = useState(null);
    const [savingEdit, setSavingEdit] = useState(false);
    const [filters, setFilters] = useState({
        project: '',
        staff: '',
        search: '',
    });

    const refreshReports = async () => {
        const response = await fetch(`/api/test-reports?_t=${Date.now()}`, { cache: 'no-store' });
        const data = await response.json();
        setReports(Array.isArray(data) ? data : []);
        setSelectedIds((current) => current.filter((id) => data.some((r) => r.id === id)));
    };

    useEffect(() => {
        let cancelled = false;
        fetch(`/api/test-reports?_t=${Date.now()}`, { cache: 'no-store' })
            .then((r) => r.json())
            .then((data) => {
                if (!cancelled) setReports(Array.isArray(data) ? data : []);
            })
            .catch((err) => {
                if (!cancelled) console.error('加载检测报告失败:', err);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, []);

    const filteredReports = useMemo(() => {
        return reports.filter((r) => {
            if (filters.project && !r.project?.name?.includes(filters.project)) return false;
            if (filters.staff) {
                const allStaff = (r.roles || []).map((role) => role.staff?.name || '').join(' ');
                if (!allStaff.includes(filters.staff)) return false;
            }
            if (filters.search) {
                const text = `${r.reportNo || ''} ${r.testContent} ${r.remarks || ''}`;
                if (!text.includes(filters.search)) return false;
            }
            return true;
        });
    }, [reports, filters]);

    const handleImport = async () => {
        if (!rawText.trim()) return;
        setImporting(true);
        setResult(null);
        try {
            const response = await fetch('/api/test-reports', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rawText }),
            });
            const data = await response.json();
            if (data.error) {
                setResult({ error: data.error });
            } else {
                setResult(data);
                setRawText('');
                await refreshReports();
            }
        } catch (err) {
            setResult({ error: err.message });
        } finally {
            setImporting(false);
        }
    };

    const handleBatchDelete = async () => {
        if (selectedIds.length === 0) return;
        if (!window.confirm(`确认删除选中的 ${selectedIds.length} 条报告记录？`)) return;
        setDeletingBatch(true);
        try {
            await fetch('/api/test-reports', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: selectedIds }),
            });
            setSelectedIds([]);
            await refreshReports();
        } finally {
            setDeletingBatch(false);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('确认删除该报告记录？')) return;
        await fetch(`/api/test-reports/${id}`, { method: 'DELETE' });
        await refreshReports();
    };

    const openEdit = (report) => {
        setEditingReport({
            id: report.id,
            reportNo: report.reportNo || '',
            projectName: report.project?.name || '',
            testContent: report.testContent || '',
            reportDate: report.reportDate ? new Date(report.reportDate).toISOString().split('T')[0] : '',
            quantity: report.quantity || 1,
            unit: report.unit || '',
            remarks: report.remarks || '',
            writer: getRoleStaff(report, '编写'),
            inspector: getRoleStaff(report, '主检'),
            reviewer: getRoleStaff(report, '审核'),
            approver: getRoleStaff(report, '批准'),
        });
    };

    const handleSaveEdit = async () => {
        if (!editingReport) return;
        setSavingEdit(true);
        try {
            await fetch(`/api/test-reports/${editingReport.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editingReport),
            });
            setEditingReport(null);
            await refreshReports();
        } finally {
            setSavingEdit(false);
        }
    };

    const toggleSelect = (id) => {
        setSelectedIds((current) =>
            current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
        );
    };

    const toggleSelectAll = () => {
        const visibleIds = filteredReports.map((r) => r.id);
        const allSelected = visibleIds.every((id) => selectedIds.includes(id));
        setSelectedIds(allSelected ? [] : visibleIds);
    };

    const summaryStats = useMemo(() => {
        const totalValue = filteredReports.reduce((sum, r) => sum + getReportTotalValue(r), 0);
        return {
            count: filteredReports.length,
            totalValue: Number(totalValue.toFixed(2)),
        };
    }, [filteredReports]);

    return (
        <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <h2 className="section-title" style={{ margin: 0 }}>检测报告管理</h2>
                <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>
                    报告导入 &middot; 角色产值分配
                </span>
            </div>

            {/* Import Area */}
            <div style={{
                background: 'var(--color-surface)',
                borderRadius: 'var(--radius)',
                border: 'var(--glass-border)',
                backdropFilter: 'var(--glass-blur)',
                padding: 'var(--spacing)',
            }}>
                <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--color-muted)' }}>
                    粘贴制表符分隔的报告数据（日期 | 报告编号 | 项目名称 | 检测内容 | 数量 | 单位 | 编写人 | 主检人 | 审核人 | 批准人）
                </div>
                <textarea
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    placeholder={'2026-03-20\tBG-2026-001\t某建设项目\t沉降观测\t5\t点\t张三\t李四\t王五\t赵六'}
                    rows={4}
                    style={{
                        width: '100%',
                        padding: '10px 14px',
                        borderRadius: 10,
                        border: '1px solid var(--color-border)',
                        background: 'rgba(255,255,255,0.6)',
                        resize: 'vertical',
                        fontSize: 13,
                        fontFamily: 'var(--font-body)',
                    }}
                />
                <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center' }}>
                    <button
                        className="btn-primary"
                        onClick={handleImport}
                        disabled={importing || !rawText.trim()}
                    >
                        {importing ? '导入中…' : '导入报告'}
                    </button>
                    {result && !result.error && (
                        <span style={{ fontSize: 13, color: 'var(--color-success)' }}>
                            成功导入 {result.saved}/{result.total} 条，已计价 {result.pricedCount} 条
                            {result.newProjects?.length > 0 && (
                                <> · 新建项目: {result.newProjects.map((p) => p.name).join(', ')}</>
                            )}
                        </span>
                    )}
                    {result?.error && (
                        <span style={{ fontSize: 13, color: 'var(--color-danger)' }}>
                            {result.error}
                        </span>
                    )}
                </div>
            </div>

            {/* Filters & Toolbar */}
            <div style={{
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                flexWrap: 'wrap',
            }}>
                <input
                    placeholder="搜索项目…"
                    value={filters.project}
                    onChange={(e) => setFilters((f) => ({ ...f, project: e.target.value }))}
                    style={{
                        padding: '6px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--color-border)',
                        fontSize: 13,
                        width: 140,
                    }}
                />
                <input
                    placeholder="搜索人员…"
                    value={filters.staff}
                    onChange={(e) => setFilters((f) => ({ ...f, staff: e.target.value }))}
                    style={{
                        padding: '6px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--color-border)',
                        fontSize: 13,
                        width: 140,
                    }}
                />
                <input
                    placeholder="搜索编号/内容…"
                    value={filters.search}
                    onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                    style={{
                        padding: '6px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--color-border)',
                        fontSize: 13,
                        width: 160,
                    }}
                />
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>
                    共 {summaryStats.count} 条 · 产值合计 {formatCurrency(summaryStats.totalValue)}
                </span>
                {selectedIds.length > 0 && (
                    <button
                        className="btn-danger"
                        onClick={handleBatchDelete}
                        disabled={deletingBatch}
                    >
                        {deletingBatch ? '删除中…' : `删除选中 (${selectedIds.length})`}
                    </button>
                )}
            </div>

            {/* Data Table */}
            <div className="data-table-shell">
                {loading ? (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-muted)' }}>
                        加载中…
                    </div>
                ) : filteredReports.length === 0 ? (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-muted)' }}>
                        暂无检测报告记录
                    </div>
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th style={{ width: 36 }}>
                                    <input
                                        type="checkbox"
                                        checked={filteredReports.length > 0 && filteredReports.every((r) => selectedIds.includes(r.id))}
                                        onChange={toggleSelectAll}
                                    />
                                </th>
                                <th>日期</th>
                                <th>报告编号</th>
                                <th>项目</th>
                                <th>检测内容</th>
                                <th>数量</th>
                                <th>编写</th>
                                <th>主检</th>
                                <th>审核</th>
                                <th>批准</th>
                                <th>产值合计</th>
                                <th>状态</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredReports.map((report) => {
                                const totalValue = getReportTotalValue(report);
                                const hasValue = totalValue > 0;
                                return (
                                    <tr key={report.id}>
                                        <td>
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.includes(report.id)}
                                                onChange={() => toggleSelect(report.id)}
                                            />
                                        </td>
                                        <td>{report.reportDate ? new Date(report.reportDate).toISOString().split('T')[0] : '-'}</td>
                                        <td><code>{report.reportNo || '-'}</code></td>
                                        <td>{report.project?.name || '未绑定'}</td>
                                        <td>{report.testContent}</td>
                                        <td>{report.quantity}{report.unit ? ` ${report.unit}` : ''}</td>
                                        <td>{getRoleStaff(report, '编写') || '-'}</td>
                                        <td>{getRoleStaff(report, '主检') || '-'}</td>
                                        <td>{getRoleStaff(report, '审核') || '-'}</td>
                                        <td>{getRoleStaff(report, '批准') || '-'}</td>
                                        <td style={{ fontFamily: 'var(--font-data)', fontWeight: hasValue ? 600 : 400 }}>
                                            {hasValue ? formatCurrency(totalValue) : '-'}
                                        </td>
                                        <td>
                                            <span className={`status-badge ${hasValue ? 'status-badge--approved' : 'status-badge--pending'}`}>
                                                {hasValue ? '已计价' : '未匹配'}
                                            </span>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: 6 }}>
                                                <button
                                                    onClick={() => openEdit(report)}
                                                    style={{
                                                        padding: '3px 10px',
                                                        fontSize: 12,
                                                        borderRadius: 6,
                                                        border: '1px solid var(--color-border)',
                                                        background: 'var(--color-surface)',
                                                        cursor: 'pointer',
                                                    }}
                                                >
                                                    编辑
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(report.id)}
                                                    style={{
                                                        padding: '3px 10px',
                                                        fontSize: 12,
                                                        borderRadius: 6,
                                                        border: '1px solid var(--color-danger)',
                                                        color: 'var(--color-danger)',
                                                        background: 'transparent',
                                                        cursor: 'pointer',
                                                    }}
                                                >
                                                    删除
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Edit Modal */}
            {editingReport && (
                <div className="modal-backdrop" onClick={() => setEditingReport(null)}>
                    <div
                        className="modal-content"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            background: 'var(--color-surface-strong)',
                            borderRadius: 'var(--radius)',
                            padding: 'var(--spacing)',
                            maxWidth: 560,
                            width: '90vw',
                            maxHeight: '80vh',
                            overflow: 'auto',
                        }}
                    >
                        <h3 style={{ marginBottom: 16 }}>编辑检测报告</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                                日期
                                <input
                                    type="date"
                                    value={editingReport.reportDate}
                                    onChange={(e) => setEditingReport((r) => ({ ...r, reportDate: e.target.value }))}
                                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--color-border)' }}
                                />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                                报告编号
                                <input
                                    value={editingReport.reportNo}
                                    onChange={(e) => setEditingReport((r) => ({ ...r, reportNo: e.target.value }))}
                                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--color-border)' }}
                                />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, gridColumn: 'span 2' }}>
                                项目名称
                                <input
                                    value={editingReport.projectName}
                                    onChange={(e) => setEditingReport((r) => ({ ...r, projectName: e.target.value }))}
                                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--color-border)' }}
                                />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, gridColumn: 'span 2' }}>
                                检测内容
                                <input
                                    value={editingReport.testContent}
                                    onChange={(e) => setEditingReport((r) => ({ ...r, testContent: e.target.value }))}
                                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--color-border)' }}
                                />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                                数量
                                <input
                                    type="number"
                                    value={editingReport.quantity}
                                    onChange={(e) => setEditingReport((r) => ({ ...r, quantity: e.target.value }))}
                                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--color-border)' }}
                                />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                                单位
                                <input
                                    value={editingReport.unit}
                                    onChange={(e) => setEditingReport((r) => ({ ...r, unit: e.target.value }))}
                                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--color-border)' }}
                                />
                            </label>
                            <div style={{ gridColumn: 'span 2', borderTop: '1px solid var(--color-border)', paddingTop: 12, marginTop: 4 }}>
                                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>报告角色</div>
                            </div>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                                编写人
                                <input
                                    value={editingReport.writer}
                                    onChange={(e) => setEditingReport((r) => ({ ...r, writer: e.target.value }))}
                                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--color-border)' }}
                                />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                                主检人
                                <input
                                    value={editingReport.inspector}
                                    onChange={(e) => setEditingReport((r) => ({ ...r, inspector: e.target.value }))}
                                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--color-border)' }}
                                />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                                审核人
                                <input
                                    value={editingReport.reviewer}
                                    onChange={(e) => setEditingReport((r) => ({ ...r, reviewer: e.target.value }))}
                                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--color-border)' }}
                                />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                                批准人
                                <input
                                    value={editingReport.approver}
                                    onChange={(e) => setEditingReport((r) => ({ ...r, approver: e.target.value }))}
                                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--color-border)' }}
                                />
                            </label>
                        </div>
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
                            <button
                                onClick={() => setEditingReport(null)}
                                style={{
                                    padding: '8px 20px',
                                    borderRadius: 8,
                                    border: '1px solid var(--color-border)',
                                    background: 'var(--color-surface)',
                                    cursor: 'pointer',
                                }}
                            >
                                取消
                            </button>
                            <button
                                className="btn-primary"
                                onClick={handleSaveEdit}
                                disabled={savingEdit}
                            >
                                {savingEdit ? '保存中…' : '保存'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
