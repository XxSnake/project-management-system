import prisma from '@/lib/prisma';
import {
    buildProjectDisplayName,
    buildWorkLogProjectDisplayName,
    findOrCreateProjectByDisplayName,
    findProjectByDisplayName,
} from '@/lib/projectResolver';
import {
    analyzeProjectNameResolution,
    buildProjectMatcherOption,
    findFuzzyProjectCandidates,
} from '@/lib/projectNameMatcher';
import { calculateProductionValue } from '@/lib/productionCalculator';
import { syncDetectionRecordFromWorkLog } from '@/lib/detectionRecordSync';
import { isNonWorkloadWork } from '@/lib/worklogClassification';
import { normalizeAllocationShare, normalizePricingMode } from '@/lib/worklogBilling';
import { expandWorklogRows, parseWPSWorkbook, parseWPSText } from '@/lib/wpsParser';
import { NextResponse } from 'next/server';

function normalizeText(value) {
    return String(value ?? '').trim();
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
    if (calculation?.status === 'non-workload' || isNonWorkloadWork(workLog)) {
        return null;
    }

    const fallbackPayload = (() => {
        const contract = workLog?.project?.contract;
        if (!contract?.id) {
            return null;
        }

        const pricingMode = normalizePricingMode(contract.pricingMode);
        if (pricingMode !== 'mixed') {
            return null;
        }

        if (normalizeAllocationShare(workLog.allocationShare) !== null) {
            return null;
        }

        const contractAmount = Number(contract.lumpSumAmount || contract.areaPricingAmount || 0);
        const quantity = Number.parseFloat(workLog.quantity);
        if (!Number.isFinite(contractAmount) || contractAmount <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
            return null;
        }

        return {
            workLogId: workLog.id,
            contractId: contract.id,
            contractNo: contract.contractNo || '',
            projectId: workLog.project?.id || null,
            projectName: buildWorkLogProjectDisplayName(workLog),
            workDate: workLog.workDate,
            testContent: workLog.testContent,
            quantity,
            unit: workLog.unit || '',
            remarks: workLog.remarks || '',
            pricingMode,
            allocationShare: workLog.allocationShare,
            contractAmount,
            contractArea: null,
        };
    })();

    const payload = calculation?.pendingAllocation || fallbackPayload;
    if (!payload) {
        return null;
    }

    return {
        ...payload,
        projectName: buildWorkLogProjectDisplayName(workLog),
        staffNames: (workLog.staffMembers || [])
            .map((item) => item.staff?.name)
            .filter(Boolean),
    };
}

async function resolveProjectFromAssignment(row, assignment) {
    if (!assignment?.decision) {
        const existingResolution = await findProjectByDisplayName(row.projectName, null, prisma);
        const resolvedProject = await findOrCreateProjectByDisplayName(row.projectName, null, prisma);
        return {
            resolvedProject,
            projectCreated: !existingResolution.project && Boolean(resolvedProject.project?.id),
        };
    }

    if (assignment.decision === 'use-existing') {
        const projectId = Number.parseInt(assignment.projectId, 10);
        if (Number.isNaN(projectId)) {
            throw new Error(`第 ${row.rowIndex} 行缺少有效的目标项目`);
        }

        const project = await prisma.project.findUnique({
            where: { id: projectId },
        });
        if (!project) {
            throw new Error(`第 ${row.rowIndex} 行指定的项目 #${projectId} 不存在`);
        }

        return {
            resolvedProject: {
                project,
                buildingName: null,
            },
            projectCreated: false,
        };
    }

    if (assignment.decision === 'use-existing-as-building') {
        const projectId = Number.parseInt(assignment.projectId, 10);
        const buildingName = normalizeText(assignment.buildingName);
        if (Number.isNaN(projectId)) {
            throw new Error(`第 ${row.rowIndex} 行缺少有效的目标项目`);
        }
        if (!buildingName) {
            throw new Error(`第 ${row.rowIndex} 行缺少单体名称`);
        }

        const project = await prisma.project.findUnique({
            where: { id: projectId },
        });
        if (!project) {
            throw new Error(`第 ${row.rowIndex} 行指定的项目 #${projectId} 不存在`);
        }
        if (!project.buildingMode) {
            throw new Error(`第 ${row.rowIndex} 行指定的项目 #${projectId} 未开启单体建筑模式`);
        }

        return {
            resolvedProject: {
                project,
                buildingName,
            },
            projectCreated: false,
        };
    }

    if (assignment.decision === 'create-new') {
        const targetProjectName = normalizeText(assignment.projectName) || row.projectName;
        const existingResolution = await findProjectByDisplayName(targetProjectName, null, prisma);
        const resolvedProject = await findOrCreateProjectByDisplayName(targetProjectName, null, prisma);
        return {
            resolvedProject,
            projectCreated: !existingResolution.project && Boolean(resolvedProject.project?.id),
        };
    }

    throw new Error(`第 ${row.rowIndex} 行的导入决策无效：${assignment.decision}`);
}

