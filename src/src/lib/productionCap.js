import prisma from '@/lib/prisma';

/**
 * 获取项目关联合同的总金额（用于100%上限检查）
 * - 包干价合同：lumpSumAmount
 * - 面积合同：areaPricingAmount
 * - 混合计费：lumpSumAmount + areaPricingAmount + sum(priceItems)
 * - 单价合同：sum(unitPrice × quantity) from PriceItems
 */
export async function getContractTotalAmount(contract, options = {}) {
    const { tx = prisma } = options;

    if (!contract?.id) return null;

    if (contract.pricingMode === 'lumpsum') {
        const amount = Number.parseFloat(contract.lumpSumAmount);
        return Number.isFinite(amount) && amount > 0 ? amount : null;
    }

    if (contract.pricingMode === 'area') {
        const amount = Number.parseFloat(contract.areaPricingAmount);
        return Number.isFinite(amount) && amount > 0 ? amount : null;
    }

    // 单价部分：从 PriceItems 计算总额
    const priceItems = contract.priceItems || await tx.priceItem.findMany({
        where: { contractId: contract.id },
    });

    let unitTotal = 0;
    let hasValidItem = false;
    for (const item of priceItems) {
        const price = Number.parseFloat(item.unitPrice);
        const qty = Number.parseFloat(item.quantity);
        if (Number.isFinite(price) && price > 0 && Number.isFinite(qty) && qty > 0) {
            unitTotal += price * qty;
            hasValidItem = true;
        }
    }

    if (contract.pricingMode === 'mixed') {
        const areaAmount = Number.parseFloat(contract.areaPricingAmount) || 0;
        const lumpSumAmount = Number.parseFloat(contract.lumpSumAmount) || 0;
        const total = unitTotal + areaAmount + lumpSumAmount;
        return total > 0 ? total : null;
    }

    return hasValidItem ? unitTotal : null;
}

/**
 * 查询项目已累计的产值总额（不含指定的 workLogId，用于更新时排除自身）
 */
export async function getCumulativeProjectValue(projectId, excludeWorkLogId = null, options = {}) {
    const { tx = prisma } = options;

    if (!projectId) return 0;

    // 工作日志产值
    const worklogWhere = {
        workLog: { projectId },
    };
    if (excludeWorkLogId) {
        worklogWhere.workLogId = { not: excludeWorkLogId };
    }

    const worklogSum = await tx.productionValue.aggregate({
        where: worklogWhere,
        _sum: { value: true },
    });

    // 检测报告产值（通过 report.projectId 关联）
    const reportSum = await tx.productionValue.aggregate({
        where: {
            report: { projectId },
            workLogId: null,
        },
        _sum: { value: true },
    });

    return (worklogSum._sum.value || 0) + (reportSum._sum.value || 0);
}

async function getScopedProjectValue(projectId, excludeWorkLogId = null, calculationModes = [], options = {}) {
    const { tx = prisma } = options;

    if (!projectId) return 0;

    const normalizedModes = Array.isArray(calculationModes)
        ? calculationModes.filter(Boolean)
        : [];

    if (normalizedModes.length === 0) {
        return getCumulativeProjectValue(projectId, excludeWorkLogId, { tx });
    }

    const worklogWhere = {
        workLog: { projectId },
        calculationMode: { in: normalizedModes },
    };
    if (excludeWorkLogId) {
        worklogWhere.workLogId = { not: excludeWorkLogId };
    }

    const worklogSum = await tx.productionValue.aggregate({
        where: worklogWhere,
        _sum: { value: true },
    });

    const reportSum = await tx.productionValue.aggregate({
        where: {
            report: { projectId },
            workLogId: null,
            calculationMode: { in: normalizedModes },
        },
        _sum: { value: true },
    });

    return (worklogSum._sum.value || 0) + (reportSum._sum.value || 0);
}

/**
 * 检查并应用产值上限
 * 返回 { cappedValue, exceeded, originalValue }
 */
export async function applyProductionCap({
    projectId,
    contract,
    newTotalValue,
    excludeWorkLogId = null,
    capMode = null,
}, options = {}) {
    const { tx = prisma } = options;
    let contractTotal = null;
    let cumulative = 0;

    if (capMode === 'mixed-allocation-share') {
        const mixedAllocationCap = Number.parseFloat(contract?.lumpSumAmount);
        contractTotal = Number.isFinite(mixedAllocationCap) && mixedAllocationCap > 0
            ? mixedAllocationCap
            : null;

        if (contractTotal !== null) {
            cumulative = await getScopedProjectValue(
                projectId,
                excludeWorkLogId,
                ['allocation-share'],
                { tx },
            );
        }
    } else {
        contractTotal = await getContractTotalAmount(contract, { tx });
        if (contractTotal !== null) {
            cumulative = await getCumulativeProjectValue(projectId, excludeWorkLogId, { tx });
        }
    }

    // 无法确定合同总额，不做上限检查
    if (contractTotal === null) {
        return { cappedValue: newTotalValue, exceeded: false, originalValue: null };
    }

    const remaining = contractTotal - cumulative;

    if (remaining <= 0) {
        // 已完全超限，本次产值全部归零
        return { cappedValue: 0, exceeded: true, originalValue: newTotalValue };
    }

    if (newTotalValue <= remaining) {
        // 未超限
        return { cappedValue: newTotalValue, exceeded: false, originalValue: null };
    }

    // 部分超限：只计算剩余部分
    return { cappedValue: remaining, exceeded: true, originalValue: newTotalValue };
}

/**
 * 获取项目的产值进度信息
 */
export async function getProjectCapProgress(projectId, contract) {
    const contractTotal = await getContractTotalAmount(contract);
    if (contractTotal === null) {
        return null;
    }

    const cumulative = await getCumulativeProjectValue(projectId);
    const percentage = (cumulative / contractTotal) * 100;

    return {
        contractTotal,
        cumulative,
        remaining: Math.max(0, contractTotal - cumulative),
        percentage: Math.min(100, percentage),
        exceeded: cumulative >= contractTotal,
    };
}
