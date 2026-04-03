import prisma from '@/lib/prisma';
import { calculateProductionValue } from '@/lib/productionCalculator';
import { expandWorklogRows, parseWPSWorkbook, parseWPSText } from '@/lib/wpsParser';

import { NextResponse } from 'next/server';

async function findOrCreateProject(projectName) {
    let project = await prisma.project.findFirst({ where: { name: projectName } });
    let created = false;
    if (!project) {
        project = await prisma.project.create({ data: { name: projectName } });
        created = true;
    }
    return { project, created };
}

async function findOrCreateStaffIds(staffNames) {
    const staffIds = [];

    for (const name of staffNames) {
        let staff = await prisma.staff.findFirst({ where: { name } });
        if (!staff) {
            staff = await prisma.staff.create({ data: { name } });
        }
        staffIds.push(staff.id);
    }

    return staffIds;
}

function buildPendingAllocationPayload(workLog, calculation) {
    if (!calculation?.pendingAllocation) {
        return null;
    }

    return {
        ...calculation.pendingAllocation,
        staffNames: (workLog.staffMembers || [])
            .map((item) => item.staff?.name)
            .filter(Boolean),
    };
}

async function saveWorklogRow(row) {
    const { project, created: projectCreated } = await findOrCreateProject(row.projectName);
    const staffIds = await findOrCreateStaffIds(row.staffNames || []);

    const workLog = await prisma.workLog.create({
        data: {
            workDate: new Date(row.workDate),
            projectId: project.id,
            testContent: row.testContent,
            quantity: Number.parseFloat(row.quantity) || 0,
            unit: row.unit || null,
            rawText: row.raw || null,
            remarks: row.remarks || null,
            staffMembers: {
                create: staffIds.map((staffId) => ({ staffId })),
            },
        },
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

    const calculation = await calculateProductionValue(workLog, staffIds);
    return { workLog, calculation, project, projectCreated };
}

async function resolveImportRows(request) {
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
        const formData = await request.formData();
        const file = formData.get('file');
        if (!file) {
            throw new Error('未上传工作日志文件');
        }

        const fileName = file.name || 'worklog.xlsx';
        if (!/\.(xlsx|xls)$/i.test(fileName)) {
            throw new Error('仅支持导入 .xlsx 或 .xls 文件');
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const workbook = parseWPSWorkbook(buffer, fileName);
        const expandedRows = await expandWorklogRows(workbook.rows);

        return {
            source: 'file',
            fileName,
            sheetName: workbook.sheetName,
            originalRows: workbook.rows.length,
            rows: expandedRows,
        };
    }

    const { rawText } = await request.json();
    const parsedRows = parseWPSText(rawText);
    const expandedRows = await expandWorklogRows(parsedRows);

    return {
        source: 'text',
        originalRows: parsedRows.length,
        rows: expandedRows,
    };
}

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');

    const where = {};
    if (month) {
        const [year, monthIndex] = month.split('-').map(Number);
        where.workDate = {
            gte: new Date(year, monthIndex - 1, 1),
            lt: new Date(year, monthIndex, 1),
        };
    }

    const logs = await prisma.workLog.findMany({
        where,
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
        orderBy: { workDate: 'desc' },
    });
    return NextResponse.json(logs);
}

export async function POST(request) {
    try {
        const imported = await resolveImportRows(request);
        const saved = [];
        const errors = [];
        const pendingAllocations = [];
        const newProjects = new Map();
        let pricedCount = 0;
        let workloadOnlyCount = 0;

        for (const row of imported.rows) {
            if (row.error) {
                errors.push(row);
                continue;
            }

            try {
                const { workLog, calculation, project, projectCreated } = await saveWorklogRow(row);
                saved.push(workLog);

                if (projectCreated && project?.id) {
                    newProjects.set(project.id, {
                        id: project.id,
                        name: project.name,
                    });
                }

                if (calculation?.status === 'created') {
                    pricedCount += 1;
                } else {
                    workloadOnlyCount += 1;
                }

                const pending = buildPendingAllocationPayload(workLog, calculation);
                if (pending) {
                    pendingAllocations.push(pending);
                }
            } catch (error) {
                errors.push({ ...row, error: true, message: error.message });
            }
        }

        return NextResponse.json({
            saved: saved.length,
            total: imported.rows.length,
            originalRows: imported.originalRows,
            expandedItems: imported.rows.filter((row) => !row.error).length,
            source: imported.source,
            fileName: imported.fileName || null,
            sheetName: imported.sheetName || null,
            pricedCount,
            workloadOnlyCount,
            newProjects: Array.from(newProjects.values()),
            pendingAllocations,
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

        if (normalizedIds.length === 0) {
            return NextResponse.json({ error: '无效的记录 ID 列表' }, { status: 400 });
        }

        const result = await prisma.workLog.deleteMany({
            where: {
                id: { in: normalizedIds },
            },
        });

        return NextResponse.json({ success: true, deletedCount: result.count });
    } catch (error) {
        console.error('Batch delete worklog error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
