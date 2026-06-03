'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
    allocationShareToPercent,
    getWorklogBillingState,
    normalizePricingMode,
    sumProductionValues,
} from '@/lib/worklogBilling';
import {
    buildProjectDisplayName,
    buildWorkLogProjectDisplayName,
} from '@/lib/projectDisplayName';

function formatCurrency(value) {
    return `CNY ${Number(value || 0).toFixed(2)}`;
}

function formatNumber(value) {
    return Number(value || 0).toFixed(2).replace(/\.?0+$/u, '');
}

function formatDateInput(value) {
    if (!value) {
        return '';
    }

    return new Date(value).toISOString().slice(0, 10);
}

function normalizeTextInput(value) {
    return String(value ?? '').trim();
}

function getStaffNames(log) {
    return (log.staffMembers || [])
        .map((item) => item.staff?.name)
        .filter(Boolean);
}

function parseStaffInput(value) {
    return normalizeTextInput(value)
        .split(/[,，、\s]+/u)
        .map((item) => item.trim())
        .filter(Boolean);
}

function sameStringArray(left, right) {
    if (left.length !== right.length) {
        return false;
    }

    return left.every((item, index) => item === right[index]);
}

function getStatusClass(tone) {
    if (tone === 'approved') return 'status-badge--approved';
    if (tone === 'danger') return 'status-badge--rejected';
    if (tone === 'warning') return 'status-badge--rejected';
    return 'status-badge--pending';
}

function buildAllocationItemFromLog(log) {
    const contract = log.project?.contract;
    const pricingMode = normalizePricingMode(contract?.pricingMode);
    return {
        workLogId: log.id,
        contractId: contract?.id || null,
        contractNo: contract?.contractNo || '',
        projectId: log.project?.id || null,
        projectName: buildWorkLogProjectDisplayName(log, { warnOnConflict: true }),
        workDate: log.workDate,
        testContent: log.testContent,
        quantity: Number(log.quantity || 0),
        unit: log.unit || '',
        remarks: log.remarks || '',
        pricingMode,
        allocationShare: log.allocationShare,
        contractAmount: pricingMode === 'area'
            ? Number(contract?.areaPricingAmount || 0)
            : Number(contract?.lumpSumAmount || contract?.areaPricingAmount || 0),
        contractArea: pricingMode !== 'area' || contract?.areaPricingArea === null || contract?.areaPricingArea === undefined
            ? null
            : Number(contract.areaPricingArea),
        staffNames: getStaffNames(log),
    };
}

function buildEditingState(log) {
    const staffNames = getStaffNames(log);

    return {
        ...log,
        workDate: formatDateInput(log.workDate),
        projectName: buildWorkLogProjectDisplayName(log, { warnOnConflict: true }),
        staffNames,
        productionMode: log.productionValues?.some((item) => item.calculationMode === 'manual') || Number(log.manualTotalValue || 0) > 0 ? 'manual' : 'auto',
        manualTotalValue: log.manualTotalValue ?? '',
        manualValueNote: log.manualValueNote || '',
    };
}

function buildSplitState(log) {
    return {
        id: log.id,
        originalQuantity: Number(log.quantity || 0),
        splitQuantity: String(log.quantity ?? ''),
        workDate: formatDateInput(log.workDate),
        projectName: buildWorkLogProjectDisplayName(log, { warnOnConflict: true }),
        testContent: log.testContent || '',
        unit: log.unit || '',
        remarks: log.remarks || '',
        staffNames: getStaffNames(log),
        allocationShare: log.allocationShare,
        manualTotalValue: log.manualTotalValue ?? '',
    };
}

function supportsAllocationShare(log) {
    const pricingMode = normalizePricingMode(log?.project?.contract?.pricingMode);
    return pricingMode === 'area' || pricingMode === 'mixed' || pricingMode === 'lumpsum';
}

function getAllocationDialogMeta(item) {
    const pricingMode = normalizePricingMode(item?.pricingMode);
    if (pricingMode === 'lumpsum') {
        return {
            kicker: 'Lump Sum Contract',
            note: '该项目合同按包干价计费。请确认这条工作记录对应的合同占比，系统会按包干总价自动折算产值。',
            amountLabel: '包干总价',
            areaLabel: null,
            fieldLabel: '本次工作占包干总价比例 (%)',
            fieldNote: '例如填写 `3.5`，系统会按包干总价的 3.5% 计算本次产值，再在参与人员之间均分。',
        };
    }

    if (pricingMode === 'mixed') {
        return {
            kicker: 'Mixed Contract',
            note: '该项目合同为混合计费。这里确认的是打包部分占比；保存后系统会按打包部分总价自动折算这条记录的产值。',
            amountLabel: '打包部分总价',
            areaLabel: null,
            fieldLabel: '本次工作占打包部分比例 (%)',
            fieldNote: '例如填写 `3.5`，系统会按打包部分总价的 3.5% 计算本次产值；如果留空，则仍可按单价规则处理。',
        };
    }

    return {
        kicker: 'Area Contract',
        note: '该项目合同按面积计价。请确认本次检测对应的合同占比，系统会按合同总金额自动折算产值。',
        amountLabel: '合同总金额',
        areaLabel: '合同面积',
        fieldLabel: '本次检测占合同金额比例 (%)',
        fieldNote: '例如填写 `3.5`，系统会按合同总金额的 3.5% 计算本次检测产值，再在参与人员之间均分。',
    };
}

function handleBlurOnEnter(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        event.currentTarget.blur();
    }
}

