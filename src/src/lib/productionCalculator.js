import { findBestPriceMatch } from '@/lib/worklogMatching';
import { normalizeAllocationShare, normalizePricingMode } from '@/lib/worklogBilling';
import prisma from '@/lib/prisma';

async function resolveProjectWithContract(workLog) {
    if (workLog?.project?.contract !== undefined) {
        return workLog.project;
    }

    const projectId = workLog?.projectId || workLog?.project?.id;
    if (!projectId) {
        return null;
    }

    return prisma.project.findUnique({
        where: { id: projectId },
        include: {
            contract: true,
        },
    });
}

function buildPendingAllocation(workLog, contract, allocationShare = null) {
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
        allocationShare,
        contractAmount: Number.parseFloat(contract.areaPricingAmount) || 0,
        contractArea: Number.parseFloat(contract.areaPricingArea) || null,
    };
}

export async function calculateProductionValue(workLog, staffIds) {
    if (!Array.isArray(staffIds) || staffIds.length === 0) {
        return { status: 'no-staff' };
    }

    const quantity = Number.parseFloat(workLog?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
        return { status: 'invalid-quantity' };
    }

    const project = await resolveProjectWithContract(workLog);
    const contract = project?.contract || null;
    const pricingMode = normalizePricingMode(contract?.pricingMode);
    const manualTotalValue = Number.parseFloat(workLog?.manualTotalValue);

    if (Number.isFinite(manualTotalValue) && manualTotalValue > 0) {
        const perPerson = manualTotalValue / staffIds.length;
        const manualValueNote = String(workLog?.manualValueNote || '').trim();
        const priceSource = manualValueNote ? `手工指定产值: ${manualValueNote}` : '手工指定产值';

        for (const staffId of staffIds) {
            await prisma.productionValue.create({
                data: {
                    workLogId: workLog.id,
                    staffId,
                    value: perPerson,
                    unitPriceUsed: manualTotalValue,
                    priceSource,
                    calculationMode: 'manual',
                    workloadQuantity: quantity / staffIds.length,
                    workloadShare: normalizeAllocationShare(workLog?.allocationShare),
                },
            });
        }

        return {
            status: 'created',
            mode: 'manual',
            totalValue: manualTotalValue,
            manualValueNote,
        };
    }

    if (pricingMode === 'area' && contract?.id) {
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
        const perPerson = totalValue / staffIds.length;

        for (const staffId of staffIds) {
            await prisma.productionValue.create({
                data: {
                    workLogId: workLog.id,
                    staffId,
                    value: perPerson,
                    unitPriceUsed: contractAmount,
                    priceSource: `面积合同占比 ${(allocationShare * 100).toFixed(2).replace(/\.?0+$/u, '')}%`,
                    calculationMode: 'area',
                    workloadQuantity: quantity / staffIds.length,
                    workloadShare: allocationShare,
                },
            });
        }

        return {
            status: 'created',
            mode: 'area',
            totalValue,
            allocationShare,
        };
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
    const perPerson = totalValue / staffIds.length;

    for (const staffId of staffIds) {
        await prisma.productionValue.create({
            data: {
                workLogId: workLog.id,
                staffId,
                value: perPerson,
                unitPriceUsed: matchedPrice.unitPrice,
                priceSource: matchedPrice.priceSource,
                calculationMode: 'unit',
                workloadQuantity: quantity / staffIds.length,
                workloadShare: null,
            },
        });
    }

    return {
        status: 'created',
        mode: 'unit',
        totalValue,
        matchedPrice,
    };
}

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
    const perRole = totalValue / roleCount;

    for (const [roleType, staffId] of Object.entries(roleStaffMap)) {
        await prisma.productionValue.create({
            data: {
                reportId: report.id,
                staffId,
                value: perRole,
                unitPriceUsed: matchedPrice.unitPrice,
                priceSource: matchedPrice.priceSource,
                calculationMode: 'report',
                roleType,
                workloadQuantity: quantity / roleCount,
                workloadShare: null,
            },
        });
    }

    return {
        status: 'created',
        mode: 'report',
        totalValue,
        matchedPrice,
    };
}
