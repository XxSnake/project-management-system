'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const STATUS_OPTIONS = ['进行中', '已完成', '暂停'];
const EMPTY_FORM = { id: '', name: '', status: '进行中', phase: '', contractId: '' };

function normalizeStatus(value) {
    if (value === '已完成' || value === '宸插畬鎴?') return '已完成';
    if (value === '暂停' || value === '鏆傚仠') return '暂停';
    return '进行中';
}

function getStatusBadge(status) {
    if (status === '已完成') return 'badge-info';
    if (status === '暂停') return 'badge-warning';
    return 'badge-success';
}

function ContractLabel({ contract }) {
    if (!contract) return null;
    const parts = [contract.contractNo, contract.clientName].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : `合同 #${contract.id}`;
}

function getContractProjectCount(contract) {
    return Array.isArray(contract.projects) ? contract.projects.length : 0;
}

function getContractDisplayName(contract) {
    const no = contract.contractNo || '';
    const client = contract.clientName || '';
    // notes 格式: "工程: XXX | 文件: YYY"
    const projectNameMatch = (contract.notes || '').match(/工程:\s*(.+?)(?:\s*\||$)/);
    const projectName = projectNameMatch ? projectNameMatch[1].trim() : '';
    const parts = [no, client, projectName].filter(Boolean);
    return parts.length > 0 ? parts.join(' | ') : `合同 #${contract.id}`;
}