function resizeTextarea(target) {
    if (!target) {
        return;
    }

    const element = target;
    element.style.height = '0px';
    element.style.height = `${element.scrollHeight}px`;
}

function formatMatchScore(score) {
    return `${Math.round(Number(score || 0) * 100)}%`;
}

function getPreviewStatusMeta(status) {
    if (status === 'exact') {
        return {
            className: 'badge badge-success',
            label: '精确匹配',
        };
    }
    if (status === 'fuzzy') {
        return {
            className: 'badge badge-warning',
            label: '近似候选',
        };
    }
    return {
        className: 'badge badge-danger',
        label: '全新项目',
    };
}

function buildDefaultPreviewAssignment(row) {
    const resolution = row?.resolution || {};
    if (resolution.status === 'exact' && resolution.exactProjectId) {
        if (resolution.matchedAs === 'building' && resolution.buildingName) {
            return {
                selection: `exact-building:${resolution.exactProjectId}`,
                decision: 'use-existing-as-building',
                projectId: resolution.exactProjectId,
                buildingName: resolution.buildingName,
                locked: true,
            };
        }

        return {
            selection: `exact:${resolution.exactProjectId}`,
            decision: 'use-existing',
            projectId: resolution.exactProjectId,
            locked: true,
        };
    }

    if (resolution.status === 'fuzzy' && resolution.candidates?.length > 0) {
        const firstCandidate = resolution.candidates[0];
        if (firstCandidate.matchedAs !== 'project' && firstCandidate.buildingName) {
            return {
                selection: `building:${firstCandidate.projectId}`,
                decision: 'use-existing-as-building',
                projectId: firstCandidate.projectId,
                buildingName: firstCandidate.buildingName,
            };
        }

        return {
            selection: `existing:${firstCandidate.projectId}`,
            decision: 'use-existing',
            projectId: firstCandidate.projectId,
        };
    }

    return {
        selection: 'create-new',
        decision: 'create-new',
        projectName: row?.projectName || '',
    };
}

function buildPreviewSelectOptions(row, projectOptions) {
    const resolution = row?.resolution || {};
    if (resolution.status === 'exact' && resolution.exactProjectId) {
        return [
            {
                value: resolution.matchedAs === 'building' ? `exact-building:${resolution.exactProjectId}` : `exact:${resolution.exactProjectId}`,
                label: resolution.matchedAs === 'building'
                    ? `使用匹配项目：${resolution.exactProjectDisplayName || `#${resolution.exactProjectId}`}（单体：${resolution.buildingName}）`
                    : `使用匹配项目：${resolution.exactProjectDisplayName || `#${resolution.exactProjectId}`}`,
                decision: resolution.matchedAs === 'building' ? 'use-existing-as-building' : 'use-existing',
                projectId: resolution.exactProjectId,
                buildingName: resolution.buildingName || '',
            },
        ];
    }

    if (resolution.status === 'fuzzy') {
        return [
            ...(resolution.candidates || []).slice(0, 3).map((candidate) => ({
                value: candidate.matchedAs !== 'project' ? `building:${candidate.projectId}` : `existing:${candidate.projectId}`,
                label: candidate.matchedAs !== 'project'
                    ? `${candidate.projectDisplayName}（建议单体：${candidate.buildingName}，相似度 ${formatMatchScore(candidate.score)}）`
                    : `${candidate.projectDisplayName}（相似度 ${formatMatchScore(candidate.score)}）`,
                decision: candidate.matchedAs !== 'project' ? 'use-existing-as-building' : 'use-existing',
                projectId: candidate.projectId,
                buildingName: candidate.buildingName || '',
            })),
            {
                value: 'create-new',
                label: '作为全新项目新建',
                decision: 'create-new',
            },
        ];
    }

    return [
        ...projectOptions.map((project) => ({
            value: `existing:${project.id}`,
            label: `使用已有项目：${project.projectDisplayName}`,
            decision: 'use-existing',
            projectId: project.id,
            buildingName: '',
        })),
        {
            value: 'create-new',
            label: '作为全新项目新建',
            decision: 'create-new',
        },
    ];
}

