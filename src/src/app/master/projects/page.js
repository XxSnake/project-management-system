'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import ContractDetailModal from '@/components/ContractDetailModal';
import { buildProjectDisplayName } from '@/lib/projectDisplayName';

const STATUS_OPTIONS = ['进行中', '已完成', '暂停'];
const EMPTY_FORM = {
    id: '',
    name: '',
    status: '进行中',
    phase: '',
    contractId: '',
    buildingMode: false,
};

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

function getProjectOptionLabel(project) {
    return buildProjectDisplayName(project);
}

function dispatchInboxUpdated() {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('inbox-updated'));
    }
}

export default function ProjectsPage() {
    const router = useRouter();
    const [projects, setProjects] = useState([]);
    const [contracts, setContracts] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [consumedEditId, setConsumedEditId] = useState(null);
    const [requestedEditId, setRequestedEditId] = useState(null);
    const [selectedIds, setSelectedIds] = useState([]);
    const [deletingBatch, setDeletingBatch] = useState(false);
    const [linkingProjectId, setLinkingProjectId] = useState(null);
    const [linkingSelections, setLinkingSelections] = useState({});
    const [linkingSaving, setLinkingSaving] = useState(false);
    const [showMerge, setShowMerge] = useState(false);
    const [mergeTargetId, setMergeTargetId] = useState('');
    const [merging, setMerging] = useState(false);
    const [viewingContract, setViewingContract] = useState(null);
    const [sameContractDecision, setSameContractDecision] = useState(null);
    const [sameContractMode, setSameContractMode] = useState('subitem');
    const [sameContractTargetId, setSameContractTargetId] = useState('');
    const [sameContractPhase, setSameContractPhase] = useState('');
    const [sameContractSubmitting, setSameContractSubmitting] = useState(false);
    const [savingNoContractExpectedId, setSavingNoContractExpectedId] = useState(null);
    const [batchNoContractExpectedSaving, setBatchNoContractExpectedSaving] = useState(false);

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
                buildingMode: Boolean(form.buildingMode),
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
            buildingMode: Boolean(project.buildingMode),
        });
        setShowForm(true);
    };

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const params = new URLSearchParams(window.location.search);
        const nextEditId = Number.parseInt(params.get('editId') || '', 10);
        setRequestedEditId(Number.isInteger(nextEditId) ? nextEditId : null);
    }, []);

    useEffect(() => {
        if (!Number.isInteger(requestedEditId) || consumedEditId === requestedEditId) {
            return;
        }

        const project = projects.find((item) => item.id === requestedEditId);
        if (!project) {
            return;
        }

        setForm({
            id: String(project.id),
            name: project.name || '',
            status: normalizeStatus(project.status),
            phase: project.phase || '',
            contractId: project.contractId ? String(project.contractId) : '',
            buildingMode: Boolean(project.buildingMode),
        });
        setShowForm(true);
        setConsumedEditId(requestedEditId);
    }, [consumedEditId, projects, requestedEditId]);

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
            projectName: getProjectOptionLabel(project),
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
                    buildingMode: Boolean(project.buildingMode),
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

    const openLinkingProject = (project) => {
        if (!project?.id) {
            return;
        }

        setLinkingProjectId(project.id);
        setLinkingSelections((current) => ({
            ...current,
            [project.id]: project.contractId ? String(project.contractId) : '',
        }));
    };

    const resetLinkingSelection = (projectId) => {
        setLinkingSelections((current) => {
            const next = { ...current };
            const project = projects.find((item) => item.id === projectId);

            if (project) {
                next[projectId] = project.contractId ? String(project.contractId) : '';
            } else {
                delete next[projectId];
            }

            return next;
        });
    };

    const closeLinkingProject = (projectId = linkingProjectId) => {
        setLinkingSelections((current) => {
            const next = { ...current };
            if (projectId !== null && projectId !== undefined) {
                delete next[projectId];
            }
            return next;
        });

        if (projectId === linkingProjectId) {
            setLinkingProjectId(null);
        }
    };

    const updateNoContractExpected = async (project, nextValue) => {
        if (!project?.id) {
            return { ok: false, error: '项目不存在' };
        }

        setSavingNoContractExpectedId(project.id);
        try {
            const response = await fetch(`/api/projects/${project.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    noContractExpected: nextValue,
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                return {
                    ok: false,
                    error: data.error || '保存失败',
                };
            }

            return {
                ok: true,
                data,
            };
        } finally {
            setSavingNoContractExpectedId((current) => (current === project.id ? null : current));
        }
    };

    const handleToggleNoContractExpected = async (project, nextValue) => {
        if (!project) {
            return;
        }

        const result = await updateNoContractExpected(project, nextValue);
        if (!result.ok) {
            alert(result.error || '保存失败');
            return;
        }

        dispatchInboxUpdated();
        await refreshData();
    };

    const handleBatchNoContractExpected = async (nextValue) => {
        if (selectedIds.length === 0) {
            return;
        }

        const selectedProjects = normalizedProjects.filter((project) => selectedIds.includes(project.id));
        const eligibleProjects = selectedProjects.filter((project) => {
            if (nextValue && project.contractId) {
                return false;
            }

            return Boolean(project.noContractExpected) !== nextValue;
        });
        const skippedLinkedProjects = nextValue
            ? selectedProjects.filter((project) => project.contractId)
            : [];

        if (eligibleProjects.length === 0) {
            alert(nextValue
                ? '选中的项目里没有可标记为“无需合同”的无合同项目。'
                : '选中的项目里没有已标记“无需合同”的项目。');
            return;
        }

        const actionLabel = nextValue ? '标记为无需合同' : '取消无需合同标记';
        if (!confirm(`确认${actionLabel} ${eligibleProjects.length} 个项目吗？`)) {
            return;
        }

        setBatchNoContractExpectedSaving(true);
        try {
            let successCount = 0;
            let failedCount = 0;

            for (const project of eligibleProjects) {
                const result = await updateNoContractExpected(project, nextValue);
                if (result.ok) {
                    successCount += 1;
                } else {
                    failedCount += 1;
                }
            }

            dispatchInboxUpdated();
            await refreshData();

            const summary = [
                `已处理 ${successCount} 个项目`,
                skippedLinkedProjects.length > 0 ? `跳过 ${skippedLinkedProjects.length} 个已关联合同项目` : '',
                failedCount > 0 ? `失败 ${failedCount} 个项目` : '',
            ].filter(Boolean).join('，');
            alert(summary);
        } finally {
            setBatchNoContractExpectedSaving(false);
        }
    };

    const closeSameContractDecision = (resetSelection = true) => {
        if (resetSelection && sameContractDecision?.projectId) {
            resetLinkingSelection(sameContractDecision.projectId);
        }

        setSameContractDecision(null);
        setSameContractMode('subitem');
        setSameContractTargetId('');
        setSameContractPhase('');
    };

    const notifyRetroactiveResult = (data) => {
        const result = data?.retroactiveResult;
        if (!result) {
            return;
        }

        if (result.status === 'completed' && result.calculated > 0) {
            alert(`已关联合同并完成产值补算：\n补算 ${result.calculated} 条记录${result.exceeded > 0 ? `，其中 ${result.exceeded} 条超限` : ''}${result.pendingAreaShare > 0 ? `\n还有 ${result.pendingAreaShare} 条面积合同记录需要补填占比` : ''}`);
            return;
        }

        if (result.status === 'completed' && result.pendingAreaShare > 0) {
            alert(`已关联面积合同，有 ${result.pendingAreaShare} 条历史记录需要在工作记录页面补填占比后才能计算产值。`);
        }
    };

    const saveProjectContractLink = async (project, contractId, phaseOverride) => {
        if (!project) {
            return false;
        }

        const resolvedPhase = phaseOverride !== undefined
            ? (phaseOverride ? String(phaseOverride).trim() : null)
            : (project.phase || null);

        setLinkingSaving(true);
        try {
            const response = await fetch('/api/projects', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: project.id,
                    name: project.name,
                    status: normalizeStatus(project.status),
                    phase: resolvedPhase,
                    contractId: contractId || null,
                    buildingMode: Boolean(project.buildingMode),
                }),
            });

            const data = await response.json();
            if (!response.ok) {
                alert(data.error || '关联合同失败');
                resetLinkingSelection(project.id);
                return false;
            }

            notifyRetroactiveResult(data);
            closeLinkingProject(project.id);
            await refreshData();
            return true;
        } finally {
            setLinkingSaving(false);
        }
    };

    const handleLinkContractSelection = async (project, contractId) => {
        if (!project) {
            return;
        }

        const isChangingContract = Number(project.contractId || 0) !== Number(contractId || 0);
        const linkedProjects = contractId
            ? projects.filter((item) => item.id !== project.id && item.contractId === contractId)
            : [];

        if (isChangingContract && contractId && linkedProjects.length > 0) {
            setSameContractDecision({
                projectId: project.id,
                contractId,
                linkedProjectIds: linkedProjects.map((item) => item.id),
            });
            setSameContractMode('subitem');
            setSameContractTargetId(String(linkedProjects[0].id));
            setSameContractPhase(project.phase || '');
            return;
        }

        await saveProjectContractLink(project, contractId);
    };

    const handleConfirmSameContractDecision = async () => {
        if (!sameContractDecision) {
            return;
        }

        const project = projects.find((item) => item.id === sameContractDecision.projectId);
        if (!project) {
            closeSameContractDecision();
            return;
        }

        if (sameContractMode === 'subitem') {
            const rawPhase = sameContractPhase.trim();
            if (!rawPhase && !confirm('这条项目会继续挂在同一份合同下，但“工程阶段 / 子项”仍然留空。以后列表里可能还是不好区分，确认继续吗？')) {
                return;
            }
            const nextPhase = rawPhase || '__ALLOW_BLANK_PHASE__';
            if (!nextPhase && !confirm('这条项目会继续挂在同一份合同下，但“工程阶段 / 子项”仍然留空。以后列表里可能还是不好区分，确认继续吗？')) {
                return;
            }

            const success = await saveProjectContractLink(
                project,
                sameContractDecision.contractId,
                nextPhase === '__ALLOW_BLANK_PHASE__' ? null : nextPhase,
            );
            if (success) {
                closeSameContractDecision(false);
                alert(nextPhase === '__ALLOW_BLANK_PHASE__'
                    ? '已保留为同合同下的独立子项，但“工程阶段 / 子项”仍然留空。'
                    : `已保留为同合同下的独立子项，子项已记为“${nextPhase}”。`);
                return;
                alert(project.phase ? "已保留为同合同下的独立子项，当前的阶段/子项会继续保留。" : "已保留为同合同下的独立子项。后面如果要区分楼栋、单体或分项，可以继续填写阶段/子项。");
            }
            return;
        }

        const targetId = Number.parseInt(sameContractTargetId, 10);
        if (!targetId) {
            alert('请先选择要保留的项目');
            return;
        }

        const targetProject = projects.find((item) => item.id === targetId);
        if (!targetProject) {
            alert('目标项目不存在');
            return;
        }

        setSameContractSubmitting(true);
        try {
            const response = await fetch('/api/projects/merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetId,
                    sourceIds: [project.id],
                }),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || '合并失败');
            }

            alert(`已将项目“${getProjectOptionLabel(project)}”合并到“${getProjectOptionLabel(targetProject)}”，原项目里的记录已经全部转过去。`);
            setSelectedIds((current) => current.filter((id) => id !== project.id));
            closeLinkingProject(project.id);
            closeSameContractDecision(false);
            await refreshData();
        } catch (error) {
            alert(error.message);
        } finally {
            setSameContractSubmitting(false);
        }
    };

    const normalizedProjects = useMemo(
        () => projects.map((project) => ({ ...project, normalizedStatus: normalizeStatus(project.status) })),
        [projects],
    );
    const sharedContractWarningGroups = useMemo(() => {
        const groups = new Map();

        normalizedProjects.forEach((project) => {
            if (!project.contractId) {
                return;
            }

            if (!groups.has(project.contractId)) {
                groups.set(project.contractId, []);
            }
            groups.get(project.contractId).push(project);
        });

        return Array.from(groups.entries())
            .map(([contractId, linkedProjects]) => {
                const missingPhaseProjects = linkedProjects.filter((project) => !project.phase);
                if (linkedProjects.length <= 1 || missingPhaseProjects.length === 0) {
                    return null;
                }

                return {
                    contractId,
                    contract: contracts.find((item) => item.id === contractId) || null,
                    linkedProjects,
                    missingPhaseProjects,
                };
            })
            .filter(Boolean)
            .sort((left, right) => {
                if (right.missingPhaseProjects.length !== left.missingPhaseProjects.length) {
                    return right.missingPhaseProjects.length - left.missingPhaseProjects.length;
                }
                return right.linkedProjects.length - left.linkedProjects.length;
            });
    }, [contracts, normalizedProjects]);

    const activeCount = normalizedProjects.filter((item) => item.normalizedStatus === '进行中').length;
    const completedCount = normalizedProjects.filter((item) => item.normalizedStatus === '已完成').length;
    const linkedCount = normalizedProjects.filter((item) => item.contract).length;
    const noContractExpectedCount = normalizedProjects.filter((item) => item.noContractExpected).length;
    const allSelected = normalizedProjects.length > 0 && selectedIds.length === normalizedProjects.length;

    return (
        <>
            <div className="page-header">
                <div>
                    <div className="page-kicker">Data Fabric</div>
                    <h2>项目管理</h2>
                    <p className="page-desc">维护项目状态、工程阶段 / 子项、单体建筑模式和合同关联。遇到同一份合同已经绑过别的项目时，会先让你选择是直接合并，还是保留成同合同下的不同子项。</p>
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
                        className="btn btn-secondary"
                        onClick={() => void handleBatchNoContractExpected(true)}
                        disabled={!selectedIds.length || batchNoContractExpectedSaving}
                    >
                        {batchNoContractExpectedSaving ? '处理中...' : `批量标为无需合同 (${selectedIds.length})`}
                    </button>
                    <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void handleBatchNoContractExpected(false)}
                        disabled={!selectedIds.length || batchNoContractExpectedSaving}
                    >
                        取消无需合同标记
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

            {sharedContractWarningGroups.length > 0 ? (
                <div className="card stack" style={{ marginBottom: 16, borderColor: 'rgba(217, 119, 6, 0.35)', background: 'rgba(245, 158, 11, 0.08)' }}>
                    <div className="panel-eyebrow" style={{ color: 'rgb(146, 64, 14)' }}>Shared Contract Warning</div>
                    <div className="panel-title" style={{ color: 'rgb(120, 53, 15)' }}>以下合同已经关联多个项目，但还有项目没填“工程阶段 / 子项”</div>
                    <div className="panel-note" style={{ color: 'rgb(120, 53, 15)' }}>
                        这些项目后面继续拆分时，列表里还会不好区分。建议先补齐子项，再继续做合同归并。
                    </div>
                    <div style={{ display: 'grid', gap: 10 }}>
                        {sharedContractWarningGroups.map((group) => (
                            <div key={group.contractId} style={{ borderRadius: 12, border: '1px solid rgba(217, 119, 6, 0.28)', background: 'rgba(255,255,255,0.72)', padding: 12 }}>
                                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                                    {group.contract ? getContractDisplayName(group.contract) : `合同 #${group.contractId}`}
                                </div>
                                <div className="panel-note" style={{ color: 'rgb(146, 64, 14)' }}>
                                    未填写子项：{group.missingPhaseProjects.map((project) => getProjectOptionLabel(project)).join('、')}
                                </div>
                                <div className="panel-note">
                                    当前同合同项目：{group.linkedProjects.map((project) => getProjectOptionLabel(project)).join('、')}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            <div className="page-body">
                <div className="metric-grid">
                    <div className="metric-card"><div className="metric-label">项目总数</div><div className="metric-value neon">{normalizedProjects.length}</div><div className="metric-meta">当前系统里的工程项目台账</div></div>
                    <div className="metric-card"><div className="metric-label">进行中</div><div className="metric-value success">{activeCount}</div><div className="metric-meta">仍在持续推进的项目</div></div>
                    <div className="metric-card"><div className="metric-label">已完成</div><div className="metric-value">{completedCount}</div><div className="metric-meta">已完成或已归档的项目</div></div>
                    <div className="metric-card"><div className="metric-label">已关联合同</div><div className="metric-value magenta">{linkedCount}</div><div className="metric-meta">已建立合同映射，便于产值计算</div></div>
                    <div className="metric-card"><div className="metric-label">无需合同</div><div className="metric-value">{noContractExpectedCount}</div><div className="metric-meta">已确认这类项目本来就不需要上传合同</div></div>
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
                                <label>工程阶段 / 子项</label>
                                <input
                                    className="form-input"
                                    value={form.phase}
                                    onChange={(event) => setForm((current) => ({ ...current, phase: event.target.value }))}
                                    placeholder="例如：主体施工、宿舍楼、食堂改造"
                                />
                            </div>
                            <div className="form-group">
                                <label>单体建筑模式</label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 40 }}>
                                    <input
                                        type="checkbox"
                                        checked={Boolean(form.buildingMode)}
                                        onChange={(event) => {
                                            const checked = event.target.checked;
                                            setForm((current) => ({
                                                ...current,
                                                buildingMode: checked,
                                            }));
                                        }}
                                    />
                                    <span>该项目下多栋单体共用同一套检测项目</span>
                                </label>
                                <div className="panel-note">
                                    开启后，后续导入 `项目名（xxx）` 会自动归到这个项目，并把 `xxx` 当作单体建筑记录。
                                </div>
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
                            <div className="panel-note">勾选后可直接批量删除，也可以批量标记“无需合同”；无合同项目会额外显示当前合同策略。</div>
                        </div>
                        <div className="table-toolbar-meta">
                            <span>总数：{normalizedProjects.length}</span>
                            <span>已选：{selectedIds.length}</span>
                            <span>已关联合同：{linkedCount}</span>
                            <span>无需合同：{noContractExpectedCount}</span>
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
                                        <th>阶段 / 子项</th>
                                        <th>关联合同</th>
                                        <th>合同策略</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {normalizedProjects.map((project) => {
                                        const isSelected = selectedIds.includes(project.id);
                                        const isLinking = linkingProjectId === project.id;
                                        const isSavingNoContractExpected = savingNoContractExpectedId === project.id;

                                        return (
                                            <tr key={project.id} className={isSelected ? 'row-selected' : ''}>
                                                <td>
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => handleToggleSelect(project.id)}
                                                        aria-label={`选择项目 ${getProjectOptionLabel(project)}`}
                                                    />
                                                </td>
                                                <td style={{ fontWeight: 600 }}>
                                                    <a href={`/master/projects/${project.id}`} onClick={(e) => { e.preventDefault(); router.push(`/master/projects/${project.id}`); }} style={{ color: 'inherit', textDecoration: 'none', cursor: 'pointer' }} onMouseEnter={(e) => { e.target.style.color = 'var(--color-accent)'; }} onMouseLeave={(e) => { e.target.style.color = 'inherit'; }}>{getProjectOptionLabel(project)}</a>
                                                    {project.buildingMode ? <span className="badge badge-info" style={{ marginLeft: 8 }}>单体</span> : null}
                                                </td>
                                                <td><span className={`badge ${getStatusBadge(project.normalizedStatus)}`}>{project.normalizedStatus}</span></td>
                                                <td>{project.phase || '-'}</td>
                                                <td>
                                                    {isLinking ? (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                            <select
                                                                className="form-select"
                                                                style={{ fontSize: '0.78rem', minHeight: 32, padding: '2px 8px', minWidth: 180 }}
                                                                value={Object.prototype.hasOwnProperty.call(linkingSelections, project.id)
                                                                    ? linkingSelections[project.id]
                                                                    : (project.contractId ? String(project.contractId) : '')}
                                                                disabled={linkingSaving}
                                                                onChange={(event) => {
                                                                    const value = event.target.value;
                                                                    setLinkingSelections((current) => ({
                                                                        ...current,
                                                                        [project.id]: value,
                                                                    }));
                                                                    void handleLinkContractSelection(project, value ? Number.parseInt(value, 10) : null);
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
                                                                onClick={() => closeLinkingProject(project.id)}
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
                                                                        onClick={() => openLinkingProject(project)}
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
                                                                    onClick={() => openLinkingProject(project)}
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
                                                    {project.contract ? (
                                                        <span className="badge badge-success">按合同处理</span>
                                                    ) : (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                                            <span className={project.noContractExpected ? 'badge badge-info' : 'badge badge-warning'}>
                                                                {project.noContractExpected ? '无需合同' : '待关联合同'}
                                                            </span>
                                                            <button
                                                                type="button"
                                                                className="btn btn-secondary"
                                                                style={{ minHeight: '28px', padding: '0 10px', fontSize: '0.7rem' }}
                                                                disabled={isSavingNoContractExpected || batchNoContractExpectedSaving}
                                                                onClick={() => void handleToggleNoContractExpected(project, !project.noContractExpected)}
                                                            >
                                                                {isSavingNoContractExpected
                                                                    ? '保存中...'
                                                                    : (project.noContractExpected ? '改回待绑定' : '标为无需合同')}
                                                            </button>
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

            {viewingContract ? (
                <ContractDetailModal
                    contract={viewingContract}
                    onClose={() => setViewingContract(null)}
                />
            ) : null}

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
                            {(() => {
                                const contract = contracts.find((item) => item.id === sameContractDecision.contractId)
                                    || { id: sameContractDecision.contractId, contractNo: '', clientName: '', notes: '' };
                                const linkedProjects = sameContractDecision.linkedProjectIds
                                    .map((id) => projects.find((item) => item.id === id))
                                    .filter(Boolean);

                                return `合同“${getContractDisplayName(contract)}”目前已关联 ${linkedProjects.length} 个项目。请选择这次是直接并到已有项目里，还是保留成同合同下的不同子项。`;
                            })()}
                        </div>

                        <div className="form-group">
                            <label>处理方式</label>
                            <div style={{ display: 'grid', gap: 12 }}>
                                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', border: '1px solid var(--color-border)', borderRadius: 12, padding: 14, cursor: 'pointer' }}>
                                    <input type="radio" name="same-contract-mode" checked={sameContractMode === 'merge'} onChange={() => setSameContractMode('merge')} />
                                    <div>
                                        <div style={{ fontWeight: 600, marginBottom: 4 }}>合并为同一个项目</div>
                                        <div className="panel-note">当前项目会并入你选中的目标项目，原项目会删除，原项目里的工作记录、检测记录和报告会一起转过去。</div>
                                    </div>
                                </label>
                                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', border: '1px solid var(--color-border)', borderRadius: 12, padding: 14, cursor: 'pointer' }}>
                                    <input type="radio" name="same-contract-mode" checked={sameContractMode === 'subitem'} onChange={() => setSameContractMode('subitem')} />
                                    <div>
                                        <div style={{ fontWeight: 600, marginBottom: 4 }}>同一项目下的不同子项</div>
                                        <div className="panel-note">当前项目继续保留，只是共用这份合同。后面可以用“工程阶段 / 子项”区分楼栋、单体或分项。</div>
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
                            <div style={{ display: 'grid', gap: 12 }}>
                                <div className="panel-note">
                                    当前项目会保留成一条独立项目台账。如果你本来就是想把同一合同下的多个楼栋、单体或分项分开记，这个选项更合适。
                                </div>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label>工程阶段 / 子项</label>
                                    <input
                                        className="form-input"
                                        placeholder="例如：污水处理用房、1#楼、主体结构"
                                        value={sameContractPhase}
                                        onChange={(event) => setSameContractPhase(event.target.value)}
                                        disabled={sameContractSubmitting}
                                    />
                                    <div className="panel-note">建议现在就填，保存后列表里会直接按这个子项显示。</div>
                                </div>
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
