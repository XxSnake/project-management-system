export function normalizePricingMode(value) {
    return value === 'area' ? 'area' : 'unit';
}

export function normalizeAllocationShare(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const numeric = Number.parseFloat(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return null;
    }

    const normalized = numeric > 1 ? numeric / 100 : numeric;
    if (normalized <= 0 || normalized > 1) {
        return null;
    }

    return normalized;
}

export function allocationShareToPercent(value, digits = 2) {
    const normalized = normalizeAllocationShare(value);
    if (normalized === null) {
        return '';
    }

    return (normalized * 100).toFixed(digits).replace(/\.?0+$/u, '');
}

export function sumProductionValues(log) {
    return (log?.productionValues || []).reduce((sum, item) => sum + Number(item.value || 0), 0);
}

export function getWorklogStaff(log) {
    return Array.isArray(log?.staffMembers) ? log.staffMembers : [];
}

/**
 * 判断工作日志的计价状态
 *
 * 状态码说明：
 *   manual-valued       手工产值（方案C / 未签合同手动输入）
 *   area-valued         面积计价（方案B）
 *   pending-area-share  待确认占比（方案B缺少占比）
 *   valued              已计价（方案A）
 *   exceeded            产值超限（累计超过合同100%）
 *   workload-only       仅记工作量（未签合同且无手动产值）
 *   no-contract-manual  未签合同手工产值
 *   unmatched           未匹配单价
 */
export function getWorklogBillingState(log) {
    const contract = log?.project?.contract || null;
    const pricingMode = normalizePricingMode(contract?.pricingMode);
    const totalValue = sumProductionValues(log);
    const hasContract = Boolean(contract?.id);
    const hasShare = normalizeAllocationShare(log?.allocationShare) !== null;
    const calculationMode = log?.productionValues?.[0]?.calculationMode || null;
    const isExceeded = (log?.productionValues || []).some((pv) => pv.exceeded);

    // 超限状态（优先级最高，但仍有产值记录）
    if (isExceeded) {
        return {
            code: 'exceeded',
            label: '产值超限',
            tone: 'danger',
        };
    }

    // 手工产值（方案C 或 未签合同手动输入）
    if (calculationMode === 'manual' && totalValue > 0) {
        if (!hasContract) {
            return {
                code: 'no-contract-manual',
                label: '未签合同(手工)',
                tone: 'warning',
            };
        }
        return {
            code: 'manual-valued',
            label: '手工产值',
            tone: 'approved',
        };
    }

    // 面积合同（方案B）
    if (pricingMode === 'area' && hasContract) {
        if (totalValue > 0) {
            return {
                code: 'area-valued',
                label: '面积计价',
                tone: 'approved',
            };
        }

        return {
            code: 'pending-area-share',
            label: '待确认占比',
            tone: 'pending',
        };
    }

    // 未签合同
    if (!hasContract) {
        return {
            code: 'workload-only',
            label: '仅记工作量',
            tone: 'pending',
        };
    }

    // 单价合同（方案A）
    if (totalValue > 0) {
        return {
            code: 'valued',
            label: '已计价',
            tone: 'approved',
        };
    }

    return {
        code: 'unmatched',
        label: '未匹配单价',
        tone: 'warning',
    };
}
