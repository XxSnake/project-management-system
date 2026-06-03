import { allocationShareToPercent, normalizeAllocationShare, normalizePricingMode } from '@/lib/worklogBilling';

export const BATCH_ALLOCATION_STRATEGIES = {
    EVEN: 'even',
    WEIGHTED: 'weighted',
    UNIFORM: 'uniform',
};

const SHARE_SCALE = 1_000_000;

function parseNumber(value) {
    const numeric = Number.parseFloat(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function formatPercent(value, digits = 4) {
    return Number(value || 0).toFixed(digits).replace(/\.?0+$/u, '');
}

function getContractAmount(item) {
    if (item?.contractAmount !== undefined && item?.contractAmount !== null) {
        return Number(item.contractAmount || 0);
    }

    const pricingMode = normalizePricingMode(item?.pricingMode);
    const contractSummary = item?.contractSummary || {};

    if (pricingMode === 'area') {
        return Number(contractSummary.areaPricingAmount || 0);
    }

    return Number(contractSummary.lumpSumAmount || contractSummary.areaPricingAmount || 0);
}

export function getBatchAllocationContractKey(item) {
    const contractId = Number.parseInt(item?.contractId, 10);
    if (Number.isInteger(contractId) && contractId > 0) {
        return `contract:${contractId}`;
    }

    const contractNo = String(item?.contractNo || '').trim();
    return contractNo ? `contract-no:${contractNo}` : 'contract:missing';
}

function buildSelectionMeta(items) {
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error('请先选择要处理的记录');
    }

    const groups = new Set(items.map((item) => getBatchAllocationContractKey(item)));
    if (groups.size > 1) {
        throw new Error('请先按合同分组处理，本次只能处理同一合同');
    }

    const first = items[0];
    const contractKey = getBatchAllocationContractKey(first);
    if (contractKey === 'contract:missing') {
        throw new Error('所选记录缺少合同，不能批量填占比');
    }

    return {
        contractKey,
        contractId: first?.contractId || null,
        contractNo: first?.contractNo || '',
        contractAmount: getContractAmount(first),
    };
}

function distributeUnitsByWeights(weights) {
    const totalWeight = weights.reduce((sum, item) => sum + item.weight, 0);
    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
        throw new Error('当前选择不能按数量加权，请先修正数量');
    }

    const baseItems = weights.map((item, index) => {
        const rawUnits = (item.weight / totalWeight) * SHARE_SCALE;
        const units = Math.floor(rawUnits);
        return {
            index,
            units,
            remainder: rawUnits - units,
        };
    });

    let remaining = SHARE_SCALE - baseItems.reduce((sum, item) => sum + item.units, 0);
    const ranked = [...baseItems].sort((left, right) => {
        if (right.remainder !== left.remainder) {
            return right.remainder - left.remainder;
        }

        return left.index - right.index;
    });

    for (let index = 0; index < ranked.length && remaining > 0; index += 1, remaining -= 1) {
        ranked[index].units += 1;
    }

    const resolved = new Array(weights.length).fill(0);
    ranked.forEach((item) => {
        resolved[item.index] = item.units;
    });
    return resolved;
}

function buildUniformUnits(items, uniformPercent) {
    const share = normalizeAllocationShare(uniformPercent);
    if (share === null) {
        throw new Error('统一百分比只能填写 0 到 100 之间的数字');
    }

    const units = Math.round(share * SHARE_SCALE);
    return items.map(() => units);
}

function buildEvenUnits(items) {
    return distributeUnitsByWeights(items.map(() => ({ weight: 1 })));
}

function buildWeightedUnits(items) {
    const weights = items.map((item) => {
        const quantity = parseNumber(item?.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) {
            throw new Error('按数量加权要求所选记录的数量都大于 0');
        }

        return { weight: quantity };
    });

    return distributeUnitsByWeights(weights);
}

function resolveShareUnits(items, strategy, uniformPercent) {
    switch (strategy) {
    case BATCH_ALLOCATION_STRATEGIES.EVEN:
        return buildEvenUnits(items);
    case BATCH_ALLOCATION_STRATEGIES.WEIGHTED:
        return buildWeightedUnits(items);
    case BATCH_ALLOCATION_STRATEGIES.UNIFORM:
        return buildUniformUnits(items, uniformPercent);
    default:
        throw new Error('无效的批量分摊策略');
    }
}

export function buildBatchAllocationPreview(items, strategy, options = {}) {
    const { uniformPercent = '' } = options;
    const normalizedItems = Array.isArray(items) ? items : [];
    const selection = buildSelectionMeta(normalizedItems);
    const shareUnits = resolveShareUnits(normalizedItems, strategy, uniformPercent);

    const previewItems = normalizedItems.map((item, index) => {
        const allocationShare = shareUnits[index] / SHARE_SCALE;
        const estimatedValue = selection.contractAmount * allocationShare;

        return {
            workLogId: item.workLogId,
            projectName: item.projectName || '',
            contractNo: item.contractNo || '',
            testContent: item.testContent || '',
            quantity: Number(item.quantity || 0),
            unit: item.unit || '',
            allocationShare,
            allocationSharePercent: allocationShareToPercent(allocationShare, 4),
            estimatedValue,
        };
    });

    const totalAllocationShare = previewItems.reduce((sum, item) => sum + item.allocationShare, 0);
    const totalEstimatedValue = previewItems.reduce((sum, item) => sum + item.estimatedValue, 0);

    return {
        strategy,
        selection,
        items: previewItems,
        summary: {
            itemCount: previewItems.length,
            contractAmount: selection.contractAmount,
            totalAllocationShare,
            totalAllocationPercent: formatPercent(totalAllocationShare * 100),
            totalEstimatedValue,
        },
    };
}