export default function ProjectsPage() {
    const router = useRouter();
    const [projects, setProjects] = useState([]);
    const [contracts, setContracts] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [selectedIds, setSelectedIds] = useState([]);
    const [deletingBatch, setDeletingBatch] = useState(false);
    const [linkingProjectId, setLinkingProjectId] = useState(null);
    const [linkingSaving, setLinkingSaving] = useState(false);
    const [showMerge, setShowMerge] = useState(false);
    const [mergeTargetId, setMergeTargetId] = useState('');
    const [merging, setMerging] = useState(false);
    const [viewingContract, setViewingContract] = useState(null);

    const refreshData = async () => {
        const [projectResponse, contractResponse] = await Promise.all([
            fetch('/api/projects', { cache: 'no-store' }),
            fetch('/api/contracts', { cache: 'no-store' }),
        ]);

        const [projectData, contractData] = await Promise.all([
            projectResponse.json(),
            contractResponse.json(),
        ]);

        const nextProjects = Array.isArray(projectData) ? projectData : [];
        setProjects(nextProjects);
        setContracts(Array.isArray(contractData) ? contractData : []);
        setSelectedIds((current) => current.filter((id) => nextProjects.some((project) => project.id === id)));
    };

    useEffect(() => {
        let cancelled = false;

        Promise.all([
            fetch('/api/projects', { cache: 'no-store' }).then((response) => response.json()),
            fetch('/api/contracts', { cache: 'no-store' }).then((response) => response.json()),
        ])
            .then(([projectData, contractData]) => {
                if (cancelled) {
                    return;
                }

                setProjects(Array.isArray(projectData) ? projectData : []);
                setContracts(Array.isArray(contractData) ? contractData : []);
            })
            .catch((error) => {
                if (!cancelled) {
                    console.error('加载项目数据失败:', error);
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const resetForm = () => {
        setForm(EMPTY_FORM);
        setShowForm(false);
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        const response = await fetch('/api/projects', {
            method: form.id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: form.id || undefined,
                name: form.name,
                status: normalizeStatus(form.status),
                phase: form.phase || null,
                contractId: form.contractId ? Number.parseInt(form.contractId, 10) : null,
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            alert(data.error || '保存项目失败');
            return;
        }

        setForm(EMPTY_FORM);
        setShowForm(false);
        await refreshData();
    };

    const handleEdit = (project) => {
        setForm({
            id: String(project.id),
            name: project.name || '',
            status: normalizeStatus(project.status),
            phase: project.phase || '',
            contractId: project.contractId ? String(project.contractId) : '',
        });
        setShowForm(true);
    };

    const handleDelete = async (id) => {
        if (!confirm('确认删除这个项目吗？')) {
            return;
        }

        const response = await fetch('/api/projects', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
        });

        const data = await response.json();
        if (!response.ok) {
            alert(data.error || '删除项目失败');
            return;
        }

        setSelectedIds((current) => current.filter((item) => item !== id));
        await refreshData();
    };

    const handleToggleSelect = (id) => {
        setSelectedIds((current) => (
            current.includes(id)
                ? current.filter((item) => item !== id)
                : [...current, id]
        ));
    };

    const handleToggleSelectAll = (availableProjects) => {
        if (availableProjects.length === 0) {
            return;
        }

        if (selectedIds.length === availableProjects.length) {
            setSelectedIds([]);
            return;
        }

        setSelectedIds(availableProjects.map((project) => project.id));
    };

    const handleBatchDelete = async () => {
        if (selectedIds.length === 0) {
            return;
        }

        if (!confirm(`确认批量删除已选中的 ${selectedIds.length} 个项目吗？`)) {
            return;
        }

        setDeletingBatch(true);
        try {
            const response = await fetch('/api/projects', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: selectedIds }),
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || '批量删除项目失败');
            }

            setSelectedIds([]);
            await refreshData();
        } catch (error) {
            alert(error.message);
        } finally {
            setDeletingBatch(false);
        }
    };

    const handleMerge = async () => {
        if (!mergeTargetId || selectedIds.length < 2) return;
        const targetId = Number(mergeTargetId);
        const sourceIds = selectedIds.filter((id) => id !== targetId);
        const targetName = projects.find((p) => p.id === targetId)?.name || '';
        if (!confirm(`确认将 ${sourceIds.length} 个项目合并到「${targetName}」？\n合并后来源项目将被删除，所有工作记录、检测记录、报告都会转移到目标项目。`)) return;

        setMerging(true);
        try {
            const res = await fetch('/api/projects/merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetId, sourceIds }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '合并失败');
            alert(`合并完成：转移了 ${data.movedWorkLogs} 条工作记录、${data.movedDetectionRecords} 条检测记录、${data.movedTestReports} 条报告，删除了 ${data.deletedProjects} 个来源项目。`);
            setSelectedIds([]);
            setShowMerge(false);
            setMergeTargetId('');
            await refreshData();
        } catch (err) {
            alert(err.message);
        } finally {
            setMerging(false);
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

    const handleLinkContract = async (projectId, contractId) => {
        setLinkingSaving(true);
        try {
            const project = projects.find((p) => p.id === projectId);
            if (!project) return;

            const response = await fetch('/api/projects', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: projectId,
                    name: project.name,
                    status: normalizeStatus(project.status),
                    phase: project.phase || null,
                    contractId: contractId || null,
                }),
            });

            const data = await response.json();
            if (!response.ok) {
                alert(data.error || '关联合同失败');
                return;
            }

            // 显示补算结果
            if (data.retroactiveResult) {
                const r = data.retroactiveResult;
                if (r.status === 'completed' && r.calculated > 0) {
                    alert(`已关联合同并完成产值补算：\n补算 ${r.calculated} 条记录${r.exceeded > 0 ? `，其中 ${r.exceeded} 条超限` : ''}${r.pendingAreaShare > 0 ? `\n还有 ${r.pendingAreaShare} 条面积合同记录需要补填占比` : ''}`);
                } else if (r.status === 'completed' && r.pendingAreaShare > 0) {
                    alert(`已关联面积合同，有 ${r.pendingAreaShare} 条历史记录需要在工作记录页面补填占比后才能计算产值。`);
                }
            }

            setLinkingProjectId(null);
            await refreshData();
        } finally {
            setLinkingSaving(false);
        }
    };

    const normalizedProjects = useMemo(
        () => projects.map((project) => ({ ...project, normalizedStatus: normalizeStatus(project.status) })),
        [projects],
    );

    const activeCount = normalizedProjects.filter((item) => item.normalizedStatus === '进行中').length;
    const completedCount = normalizedProjects.filter((item) => item.normalizedStatus === '已完成').length;
    const linkedCount = normalizedProjects.filter((item) => item.contract).length;
    const allSelected = normalizedProjects.length > 0 && selectedIds.length === normalizedProjects.length;

    return (
        <>
            <div className="page-header">
                <div>
                    <div className="page-kicker">Data Fabric</div>
                    <h2>项目管理</h2>
                    <p className="page-desc">维护项目状态、阶段和合同关联。现在支持批量选择删除，便于清理误导入或测试项目。</p>
                </div>
                <div className="page-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => void refreshData()}>刷新</button>
                    <button type="button" className="btn btn-secondary" onClick={() => { setShowMerge(true); setMergeTargetId(''); }} disabled={selectedIds.length < 2}>
                        合并项目 ({selectedIds.length})
                    </button>
                    <button type="button" className="btn btn-danger" onClick={() => void handleBatchDelete()} disabled={!selectedIds.length || deletingBatch}>
                        {deletingBatch ? '批量删除中' : `批量删除 (${selectedIds.length})`}
                    </button>
                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => router.push('/contracts?manual=1')}
                        title="跳转到合同页面，可手动填写工程名、合同信息和检测项目清单"
                    >
                        手动新建(含合同)
                    </button>
                    <button
                        type="button"
                        className={showForm ? 'btn btn-secondary' : 'btn btn-secondary'}
                        onClick={() => {
                            if (showForm) {
                                resetForm();
                            } else {
                                setForm(EMPTY_FORM);
                                setShowForm(true);
                            }
                        }}
                    >
                        {showForm ? '收起表单' : '快速新建(仅名称)'}
                    </button>
                </div>
            </div>

            <div className="page-body">
                <div className="metric-grid">
                    <div className="metric-card"><div className="metric-label">项目总数</div><div className="metric-value neon">{normalizedProjects.length}</div><div className="metric-meta">当前系统里的工程项目台账</div></div>
                    <div className="metric-card"><div className="metric-label">进行中</div><div className="metric-value success">{activeCount}</div><div className="metric-meta">仍在持续推进的项目</div></div>
                    <div className="metric-card"><div className="metric-label">已完成</div><div className="metric-value">{completedCount}</div><div className="metric-meta">已完成或已归档的项目</div></div>
                    <div className="metric-card"><div className="metric-label">已关联合同</div><div className="metric-value magenta">{linkedCount}</div><div className="metric-meta">已建立合同映射，便于产值计算</div></div>
                </div>

                {showForm ? (
                    <form onSubmit={handleSubmit} className="card stack">
                        <div className="card-header">
                            <div className="card-copy">
                                <div className="panel-eyebrow">Project Form</div>
                                <div className="panel-title">{form.id ? '编辑项目' : '新增项目'}</div>
                                <div className="panel-note">项目状态后续可以随时修改，不需要删除后重建。</div>
                            </div>
                            <div className="page-actions">
                                {form.id ? <button type="button" className="btn btn-secondary" onClick={resetForm}>取消编辑</button> : null}
                                <button type="submit" className="btn btn-primary">{form.id ? '保存修改' : '保存项目'}</button>
                            </div>
                        </div>

                        <div className="form-grid">
                            <div className="form-group">
                                <label>项目名称</label>
                                <input className="form-input" required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：弥渡县城西片区老旧小区改造项目" />
                            </div>
                            <div className="form-group">
                                <label>项目状态</label>
                                <select className="form-select" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
                                    {STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label>工程阶段</label>
                                <input className="form-input" value={form.phase} onChange={(event) => setForm((current) => ({ ...current, phase: event.target.value }))} placeholder="例如：主体施工、竣工验收" />
                            </div>
                            <div className="form-group">
                                <label>关联合同</label>
                                <select className="form-select" value={form.contractId} onChange={(event) => setForm((current) => ({ ...current, contractId: event.target.value }))}>
                                    <option value="">暂不关联</option>
                                    {contracts.map((contract) => (
                                        <option key={contract.id} value={contract.id}>
                                            {getContractDisplayName(contract)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </form>
                ) : null}

                <section className="table-shell">
                    <div className="card-header">
                        <div className="card-copy">
                            <div className="panel-eyebrow">Project Ledger</div>
                            <div className="panel-title">项目列表</div>
                            <div className="panel-note">勾选后可直接批量删除；单项仍可继续编辑状态和合同关联。</div>
                        </div>
                        <div className="table-toolbar-meta">
                            <span>总数：{normalizedProjects.length}</span>
                            <span>已选：{selectedIds.length}</span>
                            <span>已关联合同：{linkedCount}</span>
                        </div>
                    </div>

                    {normalizedProjects.length === 0 ? (
                        <div className="empty-state">
                            <div>
                                <div className="empty-dot" />
                                <strong>还没有项目台账</strong>
                                新建项目后，就可以设置状态并关联合同。
                            </div>
                        </div>
                    ) : (
                        <div className="data-table-shell">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: '52px' }}>
                                            <input
                                                type="checkbox"
                                                checked={allSelected}
                                                onChange={() => handleToggleSelectAll(normalizedProjects)}
                                                aria-label="全选项目"
                                            />
                                        </th>
                                        <th>项目名称</th>
                                        <th>状态</th>
                                        <th>工程阶段</th>
                                        <th>关联合同</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {normalizedProjects.map((project) => {
                                        const isSelected = selectedIds.includes(project.id);
                                        const isLinking = linkingProjectId === project.id;

                                        return (
                                            <tr key={project.id} className={isSelected ? 'row-selected' : ''}>
                                                <td>
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => handleToggleSelect(project.id)}
                                                        aria-label={`选择项目 ${project.name}`}
                                                    />
                                                </td>
                                                <td style={{ fontWeight: 600 }}><a href={`/master/projects/${project.id}`} onClick={(e) => { e.preventDefault(); router.push(`/master/projects/${project.id}`); }} style={{ color: 'inherit', textDecoration: 'none', cursor: 'pointer' }} onMouseEnter={(e) => { e.target.style.color = 'var(--color-accent)'; }} onMouseLeave={(e) => { e.target.style.color = 'inherit'; }}>{project.name}</a></td>
                                                <td><span className={`badge ${getStatusBadge(project.normalizedStatus)}`}>{project.normalizedStatus}</span></td>
                                                <td>{project.phase || '-'}</td>
                                                <td>
                                                    {isLinking ? (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                            <select
                                                                className="form-select"
                                                                style={{ fontSize: '0.78rem', minHeight: 32, padding: '2px 8px', minWidth: 180 }}
                                                                defaultValue={project.contractId ? String(project.contractId) : ''}
                                                                disabled={linkingSaving}
                                                                onChange={(event) => {
                                                                    const value = event.target.value;
                                                                    void handleLinkContract(project.id, value ? Number.parseInt(value, 10) : null);
                                                                }}
                                                            >
                                                                <option value="">不关联合同</option>
                                                                {contracts.map((c) => (
                                                                    <option key={c.id} value={c.id}>
                                                                        {getContractDisplayName(c)}
                                                                        {getContractProjectCount(c) > 0 ? ` (已关联${getContractProjectCount(c)}个项目)` : ''}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                            <button
                                                                type="button"
                                                                style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-surface)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                                                                onClick={() => setLinkingProjectId(null)}
                                                            >
                                                                取消
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                            {project.contract
                                                                ? (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setViewingContract(project.contract)}
                                                                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                                                                        title="点击查看合同检测项目"
                                                                    >
                                                                        <span className="badge badge-info" style={{ cursor: 'pointer' }}><ContractLabel contract={project.contract} /></span>
                                                                    </button>
                                                                )
                                                                : (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setLinkingProjectId(project.id)}
                                                                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                                                                        title="点击关联合同"
                                                                    >
                                                                        <span className="badge badge-warning" style={{ cursor: 'pointer' }}>未关联</span>
                                                                    </button>
                                                                )
                                                            }
                                                            {project.contract && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setLinkingProjectId(project.id)}
                                                                    style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-surface)', cursor: 'pointer', whiteSpace: 'nowrap', color: 'var(--color-muted)' }}
                                                                    title="更换合同关联"
                                                                >
                                                                    换
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </td>
                                                <td>
                                                    <div className="page-actions">
                                                        <button type="button" className="btn btn-secondary" style={{ minHeight: '32px', padding: '0 12px', fontSize: '0.72rem' }} onClick={() => router.push(`/master/projects/${project.id}`)}>详情</button>
                                                        <button type="button" className="btn btn-primary" style={{ minHeight: '32px', padding: '0 12px', fontSize: '0.72rem' }} onClick={() => handleOpenContractUpload(project)}>上传合同</button>
                                                        <button type="button" className="btn btn-secondary" style={{ minHeight: '32px', padding: '0 12px', fontSize: '0.72rem' }} onClick={() => handleEdit(project)}>编辑</button>
                                                        <button type="button" className="btn btn-danger" style={{ minHeight: '32px', padding: '0 12px', fontSize: '0.72rem' }} onClick={() => void handleDelete(project.id)}>删除</button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
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
                            {[viewingContract.clientName && `委托方：${viewingContract.clientName}`, viewingContract.partyB && `受托方：${viewingContract.partyB}`, viewingContract.signedDate && `签订日期：${new Date(viewingContract.signedDate).toLocaleDateString('zh-CN')}`, ({ area: `按面积计价 · 总价 ¥${Number(viewingContract.areaPricingAmount || 0).toLocaleString()} · 面积 ${viewingContract.areaPricingArea || '-'}`, mixed: `混合计费 · 面积部分 ¥${Number(viewingContract.areaPricingAmount || 0).toLocaleString()} · 面积 ${viewingContract.areaPricingArea || '-'}`, lumpsum: `包干价 · 总价 ¥${Number(viewingContract.lumpSumAmount || 0).toLocaleString()}` }[viewingContract.pricingMode] || '按单价计价')].filter(Boolean).join(' · ')}
                        </div>

                        {(viewingContract.priceItems || []).length > 0 ? (
                            <div className="data-table-shell">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: 50 }}>序号</th>
                                            <th>检测项目</th>
                                            <th style={{ width: 120 }}>数量</th>
                                            <th style={{ width: 100 }}>单位</th>
                                            <th style={{ width: 130 }}>单价</th>
                                            <th style={{ width: 140 }}>小计</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {viewingContract.priceItems.map((item, idx) => (
                                            <tr key={item.id || idx}>
                                                <td style={{ textAlign: 'center', color: 'var(--color-muted)' }}>{idx + 1}</td>
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
                                            <td colSpan={5} style={{ textAlign: 'right', fontWeight: 600 }}>合计</td>
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

            {/* Merge Dialog */}
            {showMerge && selectedIds.length >= 2 && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={() => setShowMerge(false)}>
                    <div className="card stack" style={{ width: '90%', maxWidth: 520, padding: 24 }} onClick={(e) => e.stopPropagation()}>
                        <div className="panel-eyebrow">Merge Projects</div>
                        <div className="panel-title" style={{ marginBottom: 4 }}>合并项目</div>
                        <div className="panel-note" style={{ marginBottom: 16 }}>选择一个目标项目，其余项目的工作记录、检测记录和报告将全部转移到目标项目，来源项目随后删除。</div>

                        <div className="form-group">
                            <label>选择保留的目标项目</label>
                            <select className="form-select" value={mergeTargetId} onChange={(e) => setMergeTargetId(e.target.value)}>
                                <option value="">请选择...</option>
                                {selectedIds.map((id) => {
                                    const p = projects.find((proj) => proj.id === id);
                                    return p ? <option key={id} value={id}>{p.name}</option> : null;
                                })}
                            </select>
                        </div>

                        {mergeTargetId && (
                            <div style={{ marginTop: 12 }}>
                                <div className="panel-note" style={{ marginBottom: 8 }}>以下项目将被合并（删除）：</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {selectedIds.filter((id) => id !== Number(mergeTargetId)).map((id) => {
                                        const p = projects.find((proj) => proj.id === id);
                                        return p ? <span key={id} className="badge badge-warning" style={{ fontSize: '0.78rem' }}>{p.name}</span> : null;
                                    })}
                                </div>
                            </div>
                        )}

                        <div className="page-actions" style={{ marginTop: 20 }}>
                            <button type="button" className="btn btn-secondary" onClick={() => setShowMerge(false)}>取消</button>
                            <button type="button" className="btn btn-primary" onClick={() => void handleMerge()} disabled={!mergeTargetId || merging}>{merging ? '合并中...' : '确认合并'}</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
