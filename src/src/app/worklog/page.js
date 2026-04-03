'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
    allocationShareToPercent,
    getWorklogBillingState,
    sumProductionValues,
} from '@/lib/worklogBilling';

function formatCurrency(value) {
    return `CNY ${Number(value || 0).toFixed(2)}`;
}

function formatNumber(value) {
    return Number(value || 0).toFixed(2).replace(/\.?0+$/u, '');
}

function getStaffNames(log) {
    return (log.staffMembers || [])
        .map((item) => item.staff?.name)
        .filter(Boolean);
}

function getStatusClass(tone) {
    if (tone === 'approved') return 'status-badge--approved';
    if (tone === 'warning') return 'status-badge--rejected';
    return 'status-badge--pending';
}

function buildAllocationItemFromLog(log) {
    const contract = log.project?.contract;
    return {
        workLogId: log.id,
        contractId: contract?.id || null,
        contractNo: contract?.contractNo || '',
        projectId: log.project?.id || null,
        projectName: log.project?.name || '',
        workDate: log.workDate,
        testContent: log.testContent,
        quantity: Number(log.quantity || 0),
        unit: log.unit || '',
        remarks: log.remarks || '',
        allocationShare: log.allocationShare,
        contractAmount: Number(contract?.areaPricingAmount || 0),
        contractArea: contract?.areaPricingArea === null || contract?.areaPricingArea === undefined
            ? null
            : Number(contract.areaPricingArea),
        staffNames: getStaffNames(log),
    };
}

