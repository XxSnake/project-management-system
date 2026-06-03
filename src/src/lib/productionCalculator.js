import { findBestPriceMatch } from '@/lib/worklogMatching';
import { normalizeAllocationShare, normalizePricingMode } from '@/lib/worklogBilling';
import { applyProductionCap } from '@/lib/productionCap';
import { isNonBillableLayoutWork } from '@/lib/worklogClassification';
import prisma from '@/lib/prisma';

async function resolveProjectWithContract(workLog, tx = prisma) {
    if (workLog?.project?.contract !== undefined) {
        return workLog.project;
    }

    const projectId = workLog?.projectId || workLog?.project?.id;
    if (!projectId) {
        return null;
    }

    return tx.project.findUnique({
        where: { id: projectId },
        include: {
            contract: true,
        },
    });
}

function buildPendingAllocation(workLog, contract, allocationShare = null) {
    const pricingMode = normalizePricingMode(contract?.pricingMode);
    const contractAmount = pricingMode === 'area'
        ? (Number.parseFloat(contract.areaPricingAmount) || 0)
        : (Number.parseFloat(contract.lumpSumAmount) || Number.parseFloat(contract.areaPricingAmount) || 0);

    return {
        workLogId: workLog.id,
        contractId: contract.id,
        contractNo: contract.contractNo || '',
        projectId: workLog.projectId || workLog.project?.id || null,
        projectName: workLog.project?.name || '',
        workDate: workLog.workDate,
        testContent: workLog.testContent,
        quantity: Number.parseFloat(workLog.quantity) || 0,
        unit: workLog.unit || '',
        remarks: workLog.remarks || '',
        pricingMode,
        allocationShare,
        contractAmount,
        contractArea: pricingMode === 'area'
            ? (Number.parseFloat(contract.areaPricingArea) || null)
            : null,
    };
}

function formatAllocationSharePercent(allocationShare) {
    return (allocationShare * 100).toFixed(2).replace(/\.?0+$/u, '');
}

/**
 * 创建产值记录，支持上限检查
 */
async function createProductionValues({
    workLog,
    staffIds,
    totalValue,
    unitPriceUsed,
    priceSource,
    calculationMode,
    workloadShare = null,
    project = null,
    contract = null,
    capMode = null,
}, options = {}) {
    const { tx = prisma } = options;
    const quantity = Number.parseFloat(workLog.quantity) || 0;
    const projectId = project?.id || workLog.projectId || workLog.project?.id || null;

    // 应用产值上限检查
    const { cappedValue, exceeded, originalValue } = await applyProductionCap({
        projectId,
        contract,
        newTotalValue: totalValue,
        excludeWorkLogId: workLog.id,
        capMode,
    }, { tx });

    const perPerson = staffIds.length > 0 ? cappedValue / staffIds.length : 0;

    for (const staffId of staffIds) {
        await tx.productionValue.create({
            data: {
                workLogId: workLog.id,
                staffId,
                value: perPerson,
                unitPriceUsed,
                priceSource: exceeded ? `${priceSource} [超限]` : priceSource,
                calculationMode,
                workloadQuantity: quantity / staffIds.length,
                workloadShare,
                exceeded,
                originalValue: exceeded ? (originalValue || totalValue) / staffIds.length : null,
            },
        });
    }

    return {
        status: 'created',
        mode: calculationMode,
        totalValue: cappedValue,
        exceeded,
        originalValue: exceeded ? originalValue || totalValue : null,
    };
}

/**
 * 主计算入口：计算工作日志的产值
 *
 * 定价方案:
 *   A (unit)   - 已签合同，单价×数量
 *   B (area)   - 已签合同，面积合同，合同总额×用户输入占比
 *   C (manual) - 已签合同（面积合同），用户手动输入产值
 *   无合同     - 仅记工作量，可手动输入产值
 */
