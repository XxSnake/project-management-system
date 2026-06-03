import prisma from '@/lib/prisma';
import {
    buildWorkLogProjectDisplayName,
    findOrCreateProjectByDisplayName,
} from '@/lib/projectResolver';
import { calculateProductionValue } from '@/lib/productionCalculator';
import { syncDetectionRecordFromWorkLog } from '@/lib/detectionRecordSync';
import { normalizeAllocationShare } from '@/lib/worklogBilling';

export class WorkLogMutationError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'WorkLogMutationError';
        this.status = status;
    }
}

function parseOptionalFloat(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const numeric = Number.parseFloat(value);
    return Number.isFinite(numeric) ? numeric : null;
}

async function resolveStaffIds(staffNames = [], prismaClient = prisma) {
    const staffIds = [];

    for (const name of staffNames) {
        if (!name) {
            continue;
        }

        let staff = await prismaClient.staff.findFirst({ where: { name } });
        if (!staff) {
            staff = await prismaClient.staff.create({ data: { name } });
        }
        staffIds.push(staff.id);
    }

    return staffIds;
}

export function buildPendingAllocationPayload(log, calculation) {
    if (!calculation?.pendingAllocation) {
        return null;
    }

    return {
        ...calculation.pendingAllocation,
        projectName: buildWorkLogProjectDisplayName(log),
        staffNames: (log.staffMembers || []).map((item) => item.staff?.name).filter(Boolean),
    };
}

async function updateWorkLogWithTx(worklogId, data, tx) {
    const existingLog = await tx.workLog.findUnique({
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
        throw new WorkLogMutationError('工作记录不存在', 404);
    }

    const nextProjectName = typeof data.projectName === 'string'
        ? data.projectName
        : buildWorkLogProjectDisplayName(existingLog);
    const nextStaffNames = Array.isArray(data.staffNames)
        ? data.staffNames
        : existingLog.staffMembers.map((item) => item.staff?.name).filter(Boolean);

    const allocationShare = Object.prototype.hasOwnProperty.call(data, 'allocationShare')
        ? normalizeAllocationShare(data.allocationShare)
        : existingLog.allocationShare;
    const manualTotalValue = Object.prototype.hasOwnProperty.call(data, 'manualTotalValue')
        ? parseOptionalFloat(data.manualTotalValue)
        : existingLog.manualTotalValue;
    const manualValueNote = Object.prototype.hasOwnProperty.call(data, 'manualValueNote')
        ? (data.manualValueNote ? String(data.manualValueNote).trim() : null)
        : existingLog.manualValueNote;

    const resolvedProject = await findOrCreateProjectByDisplayName(nextProjectName, existingLog.projectId, tx);
    const project = resolvedProject.project;
    const staffIds = await resolveStaffIds(nextStaffNames, tx);

    const updatedLog = await tx.workLog.update({
        where: { id: worklogId },
        data: {
            workDate: data.workDate ? new Date(data.workDate) : existingLog.workDate,
            projectId: project?.id || null,
            buildingName: resolvedProject.buildingName,
            testContent: data.testContent ?? existingLog.testContent,
            quantity: data.quantity !== undefined ? (Number.parseFloat(data.quantity) || 0) : existingLog.quantity,
            unit: data.unit !== undefined ? (data.unit || null) : existingLog.unit,
            remarks: data.remarks !== undefined ? (data.remarks || null) : existingLog.remarks,
            allocationShare,
            manualTotalValue,
            manualValueNote,
        },
    });

    await tx.workLogStaff.deleteMany({
        where: { workLogId: worklogId },
    });

    if (staffIds.length > 0) {
        await tx.workLogStaff.createMany({
            data: staffIds.map((staffId) => ({
                staffId,
                workLogId: worklogId,
            })),
        });
    }

    await tx.productionValue.deleteMany({
        where: { workLogId: worklogId },
    });

    const calculation = await calculateProductionValue(
        {
            ...updatedLog,
            buildingName: resolvedProject.buildingName,
            project,
        },
        staffIds,
        { tx },
    );

    await syncDetectionRecordFromWorkLog(worklogId, { tx });

    const refreshedLog = await tx.workLog.findUnique({
        where: { id: worklogId },
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

    return {
        refreshedLog,
        calculation,
    };
}

export async function updateWorkLogAndRecalculate(worklogId, data, options = {}) {
    const { tx = null } = options;
    if (tx) {
        return updateWorkLogWithTx(worklogId, data, tx);
    }

    return prisma.$transaction((transaction) => updateWorkLogWithTx(worklogId, data, transaction));
}
