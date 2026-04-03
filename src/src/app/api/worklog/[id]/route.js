import prisma from '@/lib/prisma';
import { calculateProductionValue } from '@/lib/productionCalculator';
import { normalizeAllocationShare } from '@/lib/worklogBilling';

import { NextResponse } from 'next/server';

function parseOptionalFloat(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const numeric = Number.parseFloat(value);
    return Number.isFinite(numeric) ? numeric : null;
}

async function findOrCreateProject(projectName, fallbackProjectId = null) {
    if (!projectName) {
        return fallbackProjectId
            ? prisma.project.findUnique({ where: { id: fallbackProjectId } })
            : null;
    }

    let project = await prisma.project.findFirst({ where: { name: projectName } });
    if (!project) {
        project = await prisma.project.create({ data: { name: projectName } });
    }
    return project;
}

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

function buildPendingAllocationPayload(log, calculation) {
    if (!calculation?.pendingAllocation) {
        return null;
    }

    return {
        ...calculation.pendingAllocation,
        staffNames: (log.staffMembers || []).map((item) => item.staff?.name).filter(Boolean),
    };
}

export async function PUT(request, { params }) {
    try {
        const { id } = await params;
        const worklogId = Number.parseInt(id, 10);
        if (Number.isNaN(worklogId)) {
            return NextResponse.json({ error: '无效记录 ID' }, { status: 400 });
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

        const data = await request.json();
        const nextProjectName = typeof data.projectName === 'string'
            ? data.projectName
            : (existingLog.project?.name || '');
        const nextStaffNames = Array.isArray(data.staffNames)
            ? data.staffNames
            : existingLog.staffMembers.map((item) => item.staff?.name).filter(Boolean);

        const project = await findOrCreateProject(nextProjectName, existingLog.projectId);
        const staffIds = await resolveStaffIds(nextStaffNames);
        const allocationShare = Object.prototype.hasOwnProperty.call(data, 'allocationShare')
            ? normalizeAllocationShare(data.allocationShare)
            : existingLog.allocationShare;
        const manualTotalValue = Object.prototype.hasOwnProperty.call(data, 'manualTotalValue')
            ? parseOptionalFloat(data.manualTotalValue)
            : existingLog.manualTotalValue;
        const manualValueNote = Object.prototype.hasOwnProperty.call(data, 'manualValueNote')
            ? (data.manualValueNote ? String(data.manualValueNote).trim() : null)
            : existingLog.manualValueNote;

        const updatedLog = await prisma.workLog.update({
            where: { id: worklogId },
            data: {
                workDate: data.workDate ? new Date(data.workDate) : existingLog.workDate,
                projectId: project?.id || null,
                testContent: data.testContent ?? existingLog.testContent,
                quantity: data.quantity !== undefined ? (Number.parseFloat(data.quantity) || 0) : existingLog.quantity,
                unit: data.unit !== undefined ? (data.unit || null) : existingLog.unit,
                remarks: data.remarks !== undefined ? (data.remarks || null) : existingLog.remarks,
                allocationShare,
                manualTotalValue,
                manualValueNote,
            },
        });

        await prisma.workLogStaff.deleteMany({
            where: { workLogId: worklogId },
        });

        if (staffIds.length > 0) {
            await prisma.workLogStaff.createMany({
                data: staffIds.map((staffId) => ({
                    staffId,
                    workLogId: worklogId,
                })),
            });
        }

        await prisma.productionValue.deleteMany({
            where: { workLogId: worklogId },
        });

        const calculation = await calculateProductionValue(
            {
                ...updatedLog,
                project,
            },
            staffIds,
        );

        const refreshedLog = await prisma.workLog.findUnique({
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

        return NextResponse.json({
            success: true,
            log: refreshedLog,
            calculation,
            pendingAllocation: buildPendingAllocationPayload(refreshedLog, calculation),
        });
    } catch (error) {
        console.error('Update worklog error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function DELETE(request, { params }) {
    try {
        const { id } = await params;
        const worklogId = Number.parseInt(id, 10);

        await prisma.workLog.delete({
            where: { id: worklogId },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