export async function calculateProductionValue(workLog, staffIds, options = {}) {
    const { tx = prisma } = options;

    if (!Array.isArray(staffIds) || staffIds.length === 0) {
        return { status: 'no-staff' };
    }

    const quantity = Number.parseFloat(workLog?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
        return { status: 'invalid-quantity' };
    }

    if (isNonBillableLayoutWork(workLog)) {
        return {
            status: 'non-billable-layout',
            mode: 'none',
            message: '布点工作仅记录工作量，不计入产值',
        };
    }

    const project = await resolveProjectWithContract(workLog, tx);
    const contract = project?.contract || null;
    const pricingMode = normalizePricingMode(contract?.pricingMode);
    const hasContract = Boolean(contract?.id);
    const manualTotalValue = Number.parseFloat(workLog?.manualTotalValue);

    // ═══════════════════════════════════════════════════
    // 手动输入产值（方案C 或 未签合同手动输入）
    // ═══════════════════════════════════════════════════
    if (Number.isFinite(manualTotalValue) && manualTotalValue > 0) {
        const manualValueNote = String(workLog?.manualValueNote || '').trim();
        const priceSource = manualValueNote ? `手工指定产值: ${manualValueNote}` : '手工指定产值';

        return createProductionValues({
            workLog,
            staffIds,
            totalValue: manualTotalValue,
            unitPriceUsed: manualTotalValue,
            priceSource,
            calculationMode: 'manual',
            workloadShare: normalizeAllocationShare(workLog?.allocationShare),
            project,
            contract,
        }, { tx });
    }

    // ═══════════════════════════════════════════════════
    // 方案D：包干价合同按占比计算
    // ═══════════════════════════════════════════════════
    if (pricingMode === 'lumpsum' && hasContract) {
        const allocationShare = normalizeAllocationShare(workLog?.allocationShare);
        const lumpSumAmount = Number.parseFloat(contract.lumpSumAmount);

        if (!Number.isFinite(lumpSumAmount) || lumpSumAmount <= 0) {
            return {
                status: 'lumpsum-contract-incomplete',
                mode: 'lumpsum',
                message: '包干价合同尚未配置包干总价',
            };
        }

        if (allocationShare === null) {
            return {
                status: 'pending-area-share',
                mode: 'lumpsum',
                pendingAllocation: buildPendingAllocation(workLog, contract),
            };
        }

        const totalValue = lumpSumAmount * allocationShare;

        return createProductionValues({
            workLog,
            staffIds,
            totalValue,
            unitPriceUsed: lumpSumAmount,
            priceSource: `包干价合同占比 ${(allocationShare * 100).toFixed(2).replace(/\.?0+$/u, '')}%`,
            calculationMode: 'lumpsum',
            workloadShare: allocationShare,
            project,
            contract,
        }, { tx });
    }

    // ═══════════════════════════════════════════════════
    // 方案B：面积合同按占比计算
    // ═══════════════════════════════════════════════════
    if (pricingMode === 'area' && hasContract) {
        const allocationShare = normalizeAllocationShare(workLog?.allocationShare);
        const contractAmount = Number.parseFloat(contract.areaPricingAmount);

        if (!Number.isFinite(contractAmount) || contractAmount <= 0) {
            return {
                status: 'area-contract-incomplete',
                mode: 'area',
                message: '面积合同尚未配置合同总金额',
                pendingAllocation: buildPendingAllocation(workLog, contract, allocationShare),
            };
        }

        if (allocationShare === null) {
            return {
                status: 'pending-area-share',
                mode: 'area',
                pendingAllocation: buildPendingAllocation(workLog, contract),
            };
        }

        const totalValue = contractAmount * allocationShare;

        return createProductionValues({
            workLog,
            staffIds,
            totalValue,
            unitPriceUsed: contractAmount,
            priceSource: `面积合同占比 ${(allocationShare * 100).toFixed(2).replace(/\.?0+$/u, '')}%`,
            calculationMode: 'area',
            workloadShare: allocationShare,
            project,
            contract,
        }, { tx });
    }

    // ═══════════════════════════════════════════════════
    // 方案A：单价合同按单价×数量计算
    // ═══════════════════════════════════════════════════
    if (pricingMode === 'mixed' && hasContract) {
        const allocationShare = normalizeAllocationShare(workLog?.allocationShare);
        const lumpSumAmount = Number.parseFloat(contract.lumpSumAmount);

        if (allocationShare !== null && Number.isFinite(lumpSumAmount) && lumpSumAmount > 0) {
            const totalValue = lumpSumAmount * allocationShare;

            return createProductionValues({
                workLog,
                staffIds,
                totalValue,
                unitPriceUsed: lumpSumAmount,
                priceSource: `混合计费打包部分占比 ${formatAllocationSharePercent(allocationShare)}%`,
                calculationMode: 'allocation-share',
                workloadShare: allocationShare,
                project,
                contract,
                capMode: 'mixed-allocation-share',
            }, { tx });
        }

        const matchedPrice = await findBestPriceMatch({
            ...workLog,
            project,
            projectId: project?.id || workLog.projectId || null,
        });

        if (!matchedPrice) {
            return { status: 'no-price-match', mode: 'unit' };
        }

        const totalValue = matchedPrice.unitPrice * quantity;

        return createProductionValues({
            workLog,
            staffIds,
            totalValue,
            unitPriceUsed: matchedPrice.unitPrice,
            priceSource: matchedPrice.priceSource,
            calculationMode: 'unit',
            project,
            contract,
        }, { tx });
    }

    if (hasContract && pricingMode === 'unit') {
        const matchedPrice = await findBestPriceMatch({
            ...workLog,
            project,
            projectId: project?.id || workLog.projectId || null,
        });

        if (!matchedPrice) {
            return { status: 'no-price-match', mode: 'unit' };
        }

        const totalValue = matchedPrice.unitPrice * quantity;

        return createProductionValues({
            workLog,
            staffIds,
            totalValue,
            unitPriceUsed: matchedPrice.unitPrice,
            priceSource: matchedPrice.priceSource,
            calculationMode: 'unit',
            project,
            contract,
        }, { tx });
    }

    // ═══════════════════════════════════════════════════
    // 未签合同：仅记录工作量（不计算产值）
    // ═══════════════════════════════════════════════════
    if (!hasContract) {
        // 尝试用内部价格匹配（作为参考，但不生成产值记录）
        // 未签合同时如果没有手动输入产值，只返回 workload-only 状态
        return {
            status: 'workload-only',
            mode: 'none',
            message: '项目未关联合同，仅记录工作量',
        };
    }

    return { status: 'no-price-match', mode: 'unit' };
}

