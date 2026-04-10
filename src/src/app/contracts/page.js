'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const EMPTY_FORM = {
    contractNo: '',
    clientName: '',
    partyB: '',
    projectName: '',
    signedDate: '',
    pricingMode: 'unit',
    areaPricingAmount: '',
    areaPricingArea: '',
    filePath: '',
    fileName: '',
    priceItems: [],
};

function formatContractAmount(contract) {
    if (contract.pricingMode === 'area') {
        return contract.areaPricingAmount ? `¥ ${Number(contract.areaPricingAmount).toLocaleString()}（按面积）` : '-';
    }
    const sum = (contract.priceItems || []).reduce((acc, p) => acc + (Number(p.unitPrice) || 0) * (Number(p.quantity) || 0), 0);
    return sum ? `¥ ${sum.toLocaleString()}` : '-';
}

function extractProjectNameFromNotes(notes) {
    if (!notes) return '';
    const m = notes.match(/工程:\s*(.+?)(?:\s*\||$)/);
    return m ? m[1].trim() : '';
}

export default function ContractsPageWrapper() {
    return (
        <Suspense fallback={<div className="page-body">加载中…</div>}>
            <ContractsPage />
        </Suspense>
    );
}

function ContractsPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const lockedProjectId = searchParams.get('projectId');
    const lockedProjectName = searchParams.get('projectName');
    const manualMode = searchParams.get('manual') === '1';

    const [contracts, setContracts] = useState([]);
    const [showForm, setShowForm] = useState(Boolean(lockedProjectId) || manualMode);
    const [form, setForm] = useState({
        ...EMPTY_FORM,
        projectName: lockedProjectName || '',
    });
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);

    const loadContracts = useCallback(async () => {
        const res = await fetch('/api/contracts', { cache: 'no-store' });
        const data = await res.json();
        setContracts(Array.isArray(data) ? data : []);
    }, []);

    useEffect(() => { void loadContracts(); }, [loadContracts]);

    const handleFilePick = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setUploading(true);
        try {
            const fd = new FormData();
            fd.append('file', file);
            const res = await fetch('/api/upload', { method: 'POST', body: fd });
            const data = await res.json();
            if (!res.ok || !data.success) {
                alert(data.error || '上传失败');
                return;
            }
            const parsed = data.parsedData || {};
            setForm((current) => ({
                ...current,
                contractNo: parsed.contractNo || current.contractNo,
                clientName: parsed.clientName || current.clientName,
                partyB: parsed.partyB || current.partyB,
                projectName: lockedProjectName || parsed.projectName || current.projectName,
                signedDate: parsed.signedDate ? String(parsed.signedDate).slice(0, 10) : current.signedDate,
                filePath: data.savedPath || '',
                fileName: data.fileName || '',
                priceItems: Array.isArray(parsed.priceItems)
                    ? parsed.priceItems.map((p) => ({
                        testCategory: p.testCategory || '',
                        testItemName: p.testItemName || p.name || '',
                        quantity: p.quantity ?? '',
                        unit: p.unit || '',
                        unitPrice: p.unitPrice ?? '',
                    }))
                    : [],
            }));
        } catch (e) {
            alert('上传失败: ' + e.message);
        } finally {
            setUploading(false);
            event.target.value = '';
        }
    };

    const updatePriceItem = (idx, key, value) => {
        setForm((current) => {
            const items = [...current.priceItems];
            items[idx] = { ...items[idx], [key]: value };
            return { ...current, priceItems: items };
        });
    };

    const addPriceItem = () => {
        setForm((current) => ({
            ...current,
            priceItems: [...current.priceItems, { testCategory: '', testItemName: '', quantity: '', unit: '', unitPrice: '' }],
        }));
    };

    const removePriceItem = (idx) => {
        setForm((current) => ({
            ...current,
            priceItems: current.priceItems.filter((_, i) => i !== idx),
        }));
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!form.projectName.trim() && !lockedProjectId) {
            alert('请填写工程名称');
            return;
        }
        setSaving(true);
        try {
            const payload = {
                contractNo: form.contractNo || null,
                clientName: form.clientName || null,
                partyB: form.partyB || null,
                projectName: form.projectName.trim(),
                projectId: lockedProjectId ? Number.parseInt(lockedProjectId, 10) : undefined,
                signedDate: form.signedDate || null,
                pricingMode: form.pricingMode,
                areaPricingAmount: form.areaPricingAmount || null,
                areaPricingArea: form.areaPricingArea || null,
                filePath: form.filePath || null,
                fileName: form.fileName || null,
                priceItems: form.priceItems
                    .filter((p) => p.testItemName)
                    .map((p) => ({
                        testCategory: p.testCategory || null,
                        testItemName: p.testItemName,
                        quantity: p.quantity === '' ? null : Number(p.quantity),
                        unit: p.unit || null,
                        unitPrice: p.unitPrice === '' ? 0 : Number(p.unitPrice),
                    })),
            };
            const res = await fetch('/api/contracts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || '保存失败');
                return;
            }
            const r = data.retroactiveResult;
            if (r && r.status === 'completed' && r.calculated > 0) {
                alert(`合同已保存并完成产值补算：补算 ${r.calculated} 条记录${r.exceeded > 0 ? `，其中 ${r.exceeded} 条超限` : ''}`);
            } else {
                alert('合同已保存');
            }
            setForm({ ...EMPTY_FORM, projectName: lockedProjectName || '' });
            setShowForm(Boolean(lockedProjectId));
            await loadContracts();
            if (lockedProjectId) {
                router.push(`/master/projects/${lockedProjectId}`);
            } else if (manualMode) {
                router.push('/master/projects');
            }
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (contract) => {
        if (!confirm(`确认删除合同「${contract.contractNo || contract.id}」？关联项目将解除合同绑定。`)) return;
        const res = await fetch('/api/contracts', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: contract.id }),
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || '删除失败');
            return;
        }
        await loadContracts();
    };

    return (
        <>
            <div className="page-header">
                <div>
                    <div className="page-kicker">Contracts</div>
                    <h2>{manualMode ? '手动新建项目(含合同)' : '合同档案'}</h2>
                    <p className="page-desc">
                        {manualMode
                            ? '全部字段手动填写，保存后自动创建项目和合同，不需要上传文件。'
                            : lockedProjectName
                                ? `为项目「${lockedProjectName}」上传合同`
                                : '上传合同后自动 OCR 解析，按工程名关联或新建项目。'}
                    </p>
                </div>
                <div className="page-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => void loadContracts()}>刷新</button>
                    <button
                        type="button"
                        className={showForm ? 'btn btn-secondary' : 'btn btn-primary'}
                        onClick={() => setShowForm((v) => !v)}
                    >
                        {showForm ? '收起表单' : '上传合同'}
                    </button>
                </div>
            </div>

            <div className="page-body">
                {showForm ? (
                    <form onSubmit={handleSubmit} className="card stack">
                        <div className="card-header">
                            <div className="card-copy">
                                <div className="panel-eyebrow">Contract Upload</div>
                                <div className="panel-title">上传并保存合同</div>
                                <div className="panel-note">可先上传文件自动识别，或直接手动填写。</div>
                            </div>
                        </div>

                        {manualMode ? null : (
                            <div className="form-group">
                                <label>合同文件（可选）</label>
                                <input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" disabled={uploading} onChange={handleFilePick} />
                                {uploading ? <div style={{ color: 'var(--color-muted)', fontSize: 12 }}>OCR 解析中…</div> : null}
                                {form.fileName ? <div style={{ color: 'var(--color-muted)', fontSize: 12 }}>已上传：{form.fileName}</div> : null}
                            </div>
                        )}

                        <div className="form-grid">
                            <div className="form-group">
                                <label>工程名称 *</label>
                                <input
                                    className="form-input"
                                    required
                                    disabled={Boolean(lockedProjectId)}
                                    value={form.projectName}
                                    onChange={(e) => setForm((c) => ({ ...c, projectName: e.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label>合同编号</label>
                                <input className="form-input" value={form.contractNo} onChange={(e) => setForm((c) => ({ ...c, contractNo: e.target.value }))} />
                            </div>
                            <div className="form-group">
                                <label>委托方（甲方）</label>
                                <input className="form-input" value={form.clientName} onChange={(e) => setForm((c) => ({ ...c, clientName: e.target.value }))} />
                            </div>
                            <div className="form-group">
                                <label>受托方（乙方）</label>
                                <input className="form-input" value={form.partyB} onChange={(e) => setForm((c) => ({ ...c, partyB: e.target.value }))} />
                            </div>
                            <div className="form-group">
                                <label>签订日期</label>
                                <input type="date" className="form-input" value={form.signedDate} onChange={(e) => setForm((c) => ({ ...c, signedDate: e.target.value }))} />
                            </div>
                            <div className="form-group">
                                <label>计价方式</label>
                                <select className="form-select" value={form.pricingMode} onChange={(e) => setForm((c) => ({ ...c, pricingMode: e.target.value }))}>
                                    <option value="unit">按单价</option>
                                    <option value="area">按面积</option>
                                </select>
                            </div>
                            {form.pricingMode === 'area' ? (
                                <>
                                    <div className="form-group">
                                        <label>合同总价</label>
                                        <input type="number" className="form-input" value={form.areaPricingAmount} onChange={(e) => setForm((c) => ({ ...c, areaPricingAmount: e.target.value }))} />
                                    </div>
                                    <div className="form-group">
                                        <label>合同面积</label>
                                        <input type="number" className="form-input" value={form.areaPricingArea} onChange={(e) => setForm((c) => ({ ...c, areaPricingArea: e.target.value }))} />
                                    </div>
                                </>
                            ) : null}
                        </div>

                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <strong>检测项目清单</strong>
                                <button type="button" className="btn btn-secondary" style={{ minHeight: 28, padding: '0 10px', fontSize: '0.72rem' }} onClick={addPriceItem}>+ 添加</button>
                            </div>
                            <div className="data-table-shell">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: 140 }}>检测类别</th>
                                            <th>检测项目</th>
                                            <th style={{ width: 100 }}>数量</th>
                                            <th style={{ width: 90 }}>单位</th>
                                            <th style={{ width: 110 }}>单价</th>
                                            <th style={{ width: 60 }}></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {form.priceItems.length === 0 ? (
                                            <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--color-muted)' }}>暂无项目，点击"添加"</td></tr>
                                        ) : form.priceItems.map((item, idx) => (
                                            <tr key={idx}>
                                                <td><input className="form-input" value={item.testCategory || ''} onChange={(e) => updatePriceItem(idx, 'testCategory', e.target.value)} /></td>
                                                <td><input className="form-input" value={item.testItemName} onChange={(e) => updatePriceItem(idx, 'testItemName', e.target.value)} /></td>
                                                <td><input className="form-input" type="number" step="0.0001" value={item.quantity} onChange={(e) => updatePriceItem(idx, 'quantity', e.target.value)} style={{ minWidth: 80 }} /></td>
                                                <td><input className="form-input" value={item.unit} onChange={(e) => updatePriceItem(idx, 'unit', e.target.value)} style={{ minWidth: 70 }} /></td>
                                                <td><input className="form-input" type="number" step="0.0001" value={item.unitPrice} onChange={(e) => updatePriceItem(idx, 'unitPrice', e.target.value)} style={{ minWidth: 90 }} /></td>
                                                <td><button type="button" className="btn btn-danger" style={{ minHeight: 24, padding: '0 8px', fontSize: '0.68rem' }} onClick={() => removePriceItem(idx)}>删</button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="page-actions">
                            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '保存中…' : '保存合同'}</button>
                        </div>
                    </form>
                ) : null}

                <section className="table-shell" style={{ marginTop: 16 }}>
                    <div className="card-header">
                        <div className="card-copy">
                            <div className="panel-eyebrow">Contract Ledger</div>
                            <div className="panel-title">合同列表</div>
                        </div>
                        <div className="table-toolbar-meta">
                            <span>总数：{contracts.length}</span>
                        </div>
                    </div>
                    <div className="data-table-shell">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>合同编号</th>
                                    <th>委托方</th>
                                    <th>工程名称</th>
                                    <th>关联项目</th>
                                    <th>金额</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {contracts.length === 0 ? (
                                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--color-muted)' }}>暂无合同</td></tr>
                                ) : contracts.map((c) => (
                                    <tr key={c.id}>
                                        <td>{c.contractNo || '-'}</td>
                                        <td>{c.clientName || '-'}</td>
                                        <td>{extractProjectNameFromNotes(c.notes) || '-'}</td>
                                        <td>{(c.projects || []).map((p) => p.name).join('、') || '-'}</td>
                                        <td>{formatContractAmount(c)}</td>
                                        <td>
                                            <button type="button" className="btn btn-danger" style={{ minHeight: 28, padding: '0 10px', fontSize: '0.7rem' }} onClick={() => void handleDelete(c)}>删除</button>
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