export default function WorkLogPage() {
    const router = useRouter();
    const [rawText, setRawText] = useState('');
    const [result, setResult] = useState(null);
    const [logs, setLogs] = useState([]);
    const [selectedIds, setSelectedIds] = useState([]);
    const [loading, setLoading] = useState(true);
    const [parsingText, setParsingText] = useState(false);
    const [uploadingFile, setUploadingFile] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);
    const [editingLog, setEditingLog] = useState(null);
    const [savingEdit, setSavingEdit] = useState(false);
    const [deletingBatch, setDeletingBatch] = useState(false);
    const [allocationQueue, setAllocationQueue] = useState([]);
    const [activeAllocation, setActiveAllocation] = useState(null);
    const [allocationPercent, setAllocationPercent] = useState('');
    const [submittingAllocation, setSubmittingAllocation] = useState(false);
    const [filters, setFilters] = useState({
        project: '',
        staff: '',
        date: '',
        search: '',
    });

    const refreshLogs = async () => {
        const response = await fetch(`/api/worklog?_t=${Date.now()}`, { cache: 'no-store' });
        const data = await response.json();
        setLogs(Array.isArray(data) ? data : []);
        setSelectedIds((current) => current.filter((id) => data.some((log) => log.id === id)));
    };

    useEffect(() => {
        let cancelled = false;

        fetch(`/api/worklog?_t=${Date.now()}`, { cache: 'no-store' })
            .then((response) => response.json())
            .then((data) => {
                if (!cancelled) {
                    setLogs(Array.isArray(data) ? data : []);
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    console.error('加载工作记录失败:', error);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const queuePendingAllocations = (items) => {
        const pendingItems = (Array.isArray(items) ? items : []).filter((item) => item?.workLogId);
        if (pendingItems.length === 0) {
            return;
        }

        setAllocationQueue((current) => {
            const seen = new Set([
                ...(activeAllocation?.workLogId ? [activeAllocation.workLogId] : []),
                ...current.map((item) => item.workLogId),
            ]);
            const nextItems = pendingItems.filter((item) => !seen.has(item.workLogId));
            if (nextItems.length === 0) {
                return current;
            }

            if (!activeAllocation) {
                const [first, ...rest] = nextItems;
                setActiveAllocation(first);
                setAllocationPercent(allocationShareToPercent(first.allocationShare));
                return [...current, ...rest];
            }

            return [...current, ...nextItems];
        });
    };

    const finishCurrentAllocation = () => {
        setAllocationQueue((current) => {
            const [next, ...rest] = current;
            setActiveAllocation(next || null);
            setAllocationPercent(next ? allocationShareToPercent(next.allocationShare) : '');
            return rest;
        });
    };

    const closeAllocationModal = () => {
        setActiveAllocation(null);
        setAllocationQueue([]);
        setAllocationPercent('');
    };

    const applyImportResult = async (response) => {
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || '导入失败');
        }

        setResult(data);
        await refreshLogs();
        queuePendingAllocations(data.pendingAllocations);
    };

    const handleParse = async () => {
        if (!rawText.trim()) {
            return;
        }

        setParsingText(true);
        try {
            const response = await fetch('/api/worklog', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rawText }),
            });
            await applyImportResult(response);
            setRawText('');
        } catch (error) {
            setResult({ errors: [{ message: `请求失败：${error.message}` }], saved: 0 });
        } finally {
            setParsingText(false);
        }
    };

    const handleImportFile = async () => {
        if (!selectedFile) {
            return;
        }

        setUploadingFile(true);
        try {
            const formData = new FormData();
            formData.append('file', selectedFile);

            const response = await fetch('/api/worklog', {
                method: 'POST',
                body: formData,
            });
            await applyImportResult(response);
            setSelectedFile(null);
        } catch (error) {
            setResult({ errors: [{ message: `导入失败：${error.message}` }], saved: 0 });
        } finally {
            setUploadingFile(false);
        }
    };

    const handleOpenContractUpload = (project) => {
        if (!project?.id) {
            return;
        }

        const params = new URLSearchParams({
            projectId: String(project.id),
            projectName: project.name || '',
        });

        router.push(`/contracts?${params.toString()}`);
    };

    const handleToggleSelect = (id) => {
        setSelectedIds((current) => (
            current.includes(id)
                ? current.filter((selectedId) => selectedId !== id)
                : [...current, id]
        ));
    };

    const handleToggleSelectAll = (availableLogs) => {
        if (selectedIds.length === availableLogs.length) {
            setSelectedIds([]);
            return;
        }

        setSelectedIds(availableLogs.map((log) => log.id));
    };

    const handleSaveEdit = async () => {
        setSavingEdit(true);
        try {
            const response = await fetch(`/api/worklog/${editingLog.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workDate: editingLog.workDate,
                    projectName: editingLog.projectName,
                    testContent: editingLog.testContent,
                    quantity: editingLog.quantity,
                    unit: editingLog.unit,
                    remarks: editingLog.remarks,
                    staffNames: editingLog.staffNames,
                    manualTotalValue: editingLog.productionMode === 'manual' ? editingLog.manualTotalValue : '',
                    manualValueNote: editingLog.productionMode === 'manual' ? editingLog.manualValueNote : '',
                }),
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || '保存失败');
            }

            setEditingLog(null);
            await refreshLogs();
            queuePendingAllocations(data.pendingAllocation ? [data.pendingAllocation] : []);
        } catch (error) {
            alert(`保存失败：${error.message}`);
        } finally {
            setSavingEdit(false);
        }
    };

    const handleDelete = async (id) => {
        if (!confirm('确定删除这条工作记录吗？对应产值也会同步删除。')) {
            return;
        }

        try {
            const response = await fetch(`/api/worklog/${id}`, { method: 'DELETE' });
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || '删除失败');
            }

            setSelectedIds((current) => current.filter((selectedId) => selectedId !== id));
            await refreshLogs();
        } catch (error) {
            alert(`删除失败：${error.message}`);
        }
    };

    const handleBatchDelete = async () => {
        if (!selectedIds.length) {
            return;
        }

        if (!confirm(`确定批量删除选中的 ${selectedIds.length} 条记录吗？对应产值会一起清除。`)) {
            return;
        }

        setDeletingBatch(true);
        try {
            const response = await fetch('/api/worklog', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: selectedIds }),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || '批量删除失败');
            }

            setSelectedIds([]);
            await refreshLogs();
        } catch (error) {
            alert(`批量删除失败：${error.message}`);
        } finally {
            setDeletingBatch(false);
        }
    };

    const handleSubmitAllocation = async () => {
        if (!activeAllocation) {
            return;
        }

        const numericPercent = Number.parseFloat(allocationPercent);
        if (!Number.isFinite(numericPercent) || numericPercent <= 0 || numericPercent > 100) {
            alert('请输入 0 到 100 之间的占比百分比。');
            return;
        }

        setSubmittingAllocation(true);
        try {
            const response = await fetch(`/api/worklog/${activeAllocation.workLogId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    allocationShare: numericPercent,
                }),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || '确认占比失败');
            }

            await refreshLogs();

            if (data.pendingAllocation) {
                setActiveAllocation(data.pendingAllocation);
                setAllocationPercent(allocationShareToPercent(data.pendingAllocation.allocationShare));
            } else {
                finishCurrentAllocation();
            }
        } catch (error) {
            alert(`确认占比失败：${error.message}`);
        } finally {
            setSubmittingAllocation(false);
        }
    };

    const projectOptions = useMemo(() => Array.from(
        new Set(logs.map((log) => log.project?.name).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b, 'zh-CN')), [logs]);

    const staffOptions = useMemo(() => Array.from(
        new Set(logs.flatMap((log) => getStaffNames(log))),
    ).sort((a, b) => a.localeCompare(b, 'zh-CN')), [logs]);

    const filteredLogs = useMemo(() => logs.filter((log) => {
        const projectName = log.project?.name || '';
        const staffNames = getStaffNames(log).join('、');
        const workDate = new Date(log.workDate).toISOString().slice(0, 10);
        const totalValue = sumProductionValues(log);
        const haystack = `${projectName} ${log.testContent} ${staffNames} ${log.remarks || ''} ${totalValue}`.toLowerCase();

        if (filters.project && projectName !== filters.project) {
            return false;
        }
        if (filters.staff && !getStaffNames(log).includes(filters.staff)) {
            return false;
        }
        if (filters.date && workDate !== filters.date) {
            return false;
        }
        if (filters.search && !haystack.includes(filters.search.toLowerCase())) {
            return false;
        }

        return true;
    }), [filters, logs]);

    const selectedVisibleCount = filteredLogs.filter((log) => selectedIds.includes(log.id)).length;
    const allSelected = filteredLogs.length > 0 && selectedVisibleCount === filteredLogs.length;
    const filteredTotalValue = filteredLogs.reduce((sum, log) => sum + sumProductionValues(log), 0);
    const filteredWorkload = filteredLogs.reduce((sum, log) => sum + Number(log.quantity || 0), 0);
    const pendingAreaCount = filteredLogs.filter((log) => getWorklogBillingState(log).code === 'pending-area-share').length;
    const noContractCount = filteredLogs.filter((log) => {
        const state = getWorklogBillingState(log);
        return state.code === 'workload-only' || state.code === 'no-contract-guide-price';
    }).length;

    return (
        <>
            <div className="page-header">
                <div>
                    <div className="page-kicker">Inspection Ledger</div>
                    <h2>工作记录</h2>
                    <p className="page-desc">
                        统一管理 Excel / WPS 导入、工作量拆分、面积合同占比确认和产值回写。
                        即使项目还没签合同，也会先把人员工作量纳入统计。
                    </p>
                </div>
                <div className="page-actions">
                    <span className="status-badge status-badge--approved">{filteredLogs.length} 条记录</span>
                    <span className="status-badge status-badge--pending">{formatCurrency(filteredTotalValue)}</span>
                </div>
            </div>

            <div className="page-body">
                <div className="report-kpis">
                    <div className="mini-kpi">
                        <div className="mini-kpi-label">可见记录</div>
                        <div className="mini-kpi-value">{filteredLogs.length}</div>
                    </div>
                    <div className="mini-kpi">
                        <div className="mini-kpi-label">工作量合计</div>
                        <div className="mini-kpi-value">{formatNumber(filteredWorkload)}</div>
                    </div>
                    <div className="mini-kpi">
                        <div className="mini-kpi-label">待确认占比</div>
                        <div className="mini-kpi-value">{pendingAreaCount}</div>
                    </div>
                    <div className="mini-kpi">
                        <div className="mini-kpi-label">未签合同</div>
                        <div className="mini-kpi-value">{noContractCount}</div>
                    </div>
                </div>

                <div className="report-grid">
                    <section className="card">
                        <div className="panel-top">
                            <div className="panel-copy">
                                <div className="panel-eyebrow">Workbook Intake</div>
                                <div className="panel-title">Excel / WPS 文件导入</div>
                                <div className="panel-note">支持 `.xlsx` / `.xls`，导入后会自动尝试计价；面积合同会进入占比确认队列。</div>
                            </div>
                        </div>

                        <div className="form-grid">
                            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                                <label htmlFor="workbook-file">选择文件</label>
                                <input
                                    id="workbook-file"
                                    type="file"
                                    accept=".xlsx,.xls"
                                    onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                                />
                            </div>
                        </div>

                        <div className="action-row mt-4">
                            <button className="btn btn-primary" onClick={handleImportFile} disabled={!selectedFile || uploadingFile}>
                                {uploadingFile ? '导入中' : '导入 Excel'}
                            </button>
                            {selectedFile && <span className="ghost-note">已选择：{selectedFile.name}</span>}
                        </div>
                    </section>

                    <section className="card">
                        <div className="panel-top">
                            <div className="panel-copy">
                                <div className="panel-eyebrow">Manual Intake</div>
                                <div className="panel-title">WPS 粘贴导入</div>
                                <div className="panel-note">字段顺序：日期、项目、检测内容、数量、人员、备注。</div>
                            </div>
                        </div>

                        <textarea
                            className="form-textarea"
                            value={rawText}
                            onChange={(event) => setRawText(event.target.value)}
                            placeholder={'2026-03-18\t建宁路西段\t轻型动力触探\t10点\t张三、李四\t3#楼东侧'}
                        />

                        <div className="action-row mt-4">
                            <button className="btn btn-primary" onClick={handleParse} disabled={parsingText || !rawText.trim()}>
                                {parsingText ? '解析中' : '解析并保存'}
                            </button>
                            <button className="btn btn-secondary" onClick={() => { setRawText(''); setResult(null); }}>
                                清空
                            </button>
                        </div>
                    </section>
                </div>

                {result && (
                    <div className="card">
                        <div className="panel-top">
                            <div className="panel-copy">
                                <div className="panel-eyebrow">Import Result</div>
                                <div className="panel-title">最近一次导入结果</div>
                                <div className="panel-note">
                                    已保存 {result.saved || 0} 条，计价成功 {result.pricedCount || 0} 条，仅统计工作量 {result.workloadOnlyCount || 0} 条。
                                </div>
                            </div>
                        </div>
                        <div className="chip-row">
                            <span className="badge badge-success">Saved {result.saved || 0}</span>
                            {typeof result.originalRows === 'number' && <span className="badge badge-info">Rows {result.originalRows}</span>}
                            {typeof result.expandedItems === 'number' && <span className="badge badge-info">Expanded {result.expandedItems}</span>}
                            {result.newProjects?.length > 0 && <span className="badge badge-success">New Projects {result.newProjects.length}</span>}
                            {result.pendingAllocations?.length > 0 && <span className="badge badge-warning">待确认占比 {result.pendingAllocations.length}</span>}
                            {result.errors?.length > 0 && <span className="badge badge-danger">Errors {result.errors.length}</span>}
                        </div>
                        {result.newProjects?.length > 0 ? (
                            <div className="mt-4 stack-sm">
                                <div className="panel-note">识别到新的项目台账。可以直接跳到合同管理页上传合同，保存时会自动关联到对应项目。</div>
                                <div className="chip-row">
                                    {result.newProjects.map((project) => (
                                        <button
                                            key={project.id}
                                            type="button"
                                            className="btn btn-secondary"
                                            onClick={() => handleOpenContractUpload(project)}
                                        >
                                            上传并关联：{project.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                        {result.errors?.length > 0 && (
                            <div className="mt-4" style={{ display: 'grid', gap: '10px' }}>
                                {result.errors.map((item, index) => (
                                    <div key={`${item.rowIndex || 'e'}-${index}`} className="alert alert-danger">
                                        {item.message} {item.raw ? `| ${item.raw}` : ''}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                <section className="filter-bar">
                    <div className="filter-stack">
                        <label className="form-label" htmlFor="filter-project">项目</label>
                        <select
                            id="filter-project"
                            className="form-select"
                            value={filters.project}
                            onChange={(event) => setFilters((current) => ({ ...current, project: event.target.value }))}
                        >
                            <option value="">全部项目</option>
                            {projectOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                    </div>
                    <div className="filter-stack">
                        <label className="form-label" htmlFor="filter-staff">人员</label>
                        <select
                            id="filter-staff"
                            className="form-select"
                            value={filters.staff}
                            onChange={(event) => setFilters((current) => ({ ...current, staff: event.target.value }))}
                        >
                            <option value="">全部人员</option>
                            {staffOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                    </div>
                    <div className="filter-stack">
                        <label className="form-label" htmlFor="filter-date">日期</label>
                        <input
                            id="filter-date"
                            className="form-input"
                            type="date"
                            value={filters.date}
                            onChange={(event) => setFilters((current) => ({ ...current, date: event.target.value }))}
                        />
                    </div>
                    <div className="filter-stack">
                        <label className="form-label" htmlFor="filter-search">搜索</label>
                        <input
                            id="filter-search"
                            className="form-input"
                            value={filters.search}
                            onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                            placeholder="项目 / 内容 / 人员 / 备注"
                        />
                    </div>
                </section>

                <section className="table-shell">
                    <div className="table-toolbar">
                        <div className="panel-copy">
                            <div className="panel-eyebrow">Glass Ledger</div>
                            <div className="panel-title">工作记录总账</div>
                            <div className="panel-note">面积合同会在这里直接提示“确认占比”，未签合同也会保留工作量统计。</div>
                        </div>
                        <div className="table-toolbar-meta">
                            <span>可见 {filteredLogs.length} 条</span>
                            <span>已选 {selectedIds.length} 条</span>
                            <button className="btn btn-secondary" onClick={() => setSelectedIds([])} disabled={!selectedIds.length}>取消选择</button>
                            <button className="btn btn-danger" onClick={handleBatchDelete} disabled={!selectedIds.length || deletingBatch}>
                                {deletingBatch ? '删除中' : `批量删除 (${selectedIds.length})`}
                            </button>
                        </div>
                    </div>

                    <div className="data-table-shell">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th style={{ width: '50px' }}>
                                        <input
                                            type="checkbox"
                                            checked={allSelected}
                                            onChange={() => handleToggleSelectAll(filteredLogs)}
                                            aria-label="全选可见工作记录"
                                        />
                                    </th>
                                    <th>日期</th>
                                    <th>项目</th>
                                    <th>检测内容</th>
                                    <th>数量</th>
                                    <th>人员</th>
                                    <th>状态</th>
                                    <th className="text-right">产值</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    Array.from({ length: 8 }).map((_, index) => (
                                        <tr key={`skeleton-${index}`}>
                                            <td colSpan="9">
                                                <div className="progress-strip">
                                                    <div className="progress-value" style={{ width: `${36 + index * 8}%` }} />
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                ) : filteredLogs.length === 0 ? (
                                    <tr>
                                        <td colSpan="9">
                                            <div className="empty-state">
                                                <div>
                                                    <div className="empty-dot" />
                                                    <strong>Awaiting Data Node Connection</strong>
                                                    当前筛选条件下没有工作记录。
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    filteredLogs.map((log) => {
                                        const totalValue = sumProductionValues(log);
                                        const isSelected = selectedIds.includes(log.id);
                                        const staffNames = getStaffNames(log);
                                        const status = getWorklogBillingState(log);

                                        return (
                                            <tr key={log.id} style={isSelected ? { background: 'rgba(64, 160, 255, 0.08)' } : undefined}>
                                                <td>
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => handleToggleSelect(log.id)}
                                                        aria-label={`选择工作记录 ${log.id}`}
                                                    />
                                                </td>
                                                <td>{new Date(log.workDate).toLocaleDateString('zh-CN')}</td>
                                                <td>{log.project?.name || '未绑定项目'}</td>
                                                <td>
                                                    <div>{log.testContent}</div>
                                                    <div className="feed-item-meta">
                                                        {log.remarks || '无备注'}
                                                        {log.allocationShare
                                                            ? ` · 已确认 ${(Number(log.allocationShare) * 100).toFixed(2).replace(/\.?0+$/u, '')}%`
                                                            : ''}
                                                    </div>
                                                </td>
                                                <td>{log.quantity}{log.unit || ''}</td>
                                                <td>
                                                    <div className="chip-row">
                                                        {staffNames.length > 0
                                                            ? staffNames.map((item) => <span key={`${log.id}-${item}`} className="badge badge-info">{item}</span>)
                                                            : <span className="badge badge-warning">未分配</span>}
                                                    </div>
                                                </td>
                                                <td>
                                                    <span className={`status-badge ${getStatusClass(status.tone)}`}>{status.label}</span>
                                                </td>
                                                <td className="text-right"><span className="value-text">{formatCurrency(totalValue)}</span></td>
                                                <td>
                                                    <div className="chip-row">
                                                        {status.code === 'pending-area-share' && (
                                                            <button
                                                                className="btn btn-primary"
                                                                onClick={() => {
                                                                    const item = buildAllocationItemFromLog(log);
                                                                    setActiveAllocation(item);
                                                                    setAllocationPercent(allocationShareToPercent(item.allocationShare));
                                                                }}
                                                            >
                                                                确认占比
                                                            </button>
                                                        )}
                                                        <button
                                                            className="btn btn-secondary"
                                                            onClick={() => setEditingLog({
                                                                ...log,
                                                                workDate: new Date(log.workDate).toISOString().slice(0, 10),
                                                                projectName: log.project?.name || '',
                                                                staffNames,
                                                                productionMode: log.productionValues?.some((item) => item.calculationMode === 'manual') || Number(log.manualTotalValue || 0) > 0 ? 'manual' : 'auto',
                                                                manualTotalValue: log.manualTotalValue ?? '',
                                                                manualValueNote: log.manualValueNote || '',
                                                            })}
                                                        >
                                                            编辑
                                                        </button>
                                                        <button className="btn btn-danger" onClick={() => handleDelete(log.id)}>删除</button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>

            {editingLog && (
                <div className="modal-backdrop" onClick={() => setEditingLog(null)}>
                    <div className="modal-card" onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <div className="page-kicker">Ledger Edit</div>
                                <div className="modal-title">编辑工作记录</div>
                                <div className="modal-note">修改后会重新计算产值；面积合同如果还没确认占比，会再次进入提示队列。</div>
                            </div>
                            <button className="btn btn-secondary" onClick={() => setEditingLog(null)}>关闭</button>
                        </div>

                        <div className="form-grid">
                            <div className="form-group">
                                <label htmlFor="edit-date">日期</label>
                                <input
                                    id="edit-date"
                                    type="date"
                                    className="form-input"
                                    value={editingLog.workDate}
                                    onChange={(event) => setEditingLog((current) => ({ ...current, workDate: event.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="edit-project">项目名称</label>
                                <input
                                    id="edit-project"
                                    className="form-input"
                                    value={editingLog.projectName}
                                    onChange={(event) => setEditingLog((current) => ({ ...current, projectName: event.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="edit-content">检测内容</label>
                                <input
                                    id="edit-content"
                                    className="form-input"
                                    value={editingLog.testContent}
                                    onChange={(event) => setEditingLog((current) => ({ ...current, testContent: event.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="edit-staff">人员</label>
                                <input
                                    id="edit-staff"
                                    className="form-input"
                                    value={editingLog.staffNames.join('、')}
                                    onChange={(event) => setEditingLog((current) => ({
                                        ...current,
                                        staffNames: event.target.value.split(/[,，、\s]+/u).map((item) => item.trim()).filter(Boolean),
                                    }))}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="edit-quantity">数量</label>
                                <input
                                    id="edit-quantity"
                                    type="number"
                                    className="form-input"
                                    value={editingLog.quantity}
                                    onChange={(event) => setEditingLog((current) => ({ ...current, quantity: event.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="edit-unit">单位</label>
                                <input
                                    id="edit-unit"
                                    className="form-input"
                                    value={editingLog.unit || ''}
                                    onChange={(event) => setEditingLog((current) => ({ ...current, unit: event.target.value }))}
                                />
                            </div>
                        </div>

                        <div className="form-grid">
                            <div className="form-group">
                                <label htmlFor="edit-production-mode">产值方式</label>
                                <select
                                    id="edit-production-mode"
                                    className="form-select"
                                    value={editingLog.productionMode || 'auto'}
                                    onChange={(event) => setEditingLog((current) => ({
                                        ...current,
                                        productionMode: event.target.value,
                                    }))}
                                >
                                    <option value="auto">自动计算</option>
                                    <option value="manual">手工指定总产值</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label htmlFor="edit-manual-total">手工总产值</label>
                                <input
                                    id="edit-manual-total"
                                    type="number"
                                    step="0.01"
                                    className="form-input"
                                    value={editingLog.manualTotalValue ?? ''}
                                    onChange={(event) => setEditingLog((current) => ({
                                        ...current,
                                        manualTotalValue: event.target.value,
                                    }))}
                                    placeholder="留空时按自动计算"
                                    disabled={(editingLog.productionMode || 'auto') !== 'manual'}
                                />
                            </div>
                        </div>

                        <div className="form-group mt-4">
                            <label htmlFor="edit-manual-note">产值说明</label>
                            <input
                                id="edit-manual-note"
                                className="form-input"
                                value={editingLog.manualValueNote || ''}
                                onChange={(event) => setEditingLog((current) => ({
                                    ...current,
                                    manualValueNote: event.target.value,
                                }))}
                                placeholder="例如：现场加急、包干价、专项补贴"
                                disabled={(editingLog.productionMode || 'auto') !== 'manual'}
                            />
                            <div className="field-note">手工模式会把这条工作记录的总产值按参与人员平均分配；切回自动计算后这里会被忽略。</div>
                        </div>

                        <div className="form-group mt-4">
                            <label htmlFor="edit-remarks">备注</label>
                            <textarea
                                id="edit-remarks"
                                className="form-textarea"
                                value={editingLog.remarks || ''}
                                onChange={(event) => setEditingLog((current) => ({ ...current, remarks: event.target.value }))}
                            />
                        </div>

                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setEditingLog(null)}>取消</button>
                            <button className="btn btn-primary" onClick={handleSaveEdit} disabled={savingEdit}>
                                {savingEdit ? '保存中' : '保存修改'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {activeAllocation && (
                <div className="modal-backdrop" onClick={closeAllocationModal}>
                    <div className="modal-card" onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <div className="page-kicker">Area Contract</div>
                                <div className="modal-title">确认本次检测占比</div>
                                <div className="modal-note">该项目合同按面积计价。请确认本次检测对应的合同占比，系统会按合同总金额自动折算产值。</div>
                            </div>
                            <button className="btn btn-secondary" onClick={closeAllocationModal}>稍后处理</button>
                        </div>

                        <div className="surface-grid">
                            <div className="surface-item">
                                <div className="surface-title">项目</div>
                                <div className="surface-note">{activeAllocation.projectName || '未绑定项目'}</div>
                            </div>
                            <div className="surface-item">
                                <div className="surface-title">合同编号</div>
                                <div className="surface-note">{activeAllocation.contractNo || '未填写'}</div>
                            </div>
                            <div className="surface-item">
                                <div className="surface-title">合同总金额</div>
                                <div className="surface-note">{formatCurrency(activeAllocation.contractAmount)}</div>
                            </div>
                            <div className="surface-item">
                                <div className="surface-title">合同面积</div>
                                <div className="surface-note">{activeAllocation.contractArea ? `${formatNumber(activeAllocation.contractArea)} ㎡` : '未填写'}</div>
                            </div>
                        </div>

                        <div className="stack-sm mt-4">
                            <div className="surface-item">
                                <div className="surface-title">检测内容</div>
                                <div className="surface-note">{activeAllocation.testContent} · {activeAllocation.quantity}{activeAllocation.unit || ''}</div>
                            </div>
                            <div className="surface-item">
                                <div className="surface-title">参与人员</div>
                                <div className="surface-note">{activeAllocation.staffNames?.join('、') || '未分配'}</div>
                            </div>
                            {activeAllocation.remarks && (
                                <div className="surface-item">
                                    <div className="surface-title">备注</div>
                                    <div className="surface-note">{activeAllocation.remarks}</div>
                                </div>
                            )}
                        </div>

                        <div className="form-group mt-4">
                            <label htmlFor="allocation-percent">本次检测占合同金额比例 (%)</label>
                            <input
                                id="allocation-percent"
                                type="number"
                                step="0.01"
                                className="form-input"
                                value={allocationPercent}
                                onChange={(event) => setAllocationPercent(event.target.value)}
                                placeholder="例如 3.5"
                            />
                            <div className="field-note">例如填写 `3.5`，系统会按合同总金额的 3.5% 计算本次检测产值，再在参与人员之间均分。</div>
                        </div>

                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={closeAllocationModal}>稍后再说</button>
                            <button className="btn btn-primary" onClick={handleSubmitAllocation} disabled={submittingAllocation}>
                                {submittingAllocation ? '保存中' : '确认并计算产值'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