/**
 * 报告产值计算（保持原有逻辑，增加上限检查）
 */
export async function calculateReportProductionValue(report, roleStaffMap) {
    if (!roleStaffMap || Object.keys(roleStaffMap).length === 0) {
        return { status: 'no-roles' };
    }

    const quantity = Number.parseFloat(report?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
        return { status: 'invalid-quantity' };
    }

    const project = await resolveProjectWithContract(report);
    const contract = project?.contract || null;

    const matchedPrice = await findBestPriceMatch({
        testContent: report.testContent,
        quantity,
        unit: report.unit,
        project,
        projectId: project?.id || report.projectId || null,
    });

    if (!matchedPrice) {
        return { status: 'no-price-match', mode: 'unit' };
    }

    const roleCount = Object.keys(roleStaffMap).length;
    const totalValue = matchedPrice.unitPrice * quantity;
    const projectId = project?.id || report.projectId || null;

    // 应用产值上限检查
    const { cappedValue, exceeded, originalValue } = await applyProductionCap({
        projectId,
        contract,
        newTotalValue: totalValue,
    });

    const perRole = roleCount > 0 ? cappedValue / roleCount : 0;

    for (const [roleType, staffId] of Object.entries(roleStaffMap)) {
        await prisma.productionValue.create({
            data: {
                reportId: report.id,
                staffId,
                value: perRole,
                unitPriceUsed: matchedPrice.unitPrice,
                priceSource: exceeded ? `${matchedPrice.priceSource} [超限]` : matchedPrice.priceSource,
                calculationMode: 'report',
                roleType,
                workloadQuantity: quantity / roleCount,
                workloadShare: null,
                exceeded,
                originalValue: exceeded ? (originalValue || totalValue) / roleCount : null,
            },
        });
    }

    return {
        status: 'created',
        mode: 'report',
        totalValue: cappedValue,
        exceeded,
        matchedPrice,
    };
}

function createWorklogRebuildStats(total) {
    return {
        total,
        created: 0,
        pendingAreaShare: 0,
        workloadOnly: 0,
        nonBillableLayout: 0,
        noMatch: 0,
        noStaff: 0,
        invalidQuantity: 0,
        exceeded: 0,
    };
}

