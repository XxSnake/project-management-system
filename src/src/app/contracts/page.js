'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { buildProjectDisplayName } from '@/lib/projectDisplayName';

const EMPTY_FORM = {
    contractNo: '',
    clientName: '',
    partyB: '',
    projectId: '',
    projectName: '',
    signedDate: '',
    pricingMode: 'unit',
    areaPricingAmount: '',
    areaPricingArea: '',
    lumpSumAmount: '',
    filePath: '',
    fileName: '',
    priceItems: [],
};

function formatContractAmount(contract) {
    if (contract.pricingMode === 'lumpsum') {
        return contract.lumpSumAmount ? `¥ ${Number(contract.lumpSumAmount).toLocaleString()}（包干价）` : '-';
    }
    if (contract.pricingMode === 'area') {
        return contract.areaPricingAmount ? `¥ ${Number(contract.areaPricingAmount).toLocaleString()}（按面积）` : '-';
    }
    const sum = (contract.priceItems || []).reduce((acc, p) => acc + (Number(p.unitPrice) || 0) * (Number(p.quantity) || 0), 0);
    if (contract.pricingMode === 'mixed' && contract.areaPricingAmount) {
        return sum ? `¥ ${(sum + Number(contract.areaPricingAmount)).toLocaleString()}（混合计费）` : '-';
    }
    return sum ? `¥ ${sum.toLocaleString()}` : '-';
}

function extractProjectNameFromNotes(notes) {
    if (!notes) return '';
    const m = notes.match(/工程:\s*(.+?)(?:\s*\||$)/);
    return m ? m[1].trim() : '';
}

