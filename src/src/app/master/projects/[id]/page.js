'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

const EDITABLE_COLUMNS = [
    { key: 'testCategory', label: '检测类别' },
    { key: 'testItem', label: '检测项目' },
    { key: 'quantityText', label: '已检测数量' },
    { key: 'detectDate', label: '检测时间', type: 'date' },
    { key: 'reportNo', label: '报告编号' },
    { key: 'reportEditor', label: '报告编制' },
    { key: 'mainTester', label: '主检' },
    { key: 'reviewer', label: '审核' },
    { key: 'approver', label: '批准' },
    { key: 'remarks', label: '备注' },
];

const DRIFT_FIELDS = {
    testItem: 'srcTestItem',
    quantityText: 'srcQuantityText',
    detectDate: 'srcDetectDate',
    mainTester: 'srcMainTester',
};

function toDateInputValue(v) {
    if (!v) return '';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDateDisplay(v) {
    if (!v) return '';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

function isFieldDrifted(record, colKey) {
    const srcKey = DRIFT_FIELDS[colKey];
    if (!srcKey) return false;
    if (colKey === 'detectDate') {
        const a = record[colKey] ? new Date(record[colKey]).getTime() : 0;
        const b = record[srcKey] ? new Date(record[srcKey]).getTime() : 0;
        return a !== b;
    }
    return (record[colKey] || '') !== (record[srcKey] || '');
}

export default function ProjectDetailPage() {
    const router = useRouter();
    const params = useParams();
    const projectId = params?.id;
    const [project, setProject] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/projects/${projectId}`, { cache: 'no-store' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '加载失败');
            setProject(data);
            setError('');
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        if (projectId) void load();
    }, [projectId, load]);

    const handleSaveCell = async (record, key, value) => {
        const original = key === 'detectDate' ? toDateInputValue(record[key]) : (record[key] || '');
        if (value === original) return;
        const payload = { [key]: value || null };
        const res = await fetch(`/api/projects/${projectId}/detection-records/${record.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.error || '保存失败');
            return;
        }
        await load();
    };

    const handleDeleteRecord = async (record) => {
        if (!confirm('确认删除这条检测记录？（不会影响原始工作记录）')) return;
        const res = await fetch(`/api/projects/${projectId}/detection-records/${record.id}`, {
            method: 'DELETE',
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.error || '删除失败');
            return;
        }
        await load();
    };

    if (loading) return <div className="page-body">加载中…</div>;
    if (error) return <div className="page-body"><div className="card">错误：{error}</div></div>;
    if (!project) return null;

    const contract = project.contract;
    const priceItems = contract?.priceItems || [];
    const contractAmount = contract?.pricingMode === 'area'
        ? (contract?.areaPricingAmount || 0)
        : priceItems.reduce((sum, p) => sum + (Number(p.unitPrice) || 0) * (Number(p.quantity) || 0), 0);

    return (
        <>
            <div className="page-header">
                <div>
                    <div className="page-kicker">Project Detail</div>
                    <h2>{project.name}</h2>
                    <p className="page-desc">
                        状态：{project.status}
                        {project.phase ? ` · 阶段：${project.phase}` : ''}
                    </p>
                </div>
                <div className="page-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => router.push('/master/projects')}>返回列表</button>
                    <button type="button" className="btn btn-secondary" onClick={() => void load()}>刷新</button>
                </div>
            </div>

            <div className="page-body">
                <section className="card stack">
                    <div className="card-header">
                        <div className="card-copy">
                            <div className="panel-eyebrow">Contract</div>
                            <div className="panel-title">合同信息</div>
                        </div>
                    </div>
                    {contract ? (
                        <>
                            <div className="form-grid">
                                <div className="form-group"><label>客户</label><div>{contract.clientName || '-'}</div></div>
                                <div className="form-group"><label>合同金额</label><div>{contractAmount ? `¥ ${Number(contractAmount).toLocaleString()}` : '-'}</div></div>
                                <div className="form-group"><label>计价方式</label><div>{contract.pricingMode === 'area' ? '按面积' : '按单价'}</div></div>
                            </div>
                            <div className="data-table-shell" style={{ marginTop: 12 }}>
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>检测项目</th>
                                            <th>数量</th>
                                            <th>单位</th>
                                            <th>单价</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {priceItems.length === 0 ? (
                                            <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--color-muted)' }}>无检测项目清单</td></tr>
                                        ) : priceItems.map((item) => (
                                            <tr key={item.id}>
                                                <td>{item.testItemName}</td>
                                                <td>{item.quantity ?? '-'}</td>
                                                <td>{item.unit || '-'}</td>
                                                <td>{item.unitPrice}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    ) : (
                        <div className="empty-state"><div>未关联合同</div></div>
                    )}
                </section>

                <section className="table-shell" style={{ marginTop: 16 }}>
                    <div className="card-header">
                        <div className="card-copy">
                            <div className="panel-eyebrow">Detection Records</div>
                            <div className="panel-title">检测记录</div>
                            <div className="panel-note">
                                表格为独立覆盖层，直接编辑单元格保存。<span style={{ color: '#e67e22', fontWeight: 600 }}>橙色背景</span>表示该字段与工作记录原始数据不一致。
                            </div>
                        </div>
                    </div>
                    <div className="data-table-shell">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th style={{ width: 60 }}>序号</th>
                                    {EDITABLE_COLUMNS.map((c) => <th key={c.key}>{c.label}</th>)}
                                    <th style={{ width: 80 }}>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {project.detectionRecords.length === 0 ? (
                                    <tr><td colSpan={EDITABLE_COLUMNS.length + 2} style={{ textAlign: 'center', color: 'var(--color-muted)' }}>暂无检测记录</td></tr>
                                ) : project.detectionRecords.map((record) => (
                                    <tr key={record.id}>
                                        <td>{record.sequence}</td>
                                        {EDITABLE_COLUMNS.map((col) => {
                                            const drifted = isFieldDrifted(record, col.key);
                                            const cellStyle = drifted ? { background: '#ffe8cc' } : undefined;
                                            const title = drifted
                                                ? `工作记录原值：${col.key === 'detectDate' ? formatDateDisplay(record[DRIFT_FIELDS[col.key]]) : (record[DRIFT_FIELDS[col.key]] || '(空)')}`
                                                : undefined;
                                            if (col.type === 'date') {
                                                return (
                                                    <td key={col.key} style={cellStyle} title={title}>
                                                        <input
                                                            type="date"
                                                            defaultValue={toDateInputValue(record[col.key])}
                                                            onBlur={(e) => void handleSaveCell(record, col.key, e.target.value)}
                                                            style={{ width: '100%', background: 'transparent', border: '1px dashed transparent', padding: 2 }}
                                                            onFocus={(e) => { e.target.style.border = '1px dashed var(--color-border)'; }}
                                                        />
                                                    </td>
                                                );
                                            }
                                            return (
                                                <td key={col.key} style={cellStyle} title={title}>
                                                    <input
                                                        type="text"
                                                        defaultValue={record[col.key] || ''}
                                                        onBlur={(e) => void handleSaveCell(record, col.key, e.target.value)}
                                                        style={{ width: '100%', background: 'transparent', border: '1px dashed transparent', padding: 2 }}
                                                        onFocus={(e) => { e.target.style.border = '1px dashed var(--color-border)'; }}
                                                    />
                                                </td>
                                            );
                                        })}
                                        <td>
                                            <button type="button" className="btn btn-danger" style={{ minHeight: 28, padding: '0 10px', fontSize: '0.7rem' }} onClick={() => void handleDeleteRecord(record)}>删除</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        </>
    );
}
