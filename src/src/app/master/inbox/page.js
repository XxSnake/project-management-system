'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
    BATCH_ALLOCATION_STRATEGIES,
    buildBatchAllocationPreview,
    getBatchAllocationContractKey,
} from '@/lib/inboxBatchAllocation';
import {
    ACKNOWLEDGEABLE_EXCEPTION_TYPES,
    EXCEPTION_META,
    EXCEPTION_ORDER,
    EXCEPTION_TYPES,
} from '@/lib/workLogExceptions';

const PAGE_SIZE = 50;
const TAB_ITEMS = [
    { type: 'all', label: '全部', code: 'ALL' },
    ...EXCEPTION_ORDER.map((type) => ({
        type,
        label: EXCEPTION_META[type]?.label || type,
        code: EXCEPTION_META[type]?.code || '--',
    })),
];
const BATCH_STRATEGY_OPTIONS = [
    {
        value: BATCH_ALLOCATION_STRATEGIES.WEIGHTED,
        label: '按数量加权',
        description: '按数量占比分配，总和自动补到 100%',
    },
    {
        value: BATCH_ALLOCATION_STRATEGIES.EVEN,
        label: '平均分',
        description: '把同一合同下选中的记录平均分掉 100%',
    },
    {
        value: BATCH_ALLOCATION_STRATEGIES.UNIFORM,
        label: '统一百分比',
        description: '给每条记录填同一个百分比',
    },
];

function formatDateDisplay(value) {
    if (!value) {
        return '-';
    }

    return new Date(value).toISOString().slice(0, 10);
}

function formatDateInput(value) {
    if (!value) {
        return '';
    }

    return new Date(value).toISOString().slice(0, 10);
}

function formatNumber(value) {
    return Number(value || 0).toFixed(2).replace(/\.?0+$/u, '');
}

function formatCurrency(value) {
    return `CNY ${Number(value || 0).toFixed(2)}`;
}

function normalizeTextInput(value) {
    return String(value ?? '').trim();
}

function parseStaffInput(value) {
    return normalizeTextInput(value)
        .split(/[,，、\s]+/u)
        .map((item) => item.trim())
        .filter(Boolean);
}

function getBadgeClass(type) {
    return EXCEPTION_META[type]?.tone === 'danger' ? 'badge badge-danger' : 'badge badge-warning';
}

function buildEditState(item) {
    return {
        workLogId: item.workLogId,
        workDate: formatDateInput(item.workDate),
        projectName: item.projectName || '',
        testContent: item.testContent || '',
        quantity: String(item.quantity ?? ''),
        unit: item.unit || '',
        remarks: item.remarks || '',
        staffText: (item.staffNames || []).join(', '),
    };
}

function buildManualState(item) {
    return {
        workLogId: item.workLogId,
        projectName: item.projectName || '',
        testContent: item.testContent || '',
        manualTotalValue: item.manualTotalValue ?? '',
        manualValueNote: item.manualValueNote || '',
    };
}

function buildAllocationState(item) {
    return {
        workLogId: item.workLogId,
        projectName: item.projectName || '',
        contractNo: item.contractNo || '',
        pricingMode: item.pricingMode || 'area',
        allocationSharePercent: item.allocationSharePercent || '',
        contractSummary: item.contractSummary || {},
    };
}

function isPendingAllocationItem(item) {
    return (item?.exceptions || []).includes(EXCEPTION_TYPES.PENDING_ALLOCATION_SHARE);
}

function isExceededItem(item) {
    return (item?.exceptions || []).includes(EXCEPTION_TYPES.EXCEEDED);
}

function isProjectFuzzyMatchItem(item) {
    return item?.itemType === 'project-fuzzy-match';
}

function getInboxRowKey(item) {
    if (isProjectFuzzyMatchItem(item)) {
        return `project-${item.projectId}`;
    }

    return `worklog-${item.workLogId}`;
}

function dispatchInboxUpdated() {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('inbox-updated'));
    }
}

function getAcknowledgeTargets(item, selectedType) {
    const available = (item.exceptions || []).filter((type) => ACKNOWLEDGEABLE_EXCEPTION_TYPES.has(type));
    if (selectedType !== 'all' && available.includes(selectedType)) {
        return [selectedType];
    }

    return available;
}