function getProjectOptionLabel(project) {
    return buildProjectDisplayName(project);
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
    const [projects, setProjects] = useState([]);
    const [showForm, setShowForm] = useState(Boolean(lockedProjectId) || manualMode);
    const [form, setForm] = useState({
        ...EMPTY_FORM,
        projectId: lockedProjectId || '',
        projectName: lockedProjectName || '',
    });
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [sameContractDecision, setSameContractDecision] = useState(null);
    const [sameContractMode, setSameContractMode] = useState('subitem');
    const [sameContractTargetId, setSameContractTargetId] = useState('');
    const [sameContractPhase, setSameContractPhase] = useState('');
    const [sameContractSubmitting, setSameContractSubmitting] = useState(false);

    const loadData = useCallback(async () => {
        const [contractResponse, projectResponse] = await Promise.all([
            fetch('/api/contracts', { cache: 'no-store' }),
            fetch('/api/projects', { cache: 'no-store' }),
        ]);
        const [contractData, projectData] = await Promise.all([
            contractResponse.json(),
            projectResponse.json(),
        ]);
        setContracts(Array.isArray(contractData) ? contractData : []);
        setProjects(Array.isArray(projectData) ? projectData : []);
    }, []);
    const loadContracts = loadData;

    useEffect(() => { void loadData(); }, [loadData]);

    const closeSameContractDecision = () => {
        setSameContractDecision(null);
        setSameContractMode('subitem');
        setSameContractTargetId('');
        setSameContractPhase('');
    };

    const buildPriceItemsPayload = () => form.priceItems
        .filter((p) => p.testItemName)
        .map((p) => ({
            testCategory: p.testCategory || null,
            testItemName: p.testItemName,
            quantity: p.quantity === '' ? null : Number(p.quantity),
            unit: p.unit || null,
            unitPrice: p.unitPrice === '' ? 0 : Number(p.unitPrice),
        }));

    const buildContractPayload = (overrides = {}) => {
        const hasProjectIdOverride = Object.prototype.hasOwnProperty.call(overrides, 'projectId');
        const resolvedProjectId = hasProjectIdOverride
            ? overrides.projectId
            : (editingId
                ? (form.projectId ? Number.parseInt(form.projectId, 10) : undefined)
                : (lockedProjectId ? Number.parseInt(lockedProjectId, 10) : undefined));
        const selectedProject = resolvedProjectId
            ? projects.find((project) => project.id === resolvedProjectId) || null
            : null;
        const resolvedProjectName = typeof overrides.projectName === 'string'
            ? overrides.projectName.trim()
            : (form.projectName.trim() || selectedProject?.name || lockedProjectName || '');

        const payload = {
            contractNo: form.contractNo || null,
            clientName: form.clientName || null,
            partyB: form.partyB || null,
            signedDate: form.signedDate || null,
            pricingMode: form.pricingMode,
            areaPricingAmount: form.areaPricingAmount || null,
            areaPricingArea: form.areaPricingArea || null,
            lumpSumAmount: form.lumpSumAmount || null,
            projectName: resolvedProjectName,
            priceItems: buildPriceItemsPayload(),
        };

        if (editingId) {
            payload.id = editingId;
        } else {
            payload.filePath = form.filePath || null;
            payload.fileName = form.fileName || null;
        }

        if (resolvedProjectId) {
            payload.projectId = resolvedProjectId;
        }

        if (Object.prototype.hasOwnProperty.call(overrides, 'projectPhase')) {
            payload.projectPhase = overrides.projectPhase;
        }

        if (overrides.sharedContractMode) {
            payload.sharedContractMode = overrides.sharedContractMode;
        }

        if (overrides.allowBlankSharedPhase === true) {
            payload.allowBlankSharedPhase = true;
        }

        return {
            payload,
            selectedProject,
            resolvedProjectName,
        };
    };

    const submitContractPayload = async (payload) => {
        const isEditing = Boolean(editingId);

        setSaving(true);
        try {
            const res = await fetch('/api/contracts', {
                method: isEditing ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = await res.json();
            if (!res.ok) {
                alert(data.error || '保存失败');
                return false;
            }

            if (isEditing) {
                const linkedProjects = Array.isArray(data.contract?.projects) ? data.contract.projects.length : 0;
                const recalculatedProjects = Array.isArray(data.recalculationResults) ? data.recalculationResults.length : 0;
                alert(`合同已更新，项目信息已同步${recalculatedProjects > 0 ? `，并重算了 ${recalculatedProjects} 个项目的数据` : ''}${linkedProjects > 0 ? '。' : '，但当前还没有绑定项目。'}`);
            } else {
                const r = data.retroactiveResult;
                if (r && r.status === 'completed' && r.calculated > 0) {
                    alert(`合同已保存并完成产值补算：补算 ${r.calculated} 条记录${r.exceeded > 0 ? `，其中 ${r.exceeded} 条超限` : ''}`);
                } else {
                    alert('合同已保存');
                }
            }

            setEditingId(null);
            setForm({ ...EMPTY_FORM, projectId: lockedProjectId || '', projectName: lockedProjectName || '' });
            setShowForm(Boolean(lockedProjectId));
            closeSameContractDecision();
            await loadData();
            if (!isEditing && lockedProjectId) {
                router.push(`/master/projects/${lockedProjectId}`);
            } else if (!isEditing && manualMode) {
                router.push('/master/projects');
            }
            return true;
        } finally {
            setSaving(false);
        }
    };

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
        if (!form.projectName.trim() && !form.projectId && !lockedProjectId) {
            alert('请填写工程名称');
            return;
        }
        const { payload, selectedProject, resolvedProjectName } = buildContractPayload();

        if (editingId) {
            const currentContract = contracts.find((contract) => contract.id === editingId) || null;
            const linkedProjects = Array.isArray(currentContract?.projects) ? currentContract.projects : [];
            const isAlreadyLinkedProject = selectedProject
                ? linkedProjects.some((project) => project.id === selectedProject.id)
                : linkedProjects.some((project) => project.name === resolvedProjectName && !project.phase);

            if (linkedProjects.length > 0 && !isAlreadyLinkedProject) {
                setSameContractDecision({
                    payload,
                    linkedProjectIds: linkedProjects.map((project) => project.id),
                    sourceProjectId: selectedProject?.id || null,
                });
                setSameContractMode('subitem');
                setSameContractTargetId(linkedProjects[0] ? String(linkedProjects[0].id) : '');
                setSameContractPhase(selectedProject?.phase || '');
                return;
            }
        }

        await submitContractPayload(payload);
    };

    const handleConfirmSameContractDecision = async () => {
        if (!sameContractDecision) {
            return;
        }

        if (sameContractMode === 'merge') {
            const targetId = Number.parseInt(sameContractTargetId, 10);
            if (!targetId) {
                alert('请先选择要保留的项目');
                return;
            }

            const targetProject = projects.find((project) => project.id === targetId);
            if (!targetProject) {
                alert('目标项目不存在');
                return;
            }

            setSameContractSubmitting(true);
            try {
                if (
                    sameContractDecision.sourceProjectId
                    && sameContractDecision.sourceProjectId !== targetId
                    && !sameContractDecision.linkedProjectIds.includes(sameContractDecision.sourceProjectId)
                ) {
                    const mergeResponse = await fetch('/api/projects/merge', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            targetId,
                            sourceIds: [sameContractDecision.sourceProjectId],
                        }),
                    });
                    const mergeData = await mergeResponse.json();
                    if (!mergeResponse.ok) {
                        alert(mergeData.error || '合并项目失败');
                        return;
                    }
                }

                const success = await submitContractPayload({
                    ...sameContractDecision.payload,
                    projectId: targetId,
                    projectName: targetProject.name,
                    projectPhase: targetProject.phase || null,
                    sharedContractMode: 'merge',
                });
                if (success) {
                    closeSameContractDecision();
                }
            } finally {
                setSameContractSubmitting(false);
            }
            return;
        }

        const nextPhase = sameContractPhase.trim();
        if (!nextPhase && !confirm('这份合同下面会保留多个项目，但“工程阶段 / 子项”仍然留空。以后列表里可能还是不好区分，确认继续吗？')) {
            return;
        }

        setSameContractSubmitting(true);
        try {
            const success = await submitContractPayload({
                ...sameContractDecision.payload,
                projectPhase: nextPhase || null,
                sharedContractMode: 'subitem',
                ...(nextPhase ? {} : { allowBlankSharedPhase: true }),
            });
            if (success) {
                closeSameContractDecision();
            }
        } finally {
            setSameContractSubmitting(false);
        }
    };

    const handleEdit = (contract) => {
        const linkedProject = (contract.projects || [])[0] || null;
        closeSameContractDecision();
        setEditingId(contract.id);
        setForm({
            contractNo: contract.contractNo || '',
            clientName: contract.clientName || '',
            partyB: contract.partyB || '',
            projectId: linkedProject ? String(linkedProject.id) : '',
            projectName: extractProjectNameFromNotes(contract.notes) || linkedProject?.name || '',
            signedDate: contract.signedDate ? String(contract.signedDate).slice(0, 10) : '',
            pricingMode: contract.pricingMode || 'unit',
            areaPricingAmount: contract.areaPricingAmount ?? '',
            areaPricingArea: contract.areaPricingArea ?? '',
            lumpSumAmount: contract.lumpSumAmount ?? '',
            filePath: contract.filePath || '',
            fileName: '',
            priceItems: (contract.priceItems || []).map((p) => ({
                testCategory: p.testCategory || '',
                testItemName: p.testItemName || '',
                quantity: p.quantity ?? '',
                unit: p.unit || '',
                unitPrice: p.unitPrice ?? '',
            })),
        });
        setShowForm(true);
    };

    const handleCancelEdit = () => {
        closeSameContractDecision();
        setEditingId(null);
        setForm({ ...EMPTY_FORM, projectId: lockedProjectId || '', projectName: lockedProjectName || '' });
        setShowForm(Boolean(lockedProjectId) || manualMode);
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
        await loadData();
    };

    const editableProjectOptions = projects.filter((project) => (
        !project.contractId
        || project.contractId === editingId
        || String(project.id) === String(form.projectId)
    ));

    const handleProjectSelectionChange = (value) => {
        const selectedProject = projects.find((project) => String(project.id) === value);
        setForm((current) => ({
            ...current,
            projectId: value,
            projectName: selectedProject ? selectedProject.name : current.projectName,
        }));
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
                                <div className="panel-eyebrow">{editingId ? 'Edit Contract' : 'Contract Upload'}</div>
                                <div className="panel-title">{editingId ? '编辑合同' : '上传并保存合同'}</div>
                                <div className="panel-note">{editingId ? '修改合同信息和检测项目清单。' : '可先上传文件自动识别，或直接手动填写。'}</div>
                            </div>
                        </div>

                        {(manualMode || editingId) ? null : (
                            <div className="form-group">
                                <label>合同文件（可选）</label>
                                <input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" disabled={uploading} onChange={handleFilePick} />
                                {uploading ? <div style={{ color: 'var(--color-muted)', fontSize: 12 }}>OCR 解析中…</div> : null}
                                {form.fileName ? <div style={{ color: 'var(--color-muted)', fontSize: 12 }}>已上传：{form.fileName}</div> : null}
                            </div>
                        )}

                        <div className="form-grid">
                            {editingId ? (
                                <>
                                    <div className="form-group">
                                        <label>关联项目</label>
                                        <select
                                            className="form-select"
                                            value={form.projectId}
                                            onChange={(e) => handleProjectSelectionChange(e.target.value)}
                                        >
                                            <option value="">按工程名称新建/匹配项目</option>
                                            {editableProjectOptions.map((project) => (
                                                <option key={project.id} value={project.id}>
                                                    {getProjectOptionLabel(project)}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label>工程名称 *</label>
                                        <input
                                            className="form-input"
                                            required
                                            value={form.projectName}
                                            onChange={(e) => setForm((c) => ({ ...c, projectName: e.target.value }))}
                                        />
                                    </div>
                                </>
                            ) : (
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
                            )}
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
                                    <option value="mixed">混合计费</option>
                                    <option value="lumpsum">包干价</option>
                                </select>
                            </div>
                            {(form.pricingMode === 'area' || form.pricingMode === 'mixed') ? (
                                <>
                                    <div className="form-group">
                                        <label>{form.pricingMode === 'mixed' ? '面积部分总价' : '合同总价'}</label>
                                        <input type="number" className="form-input" value={form.areaPricingAmount} onChange={(e) => setForm((c) => ({ ...c, areaPricingAmount: e.target.value }))} />
                                    </div>
                                    <div className="form-group">
                                        <label>合同面积</label>
                                        <input type="number" className="form-input" value={form.areaPricingArea} onChange={(e) => setForm((c) => ({ ...c, areaPricingArea: e.target.value }))} />
                                    </div>
                                </>
                            ) : null}
                            {form.pricingMode === 'lumpsum' ? (
                                <div className="form-group">
                                    <label>包干总价</label>
                                    <input type="number" className="form-input" value={form.lumpSumAmount} onChange={(e) => setForm((c) => ({ ...c, lumpSumAmount: e.target.value }))} />
                                </div>
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
                                            <th style={{ width: 260 }}>检测类别</th>
                                            <th>检测项目</th>
                                            <th style={{ width: 130 }}>数量</th>
                                            <th style={{ width: 90 }}>单位</th>
                                            <th style={{ width: 140 }}>单价</th>
                                            <th style={{ width: 60 }}></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {form.priceItems.length === 0 ? (
                                            <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--color-muted)' }}>暂无项目，点击“添加”</td></tr>
                                        ) : form.priceItems.map((item, idx) => (
                                            <tr key={idx}>
                                                <td><input className="form-input" value={item.testCategory || ''} onChange={(e) => updatePriceItem(idx, 'testCategory', e.target.value)} style={{ minWidth: 230 }} /></td>
                                                <td><input className="form-input" value={item.testItemName} onChange={(e) => updatePriceItem(idx, 'testItemName', e.target.value)} /></td>
                                                <td><input className="form-input" type="text" inputMode="decimal" value={item.quantity} onChange={(e) => updatePriceItem(idx, 'quantity', e.target.value)} style={{ minWidth: 110 }} /></td>
                                                <td><input className="form-input" value={item.unit} onChange={(e) => updatePriceItem(idx, 'unit', e.target.value)} style={{ minWidth: 70 }} /></td>
                                                <td><input className="form-input" type="text" inputMode="decimal" value={item.unitPrice} onChange={(e) => updatePriceItem(idx, 'unitPrice', e.target.value)} style={{ minWidth: 120 }} /></td>
                                                <td><button type="button" className="btn btn-danger" style={{ minHeight: 24, padding: '0 8px', fontSize: '0.68rem' }} onClick={() => removePriceItem(idx)}>删</button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="page-actions">
                            {editingId ? <button type="button" className="btn btn-secondary" onClick={handleCancelEdit}>取消编辑</button> : null}
                            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '保存中…' : (editingId ? '更新合同' : '保存合同')}</button>
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
                                        <td>{(c.projects || []).map((p) => getProjectOptionLabel(p)).join('、') || '-'}</td>
                                        <td>{formatContractAmount(c)}</td>
                                        <td>
                                            <div className="page-actions">
                                                <button type="button" className="btn btn-secondary" style={{ minHeight: 28, padding: '0 10px', fontSize: '0.7rem' }} onClick={() => handleEdit(c)}>编辑</button>
                                                <button type="button" className="btn btn-danger" style={{ minHeight: 28, padding: '0 10px', fontSize: '0.7rem' }} onClick={() => void handleDelete(c)}>删除</button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>

            {sameContractDecision && (
                <div
                    style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
                    onClick={() => {
                        if (!sameContractSubmitting) {
                            closeSameContractDecision();
                        }
                    }}
                >
                    <div className="card stack" style={{ width: '90%', maxWidth: 680, padding: 24 }} onClick={(event) => event.stopPropagation()}>
                        <div className="panel-eyebrow">Contract Decision</div>
                        <div className="panel-title" style={{ marginBottom: 4 }}>这份合同已经关联了其他项目</div>
                        <div className="panel-note" style={{ marginBottom: 16 }}>
                            保存前请先确认：这次是把项目并到已有项目里，还是保留成同合同下的不同子项。
                        </div>

                        <div className="form-group">
                            <label>处理方式</label>
                            <div style={{ display: 'grid', gap: 12 }}>
                                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', border: '1px solid var(--color-border)', borderRadius: 12, padding: 14, cursor: 'pointer' }}>
                                    <input type="radio" name="contract-same-mode" checked={sameContractMode === 'merge'} onChange={() => setSameContractMode('merge')} />
                                    <div>
                                        <div style={{ fontWeight: 600, marginBottom: 4 }}>合并为同一个项目</div>
                                        <div className="panel-note">保存后继续挂到你选中的已有项目上。如果当前选的是另一个已存在项目，会先把它并过去。</div>
                                    </div>
                                </label>
                                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', border: '1px solid var(--color-border)', borderRadius: 12, padding: 14, cursor: 'pointer' }}>
                                    <input type="radio" name="contract-same-mode" checked={sameContractMode === 'subitem'} onChange={() => setSameContractMode('subitem')} />
                                    <div>
                                        <div style={{ fontWeight: 600, marginBottom: 4 }}>同一项目下的不同子项</div>
                                        <div className="panel-note">这份合同会继续挂多个项目，建议现在就补上“工程阶段 / 子项”，后面更容易区分。</div>
                                    </div>
                                </label>
                            </div>
                        </div>

                        <div className="form-group">
                            <label>已关联项目</label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {sameContractDecision.linkedProjectIds.map((id) => {
                                    const project = projects.find((item) => item.id === id);
                                    return project ? (
                                        <span key={id} className="badge badge-info" style={{ fontSize: '0.78rem' }}>
                                            {getProjectOptionLabel(project)}
                                        </span>
                                    ) : null;
                                })}
                            </div>
                        </div>

                        {sameContractMode === 'merge' ? (
                            <div className="form-group">
                                <label>要保留的项目</label>
                                <select className="form-select" value={sameContractTargetId} onChange={(event) => setSameContractTargetId(event.target.value)}>
                                    <option value="">请选择...</option>
                                    {sameContractDecision.linkedProjectIds.map((id) => {
                                        const project = projects.find((item) => item.id === id);
                                        return project ? <option key={id} value={id}>{getProjectOptionLabel(project)}</option> : null;
                                    })}
                                </select>
                            </div>
                        ) : (
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label>工程阶段 / 子项</label>
                                <input
                                    className="form-input"
                                    placeholder="例如：污水处理用房、1#楼、主体结构"
                                    value={sameContractPhase}
                                    onChange={(event) => setSameContractPhase(event.target.value)}
                                    disabled={sameContractSubmitting}
                                />
                                <div className="panel-note">允许暂时留空，但会再提醒你确认一次。</div>
                            </div>
                        )}

                        <div className="page-actions" style={{ marginTop: 20 }}>
                            <button type="button" className="btn btn-secondary" onClick={() => closeSameContractDecision()} disabled={sameContractSubmitting}>取消</button>
                            <button type="button" className="btn btn-primary" onClick={() => void handleConfirmSameContractDecision()} disabled={sameContractSubmitting || (sameContractMode === 'merge' && !sameContractTargetId)}>
                                {sameContractSubmitting ? '处理中...' : '确认'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