async function saveWorklogRow(row, assignment = null) {
    const { resolvedProject, projectCreated } = await resolveProjectFromAssignment(row, assignment);
    const staffIds = await findOrCreateStaffIds(row.staffNames || []);

    const workLog = await prisma.workLog.create({
        data: {
            workDate: new Date(row.workDate),
            projectId: resolvedProject.project.id,
            buildingName: resolvedProject.buildingName,
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
    await syncDetectionRecordFromWorkLog(workLog.id);
    return { workLog, calculation, project: resolvedProject.project, projectCreated };
}

async function resolveImportRowsFromFormData(formData) {
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

async function resolveImportRowsFromJson(body) {
    if (Array.isArray(body?.rows)) {
        return {
            source: body.source || 'preview',
            fileName: body.fileName || null,
            sheetName: body.sheetName || null,
            originalRows: typeof body.originalRows === 'number' ? body.originalRows : body.rows.length,
            rows: body.rows,
        };
    }

    const rawText = String(body?.rawText || '');
    const parsedRows = parseWPSText(rawText);
    const expandedRows = await expandWorklogRows(parsedRows);

    return {
        source: 'text',
        originalRows: parsedRows.length,
        rows: expandedRows,
    };
}

async function resolveImportRequest(request) {
    const url = new URL(request.url);
    const queryMode = url.searchParams.get('mode');
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
        const formData = await request.formData();
        return {
            mode: queryMode || String(formData.get('mode') || '').trim() || null,
            rowAssignments: [],
            imported: await resolveImportRowsFromFormData(formData),
        };
    }

    const body = await request.json().catch(() => ({}));
    return {
        mode: queryMode || body.mode || null,
        rowAssignments: Array.isArray(body.rowAssignments) ? body.rowAssignments : [],
        imported: await resolveImportRowsFromJson(body),
    };
}

async function buildPreviewResponse(imported) {
    const projects = await prisma.project.findMany({
        select: {
            id: true,
            name: true,
            phase: true,
            buildingMode: true,
            contractId: true,
        },
        orderBy: [
            { name: 'asc' },
            { id: 'asc' },
        ],
    });

    const projectOptions = projects.map(buildProjectMatcherOption);
    const previewRows = [];
    const statusCounts = {
        exact: 0,
        fuzzy: 0,
        none: 0,
    };
    const errors = [];

    for (const row of imported.rows) {
        if (row.error) {
            errors.push(row);
            continue;
        }

        const exactResolution = await findProjectByDisplayName(row.projectName, null, prisma);
        if (exactResolution.project) {
            const fuzzyCandidates = await findFuzzyProjectCandidates(row.projectName, {
                projects,
                limit: 5,
                threshold: 0.75,
            });
            const competingCandidates = fuzzyCandidates.filter((candidate) => candidate.project.id !== exactResolution.project.id);

            if (competingCandidates.length > 0) {
                previewRows.push({
                    ...row,
                    resolution: {
                        status: 'fuzzy',
                        exactProjectId: exactResolution.project.id,
                        candidates: [
                            {
                                projectId: exactResolution.project.id,
                                projectDisplayName: buildProjectDisplayName(exactResolution.project),
                                score: 1,
                                matchedAs: exactResolution.buildingName ? 'building' : 'project',
                                buildingName: exactResolution.buildingName || null,
                            },
                            ...competingCandidates.map((candidate) => ({
                                projectId: candidate.project.id,
                                projectDisplayName: buildProjectDisplayName(candidate.project),
                                score: candidate.score,
                                matchedAs: candidate.matchedAs,
                                buildingName: candidate.buildingName || null,
                            })),
                        ].slice(0, 5),
                    },
                });
                statusCounts.fuzzy += 1;
                continue;
            }

            previewRows.push({
                ...row,
                resolution: {
                    status: 'exact',
                    exactProjectId: exactResolution.project.id,
                    exactProjectDisplayName: buildProjectDisplayName(exactResolution.project),
                    matchedAs: exactResolution.buildingName ? 'building' : 'project',
                    buildingName: exactResolution.buildingName || null,
                    candidates: [],
                },
            });
            statusCounts.exact += 1;
            continue;
        }

        const analysis = await analyzeProjectNameResolution(row.projectName, {
            projects,
            limit: 5,
            threshold: 0.75,
        });

        if (analysis.status === 'fuzzy') {
            previewRows.push({
                ...row,
                resolution: {
                    status: 'fuzzy',
                    exactProjectId: null,
                    candidates: analysis.candidates.map((candidate) => ({
                        projectId: candidate.project.id,
                        projectDisplayName: buildProjectDisplayName(candidate.project),
                        score: candidate.score,
                        matchedAs: candidate.matchedAs,
                        buildingName: candidate.buildingName || null,
                    })),
                },
            });
            statusCounts.fuzzy += 1;
            continue;
        }

        previewRows.push({
            ...row,
            resolution: {
                status: 'none',
                exactProjectId: null,
                candidates: [],
            },
        });
        statusCounts.none += 1;
    }

    const classifiedPreviewRows = previewRows.map((row) => ({
        ...row,
        countsAsWorkload: !isNonWorkloadWork(row),
    }));
    const projectStatusPriority = {
        exact: 1,
        fuzzy: 2,
        none: 3,
    };
    const projectStatuses = new Map();

    classifiedPreviewRows.forEach((row) => {
        const projectName = normalizeText(row.projectName);
        if (!projectName) {
            return;
        }

        const status = row.resolution?.status || 'none';
        const previous = projectStatuses.get(projectName);
        if (!previous || projectStatusPriority[status] > projectStatusPriority[previous]) {
            projectStatuses.set(projectName, status);
        }
    });

    const projectStatusCounts = {
        exact: 0,
        fuzzy: 0,
        none: 0,
    };
    projectStatuses.forEach((status) => {
        projectStatusCounts[status] += 1;
    });

    return NextResponse.json({
        mode: 'preview',
        total: imported.rows.length,
        originalRows: imported.originalRows,
        expandedItems: imported.rows.filter((row) => !row.error).length,
        source: imported.source,
        fileName: imported.fileName || null,
        sheetName: imported.sheetName || null,
        statusCounts,
        projectStatusCounts,
        nonWorkloadCount: classifiedPreviewRows.filter((row) => !row.countsAsWorkload).length,
        rows: classifiedPreviewRows,
        projectOptions,
        errors,
    });
}

async function commitImportRows(imported, rowAssignments = []) {
    const saved = [];
    const errors = [];
    const pendingAllocations = [];
    const newProjects = new Map();
    let pricedCount = 0;
    let workloadOnlyCount = 0;
    let nonWorkloadCount = 0;

    const assignmentMap = new Map(
        rowAssignments.map((item) => [Number.parseInt(item?.rowIndex, 10), item]),
    );

    for (const row of imported.rows) {
        if (row.error) {
            errors.push(row);
            continue;
        }

        try {
            const assignment = assignmentMap.get(Number(row.rowIndex));
            const { workLog, calculation, project, projectCreated } = await saveWorklogRow(row, assignment);
            saved.push(workLog);

            if (projectCreated && project?.id) {
                newProjects.set(project.id, {
                    id: project.id,
                    name: buildProjectDisplayName(project),
                });
            }

            if (calculation?.status === 'created') {
                pricedCount += 1;
            } else if (calculation?.status === 'non-workload') {
                nonWorkloadCount += 1;
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
        nonWorkloadCount,
        newProjects: Array.from(newProjects.values()),
        pendingAllocations,
        errors,
    });
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
    return NextResponse.json(logs.map((log) => ({
        ...log,
        countsAsWorkload: !isNonWorkloadWork(log),
    })));
}

export async function POST(request) {
    try {
        const { mode, rowAssignments, imported } = await resolveImportRequest(request);

        if (mode === 'preview') {
            return buildPreviewResponse(imported);
        }

        return commitImportRows(imported, rowAssignments);
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