function createReportRebuildStats(total) {
    return {
        total,
        created: 0,
        noMatch: 0,
        noRoles: 0,
        invalidQuantity: 0,
        exceeded: 0,
    };
}

function applyWorklogRebuildResult(stats, result) {
    switch (result?.status) {
    case 'created':
        stats.created += 1;
        if (result.exceeded) {
            stats.exceeded += 1;
        }
        break;
    case 'pending-area-share':
        stats.pendingAreaShare += 1;
        break;
    case 'workload-only':
        stats.workloadOnly += 1;
        break;
    case 'non-billable-layout':
        stats.workloadOnly += 1;
        stats.nonBillableLayout += 1;
        break;
    case 'no-staff':
        stats.noStaff += 1;
        break;
    case 'invalid-quantity':
        stats.invalidQuantity += 1;
        break;
    default:
        stats.noMatch += 1;
        break;
    }
}

function applyReportRebuildResult(stats, result) {
    switch (result?.status) {
    case 'created':
        stats.created += 1;
        if (result.exceeded) {
            stats.exceeded += 1;
        }
        break;
    case 'no-roles':
        stats.noRoles += 1;
        break;
    case 'invalid-quantity':
        stats.invalidQuantity += 1;
        break;
    default:
        stats.noMatch += 1;
        break;
    }
}

function buildReportRoleStaffMap(roles = []) {
    const roleStaffMap = {};
    roles.forEach((role) => {
        if (role?.roleType && role?.staffId) {
            roleStaffMap[role.roleType] = role.staffId;
        }
    });
    return roleStaffMap;
}

function getTimelineDate(item) {
    const value = item.kind === 'worklog' ? item.entry.workDate : item.entry.reportDate;
    return value ? new Date(value).getTime() : new Date(item.entry.createdAt).getTime();
}

export async function rebuildProjectProduction(projectId, options = {}) {
    const clearManualValues = options.clearManualValues === true;

    const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
            contract: {
                include: {
                    priceItems: true,
                },
            },
        },
    });

    if (!project) {
        return {
            status: 'project-not-found',
            projectId,
        };
    }

    if (clearManualValues && project.contract) {
        await prisma.workLog.updateMany({
            where: {
                projectId,
                manualTotalValue: {
                    not: null,
                },
            },
            data: {
                manualTotalValue: null,
                manualValueNote: null,
            },
        });
    }

    const [workLogs, reports] = await Promise.all([
        prisma.workLog.findMany({
            where: { projectId },
            include: {
                staffMembers: {
                    include: {
                        staff: true,
                    },
                },
            },
            orderBy: [
                { workDate: 'asc' },
                { createdAt: 'asc' },
            ],
        }),
        prisma.testReport.findMany({
            where: { projectId },
            include: {
                roles: {
                    include: {
                        staff: true,
                    },
                },
            },
            orderBy: [
                { reportDate: 'asc' },
                { createdAt: 'asc' },
            ],
        }),
    ]);

    if (workLogs.length > 0 || reports.length > 0) {
        const workLogIds = workLogs.map((item) => item.id);
        const reportIds = reports.map((item) => item.id);

        await prisma.productionValue.deleteMany({
            where: {
                OR: [
                    workLogIds.length > 0 ? { workLogId: { in: workLogIds } } : undefined,
                    reportIds.length > 0 ? { reportId: { in: reportIds } } : undefined,
                ].filter(Boolean),
            },
        });
    }

    const worklogs = createWorklogRebuildStats(workLogs.length);
    const reportStats = createReportRebuildStats(reports.length);

    const timeline = [
        ...workLogs.map((entry) => ({ kind: 'worklog', entry })),
        ...reports.map((entry) => ({ kind: 'report', entry })),
    ].sort((left, right) => {
        const diff = getTimelineDate(left) - getTimelineDate(right);
        if (diff !== 0) {
            return diff;
        }

        if (left.kind !== right.kind) {
            return left.kind === 'worklog' ? -1 : 1;
        }

        return left.entry.id - right.entry.id;
    });

    for (const item of timeline) {
        if (item.kind === 'worklog') {
            const staffIds = item.entry.staffMembers.map((staffMember) => staffMember.staffId);
            const result = await calculateProductionValue(
                {
                    ...item.entry,
                    project,
                },
                staffIds,
            );
            applyWorklogRebuildResult(worklogs, result);
            continue;
        }

        const roleStaffMap = buildReportRoleStaffMap(item.entry.roles);
        const result = await calculateReportProductionValue(
            {
                ...item.entry,
                project,
            },
            roleStaffMap,
        );
        applyReportRebuildResult(reportStats, result);
    }

    return {
        status: 'completed',
        projectId,
        projectName: project.name,
        hasContract: Boolean(project.contract),
        pricingMode: normalizePricingMode(project.contract?.pricingMode),
        worklogs,
        reports: reportStats,
    };
}

