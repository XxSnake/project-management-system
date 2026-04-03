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

export function getWorklogBillingState(log) {
    const contract = log?.project?.contract || null;
    const pricingMode = normalizePricingMode(contract?.pricingMode);
    const totalValue = sumProductionValues(log);
    const hasContract = Boolean(contract?.id);
    const hasShare = normalizeAllocationShare(log?.allocationShare) !== null;
    const calculationMode = log?.productionValues?.[0]?.calculationMode || null;

    if (calculationMode === 'manual' && totalValue > 0) {
        return {
            code: 'manual-valued',
            label: '手工产值',
            tone: 'approved',
        };
    }

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

    if (!hasContract) {
        return {
            code: totalValue > 0 ? 'no-contract-guide-price' : 'workload-only',
            label: totalValue > 0 ? '未签合同' : '仅记工作量',
            tone: totalValue > 0 ? 'warning' : 'pending',
        };
    }

    if (totalValue > 0) {
        return {
            code: 'valued',
            label: '已计价',
            tone: 'approved',
        };
    }

    return {
        code: hasShare ? 'unpriced' : 'unmatched',
        label: '未匹配单价',
        tone: 'warning',
    };
}
