'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

const COLUMNS = [
    { key: 'testItem', label: '检测项目' },
    { key: 'contractQty', label: '合同数量' },
    { key: 'unitPrice', label: '单价' },
    { key: 'quantityText', label: '已检数量' },
    { key: 'detectDate', label: '检测时间', type: 'date' },
    { key: 'mainTester', label: '检测人员' },
    { key: 'reportNo', label: '报告编号' },
    { key: 'remarks', label: '备注' },
];

// Editable fields in detection records
const EDITABLE_KEYS = ['testItem', 'quantityText', 'detectDate', 'mainTester', 'reportNo', 'remarks'];

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

// Match a detection record's testItem to a contract price item
function findPriceItem(priceItems, testItem) {
    if (!testItem || !priceItems || priceItems.length === 0) return null;
    const normalized = testItem.trim();
    return priceItems.find((p) => p.testItemName === normalized)
        || priceItems.find((p) => normalized.includes(p.testItemName) || p.testItemName.includes(normalized))
        || null;
}

export default function ProjectDetailPage() {
    const router = useRouter();
    const params = useParams();
    const projectId = params?.id;
    const [project, setProject] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showAddRecord, setShowAddRecord] = useState(false);
    const [newRecord, setNewRecord] = useState({});
    const [viewingContract, setViewingContract] = useState(null);

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
        if (!confirm('确认删除这条记录？')) return;
        const res = await fetch(`/api/projects/${projectId}/detection-records/${record.id}`, { method: 'DELETE' });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.error || '删除失败');
            return;
        }
        await load();
    };

    const handleAddRecord = async () => {
        const payload = { ...newRecord, projectId: Number(projectId) };
        const res = await fetch(`/api/projects/${projectId}/detection-records`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.error || '新增失败');
            return;
        }
        setNewRecord({});
        setShowAddRecord(false);
        await load();
    };

    if (loading) return <div className="page-body">加载中…</div>;
    if (error) return <div className="page-body"><div className="card">错误：{error}</div></div>;
    if (!project) return null;

    const contract = project.contract;
    const priceItems = contract?.priceItems || [];
    const records = project.detectionRecords || [];

    return (
        <>
            <div className="page-header">
                <div>
                    <div className="page-kicker">Project Detail</div>
                    <h2 style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        {project.name}
                        {contract ? (
                            <button
                                type="button"
                                onClick={() => setViewingContract(contract)}
                                className="badge badge-info"
                                style={{ fontSize: '0.7rem', cursor: 'pointer', textDecoration: 'none', fontWeight: 500, border: 'none', background: 'none' }}
                                title="点击查看合同检测项目"
                            >
                                <span className="badge badge-info">{contract.contractNo}</span>
                            </button>
                        ) : (
                            <a
                                href={`/contracts?projectId=${projectId}&projectName=${encodeURIComponent(project.name)}`}
                                onClick={(e) => { e.preventDefault(); router.push(`/contracts?projectId=${projectId}&projectName=${encodeURIComponent(project.name)}`); }}
                                className="badge badge-warning"
                                style={{ fontSize: '0.7rem', cursor: 'pointer', textDecoration: 'none', fontWeight: 500 }}
                            >
                                未关联合同
                            </a>
                        )}
                    </h2>
                    <p className="page-desc">
                        状态：{project.status}
                        {project.phase ? ` · 阶段：${project.phase}` : ''}
                        {contract?.clientName ? ` · 甲方：${contract.clientName}` : ''}
                    </p>
                </div>
                <div className="page-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => router.push('/master/projects')}>返回列表</button>
                    <button type="button" className="btn btn-secondary" onClick={() => void load()}>刷新</button>
                    <button type="button" className="btn btn-primary" onClick={() => setShowAddRecord(!showAddRecord)}>{showAddRecord ? '取消添加' : '添加记录'}</button>
                </div>
            </div>

            <div className="page-body">
                {/* Add Record Form */}
                {showAddRecord && (
                    <div className="card stack" style={{ padding: 16, marginBottom: 16 }}>
                        <div className="panel-note" style={{ marginBottom: 8 }}>手工添加一条检测记录</div>
                        <div className="form-grid">
                            {COLUMNS.filter((col) => EDITABLE_KEYS.includes(col.key)).map((col) => (
                                <div key={col.key} className="form-group">
                                    <label>{col.label}</label>
                                    <input
                                        className="form-input"
                                        type={col.type === 'date' ? 'date' : 'text'}
                                        value={newRecord[col.key] || ''}
                                        onChange={(e) => setNewRecord((prev) => ({ ...prev, [col.key]: e.target.value }))}
                                    />
                                </div>
                            ))}
                        </div>
                        <div className="page-actions" style={{ marginTop: 12 }}>
                            <button type="button" className="btn btn-primary" onClick={() => void handleAddRecord()}>确认添加</button>
                        </div>
                    </div>
                )}

                {/* Unified Table */}
                <section className="table-shell">
                    <div className="card-header">
                        <div className="card-copy">
                            <div className="panel-eyebrow">Detection &amp; Report Records</div>
                            <div className="panel-title">检测与报告记录</div>
                            <div className="panel-note">
                                直接点击单元格即可编辑。合同数量和单价从关联合同自动匹配。
                                {records.some((r) => Object.keys(DRIFT_FIELDS).some((k) => isFieldDrifted(r, k))) && (
                                    <span style={{ marginLeft: 8 }}><span style={{ color: '#e67e22', fontWeight: 600 }}>橙色背景</span>表示与工作记录原始数据不一致。</span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="data-table-shell">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th style={{ width: 50 }}>序号</th>
                                    {COLUMNS.map((c) => <th key={c.key}>{c.label}</th>)}
                                    <th style={{ width: 60 }}>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {records.length === 0 ? (
                                    <tr><td colSpan={COLUMNS.length + 2} style={{ textAlign: 'center', color: 'var(--color-muted)', padding: '32px 0' }}>暂无记录，可通过工作记录自动同步或点击「添加记录」手工新增</td></tr>
                                ) : records.map((record) => {
                                    const matched = findPriceItem(priceItems, record.testItem);
                                    return (
                                        <tr key={record.id}>
                                            <td style={{ textAlign: 'center', color: 'var(--color-muted)', fontSize: '0.8rem' }}>{record.sequence}</td>
                                            {COLUMNS.map((col) => {
                                                // Contract fields: read-only, auto-matched
                                                if (col.key === 'contractQty') {
                                                    return <td key={col.key} style={{ color: matched ? 'inherit' : 'var(--color-muted)' }}>{matched ? `${matched.quantity ?? '-'} ${matched.unit || ''}`.trim() : '-'}</td>;
                                                }
                                                if (col.key === 'unitPrice') {
                                                    return <td key={col.key} style={{ color: matched ? 'inherit' : 'var(--color-muted)' }}>{matched ? `¥${Number(matched.unitPrice).toFixed(2)}` : '-'}</td>;
                                                }

                                                // Non-editable fields
                                                if (!EDITABLE_KEYS.includes(col.key)) {
                                                    return <td key={col.key}>{record[col.key] || '-'}</td>;
                                                }

                                                // Editable fields
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
                                                <button type="button" className="btn btn-danger" style={{ minHeight: 28, padding: '0 8px', fontSize: '0.7rem' }} onClick={() => void handleDeleteRecord(record)}>删除</button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>

            {/* Contract Detail Dialog */}
            {viewingContract && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={() => setViewingContract(null)}>
                    <div className="card stack" style={{ width: '90%', maxWidth: 700, padding: 24, maxHeight: '80vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
                        <div className="panel-eyebrow">Contract Detail</div>
                        <div className="panel-title" style={{ marginBottom: 4 }}>
                            {viewingContract.contractNo || `合同 #${viewingContract.id}`}
                        </div>
                        <div className="panel-note" style={{ marginBottom: 16 }}>
                            {[viewingContract.clientName && `委托方：${viewingContract.clientName}`, viewingContract.partyB && `受托方：${viewingContract.partyB}`, viewingContract.signedDate && `签订日期：${new Date(viewingContract.signedDate).toLocaleDateString('zh-CN')}`, viewingContract.pricingMode === 'area' ? `按面积计价 · 总价 ¥${Number(viewingContract.areaPricingAmount || 0).toLocaleString()} · 面积 ${viewingContract.areaPricingArea || '-'}` : '按单价计价'].filter(Boolean).join(' · ')}
                        </div>

                        {(viewingContract.priceItems || []).length > 0 ? (
                            <div className="data-table-shell">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: 50 }}>序号</th>
                                            <th style={{ width: 140 }}>检测类别</th>
                                            <th>检测项目</th>
                                            <th style={{ width: 100 }}>数量</th>
                                            <th style={{ width: 90 }}>单位</th>
                                            <th style={{ width: 110 }}>单价</th>
                                            <th style={{ width: 130 }}>小计</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {viewingContract.priceItems.map((item, idx) => (
                                            <tr key={item.id || idx}>
                                                <td style={{ textAlign: 'center', color: 'var(--color-muted)' }}>{idx + 1}</td>
                                                <td>{item.testCategory || '-'}</td>
                                                <td>{item.testItemName}</td>
                                                <td>{item.quantity ?? '-'}</td>
                                                <td>{item.unit || '-'}</td>
                                                <td>¥{Number(item.unitPrice || 0).toFixed(2)}</td>
                                                <td>¥{((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)).toFixed(2)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr>
                                            <td colSpan={6} style={{ textAlign: 'right', fontWeight: 600 }}>合计</td>
                                            <td style={{ fontWeight: 600 }}>¥{viewingContract.priceItems.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0).toLocaleString()}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        ) : (
                            <div style={{ textAlign: 'center', color: 'var(--color-muted)', padding: '24px 0' }}>该合同暂无检测项目清单</div>
                        )}

                        <div className="page-actions" style={{ marginTop: 16 }}>
                            <button type="button" className="btn btn-secondary" onClick={() => setViewingContract(null)}>关闭</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