/**
 * 补算：项目关联合同后，对历史工作日志进行产值补算
 * @param {number} projectId - 项目ID
 * @param {object} options - { recalcMonth: 补算起始月 }
 * @returns {object} 补算结果摘要
 */
export async function retroactiveCalculation(projectId) {
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
            contract: {
                include: { priceItems: true },
            },
        },
    });

    if (!project?.contract) {
        return { status: 'no-contract', message: '项目未关联合同' };
    }

    const contract = project.contract;
    const pricingMode = normalizePricingMode(contract.pricingMode);

    const shouldRecalculateAllLogs = pricingMode === 'unit' || pricingMode === 'mixed';
    const targetLogWhere = shouldRecalculateAllLogs
        ? { projectId }
        : {
            projectId,
            OR: [
                { productionValues: { none: {} } },
                { productionValues: { every: { calculationMode: 'manual' } } },
            ],
        };

    // 单价/混合合同需要整项目重跑，才能把已经算错的旧产值一起纠正回来
    const unpricedLogs = await prisma.workLog.findMany({
        where: targetLogWhere,
        include: {
            project: { include: { contract: true } },
            staffMembers: { include: { staff: true } },
            productionValues: true,
        },
        orderBy: { workDate: 'asc' },
    });

    if (unpricedLogs.length === 0) {
        return { status: 'nothing-to-calculate', message: '没有需要补算的工作日志' };
    }

    const results = {
        total: unpricedLogs.length,
        calculated: 0,
        pendingAreaShare: 0,
        workloadOnly: 0,
        nonBillableLayout: 0,
        noMatch: 0,
        exceeded: 0,
        details: [],
    };

    for (const log of unpricedLogs) {
        const staffIds = log.staffMembers.map((sm) => sm.staffId);
        if (staffIds.length === 0) {
            results.details.push({ workLogId: log.id, status: 'no-staff' });
            continue;
        }

        if (pricingMode === 'area' || pricingMode === 'lumpsum') {
            // 面积/包干价合同：需要用户逐条补填占比
            const allocationShare = normalizeAllocationShare(log.allocationShare);
            if (allocationShare === null) {
                results.pendingAreaShare += 1;
                results.details.push({
                    workLogId: log.id,
                    status: 'pending-area-share',
                    testContent: log.testContent,
                    workDate: log.workDate,
                });
                continue;
            }
        }

        // 清除旧的产值记录（可能是未签合同期间的手动输入）
        if (log.productionValues?.length > 0) {
            await prisma.productionValue.deleteMany({
                where: { workLogId: log.id },
            });
        }

        // 清除手动产值字段，让系统按合同规则重新计算
        if (log.manualTotalValue) {
            await prisma.workLog.update({
                where: { id: log.id },
                data: { manualTotalValue: null, manualValueNote: null },
            });
            log.manualTotalValue = null;
            log.manualValueNote = null;
        }

        // 对该条日志执行产值计算
        const calcResult = await calculateProductionValue(log, staffIds);
        results.details.push({ workLogId: log.id, ...calcResult });

        if (calcResult.status === 'created') {
            results.calculated += 1;
            if (calcResult.exceeded) {
                results.exceeded += 1;
            }
        } else if (calcResult.status === 'pending-area-share') {
            results.pendingAreaShare += 1;
        } else if (calcResult.status === 'workload-only') {
            results.workloadOnly += 1;
        } else if (calcResult.status === 'non-billable-layout') {
            results.workloadOnly += 1;
            results.nonBillableLayout += 1;
        } else {
            results.noMatch += 1;
        }
    }

    return {
        status: 'completed',
        pricingMode,
        ...results,
    };
}
