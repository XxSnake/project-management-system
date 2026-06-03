import prisma from '@/lib/prisma';
import {
    buildWorkLogProjectDisplayName,
    findOrCreateProjectByDisplayName,
} from '@/lib/projectResolver';
import { calculateProductionValue, rebuildProjectProduction } from '@/lib/productionCalculator';
import { syncDetectionRecordFromWorkLog } from '@/lib/detectionRecordSync';
import { normalizeAllocationShare, normalizePricingMode } from '@/lib/worklogBilling';

import { NextResponse } from 'next/server';

async function resolveStaffIds(staffNames = []) {
    const staffIds = [];

    for (const name of staffNames) {
        if (!name) {
            continue;
        }

        let staff = await prisma.staff.findFirst({ where: { name } });
        if (!staff) {
            staff = await prisma.staff.create({ data: { name } });
        }
        staffIds.push(staff.id);
    }

    return staffIds;
}

function buildPendingAllocationPayload(log) {
    const contract = log?.project?.contract;
    if (!contract?.id) {
        return null;
    }

    const pricingMode = normalizePricingMode(contract.pricingMode);
    if (pricingMode !== 'area' && pricingMode !== 'mixed' && pricingMode !== 'lumpsum') {
        return null;
    }

    if (normalizeAllocationShare(log.allocationShare) !== null) {
        return null;
    }

    const quantity = Number.parseFloat(log.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
        return null;
    }

    return {
        workLogId: log.id,
        contractId: contract.id,
        contractNo: contract.contractNo || '',
        projectId: log.project?.id || null,
        projectName: buildWorkLogProjectDisplayName(log),
        workDate: log.workDate,
        testContent: log.testContent,
        quantity,
        unit: log.unit || '',
        remarks: log.remarks || '',
        pricingMode,
        allocationShare: log.allocationShare,
        contractAmount: pricingMode === 'area'
            ? Number(contract.areaPricingAmount || 0)
            : Number(contract.lumpSumAmount || contract.areaPricingAmount || 0),
        contractArea: pricingMode !== 'area' || contract.areaPricingArea === null || contract.areaPricingArea === undefined
            ? null
            : Number(contract.areaPricingArea),
        staffNames: (log.staffMembers || []).map((item) => item.staff?.name).filter(Boolean),
    };
}

async function loadDetailedWorklog(workLogId) {
    return prisma.workLog.findUnique({
        where: { id: workLogId },
        include: {
            project: {
                include: {
                    contract: true,
                },
            },
            staffMembers: {
                include: {
                    staff: true,
                },
            },
            productionValues: true,
        },
    });
}

async function recalculateStandaloneWorklog(workLogId) {
    const log = await prisma.workLog.findUnique({
        where: { id: workLogId },
        include: {
            project: {
                include: {
                    contract: true,
                },
            },
            staffMembers: {
                include: {
                    staff: true,
                },
            },
        },
    });

    if (!log) {
        return;
    }

    await prisma.productionValue.deleteMany({
        where: { workLogId },
    });

    const staffIds = log.staffMembers.map((item) => item.staffId);
    await calculateProductionValue(log, staffIds);
}