export default function InboxPage() {
    const router = useRouter();
    const [selectedType, setSelectedType] = useState('all');
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [payload, setPayload] = useState({
        counts: {},
        items: [],
        total: 0,
        page: 1,
        pageSize: PAGE_SIZE,
    });
    const [editingItem, setEditingItem] = useState(null);
    const [manualItem, setManualItem] = useState(null);
    const [allocationItem, setAllocationItem] = useState(null);
    const [savingEdit, setSavingEdit] = useState(false);
    const [savingManual, setSavingManual] = useState(false);
    const [savingAllocation, setSavingAllocation] = useState(false);
    const [ackingMap, setAckingMap] = useState({});
    const [selectedBatchIds, setSelectedBatchIds] = useState([]);
    const [batchDialogOpen, setBatchDialogOpen] = useState(false);
    const [batchStrategy, setBatchStrategy] = useState(BATCH_ALLOCATION_STRATEGIES.WEIGHTED);
    const [batchUniformPercent, setBatchUniformPercent] = useState('');
    const [savingBatch, setSavingBatch] = useState(false);
    const [fuzzySubmittingMap, setFuzzySubmittingMap] = useState({});

    const loadData = useCallback(async (options = {}) => {
        const { silent = false } = options;

        if (!silent) {
            setLoading(true);
        }

        setError('');
        try {
            const params = new URLSearchParams({
                page: String(page),
                pageSize: String(PAGE_SIZE),
            });
            if (selectedType !== 'all') {
                params.set('type', selectedType);
            }

            const response = await fetch(`/api/inbox/exceptions?${params.toString()}&_t=${Date.now()}`, {
                cache: 'no-store',
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || '加载异常收件箱失败');
            }

            setPayload({
                counts: data.counts || {},
                items: Array.isArray(data.items) ? data.items : [],
                total: Number(data.total || 0),
                page: Number(data.page || page),
                pageSize: Number(data.pageSize || PAGE_SIZE),
            });
        } catch (currentError) {
            setError(currentError.message || '加载异常收件箱失败');
        } finally {
            if (!silent) {
                setLoading(false);
            }
        }
    }, [page, selectedType]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const selectedCount = selectedType === 'all'
        ? Number(payload.counts?.total || 0)
        : Number(payload.counts?.[selectedType] || 0);
    const totalPages = Math.max(1, Math.ceil(Number(payload.total || 0) / PAGE_SIZE));
    const isExceededTab = selectedType === EXCEPTION_TYPES.EXCEEDED;

    const openContractPage = (item) => {
        const params = new URLSearchParams();
        if (item.contractId) {
            params.set('contractId', String(item.contractId));
        }
        if (item.contractNo) {
            params.set('contractNo', item.contractNo);
        }

        router.push(params.toString() ? `/contracts?${params.toString()}` : '/contracts');
    };

    const openProjectPage = (item) => {
        if (!item.projectId) {
            return;
        }

        router.push(`/master/projects/${item.projectId}`);
    };

    const openProjectRenamePage = (item) => {
        if (!item.projectId) {
            return;
        }

        router.push(`/master/projects?editId=${item.projectId}`);
    };

    const openWorkLogPageForExceeded = (item) => {
        const params = new URLSearchParams();
        if (item.projectId) {
            params.set('projectId', String(item.projectId));
        }
        if (item.projectName) {
            params.set('projectName', item.projectName);
        }
        params.set('exceptionType', EXCEPTION_TYPES.EXCEEDED);
        params.set('focusWorkLogId', String(item.workLogId));

        alert('这类超限通常要去工作记录总账里做“改项目”或“拆分”。已帮你跳到对应项目的超限记录。');
        router.push(`/worklog?${params.toString()}`);
    };

    const saveWorkLogPatch = async (workLogId, patch) => {
        const response = await fetch(`/api/worklog/${workLogId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || '保存失败');
        }

        dispatchInboxUpdated();
        await loadData({ silent: true });
        return data;
    };

    const handleSaveEdit = async () => {
        if (!editingItem) {
            return;
        }

        const quantityText = normalizeTextInput(editingItem.quantity);
        if (quantityText && !/^(?:\d+|\d*\.\d+)$/u.test(quantityText)) {
            alert('数量只能填写数字');
            return;
        }

        if (!normalizeTextInput(editingItem.projectName)) {
            alert('项目不能为空');
            return;
        }

        setSavingEdit(true);
        try {
            await saveWorkLogPatch(editingItem.workLogId, {
                workDate: editingItem.workDate,
                projectName: editingItem.projectName,
                testContent: editingItem.testContent,
                quantity: quantityText,
                unit: editingItem.unit,
                remarks: editingItem.remarks,
                staffNames: parseStaffInput(editingItem.staffText),
            });
            setEditingItem(null);
            setMessage('工作记录已更新');
        } catch (currentError) {
            alert(currentError.message || '保存失败');
        } finally {
            setSavingEdit(false);
        }
    };

    const handleSaveManual = async () => {
        if (!manualItem) {
            return;
        }

        const numeric = Number.parseFloat(manualItem.manualTotalValue);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            alert('手动产值必须大于 0');
            return;
        }

        setSavingManual(true);
        try {
            await saveWorkLogPatch(manualItem.workLogId, {
                manualTotalValue: numeric,
                manualValueNote: manualItem.manualValueNote,
            });
            setManualItem(null);
            setMessage('手动产值已保存');
        } catch (currentError) {
            alert(currentError.message || '保存失败');
        } finally {
            setSavingManual(false);
        }
    };

    const handleSaveAllocation = async () => {
        if (!allocationItem) {
            return;
        }

        const numeric = Number.parseFloat(allocationItem.allocationSharePercent);
        if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 100) {
            alert('占比只能填写 0 到 100 之间的数字');
            return;
        }

        setSavingAllocation(true);
        try {
            await saveWorkLogPatch(allocationItem.workLogId, {
                allocationShare: numeric,
            });
            setAllocationItem(null);
            setMessage('占比已保存');
        } catch (currentError) {
            alert(currentError.message || '保存失败');
        } finally {
            setSavingAllocation(false);
        }
    };

    const handleAcknowledge = async (workLogId, exceptionType) => {
        const ackKey = `${workLogId}:${exceptionType}`;
        setAckingMap((current) => ({ ...current, [ackKey]: true }));

        try {
            const response = await fetch('/api/inbox/acknowledge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workLogId,
                    exceptionType,
                }),
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || '标记失败');
            }

            dispatchInboxUpdated();
            await loadData({ silent: true });
            setMessage(`已忽略 ${EXCEPTION_META[exceptionType]?.label || exceptionType}`);
        } catch (currentError) {
            alert(currentError.message || '标记失败');
        } finally {
            setAckingMap((current) => {
                const next = { ...current };
                delete next[ackKey];
                return next;
            });
        }
    };

    const handleConfirmFuzzyDistinct = async (projectId) => {
        const actionKey = `confirm:${projectId}`;
        setFuzzySubmittingMap((current) => ({ ...current, [actionKey]: true }));

        try {
            const response = await fetch('/api/inbox/fuzzy-match/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId }),
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || '处理失败');
            }

            dispatchInboxUpdated();
            await loadData({ silent: true });
            setMessage('已确认这条项目不是同一个');
        } catch (currentError) {
            alert(currentError.message || '处理失败');
        } finally {
            setFuzzySubmittingMap((current) => {
                const next = { ...current };
                delete next[actionKey];
                return next;
            });
        }
    };

    const handleMergeFuzzyProject = async (projectId, targetProjectId) => {
        const actionKey = `merge:${projectId}:${targetProjectId}`;
        setFuzzySubmittingMap((current) => ({ ...current, [actionKey]: true }));

        try {
            const response = await fetch('/api/inbox/fuzzy-match/merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, targetProjectId }),
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || '合并失败');
            }

            dispatchInboxUpdated();
            await loadData({ silent: true });
            setMessage(`已并入 ${data.targetProject || `#${targetProjectId}`}`);
        } catch (currentError) {
            alert(currentError.message || '合并失败');
        } finally {
            setFuzzySubmittingMap((current) => {
                const next = { ...current };
                delete next[actionKey];
                return next;
            });
        }
    };

    const tableRows = useMemo(() => payload.items || [], [payload.items]);
    const isBatchAllocationTab = selectedType === EXCEPTION_TYPES.PENDING_ALLOCATION_SHARE;
    const batchRows = useMemo(
        () => (isBatchAllocationTab ? tableRows.filter((item) => isPendingAllocationItem(item)) : []),
        [isBatchAllocationTab, tableRows],
    );
    const selectedBatchIdSet = useMemo(() => new Set(selectedBatchIds), [selectedBatchIds]);
    const selectedBatchItems = useMemo(
        () => batchRows.filter((item) => selectedBatchIdSet.has(item.workLogId)),
        [batchRows, selectedBatchIdSet],
    );
    const batchContractGroups = useMemo(() => {
        const groups = new Map();

        for (const item of batchRows) {
            const contractKey = getBatchAllocationContractKey(item);
            const existing = groups.get(contractKey) || {
                key: contractKey,
                contractId: item.contractId || null,
                contractNo: item.contractNo || '',
                projectName: item.projectName || '',
                ids: [],
            };

            existing.ids.push(item.workLogId);
            groups.set(contractKey, existing);
        }

        return Array.from(groups.values()).sort((left, right) => {
            const leftLabel = left.contractNo || left.projectName || '';
            const rightLabel = right.contractNo || right.projectName || '';
            return leftLabel.localeCompare(rightLabel, 'zh-CN');
        });
    }, [batchRows]);
    const selectedContractKeys = useMemo(
        () => Array.from(new Set(selectedBatchItems.map((item) => getBatchAllocationContractKey(item)))),
        [selectedBatchItems],
    );
    const batchPreviewState = useMemo(() => {
        if (selectedBatchItems.length === 0) {
            return {
                preview: null,
                error: '请先勾选要批量处理的记录',
            };
        }

        try {
            return {
                preview: buildBatchAllocationPreview(selectedBatchItems, batchStrategy, {
                    uniformPercent: batchUniformPercent,
                }),
                error: '',
            };
        } catch (currentError) {
            return {
                preview: null,
                error: currentError.message || '批量预览失败',
            };
        }
    }, [batchStrategy, batchUniformPercent, selectedBatchItems]);

    useEffect(() => {
        if (!isBatchAllocationTab) {
            setSelectedBatchIds([]);
            setBatchDialogOpen(false);
            return;
        }

        const visibleIds = new Set(batchRows.map((item) => item.workLogId));
        setSelectedBatchIds((current) => {
            const next = current.filter((id) => visibleIds.has(id));
            return next.length === current.length ? current : next;
        });
    }, [batchRows, isBatchAllocationTab]);

    const toggleBatchSelection = (workLogId) => {
        setSelectedBatchIds((current) => (
            current.includes(workLogId)
                ? current.filter((id) => id !== workLogId)
                : [...current, workLogId]
        ));
    };

    const toggleBatchContractGroup = (group) => {
        setSelectedBatchIds((current) => {
            const allSelected = group.ids.every((id) => current.includes(id));
            if (allSelected) {
                return current.filter((id) => !group.ids.includes(id));
            }

            const next = new Set(current);
            group.ids.forEach((id) => next.add(id));
            return Array.from(next);
        });
    };

    const handleOpenBatchDialog = () => {
        if (selectedBatchItems.length === 0) {
            alert('请先勾选要批量处理的记录');
            return;
        }

        setBatchDialogOpen(true);
    };

    const handleSaveBatchAllocation = async () => {
        if (!batchPreviewState.preview) {
            alert(batchPreviewState.error || '请先完成批量预览');
            return;
        }

        setSavingBatch(true);
        try {
            const response = await fetch('/api/inbox/batch-allocate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: batchPreviewState.preview.items.map((item) => ({
                        workLogId: item.workLogId,
                        allocationShare: item.allocationShare,
                    })),
                }),
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || '批量填占比失败');
            }

            dispatchInboxUpdated();
            await loadData({ silent: true });
            setSelectedBatchIds([]);
            setBatchDialogOpen(false);
            setMessage(`已批量处理 ${data.updatedCount || batchPreviewState.preview.items.length} 条缺占比记录`);
        } catch (currentError) {
            alert(currentError.message || '批量填占比失败');
        } finally {
            setSavingBatch(false);
        }
    };

    return (
        <>
            <div className="page-header">
                <div>
                    <div className="page-kicker">Exception Inbox</div>
                    <h2>异常处理</h2>
                    <p className="page-desc">
                        这里集中显示需要补数据、补规则或人工确认的工作记录。修完后会自动从列表里消失，不改现有计算逻辑。
                    </p>
                </div>
                <div className="page-actions">
                    <span className="status-badge status-badge--pending">未处理 {payload.counts?.total || 0} 条</span>
                    <span className="status-badge status-badge--approved">{selectedType === 'all' ? '当前查看全部' : `${selectedCount} 条`}</span>
                    <button type="button" className="btn btn-secondary" onClick={() => void loadData()}>刷新</button>
                    <button type="button" className="btn btn-secondary" onClick={() => router.push('/worklog')}>打开工作记录总账</button>
                </div>
            </div>

            <div className="page-body">
                {message ? (
                    <div className="alert alert-success" style={{ marginBottom: 16 }}>
                        {message}
                    </div>
                ) : null}

                {error ? (
                    <div className="alert alert-danger" style={{ marginBottom: 16 }}>
                        {error}
                    </div>
                ) : null}

                {isExceededTab ? (
                    <div className="alert alert-danger" style={{ marginBottom: 16 }}>
                        这里的“接受 cap”不是忽略错误，而是确认“当前截断后的产值就是我要保留的结果”。如果合同额本来就该更高，请去改合同总额；如果只是这条记录放错了项目，请去工作记录总账拆分或改绑。
                    </div>
                ) : null}

                <section className="card stack" style={{ marginBottom: 16 }}>
                    <div className="card-header">
                        <div className="card-copy">
                            <div className="panel-eyebrow">Inbox Tabs</div>
                            <div className="panel-title">异常分类</div>
                            <div className="panel-note">每条记录可能同时属于多个分类，顶部数字按当前未处理状态实时统计。</div>
                        </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                        {TAB_ITEMS.map((item) => {
                            const active = item.type === selectedType;
                            const count = item.type === 'all'
                                ? Number(payload.counts?.total || 0)
                                : Number(payload.counts?.[item.type] || 0);

                            return (
                                <button
                                    key={item.type}
                                    type="button"
                                    className={active ? 'btn btn-primary' : 'btn btn-secondary'}
                                    style={{ minHeight: 36 }}
                                    onClick={() => {
                                        setSelectedType(item.type);
                                        setPage(1);
                                        setMessage('');
                                    }}
                                >
                                    {item.code} {item.label} ({count})
                                </button>
                            );
                        })}
                    </div>
                </section>

                <section className="card">
                    <div className="card-header">
                        <div className="card-copy">
                            <div className="panel-eyebrow">Exception Ledger</div>
                            <div className="panel-title">{selectedType === 'all' ? '全部异常记录' : EXCEPTION_META[selectedType]?.label || '异常记录'}</div>
                            <div className="panel-note">
                                当前第 {page} / {totalPages} 页，共 {payload.total || 0} 条。
                            </div>
                        </div>
                        <div className="page-actions">
                            <button type="button" className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</button>
                            <button type="button" className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>下一页</button>
                        </div>
                    </div>

                    {isBatchAllocationTab ? (
                        <div className="stack" style={{ gap: 12, marginBottom: 16 }}>
                            <div className="alert alert-warning" style={{ marginBottom: 0 }}>
                                这个分类支持批量填占比。一次只能处理同一合同下的一组记录，系统会先给你预览，再统一保存。
                            </div>
                            <div className="page-actions" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                                <div className="page-actions" style={{ gap: 8, flexWrap: 'wrap' }}>
                                    <span className="status-badge status-badge--pending">已选 {selectedBatchItems.length} 条</span>
                                    <button type="button" className="btn btn-secondary" onClick={() => setSelectedBatchIds(batchRows.map((item) => item.workLogId))}>全选本页</button>
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => setSelectedBatchIds(batchRows
                                            .map((item) => item.workLogId)
                                            .filter((id) => !selectedBatchIdSet.has(id)))}
                                    >
                                        反选本页
                                    </button>
                                    <button type="button" className="btn btn-secondary" onClick={() => setSelectedBatchIds([])}>清空选择</button>
                                </div>
                                <button type="button" className="btn btn-primary" disabled={selectedBatchItems.length === 0} onClick={handleOpenBatchDialog}>
                                    批量填占比
                                </button>
                            </div>
                            {batchContractGroups.length > 0 ? (
                                <div className="page-actions" style={{ gap: 8, flexWrap: 'wrap' }}>
                                    {batchContractGroups.map((group) => {
                                        const groupSelected = group.ids.every((id) => selectedBatchIdSet.has(id));
                                        return (
                                            <button
                                                key={group.key}
                                                type="button"
                                                className={groupSelected ? 'btn btn-primary' : 'btn btn-secondary'}
                                                style={{ minHeight: 32, padding: '0 12px', fontSize: '0.72rem' }}
                                                onClick={() => toggleBatchContractGroup(group)}
                                            >
                                                {groupSelected ? '取消' : '选择'} {group.contractNo || group.projectName || '未命名合同'} ({group.ids.length})
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : null}
                            {selectedContractKeys.length > 1 ? (
                                <div className="alert alert-danger" style={{ marginBottom: 0 }}>
                                    当前选中了多个合同。请按合同分开处理，再进入批量预览。
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    {loading ? (
                        <div className="empty-state">
                            <div>
                                <div className="empty-dot" />
                                <strong>正在加载异常收件箱</strong>
                                <div>请稍候。</div>
                            </div>
                        </div>
                    ) : tableRows.length === 0 ? (
                        <div className="empty-state">
                            <div>
                                <div className="empty-dot" />
                                <strong>当前没有待处理记录</strong>
                                <div>这个分类下已经清空，或者刚刚处理完成。</div>
                            </div>
                        </div>
                    ) : (
                        <div className="data-table-shell">
                            <table className="data-table" style={{ minWidth: isBatchAllocationTab ? 1380 : 1320 }}>
                                <thead>
                                    <tr>
                                        {isBatchAllocationTab ? (
                                            <th style={{ width: 54 }}>
                                                <input
                                                    type="checkbox"
                                                    checked={batchRows.length > 0 && selectedBatchItems.length === batchRows.length}
                                                    onChange={() => setSelectedBatchIds(
                                                        selectedBatchItems.length === batchRows.length
                                                            ? []
                                                            : batchRows.map((item) => item.workLogId),
                                                    )}
                                                />
                                            </th>
                                        ) : null}
                                        <th style={{ width: 120 }}>日期</th>
                                        <th style={{ width: 280 }}>项目</th>
                                        <th>检测内容</th>
                                        <th style={{ width: 130 }}>数量</th>
                                        <th style={{ width: 220 }}>人员</th>
                                        <th style={{ width: 220 }}>异常</th>
                                        <th style={{ width: 320 }}>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tableRows.map((item) => {
                                        if (isProjectFuzzyMatchItem(item)) {
                                            const confirmKey = `confirm:${item.projectId}`;

                                            return (
                                                <tr key={getInboxRowKey(item)}>
                                                    <td>{formatDateDisplay(item.fuzzyMatchedAt || item.projectCreatedAt)}</td>
                                                    <td>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                            <div style={{ fontWeight: 600 }}>{item.projectName || `#${item.projectId}`}</div>
                                                            <div style={{ color: 'rgba(54, 65, 82, 0.78)', fontSize: '0.82rem', lineHeight: 1.6 }}>
                                                                #{item.projectId}
                                                                {item.contractNo ? ` · 合同：${item.contractNo}` : ' · 未关联合同'}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                            <div>后台已把这条项目判成“疑似重名”，等你人工确认。</div>
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                                {(item.candidateProjects || []).length > 0 ? (
                                                                    item.candidateProjects.map((candidate) => (
                                                                        <div key={`candidate-${item.projectId}-${candidate.id}`} style={{ color: 'rgba(54, 65, 82, 0.78)', fontSize: '0.82rem', lineHeight: 1.6 }}>
                                                                            候选：{candidate.projectName || `#${candidate.id}`}
                                                                            {candidate.contractNo ? ` · ${candidate.contractNo}` : ''}
                                                                            {candidate.missing ? ' · 已不存在' : ''}
                                                                        </div>
                                                                    ))
                                                                ) : (
                                                                    <div style={{ color: 'rgba(54, 65, 82, 0.78)', fontSize: '0.82rem', lineHeight: 1.6 }}>
                                                                        当前没有可用的候选项目。
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                            <div>{item.phase || '无子项 / 阶段'}</div>
                                                            <div style={{ color: 'rgba(54, 65, 82, 0.78)', fontSize: '0.82rem' }}>
                                                                {item.buildingMode ? '单体建筑模式' : '普通项目'}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                            <div>{(item.candidateProjects || []).length} 个候选项目</div>
                                                            <div style={{ color: 'rgba(54, 65, 82, 0.78)', fontSize: '0.82rem', lineHeight: 1.6 }}>
                                                                要是不是同一个项目就点“不重名”；要是其中一个才是正确的，可以直接并入过去。
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                                                <span className={getBadgeClass(EXCEPTION_TYPES.FUZZY_PROJECT_DUPLICATE)}>
                                                                    {EXCEPTION_META[EXCEPTION_TYPES.FUZZY_PROJECT_DUPLICATE]?.code} {EXCEPTION_META[EXCEPTION_TYPES.FUZZY_PROJECT_DUPLICATE]?.label}
                                                                </span>
                                                            </div>
                                                            <div style={{ color: 'rgba(54, 65, 82, 0.78)', fontSize: '0.78rem', lineHeight: 1.5 }}>
                                                                这类记录不会自动合并，只是把可疑项目推进收件箱提醒你。
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div className="page-actions" style={{ gap: 8, flexWrap: 'wrap' }}>
                                                            <button
                                                                type="button"
                                                                className="btn btn-primary"
                                                                style={{ minHeight: 32, padding: '0 12px', fontSize: '0.72rem' }}
                                                                disabled={Boolean(fuzzySubmittingMap[confirmKey])}
                                                                onClick={() => void handleConfirmFuzzyDistinct(item.projectId)}
                                                            >
                                                                {fuzzySubmittingMap[confirmKey] ? '处理中...' : '不是同一个项目'}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="btn btn-secondary"
                                                                style={{ minHeight: 32, padding: '0 12px', fontSize: '0.72rem' }}
                                                                onClick={() => openProjectRenamePage(item)}
                                                            >
                                                                去改项目名
                                                            </button>
                                                            {(item.candidateProjects || [])
                                                                .filter((candidate) => !candidate.missing)
                                                                .map((candidate) => {
                                                                    const mergeKey = `merge:${item.projectId}:${candidate.id}`;
                                                                    return (
                                                                        <button
                                                                            key={mergeKey}
                                                                            type="button"
                                                                            className="btn btn-secondary"
                                                                            style={{ minHeight: 32, padding: '0 12px', fontSize: '0.72rem' }}
                                                                            disabled={Boolean(fuzzySubmittingMap[mergeKey])}
                                                                            onClick={() => void handleMergeFuzzyProject(item.projectId, candidate.id)}
                                                                        >
                                                                            {fuzzySubmittingMap[mergeKey] ? '合并中...' : `并入 ${candidate.projectName || `#${candidate.id}`}`}
                                                                        </button>
                                                                    );
                                                                })}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        }

                                        const acknowledgeTargets = getAcknowledgeTargets(item, selectedType)
                                            .filter((type) => type !== EXCEPTION_TYPES.EXCEEDED);
                                        const allowEdit = item.exceptions.some((type) => (
                                            type === EXCEPTION_TYPES.INVALID_QUANTITY
                                            || type === EXCEPTION_TYPES.MISSING_STAFF
                                            || type === EXCEPTION_TYPES.NO_PRICE_MATCH
                                        ));
                                        const allowManual = item.exceptions.some((type) => (
                                            type === EXCEPTION_TYPES.NO_PRICE_MATCH
                                            || type === EXCEPTION_TYPES.PENDING_ALLOCATION_SHARE
                                            || type === EXCEPTION_TYPES.CONTRACT_INCOMPLETE
                                        ));
                                        const allowAllocation = item.exceptions.includes(EXCEPTION_TYPES.PENDING_ALLOCATION_SHARE);
                                        const allowExceeded = isExceededItem(item);

                                        return (
                                            <tr key={getInboxRowKey(item)}>
                                                {isBatchAllocationTab ? (
                                                    <td>
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedBatchIdSet.has(item.workLogId)}
                                                            onChange={() => toggleBatchSelection(item.workLogId)}
                                                        />
                                                    </td>
                                                ) : null}
                                                <td>{formatDateDisplay(item.workDate)}</td>
                                                <td>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                        <div style={{ fontWeight: 600 }}>{item.projectName || '未绑定项目'}</div>
                                                        <div style={{ color: 'rgba(54, 65, 82, 0.78)', fontSize: '0.82rem', lineHeight: 1.6 }}>
                                                            #{item.workLogId}
                                                            {item.buildingName ? ` · 单体：${item.buildingName}` : ''}
                                                            {item.contractNo ? ` · 合同：${item.contractNo}` : ' · 未关联合同'}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                        <div>{item.testContent || '-'}</div>
                                                        {item.remarks ? (
                                                            <div style={{ color: 'rgba(54, 65, 82, 0.78)', fontSize: '0.82rem', lineHeight: 1.6 }}>
                                                                备注：{item.remarks}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                        <div>{formatNumber(item.quantity)} {item.unit || ''}</div>
                                                        {item.manualTotalValue ? (
                                                            <div style={{ color: 'rgba(54, 65, 82, 0.78)', fontSize: '0.82rem' }}>
                                                                手动产值：{formatCurrency(item.manualTotalValue)}
                                                            </div>
                                                        ) : null}
                                                        {item.allocationSharePercent ? (
                                                            <div style={{ color: 'rgba(54, 65, 82, 0.78)', fontSize: '0.82rem' }}>
                                                                占比：{item.allocationSharePercent}%
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                                            {(item.staffNames || []).length > 0
                                                                ? item.staffNames.map((name) => (
                                                                    <span key={`${item.workLogId}-${name}`} className="badge badge-info">{name}</span>
                                                                ))
                                                                : <span className="badge badge-warning">未分配</span>}
                                                        </div>
                                                        {allowExceeded ? (
                                                            <div style={{ color: 'var(--color-danger, #b42318)', fontSize: '0.78rem', lineHeight: 1.5 }}>
                                                                这条记录当前已按合同上限截断。若你确认这个结果合理，可直接“接受 cap”。
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                                            {(item.exceptions || []).map((type) => (
                                                                <span key={`${item.workLogId}-${type}`} className={getBadgeClass(type)}>
                                                                    {EXCEPTION_META[type]?.code} {EXCEPTION_META[type]?.label}
                                                                </span>
                                                            ))}
                                                        </div>
                                                        {allowExceeded && item.contractNo ? (
                                                            <div style={{ color: 'rgba(54, 65, 82, 0.78)', fontSize: '0.78rem', lineHeight: 1.5 }}>
                                                                当前关联合同：{item.contractNo}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="page-actions" style={{ gap: 8, flexWrap: 'wrap' }}>
                                                        {allowEdit ? (
                                                            <button
                                                                type="button"
                                                                className="btn btn-secondary"
                                                                style={{ minHeight: 32, padding: '0 12px', fontSize: '0.72rem' }}
                                                                onClick={() => {
                                                                    setEditingItem(buildEditState(item));
                                                                    setMessage('');
                                                                }}
                                                            >
                                                                编辑
                                                            </button>
                                                        ) : null}

                                                        {allowManual ? (
                                                            <button
                                                                type="button"
                                                                className="btn btn-primary"
                                                                style={{ minHeight: 32, padding: '0 12px', fontSize: '0.72rem' }}
                                                                onClick={() => {
                                                                    setManualItem(buildManualState(item));
                                                                    setMessage('');
                                                                }}
                                                            >
                                                                转手动产值
                                                            </button>
                                                        ) : null}

                                                        {allowAllocation ? (
                                                            <button
                                                                type="button"
                                                                className="btn btn-secondary"
                                                                style={{ minHeight: 32, padding: '0 12px', fontSize: '0.72rem' }}
                                                                onClick={() => {
                                                                    setAllocationItem(buildAllocationState(item));
                                                                    setMessage('');
                                                                }}
                                                            >
                                                                填占比
                                                            </button>
                                                        ) : null}

                                                        {item.exceptions.includes(EXCEPTION_TYPES.CONTRACT_INCOMPLETE) ? (
                                                            <button
                                                                type="button"
                                                                className="btn btn-secondary"
                                                                style={{ minHeight: 32, padding: '0 12px', fontSize: '0.72rem' }}
                                                                onClick={() => openContractPage(item)}
                                                            >
                                                                去合同页
                                                            </button>
                                                        ) : null}

                                                        {item.exceptions.includes(EXCEPTION_TYPES.WORKLOAD_ONLY) ? (
                                                            <button
                                                                type="button"
                                                                className="btn btn-secondary"
                                                                style={{ minHeight: 32, padding: '0 12px', fontSize: '0.72rem' }}
                                                                onClick={() => openProjectPage(item)}
                                                            >
                                                                去项目页
                                                            </button>
                                                        ) : null}

                                                        {allowExceeded ? (
                                                            <>
                                                                <button
                                                                    type="button"
                                                                    className="btn btn-primary"
                                                                    style={{ minHeight: 32, padding: '0 12px', fontSize: '0.72rem' }}
                                                                    disabled={Boolean(ackingMap[`${item.workLogId}:${EXCEPTION_TYPES.EXCEEDED}`])}
                                                                    onClick={() => void handleAcknowledge(item.workLogId, EXCEPTION_TYPES.EXCEEDED)}
                                                                >
                                                                    {ackingMap[`${item.workLogId}:${EXCEPTION_TYPES.EXCEEDED}`] ? '处理中...' : '接受 cap'}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="btn btn-secondary"
                                                                    style={{ minHeight: 32, padding: '0 12px', fontSize: '0.72rem' }}
                                                                    onClick={() => openContractPage(item)}
                                                                >
                                                                    改合同额
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="btn btn-secondary"
                                                                    style={{ minHeight: 32, padding: '0 12px', fontSize: '0.72rem' }}
                                                                    onClick={() => openWorkLogPageForExceeded(item)}
                                                                >
                                                                    去总账处理
                                                                </button>
                                                            </>
                                                        ) : null}

                                                        {acknowledgeTargets.map((type) => {
                                                            const ackKey = `${item.workLogId}:${type}`;
                                                            return (
                                                                <button
                                                                    key={ackKey}
                                                                    type="button"
                                                                    className="btn btn-danger"
                                                                    style={{ minHeight: 32, padding: '0 12px', fontSize: '0.72rem' }}
                                                                    disabled={Boolean(ackingMap[ackKey])}
                                                                    onClick={() => void handleAcknowledge(item.workLogId, type)}
                                                                >
                                                                    {ackingMap[ackKey] ? '处理中...' : `忽略 ${EXCEPTION_META[type]?.code}`}
                                                                </button>
                                                            );
                                                        })}
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

            {editingItem ? (
                <div className="modal-backdrop" onClick={() => setEditingItem(null)}>
                    <div className="modal-card card" onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <div className="modal-title">编辑工作记录</div>
                                <div className="modal-note">修完数量、人员或检测内容后，这条记录会自动重新判断是否还属于异常。</div>
                            </div>
                        </div>

                        <div className="stack" style={{ gap: 16 }}>
                            <div className="form-grid">
                                <div className="form-group">
                                    <label>日期</label>
                                    <input className="form-input" type="date" value={editingItem.workDate} onChange={(event) => setEditingItem((current) => ({ ...current, workDate: event.target.value }))} />
                                </div>
                                <div className="form-group">
                                    <label>项目</label>
                                    <input className="form-input" value={editingItem.projectName} onChange={(event) => setEditingItem((current) => ({ ...current, projectName: event.target.value }))} />
                                </div>
                            </div>

                            <div className="form-group">
                                <label>检测内容</label>
                                <input className="form-input" value={editingItem.testContent} onChange={(event) => setEditingItem((current) => ({ ...current, testContent: event.target.value }))} />
                            </div>

                            <div className="form-grid">
                                <div className="form-group">
                                    <label>数量</label>
                                    <input className="form-input" value={editingItem.quantity} onChange={(event) => setEditingItem((current) => ({ ...current, quantity: event.target.value }))} />
                                </div>
                                <div className="form-group">
                                    <label>单位</label>
                                    <input className="form-input" value={editingItem.unit} onChange={(event) => setEditingItem((current) => ({ ...current, unit: event.target.value }))} />
                                </div>
                            </div>

                            <div className="form-group">
                                <label>人员</label>
                                <input className="form-input" value={editingItem.staffText} onChange={(event) => setEditingItem((current) => ({ ...current, staffText: event.target.value }))} placeholder="多个名字用逗号隔开，可留空" />
                            </div>

                            <div className="form-group">
                                <label>备注</label>
                                <textarea className="form-textarea" rows={4} value={editingItem.remarks} onChange={(event) => setEditingItem((current) => ({ ...current, remarks: event.target.value }))} />
                            </div>
                        </div>

                        <div className="modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setEditingItem(null)}>取消</button>
                            <button type="button" className="btn btn-primary" disabled={savingEdit} onClick={() => void handleSaveEdit()}>
                                {savingEdit ? '保存中...' : '保存修改'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {manualItem ? (
                <div className="modal-backdrop" onClick={() => setManualItem(null)}>
                    <div className="modal-card card" onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <div className="modal-title">转手动产值</div>
                                <div className="modal-note">{manualItem.projectName} · {manualItem.testContent}</div>
                            </div>
                        </div>

                        <div className="stack" style={{ gap: 16 }}>
                            <div className="form-group">
                                <label>手动产值</label>
                                <input
                                    className="form-input"
                                    value={manualItem.manualTotalValue}
                                    onChange={(event) => setManualItem((current) => ({ ...current, manualTotalValue: event.target.value }))}
                                    placeholder="填写大于 0 的数字"
                                />
                            </div>
                            <div className="form-group">
                                <label>说明</label>
                                <textarea
                                    className="form-textarea"
                                    rows={4}
                                    value={manualItem.manualValueNote}
                                    onChange={(event) => setManualItem((current) => ({ ...current, manualValueNote: event.target.value }))}
                                    placeholder="可选，用来说明为什么改为手动产值"
                                />
                            </div>
                        </div>

                        <div className="modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setManualItem(null)}>取消</button>
                            <button type="button" className="btn btn-primary" disabled={savingManual} onClick={() => void handleSaveManual()}>
                                {savingManual ? '保存中...' : '确认保存'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {allocationItem ? (
                <div className="modal-backdrop" onClick={() => setAllocationItem(null)}>
                    <div className="modal-card card" onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <div className="modal-title">填写占比</div>
                                <div className="modal-note">
                                    {allocationItem.projectName}
                                    {allocationItem.contractNo ? ` · ${allocationItem.contractNo}` : ''}
                                </div>
                            </div>
                        </div>

                        <div className="stack" style={{ gap: 16 }}>
                            <div className="alert alert-warning" style={{ marginBottom: 0 }}>
                                当前计费方式：{allocationItem.pricingMode}
                                {allocationItem.contractSummary?.areaPricingAmount ? ` · 合同金额 ${formatCurrency(allocationItem.contractSummary.areaPricingAmount)}` : ''}
                                {allocationItem.contractSummary?.lumpSumAmount ? ` · 包干金额 ${formatCurrency(allocationItem.contractSummary.lumpSumAmount)}` : ''}
                            </div>
                            <div className="form-group">
                                <label>占比（%）</label>
                                <input
                                    className="form-input"
                                    value={allocationItem.allocationSharePercent}
                                    onChange={(event) => setAllocationItem((current) => ({ ...current, allocationSharePercent: event.target.value }))}
                                    placeholder="例如 3.5"
                                />
                            </div>
                        </div>

                        <div className="modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setAllocationItem(null)}>取消</button>
                            <button type="button" className="btn btn-primary" disabled={savingAllocation} onClick={() => void handleSaveAllocation()}>
                                {savingAllocation ? '保存中...' : '确认保存'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {batchDialogOpen ? (
                <div className="modal-backdrop" onClick={() => setBatchDialogOpen(false)}>
                    <div className="modal-card card" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 920 }}>
                        <div className="modal-header">
                            <div>
                                <div className="modal-title">批量填占比</div>
                                <div className="modal-note">
                                    已选 {selectedBatchItems.length} 条
                                    {batchPreviewState.preview?.selection?.contractNo ? ` · ${batchPreviewState.preview.selection.contractNo}` : ''}
                                </div>
                            </div>
                        </div>

                        <div className="stack" style={{ gap: 16 }}>
                            <div className="form-group">
                                <label>分摊方式</label>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                                    {BATCH_STRATEGY_OPTIONS.map((option) => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            className={batchStrategy === option.value ? 'btn btn-primary' : 'btn btn-secondary'}
                                            style={{ minHeight: 36 }}
                                            onClick={() => setBatchStrategy(option.value)}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                                <div className="field-note" style={{ marginTop: 8 }}>
                                    {BATCH_STRATEGY_OPTIONS.find((item) => item.value === batchStrategy)?.description || ''}
                                </div>
                            </div>

                            {batchStrategy === BATCH_ALLOCATION_STRATEGIES.UNIFORM ? (
                                <div className="form-group">
                                    <label>统一百分比（%）</label>
                                    <input
                                        className="form-input"
                                        value={batchUniformPercent}
                                        onChange={(event) => setBatchUniformPercent(event.target.value)}
                                        placeholder="例如 20"
                                    />
                                </div>
                            ) : null}

                            {batchPreviewState.error ? (
                                <div className="alert alert-danger" style={{ marginBottom: 0 }}>
                                    {batchPreviewState.error}
                                </div>
                            ) : (
                                <>
                                    <div className="alert alert-warning" style={{ marginBottom: 0 }}>
                                        合同金额 {formatCurrency(batchPreviewState.preview?.summary?.contractAmount || 0)}
                                        {' · '}
                                        预览总占比 {batchPreviewState.preview?.summary?.totalAllocationPercent || '0'}%
                                        {' · '}
                                        预览总产值 {formatCurrency(batchPreviewState.preview?.summary?.totalEstimatedValue || 0)}
                                    </div>

                                    <div className="data-table-shell" style={{ maxHeight: 320, overflow: 'auto' }}>
                                        <table className="data-table" style={{ minWidth: 760 }}>
                                            <thead>
                                                <tr>
                                                    <th style={{ width: 120 }}>记录</th>
                                                    <th>检测内容</th>
                                                    <th style={{ width: 120 }}>数量</th>
                                                    <th style={{ width: 130 }}>新占比</th>
                                                    <th style={{ width: 150 }}>预计产值</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(batchPreviewState.preview?.items || []).map((item) => (
                                                    <tr key={`preview-${item.workLogId}`}>
                                                        <td>#{item.workLogId}</td>
                                                        <td>
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                                <div>{item.projectName || '-'}</div>
                                                                <div style={{ color: 'rgba(54, 65, 82, 0.78)', fontSize: '0.82rem', lineHeight: 1.6 }}>
                                                                    {item.testContent || '-'}
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td>{formatNumber(item.quantity)} {item.unit || ''}</td>
                                                        <td>{item.allocationSharePercent}%</td>
                                                        <td>{formatCurrency(item.estimatedValue)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setBatchDialogOpen(false)}>取消</button>
                            <button
                                type="button"
                                className="btn btn-primary"
                                disabled={savingBatch || !batchPreviewState.preview}
                                onClick={() => void handleSaveBatchAllocation()}
                            >
                                {savingBatch ? '保存中...' : '确认批量保存'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </>
    );
}
