import prisma from '@/lib/prisma';
import { calculateReportProductionValue } from '@/lib/productionCalculator';

import { NextResponse } from 'next/server';

const ROLE_TYPES = ['编写', '主检', '审核', '批准'];

function parseReportText(rawText) {
    if (!rawText || typeof rawText !== 'string') {
        return [];
    }

    const lines = rawText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    const rows = [];

    for (const line of lines) {
        const parts = line.split('\t').map((cell) => cell.trim());
        if (parts.length < 6) {
            continue;
        }

        const [dateStr, reportNo, projectName, testContent, quantityStr, unit, ...roleNames] = parts;

        const workDate = new Date(dateStr);
        if (Number.isNaN(workDate.getTime())) {
            continue;
        }

        const quantity = Number.parseFloat(quantityStr) || 1;
        const writer = roleNames[0] || '';
        const inspector = roleNames[1] || '';
        const reviewer = roleNames[2] || '';
        const approver = roleNames[3] || '';

        rows.push({
            reportDate: workDate,
            reportNo: reportNo || null,
            projectName: projectName || '',
            testContent: testContent || '',
            quantity,
            unit: unit || null,
            writer,
            inspector,
            reviewer,
            approver,
            raw: line,
        });
    }

    return rows;
}

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

async function saveReportRow(row) {
    let project;
    let projectCreated = false;

    if (row._forceProjectId) {
        project = await prisma.project.findUnique({ where: { id: row._forceProjectId } });
    }

    if (!project) {
        const result = await findOrCreateProject(row.projectName);
        project = result.project;
        projectCreated = result.created;
    }

    const roleAssignments = [];
    const roleStaffMap = {};

    for (const [index, roleType] of ROLE_TYPES.entries()) {
        const nameKey = ['writer', 'inspector', 'reviewer', 'approver'][index];
        const staffName = row[nameKey];
        if (staffName) {
            const staff = await findOrCreateStaff(staffName);
            if (staff) {
                roleAssignments.push({ roleType, staffId: staff.id });
                roleStaffMap[roleType] = staff.id;
            }
        }
    }

    const report = await prisma.testReport.create({
        data: {
            reportNo: row.reportNo,
            projectId: project.id,
            testContent: row.testContent,
            reportDate: row.reportDate,
            quantity: row.quantity,
            unit: row.unit,
            rawText: row.raw || null,
            roles: {
                create: roleAssignments,
            },
        },
        include: {
            project: {
                include: {
                    contract: true,
                },
            },
            roles: {
                include: {
                    staff: true,
                },
            },
            productionValues: true,
        },
    });

    const calculation = await calculateReportProductionValue(report, roleStaffMap);

    return { report, calculation, project, projectCreated };
}

const reportInclude = {
    project: {
        include: {
            contract: true,
        },
    },
    roles: {
        include: {
            staff: true,
        },
    },
    productionValues: {
        include: {
            staff: true,
        },
    },
};

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const projectId = searchParams.get('projectId');

    const where = {};
    if (month) {
        const [year, monthIndex] = month.split('-').map(Number);
        where.reportDate = {
            gte: new Date(year, monthIndex - 1, 1),
            lt: new Date(year, monthIndex, 1),
        };
    }
    if (projectId) {
        const pid = Number.parseInt(projectId, 10);
        if (!Number.isNaN(pid)) {
            where.projectId = pid;
        }
    }

    const reports = await prisma.testReport.findMany({
        where,
        include: reportInclude,
        orderBy: { reportDate: 'desc' },
    });

    return NextResponse.json(reports);
}

export async function POST(request) {
    try {
        const body = await request.json();
        const { rawText, projectId: forceProjectId } = body;
        const rows = parseReportText(rawText);

        if (rows.length === 0) {
            return NextResponse.json({ error: '未能解析出有效的报告记录' }, { status: 400 });
        }

        // If projectId is provided (from project detail page), force all rows to use it
        if (forceProjectId) {
            const pid = Number.parseInt(forceProjectId, 10);
            if (!Number.isNaN(pid)) {
                const existingProject = await prisma.project.findUnique({ where: { id: pid } });
                if (existingProject) {
                    for (const row of rows) {
                        row.projectName = existingProject.name;
                        row._forceProjectId = pid;
                    }
                }
            }
        }

        const saved = [];
        const errors = [];
        const newProjects = new Map();
        let pricedCount = 0;

        for (const row of rows) {
            try {
                const { report, calculation, project, projectCreated } = await saveReportRow(row);
                saved.push(report);

                if (projectCreated && project?.id) {
                    newProjects.set(project.id, { id: project.id, name: project.name });
                }

                if (calculation?.status === 'created') {
                    pricedCount += 1;
                }
            } catch (error) {
                errors.push({ ...row, error: true, message: error.message });
            }
        }

        return NextResponse.json({
            saved: saved.length,
            total: rows.length,
            pricedCount,
            newProjects: Array.from(newProjects.values()),
            errors,
        });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
    }
}

export async function DELETE(request) {
    try {
        const { ids } = await request.json();

        if (!Array.isArray(ids) || ids.length === 0) {
            return NextResponse.json({ error: '缺少要删除的记录 ID 列表' }, { status: 400 });
        }

        const normalizedIds = ids
            .map((id) => Number.parseInt(id, 10))
            .filter((id) => !Number.isNaN(id));

        const result = await prisma.testReport.deleteMany({
            where: { id: { in: normalizedIds } },
        });

        return NextResponse.json({ success: true, deletedCount: result.count });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