export async function POST(request, { params }) {
    try {
        const { id } = await params;
        const worklogId = Number.parseInt(id, 10);
        if (Number.isNaN(worklogId)) {
            return NextResponse.json({ error: '无效的工作记录 ID' }, { status: 400 });
        }

        const existingLog = await prisma.workLog.findUnique({
            where: { id: worklogId },
            include: {
                project: true,
                staffMembers: {
                    include: {
                        staff: true,
                    },
                },
            },
        });

        if (!existingLog) {
            return NextResponse.json({ error: '工作记录不存在' }, { status: 404 });
        }

        const body = await request.json().catch(() => ({}));
        const originalQuantity = Number.parseFloat(existingLog.quantity);
        const hasQuantityOverride = body.quantity !== undefined || body.splitQuantity !== undefined;
        const nextQuantityRaw = body.quantity !== undefined ? body.quantity : body.splitQuantity;
        const nextQuantity = hasQuantityOverride
            ? Number.parseFloat(nextQuantityRaw)
            : originalQuantity;

        if (!Number.isFinite(originalQuantity) || originalQuantity < 0) {
            return NextResponse.json({ error: '原记录数量无效，不能复制副本' }, { status: 400 });
        }

        if (!Number.isFinite(nextQuantity) || nextQuantity < 0) {
            return NextResponse.json({ error: '新记录数量必须大于或等于 0' }, { status: 400 });
        }

        const nextWorkDate = body.workDate ? new Date(body.workDate) : existingLog.workDate;
        if (Number.isNaN(nextWorkDate.getTime())) {
            return NextResponse.json({ error: '新记录日期无效' }, { status: 400 });
        }

        const nextProjectName = typeof body.projectName === 'string' && body.projectName.trim()
            ? body.projectName.trim()
            : buildWorkLogProjectDisplayName(existingLog);
        const nextTestContent = typeof body.testContent === 'string' && body.testContent.trim()
            ? body.testContent.trim()
            : existingLog.testContent;
        const nextUnit = body.unit === undefined
            ? existingLog.unit
            : (String(body.unit || '').trim() || null);
        const nextRemarks = body.remarks === undefined
            ? existingLog.remarks
            : (String(body.remarks || '').trim() || null);
        const nextStaffNames = Array.from(new Set(
            (Array.isArray(body.staffNames)
                ? body.staffNames.map((item) => String(item || '').trim()).filter(Boolean)
                : existingLog.staffMembers.map((item) => item.staff?.name).filter(Boolean)),
        ));

        const nextProjectResolution = await findOrCreateProjectByDisplayName(nextProjectName, existingLog.projectId, prisma);
        const nextProject = nextProjectResolution.project;
        const nextStaffIds = await resolveStaffIds(nextStaffNames);

        const result = await prisma.$transaction(async (tx) => {
            const createdLog = await tx.workLog.create({
                data: {
                    workDate: nextWorkDate,
                    projectId: nextProject?.id || null,
                    buildingName: nextProjectResolution.buildingName,
                    testContent: nextTestContent,
                    quantity: nextQuantity,
                    unit: nextUnit,
                    rawText: existingLog.rawText
                        ? `${existingLog.rawText}\n[manual-copy from #${existingLog.id}]`
                        : `[manual-copy from #${existingLog.id}]`,
                    remarks: nextRemarks,
                    allocationShare: null,
                    manualTotalValue: null,
                    manualValueNote: null,
                },
            });

            if (nextStaffIds.length > 0) {
                await tx.workLogStaff.createMany({
                    data: nextStaffIds.map((staffId) => ({
                        workLogId: createdLog.id,
                        staffId,
                    })),
                });
            }

            return {
                createdLogId: createdLog.id,
                originalProjectId: existingLog.projectId,
                createdProjectId: nextProject?.id || null,
            };
        });

        await syncDetectionRecordFromWorkLog(worklogId);
        await syncDetectionRecordFromWorkLog(result.createdLogId);

        const rebuiltProjectIds = Array.from(new Set([
            result.originalProjectId,
            result.createdProjectId,
        ].filter(Boolean)));

        for (const projectId of rebuiltProjectIds) {
            await rebuildProjectProduction(projectId);
        }

        if (!result.createdProjectId) {
            await recalculateStandaloneWorklog(result.createdLogId);
        }

        const [originalLog, splitLog] = await Promise.all([
            loadDetailedWorklog(worklogId),
            loadDetailedWorklog(result.createdLogId),
        ]);

        return NextResponse.json({
            success: true,
            originalLog,
            splitLog,
            pendingAllocations: [
                buildPendingAllocationPayload(originalLog),
                buildPendingAllocationPayload(splitLog),
            ].filter(Boolean),
        });
    } catch (error) {
        console.error('Split worklog error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
