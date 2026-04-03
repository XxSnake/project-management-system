import prisma from '@/lib/prisma';
import { calculateReportProductionValue } from '@/lib/productionCalculator';

import { NextResponse } from 'next/server';

const ROLE_TYPES = ['编写', '主检', '审核', '批准'];

async function findOrCreateProject(projectName) {
    let project = await prisma.project.findFirst({ where: { name: projectName } });
    let created = false;
    if (!project) {
        project = await prisma.project.create({ data: { name: projectName } });
        created = true;
    }
    return { project, created };
}

async function findOrCreateStaff(name) {
    if (!name) {
        return null;
    }

    let staff = await prisma.staff.findFirst({ where: { name } });
    if (!staff) {
        staff = await prisma.staff.create({ data: { name } });
    }
    return staff;
}

export async function PUT(request, { params }) {
    try {
        const { id } = await params;
        const reportId = Number.parseInt(id, 10);
        const body = await request.json();

        const existing = await prisma.testReport.findUnique({ where: { id: reportId } });
        if (!existing) {
            return NextResponse.json({ error: '报告记录不存在' }, { status: 404 });
        }

        let projectId = existing.projectId;
        if (body.projectName) {
            const { project } = await findOrCreateProject(body.projectName);
            projectId = project.id;
        }

        const roleAssignments = [];
        const roleStaffMap = {};
        const roleNameKeys = ['writer', 'inspector', 'reviewer', 'approver'];

        for (const [index, roleType] of ROLE_TYPES.entries()) {
            const staffName = body[roleNameKeys[index]];
            if (staffName) {
                const staff = await findOrCreateStaff(staffName);
                if (staff) {
                    roleAssignments.push({ roleType, staffId: staff.id });
                    roleStaffMap[roleType] = staff.id;
                }
            }
        }

        await prisma.reportRole.deleteMany({ where: { reportId } });
        await prisma.productionValue.deleteMany({ where: { reportId } });

        const report = await prisma.testReport.update({
            where: { id: reportId },
            data: {
                reportNo: body.reportNo ?? existing.reportNo,
                projectId,
                testContent: body.testContent ?? existing.testContent,
                reportDate: body.reportDate ? new Date(body.reportDate) : existing.reportDate,
                quantity: body.quantity !== undefined ? Number.parseFloat(body.quantity) || 1 : existing.quantity,
                unit: body.unit ?? existing.unit,
                remarks: body.remarks ?? existing.remarks,
                roles: {
                    create: roleAssignments,
                },
            },
            include: {
                project: { include: { contract: true } },
                roles: { include: { staff: true } },
                productionValues: { include: { staff: true } },
            },
        });

        await calculateReportProductionValue(report, roleStaffMap);

        const updated = await prisma.testReport.findUnique({
            where: { id: reportId },
            include: {
                project: { include: { contract: true } },
                roles: { include: { staff: true } },
                productionValues: { include: { staff: true } },
            },
        });

        return NextResponse.json(updated);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function DELETE(request, { params }) {
    try {
        const { id } = await params;
        const reportId = Number.parseInt(id, 10);

        await prisma.testReport.delete({ where: { id: reportId } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
