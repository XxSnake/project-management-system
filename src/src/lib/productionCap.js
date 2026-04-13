import prisma from '@/lib/prisma';

/**
 * 获取项目关联合同的总金额（用于100%上限检查）
 * - 包干价合同：lumpSumAmount
 * - 面积合同：areaPricingAmount
 * - 混合计费：areaPricingAmount + sum(priceItems)
 * - 单价合同：sum(unitPrice × quantity) from PriceItems
 */
export async function getContractTotalAmount(contract) {
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
    const priceItems = contract.priceItems || await prisma.priceItem.findMany({
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
        const total = unitTotal + areaAmount;
        return total > 0 ? total : null;
    }

    return hasValidItem ? unitTotal : null;
}

/**
 * 查询项目已累计的产值总额（不含指定的 workLogId，用于更新时排除自身）
 */
export async function getCumulativeProjectValue(projectId, excludeWorkLogId = null) {
    if (!projectId) return 0;

    // 工作日志产值
    const worklogWhere = {
        workLog: { projectId },
    };
    if (excludeWorkLogId) {
        worklogWhere.workLogId = { not: excludeWorkLogId };
    }

    const worklogSum = await prisma.productionValue.aggregate({
        where: worklogWhere,
        _sum: { value: true },
    });

    // 检测报告产值（通过 report.projectId 关联）
    const reportSum = await prisma.productionValue.aggregate({
        where: {
            report: { projectId },
            workLogId: null,
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
}) {
    const contractTotal = await getContractTotalAmount(contract);

    // 无法确定合同总额，不做上限检查
    if (contractTotal === null) {
        return { cappedValue: newTotalValue, exceeded: false, originalValue: null };
    }

    const cumulative = await getCumulativeProjectValue(projectId, excludeWorkLogId);
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