function resolveInboxJumpContext(logs) {
    if (typeof window === 'undefined') {
        return null;
    }

    const params = new URLSearchParams(window.location.search);
    const projectName = normalizeTextInput(params.get('projectName'));
    const exceptionType = normalizeTextInput(params.get('exceptionType'));
    const focusWorkLogId = Number.parseInt(params.get('focusWorkLogId') || '', 10);
    const projectId = Number.parseInt(params.get('projectId') || '', 10);
    const hasContext = (
        projectName
        || exceptionType
        || Number.isInteger(focusWorkLogId)
        || Number.isInteger(projectId)
    );

    if (!hasContext) {
        return null;
    }

    const matchedLog = logs.find((log) => {
        if (Number.isInteger(focusWorkLogId) && log.id === focusWorkLogId) {
            return true;
        }

        if (Number.isInteger(projectId) && log.project?.id === projectId) {
            return true;
        }

        if (!projectName) {
            return false;
        }

        const projectDisplayName = buildProjectDisplayName(log.project);
        const workLogDisplayName = buildWorkLogProjectDisplayName(log, { warnOnConflict: true });
        return projectDisplayName === projectName || workLogDisplayName === projectName;
    }) || null;

    const projectFilter = matchedLog ? buildProjectDisplayName(matchedLog.project) : '';
    const selectedIds = Number.isInteger(focusWorkLogId) && logs.some((log) => log.id === focusWorkLogId)
        ? [focusWorkLogId]
        : (matchedLog?.id ? [matchedLog.id] : []);
    const noteParts = [];

    if (projectFilter) {
        noteParts.push(`项目：${projectFilter}`);
    }
    if (exceptionType === 'exceeded') {
        noteParts.push('状态：产值超限');
    } else if (exceptionType) {
        noteParts.push(`状态：${exceptionType}`);
    }

    return {
        filters: {
            ...(projectFilter ? { project: projectFilter } : {}),
            ...(exceptionType ? { status: exceptionType } : {}),
        },
        selectedIds,
        note: noteParts.length > 0 ? `来自异常收件箱，已按${noteParts.join('，')}筛到相关记录。` : '来自异常收件箱，已定位到相关工作记录。',
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
    const [importPreview, setImportPreview] = useState(null);
    const [previewAssignments, setPreviewAssignments] = useState({});
    const [confirmingImport, setConfirmingImport] = useState(false);
    const [editorVersion, setEditorVersion] = useState(0);
    const [editingLog, setEditingLog] = useState(null);
    const [savingEdit, setSavingEdit] = useState(false);
    const [savingQuickEditId, setSavingQuickEditId] = useState(null);
    const [splittingLog, setSplittingLog] = useState(null);
    const [submittingSplit, setSubmittingSplit] = useState(false);
    const [deletingBatch, setDeletingBatch] = useState(false);
    const [allocationQueue, setAllocationQueue] = useState([]);
    const [activeAllocation, setActiveAllocation] = useState(null);
    const [allocationPercent, setAllocationPercent] = useState('');
    const [submittingAllocation, setSubmittingAllocation] = useState(false);
    const [filters, setFilters] = useState({
        project: '',
        status: '',
        staff: '',
        date: '',
        search: '',
    });
    const [jumpNotice, setJumpNotice] = useState('');
    const [jumpContextApplied, setJumpContextApplied] = useState(false);

    const refreshLogs = async () => {
        const response = await fetch(`/api/worklog?_t=${Date.now()}`, { cache: 'no-store' });
        const data = await response.json();
        setLogs(Array.isArray(data) ? data : []);
        setEditorVersion((current) => current + 1);
        setSelectedIds((current) => current.filter((id) => data.some((log) => log.id === id)));
    };

    useEffect(() => {
        let cancelled = false;

        fetch(`/api/worklog?_t=${Date.now()}`, { cache: 'no-store' })
            .then((response) => response.json())
            .then((data) => {
                if (!cancelled) {
                    setLogs(Array.isArray(data) ? data : []);
                    setEditorVersion((current) => current + 1);
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

    useEffect(() => {
        if (jumpContextApplied || logs.length === 0) {
            return;
        }

        const context = resolveInboxJumpContext(logs);
        setJumpContextApplied(true);
        if (!context) {
            return;
        }

        setFilters((current) => ({
            ...current,
            ...context.filters,
        }));
        if (context.selectedIds.length > 0) {
            setSelectedIds(context.selectedIds);
        }
        if (context.note) {
            setJumpNotice(context.note);
        }
    }, [jumpContextApplied, logs]);

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

    const clearPreviewState = () => {
        setImportPreview(null);
        setPreviewAssignments({});
    };

    const applyPreviewResult = async (response) => {
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || '预览失败');
        }

        const rows = Array.isArray(data.rows) ? data.rows : [];
        setImportPreview({
            ...data,
            rows,
            errors: Array.isArray(data.errors) ? data.errors : [],
            projectOptions: Array.isArray(data.projectOptions) ? data.projectOptions : [],
        });
        setPreviewAssignments(Object.fromEntries(
            rows.map((row) => [row.rowIndex, buildDefaultPreviewAssignment(row)]),
        ));
    };

    const handleParse = async () => {
        if (!rawText.trim()) {
            return;
        }

        setParsingText(true);
        try {
            const response = await fetch('/api/worklog?mode=preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rawText }),
            });
            await applyPreviewResult(response);
        } catch (error) {
            setImportPreview({
                rows: [],
                errors: [{ message: `预览失败：${error.message}` }],
                projectOptions: [],
                statusCounts: { exact: 0, fuzzy: 0, none: 0 },
            });
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

            const response = await fetch('/api/worklog?mode=preview', {
                method: 'POST',
                body: formData,
            });
            await applyPreviewResult(response);
        } catch (error) {
            setImportPreview({
                rows: [],
                errors: [{ message: `预览失败：${error.message}` }],
                projectOptions: [],
                statusCounts: { exact: 0, fuzzy: 0, none: 0 },
            });
        } finally {
            setUploadingFile(false);
        }
    };

    const handlePreviewAssignmentChange = (row, selection) => {
        const options = buildPreviewSelectOptions(row, importPreview?.projectOptions || []);
        const matchedOption = options.find((item) => item.value === selection);

        if (!matchedOption) {
            return;
        }

        setPreviewAssignments((current) => ({
            ...current,
            [row.rowIndex]: matchedOption.decision === 'create-new'
                ? {
                    selection,
                    decision: 'create-new',
                    projectName: row.projectName || '',
                }
                : {
                    selection,
                    decision: matchedOption.decision,
                    projectId: matchedOption.projectId,
                    buildingName: matchedOption.buildingName || '',
                },
        }));
    };

    const handlePreviewAssignmentFieldChange = (rowIndex, key, value) => {
        setPreviewAssignments((current) => ({
            ...current,
            [rowIndex]: {
                ...(current[rowIndex] || {}),
                [key]: value,
            },
        }));
    };

    const handleConfirmImport = async () => {
        if (!importPreview) {
            return;
        }

        const previewRows = importPreview.rows || [];
        const commitRows = previewRows.map(({ resolution, ...row }) => row);
        const rowAssignments = previewRows
            .map((previewRow) => {
                const assignment = previewAssignments[previewRow.rowIndex];
                if (!assignment || previewRow.error || previewRow.resolution?.status === 'exact') {
                    return null;
                }

                if (assignment.decision === 'use-existing') {
                    return {
                        rowIndex: previewRow.rowIndex,
                        decision: 'use-existing',
                        projectId: assignment.projectId,
                    };
                }

                if (assignment.decision === 'use-existing-as-building') {
                    return {
                        rowIndex: previewRow.rowIndex,
                        decision: 'use-existing-as-building',
                        projectId: assignment.projectId,
                        buildingName: assignment.buildingName,
                    };
                }

                return {
                    rowIndex: previewRow.rowIndex,
                    decision: 'create-new',
                    projectName: assignment.projectName || previewRow.projectName,
                };
            })
            .filter(Boolean);

        setConfirmingImport(true);
        try {
            const response = await fetch('/api/worklog?mode=commit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source: importPreview.source,
                    fileName: importPreview.fileName,
                    sheetName: importPreview.sheetName,
                    originalRows: importPreview.originalRows,
                    rows: commitRows,
                    rowAssignments,
                }),
            });
            await applyImportResult(response);
            clearPreviewState();
            setRawText('');
            setSelectedFile(null);
        } catch (error) {
            setResult({ errors: [{ message: `导入失败：${error.message}` }], saved: 0 });
        } finally {
            setConfirmingImport(false);
        }
    };

    const handleOpenContractUpload = (project) => {
        if (!project?.id) {
            return;
        }

        const params = new URLSearchParams({
            projectId: String(project.id),
            projectName: buildProjectDisplayName(project),
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

    const saveWorkLogPatch = async (logId, payload, options = {}) => {
        const { queuePending = false } = options;

        setSavingQuickEditId(logId);
        try {
            const response = await fetch(`/api/worklog/${logId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || '保存失败');
            }

            await refreshLogs();
            if (queuePending && data.pendingAllocation) {
                queuePendingAllocations([data.pendingAllocation]);
            }
            return data;
        } catch (error) {
            alert(`保存失败：${error.message}`);
            return null;
        } finally {
            setSavingQuickEditId(null);
        }
    };

    const handleQuickSaveText = async (log, key, value, originalValue) => {
        const nextValue = normalizeTextInput(value);
        const currentValue = normalizeTextInput(originalValue);
        if (nextValue === currentValue) {
            return;
        }

        await saveWorkLogPatch(log.id, { [key]: nextValue });
    };

    const handleQuickSaveDate = async (log, value) => {
        const nextValue = value || '';
        if (nextValue === formatDateInput(log.workDate)) {
            return;
        }

        await saveWorkLogPatch(log.id, { workDate: nextValue });
    };

    const handleQuickSaveQuantity = async (log, value) => {
        const nextValue = normalizeTextInput(value);
        const currentValue = formatNumber(log.quantity);

        if (nextValue === currentValue) {
            return;
        }

        if (nextValue === '') {
            await saveWorkLogPatch(log.id, { quantity: '' });
            return;
        }

        if (!/^(?:\d+|\d*\.\d+)$/u.test(nextValue)) {
            alert('数量请填写数字');
            await refreshLogs();
            return;
        }

        await saveWorkLogPatch(log.id, { quantity: nextValue });
    };

    const handleQuickSaveStaff = async (log, value) => {
        const nextStaffNames = parseStaffInput(value);
        const currentStaffNames = getStaffNames(log);

        if (sameStringArray(nextStaffNames, currentStaffNames)) {
            return;
        }

        await saveWorkLogPatch(log.id, { staffNames: nextStaffNames });
    };

    const handleQuickSaveAllocationShare = async (log, value) => {
        const nextValue = normalizeTextInput(value);
        const currentValue = allocationShareToPercent(log.allocationShare);
        if (nextValue === currentValue) {
            return;
        }

        if (nextValue === '') {
            await saveWorkLogPatch(log.id, { allocationShare: '' });
            return;
        }

        const numericPercent = Number.parseFloat(nextValue);
        if (!Number.isFinite(numericPercent) || numericPercent <= 0 || numericPercent > 100) {
            alert('占比请填写 0 到 100 之间的数字');
            await refreshLogs();
            return;
        }

        await saveWorkLogPatch(log.id, { allocationShare: numericPercent });
    };

    const handleSaveEditLegacy = async () => {
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

    void handleSaveEditLegacy;

    const handleSaveEdit = async () => {
        setSavingEdit(true);
        try {
            const data = await saveWorkLogPatch(
                editingLog.id,
                {
                    workDate: editingLog.workDate,
                    projectName: editingLog.projectName,
                    testContent: editingLog.testContent,
                    quantity: editingLog.quantity,
                    unit: editingLog.unit,
                    remarks: editingLog.remarks,
                    staffNames: editingLog.staffNames,
                    manualTotalValue: editingLog.productionMode === 'manual' ? editingLog.manualTotalValue : '',
                    manualValueNote: editingLog.productionMode === 'manual' ? editingLog.manualValueNote : '',
                },
                { queuePending: true },
            );

            if (data) {
                setEditingLog(null);
            }
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

    const handleOpenSplit = (log) => {
        setSplittingLog(buildSplitState(log));
    };

    const handleSubmitSplit = async () => {
        if (!splittingLog) {
            return;
        }

        const splitQuantity = Number.parseFloat(splittingLog.splitQuantity);
        if (!Number.isFinite(splitQuantity) || splitQuantity < 0) {
            alert('新记录数量必须大于或等于 0');
            return;
        }

        setSubmittingSplit(true);
        try {
            const response = await fetch(`/api/worklog/${splittingLog.id}/split`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    quantity: splitQuantity,
                    workDate: splittingLog.workDate,
                    projectName: splittingLog.projectName,
                    testContent: splittingLog.testContent,
                    unit: splittingLog.unit,
                    remarks: splittingLog.remarks,
                    staffNames: splittingLog.staffNames,
                }),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || '拆分失败');
            }

            setSplittingLog(null);
            await refreshLogs();
            queuePendingAllocations(data.pendingAllocations);
        } catch (error) {
            alert(`拆分失败：${error.message}`);
        } finally {
            setSubmittingSplit(false);
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
        new Set(logs.map((log) => buildProjectDisplayName(log.project)).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b, 'zh-CN')), [logs]);

    const staffOptions = useMemo(() => Array.from(
        new Set(logs.flatMap((log) => getStaffNames(log))),
    ).sort((a, b) => a.localeCompare(b, 'zh-CN')), [logs]);
    const statusOptions = useMemo(() => Array.from(
        new Map(logs.map((log) => {
            const state = getWorklogBillingState(log);
            return [state.code, { value: state.code, label: state.label }];
        })).values(),
    ), [logs]);

    const filteredLogs = useMemo(() => logs.filter((log) => {
        const projectName = buildProjectDisplayName(log.project);
        const displayProjectName = buildWorkLogProjectDisplayName(log, { warnOnConflict: true });
        const staffNames = getStaffNames(log).join('、');
        const workDate = new Date(log.workDate).toISOString().slice(0, 10);
        const totalValue = sumProductionValues(log);
        const billingState = getWorklogBillingState(log);
        const haystack = `${log.id} ${projectName} ${displayProjectName} ${log.testContent} ${staffNames} ${log.remarks || ''} ${log.buildingName || ''} ${totalValue}`.toLowerCase();

        if (filters.project && projectName !== filters.project) {
            return false;
        }
        if (filters.status && billingState.code !== filters.status) {
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
    const exceededCount = filteredLogs.filter((log) => getWorklogBillingState(log).code === 'exceeded').length;
    const noContractCount = filteredLogs.filter((log) => {
        const state = getWorklogBillingState(log);
        return state.code === 'workload-only' || state.code === 'no-contract-manual';
    }).length;
    const previewRows = importPreview?.rows || [];
    const previewErrors = importPreview?.errors || [];
    const previewValidCount = previewRows.length;
    const previewStatusCounts = importPreview?.statusCounts || { exact: 0, fuzzy: 0, none: 0 };
    const allocationDialogMeta = getAllocationDialogMeta(activeAllocation);

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
                    {exceededCount > 0 && (
                        <div className="mini-kpi">
                            <div className="mini-kpi-label">产值超限</div>
                            <div className="mini-kpi-value" style={{ color: 'var(--color-danger, #ef4444)' }}>{exceededCount}</div>
                        </div>
                    )}
                </div>

                <div className="report-grid">
                    <section className="card">
                        <div className="panel-top">
                            <div className="panel-copy">
                                <div className="panel-eyebrow">Workbook Intake</div>
                                <div className="panel-title">Excel / WPS 文件导入</div>
                                <div className="panel-note">支持 `.xlsx` / `.xls`。现在会先预览项目匹配结果，确认后再正式导入。</div>
                            </div>
                        </div>

                        <div className="form-grid">
                            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                                <label htmlFor="workbook-file">选择文件</label>
                                <input
                                    id="workbook-file"
                                    type="file"
                                    accept=".xlsx,.xls"
                                    onChange={(event) => {
                                        setSelectedFile(event.target.files?.[0] || null);
                                        clearPreviewState();
                                    }}
                                />
                            </div>
                        </div>

                        <div className="action-row mt-4">
                            <button className="btn btn-primary" onClick={handleImportFile} disabled={!selectedFile || uploadingFile}>
                                {uploadingFile ? '预览中' : '预览导入'}
                            </button>
                            {selectedFile && <span className="ghost-note">已选择：{selectedFile.name}</span>}
                        </div>
                    </section>

                    <section className="card">
                        <div className="panel-top">
                            <div className="panel-copy">
                                <div className="panel-eyebrow">Manual Intake</div>
                                <div className="panel-title">WPS 粘贴导入</div>
                                <div className="panel-note">字段顺序：日期、项目、检测内容、数量、人员、备注。现在会先预览，再确认导入。</div>
                            </div>
                        </div>

                        <textarea
                            className="form-textarea"
                            value={rawText}
                            onChange={(event) => {
                                setRawText(event.target.value);
                                clearPreviewState();
                            }}
                            placeholder={'2026-03-18\t建宁路西段\t轻型动力触探\t10点\t张三、李四\t3#楼东侧'}
                        />

                        <div className="action-row mt-4">
                            <button className="btn btn-primary" onClick={handleParse} disabled={parsingText || !rawText.trim()}>
                                {parsingText ? '预览中' : '预览导入'}
                            </button>
                            <button className="btn btn-secondary" onClick={() => { setRawText(''); setResult(null); clearPreviewState(); }}>
                                清空
                            </button>
                        </div>
                    </section>
                </div>

                {importPreview && (
                    <div className="card">
                        <div className="panel-top">
                            <div className="panel-copy">
                                <div className="panel-eyebrow">Import Preview</div>
                                <div className="panel-title">导入预览</div>
                                <div className="panel-note">
                                    当前预览来自{importPreview.source === 'file' ? '文件导入' : '粘贴导入'}。
                                    可确认 {previewValidCount} 条，精确匹配 {previewStatusCounts.exact || 0} 条，近似候选 {previewStatusCounts.fuzzy || 0} 条，全新项目 {previewStatusCounts.none || 0} 条。
                                </div>
                            </div>
                        </div>

                        <div className="chip-row">
                            <span className="badge badge-success">Exact {previewStatusCounts.exact || 0}</span>
                            <span className="badge badge-warning">Fuzzy {previewStatusCounts.fuzzy || 0}</span>
                            <span className="badge badge-danger">New {previewStatusCounts.none || 0}</span>
                            {typeof importPreview.originalRows === 'number' && <span className="badge badge-info">Rows {importPreview.originalRows}</span>}
                            {typeof importPreview.expandedItems === 'number' && <span className="badge badge-info">Expanded {importPreview.expandedItems}</span>}
                            {previewErrors.length > 0 && <span className="badge badge-danger">Errors {previewErrors.length}</span>}
                        </div>

                        {previewValidCount > 0 && (
                            <div className="data-table-shell mt-4">
                                <table className="data-table" style={{ minWidth: 1280 }}>
                                    <thead>
                                        <tr>
                                            <th style={{ width: 80 }}>行号</th>
                                            <th style={{ width: 120 }}>日期</th>
                                            <th style={{ width: 280 }}>原始项目名</th>
                                            <th style={{ width: 260 }}>检测内容</th>
                                            <th style={{ width: 120 }}>数量</th>
                                            <th style={{ width: 120 }}>状态</th>
                                            <th style={{ width: 420 }}>决策</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {previewRows.map((row) => {
                                            const statusMeta = getPreviewStatusMeta(row.resolution?.status);
                                            const assignment = previewAssignments[row.rowIndex] || buildDefaultPreviewAssignment(row);
                                            const decisionOptions = buildPreviewSelectOptions(row, importPreview.projectOptions || []);

                                            return (
                                                <tr key={`preview-${row.rowIndex}`}>
                                                    <td>{row.rowIndex}</td>
                                                    <td>{row.workDate || '-'}</td>
                                                    <td>{row.projectName || '-'}</td>
                                                    <td>{row.testContent || '-'}</td>
                                                    <td>{`${formatNumber(row.quantity)}${row.unit || ''}`}</td>
                                                    <td><span className={statusMeta.className}>{statusMeta.label}</span></td>
                                                    <td>
                                                        <div className="stack-sm">
                                                            <select
                                                                className="form-select"
                                                                value={assignment.selection || 'create-new'}
                                                                onChange={(event) => handlePreviewAssignmentChange(row, event.target.value)}
                                                                disabled={Boolean(assignment.locked)}
                                                            >
                                                                {decisionOptions.map((option) => (
                                                                    <option key={`${row.rowIndex}-${option.value}`} value={option.value}>
                                                                        {option.label}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                            {assignment.decision === 'create-new' && (
                                                                <input
                                                                    className="form-input"
                                                                    value={assignment.projectName || row.projectName || ''}
                                                                    onChange={(event) => handlePreviewAssignmentFieldChange(row.rowIndex, 'projectName', event.target.value)}
                                                                    placeholder="请输入新项目名称"
                                                                />
                                                            )}
                                                            {assignment.decision === 'use-existing-as-building' && (
                                                                <input
                                                                    className="form-input"
                                                                    value={assignment.buildingName || ''}
                                                                    onChange={(event) => handlePreviewAssignmentFieldChange(row.rowIndex, 'buildingName', event.target.value)}
                                                                    placeholder="请输入单体名称"
                                                                    disabled={Boolean(assignment.locked)}
                                                                />
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {previewErrors.length > 0 && (
                            <div className="mt-4" style={{ display: 'grid', gap: '10px' }}>
                                {previewErrors.map((item, index) => (
                                    <div key={`${item.rowIndex || 'p'}-${index}`} className="alert alert-danger">
                                        {item.message} {item.raw ? `| ${item.raw}` : ''}
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="action-row mt-4">
                            <button className="btn btn-primary" onClick={handleConfirmImport} disabled={!previewValidCount || confirmingImport}>
                                {confirmingImport ? '导入中' : `确认导入 ${previewValidCount} 条`}
                            </button>
                            <button className="btn btn-secondary" onClick={clearPreviewState}>取消预览</button>
                        </div>
                    </div>
                )}

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

                {jumpNotice ? (
                    <div className="alert alert-warning" style={{ marginBottom: 16 }}>
                        {jumpNotice}
                    </div>
                ) : null}

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
                        <label className="form-label" htmlFor="filter-status">状态</label>
                        <select
                            id="filter-status"
                            className="form-select"
                            value={filters.status}
                            onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
                        >
                            <option value="">全部状态</option>
                            {statusOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
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
                                    <th>检测内容 / 备注 / 占比</th>
                                    <th>数量 / 单位</th>
                                    <th>人员</th>
                                    <th>状态</th>
                                    <th className="text-right">产值</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    Array.from({ length: 8 }).map((_, index) => (
                                        <tr key={`editable-skeleton-${index}`}>
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
                                                    <strong>暂无工作记录</strong>
                                                    当前筛选条件下没有可编辑的记录。
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
                                            <tr key={`editable-${log.id}`} style={isSelected ? { background: 'rgba(64, 160, 255, 0.08)' } : undefined}>
                                                <td>
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => handleToggleSelect(log.id)}
                                                        aria-label={`选择工作记录 ${log.id}`}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        key={`date-${editorVersion}-${log.id}`}
                                                        type="date"
                                                        className="inline-edit-input"
                                                        defaultValue={formatDateInput(log.workDate)}
                                                        onKeyDown={handleBlurOnEnter}
                                                        onBlur={(event) => void handleQuickSaveDate(log, event.target.value)}
                                                    />
                                                </td>
                                                <td>
                                                    <textarea
                                                        key={`project-${editorVersion}-${log.id}`}
                                                        className="inline-edit-input inline-edit-textarea"
                                                        defaultValue={buildWorkLogProjectDisplayName(log, { warnOnConflict: true })}
                                                        rows={1}
                                                        placeholder="项目名"
                                                        ref={resizeTextarea}
                                                        onInput={(event) => resizeTextarea(event.currentTarget)}
                                                        onBlur={(event) => void handleQuickSaveText(log, 'projectName', event.target.value, buildWorkLogProjectDisplayName(log, { warnOnConflict: true }))}
                                                    />
                                                </td>
                                                <td>
                                                    <div className="inline-edit-stack">
                                                        <textarea
                                                            key={`content-${editorVersion}-${log.id}`}
                                                            className="inline-edit-input inline-edit-textarea"
                                                            defaultValue={log.testContent || ''}
                                                            rows={1}
                                                            placeholder="检测内容"
                                                            ref={resizeTextarea}
                                                            onInput={(event) => resizeTextarea(event.currentTarget)}
                                                            onBlur={(event) => void handleQuickSaveText(log, 'testContent', event.target.value, log.testContent)}
                                                        />
                                                        <textarea
                                                            key={`remarks-${editorVersion}-${log.id}`}
                                                            className="inline-edit-input inline-edit-input--muted inline-edit-textarea"
                                                            defaultValue={log.remarks || ''}
                                                            rows={1}
                                                            placeholder="备注"
                                                            ref={resizeTextarea}
                                                            onInput={(event) => resizeTextarea(event.currentTarget)}
                                                            onBlur={(event) => void handleQuickSaveText(log, 'remarks', event.target.value, log.remarks)}
                                                        />
                                                        {supportsAllocationShare(log) && (
                                                            <div className="inline-edit-inline">
                                                                <input
                                                                    key={`share-${editorVersion}-${log.id}`}
                                                                    type="number"
                                                                    step="0.01"
                                                                    className="inline-edit-input"
                                                                    defaultValue={allocationShareToPercent(log.allocationShare)}
                                                                    placeholder="占比%"
                                                                    onKeyDown={handleBlurOnEnter}
                                                                    onBlur={(event) => void handleQuickSaveAllocationShare(log, event.target.value)}
                                                                />
                                                                <span className="inline-edit-hint">占比 %</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="inline-edit-inline">
                                                        <input
                                                            key={`quantity-${editorVersion}-${log.id}`}
                                                            type="number"
                                                            step="0.01"
                                                            className="inline-edit-input"
                                                            defaultValue={formatNumber(log.quantity)}
                                                            placeholder="数量"
                                                            onKeyDown={handleBlurOnEnter}
                                                            onBlur={(event) => void handleQuickSaveQuantity(log, event.target.value)}
                                                        />
                                                        <input
                                                            key={`unit-${editorVersion}-${log.id}`}
                                                            type="text"
                                                            className="inline-edit-input"
                                                            defaultValue={log.unit || ''}
                                                            placeholder="单位"
                                                            onKeyDown={handleBlurOnEnter}
                                                            onBlur={(event) => void handleQuickSaveText(log, 'unit', event.target.value, log.unit)}
                                                        />
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="inline-edit-stack">
                                                        <textarea
                                                            key={`staff-${editorVersion}-${log.id}`}
                                                            className="inline-edit-input inline-edit-textarea"
                                                            defaultValue={staffNames.join('、')}
                                                            rows={1}
                                                            placeholder="人员，多个用顿号/空格分隔"
                                                            ref={resizeTextarea}
                                                            onInput={(event) => resizeTextarea(event.currentTarget)}
                                                            onBlur={(event) => void handleQuickSaveStaff(log, event.target.value)}
                                                        />
                                                        <div className="inline-edit-hint">多个名字可用空格、逗号或顿号分开</div>
                                                    </div>
                                                </td>
                                                <td>
                                                    <span className={`status-badge ${getStatusClass(status.tone)}`}>{status.label}</span>
                                                    {savingQuickEditId === log.id && (
                                                        <div className="inline-edit-hint" style={{ marginTop: 8 }}>保存中...</div>
                                                    )}
                                                </td>
                                                <td className="text-right">
                                                    <span className="value-text">{formatCurrency(totalValue)}</span>
                                                    {log.manualValueNote && <div className="feed-item-meta">{log.manualValueNote}</div>}
                                                    {status.code === 'exceeded' && log.productionValues?.[0]?.originalValue > 0 && (
                                                        <div className="feed-item-meta" style={{ color: 'var(--color-danger, #ef4444)' }}>
                                                            原值 {formatCurrency(log.productionValues.reduce((sum, item) => sum + (item.originalValue || 0), 0))}
                                                        </div>
                                                    )}
                                                </td>
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
                                                                占比卡片
                                                            </button>
                                                        )}
                                                        <button
                                                            className="btn btn-secondary"
                                                            onClick={() => setEditingLog(buildEditingState(log))}
                                                        >
                                                            更多
                                                        </button>
                                                        <button
                                                            className="btn btn-secondary"
                                                            onClick={() => handleOpenSplit(log)}
                                                        >
                                                            拆分
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

                    <div className="data-table-shell" style={{ display: 'none' }}>
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
                                                <td>{buildWorkLogProjectDisplayName(log, { warnOnConflict: true }) || '未绑定项目'}</td>
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
                                                <td className="text-right">
                                                    <span className="value-text">{formatCurrency(totalValue)}</span>
                                                    {status.code === 'exceeded' && log.productionValues?.[0]?.originalValue > 0 && (
                                                        <div className="feed-item-meta" style={{ color: 'var(--color-danger, #ef4444)' }}>
                                                            原值 {formatCurrency(log.productionValues.reduce((s, pv) => s + (pv.originalValue || 0), 0))}
                                                        </div>
                                                    )}
                                                </td>
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
                                                            onClick={() => setEditingLog(buildEditingState(log))}
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

            {splittingLog && (
                <div className="modal-backdrop" onClick={() => setSplittingLog(null)}>
                    <div className="modal-card" onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <div className="page-kicker">Worklog Split</div>
                                <div className="modal-title">拆分工作记录</div>
                                <div className="modal-note">系统会保留原记录原样不动，复制一份新的记录供你修改。新记录默认和原记录一模一样，下面所有字段都可以按需改。新记录的占比/手工产值需要重新确认。</div>
                            </div>
                            <button className="btn btn-secondary" onClick={() => setSplittingLog(null)}>关闭</button>
                        </div>

                        <div className="split-grid">
                            <div className="surface-item">
                                <div className="surface-title">原记录当前数量</div>
                                <div className="surface-note">{formatNumber(splittingLog.originalQuantity)} {splittingLog.unit || ''}</div>
                            </div>
                        </div>

                        <div className="form-grid mt-4">
                            <div className="form-group">
                                <label htmlFor="split-quantity">新记录数量</label>
                                <input
                                    id="split-quantity"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    className="form-input"
                                    value={splittingLog.splitQuantity}
                                    onChange={(event) => setSplittingLog((current) => ({ ...current, splitQuantity: event.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="split-unit">新记录单位</label>
                                <input
                                    id="split-unit"
                                    className="form-input"
                                    value={splittingLog.unit}
                                    onChange={(event) => setSplittingLog((current) => ({ ...current, unit: event.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="split-date">新记录日期</label>
                                <input
                                    id="split-date"
                                    type="date"
                                    className="form-input"
                                    value={splittingLog.workDate}
                                    onChange={(event) => setSplittingLog((current) => ({ ...current, workDate: event.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="split-project">新记录项目</label>
                                <input
                                    id="split-project"
                                    className="form-input"
                                    value={splittingLog.projectName}
                                    onChange={(event) => setSplittingLog((current) => ({ ...current, projectName: event.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="split-content">新记录检测内容</label>
                                <input
                                    id="split-content"
                                    className="form-input"
                                    value={splittingLog.testContent}
                                    onChange={(event) => setSplittingLog((current) => ({ ...current, testContent: event.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="split-staff">新记录人员</label>
                                <input
                                    id="split-staff"
                                    className="form-input"
                                    value={splittingLog.staffNames.join('、')}
                                    onChange={(event) => setSplittingLog((current) => ({
                                        ...current,
                                        staffNames: parseStaffInput(event.target.value),
                                    }))}
                                />
                            </div>
                        </div>

                        <div className="form-group mt-4">
                            <label htmlFor="split-remarks">新记录备注</label>
                            <textarea
                                id="split-remarks"
                                className="form-textarea"
                                value={splittingLog.remarks}
                                onChange={(event) => setSplittingLog((current) => ({ ...current, remarks: event.target.value }))}
                            />
                        </div>

                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setSplittingLog(null)}>取消</button>
                            <button className="btn btn-primary" onClick={handleSubmitSplit} disabled={submittingSplit}>
                                {submittingSplit ? '拆分中...' : '确认拆分'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

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
                                <div className="page-kicker">{allocationDialogMeta.kicker}</div>
                                <div className="modal-title">确认本次检测占比</div>
                                <div className="modal-note">{allocationDialogMeta.note}</div>
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
                                <div className="surface-title">{allocationDialogMeta.amountLabel}</div>
                                <div className="surface-note">{formatCurrency(activeAllocation.contractAmount)}</div>
                            </div>
                            {allocationDialogMeta.areaLabel && (
                                <div className="surface-item">
                                    <div className="surface-title">{allocationDialogMeta.areaLabel}</div>
                                    <div className="surface-note">{activeAllocation.contractArea ? `${formatNumber(activeAllocation.contractArea)} ㎡` : '未填写'}</div>
                                </div>
                            )}
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
                            <label htmlFor="allocation-percent">{allocationDialogMeta.fieldLabel}</label>
                            <input
                                id="allocation-percent"
                                type="number"
                                step="0.01"
                                className="form-input"
                                value={allocationPercent}
                                onChange={(event) => setAllocationPercent(event.target.value)}
                                placeholder="例如 3.5"
                            />
                            <div className="field-note">{allocationDialogMeta.fieldNote}</div>
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
