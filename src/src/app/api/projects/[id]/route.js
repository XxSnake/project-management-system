import prisma from '@/lib/prisma';
import {
    computeDetectionDrift,
} from '@/lib/detectionRecordSync';
import { normalizeProjectName } from '@/lib/projectDisplayName';
import { isNonWorkloadWork } from '@/lib/worklogClassification';
import { NextResponse } from 'next/server';

function sumProductionValues(items = []) {
    return items.reduce((sum, item) => sum + Number(item?.value || 0), 0);
}

function buildBuildingSummaries(workLogs = []) {
    const summaries = new Map();

    for (const log of workLogs) {
        const buildingName = normalizeProjectName(log.buildingName);
        if (!buildingName) {
            continue;
        }

        const current = summaries.get(buildingName) || {
            buildingName,
            workLogCount: 0,
            totalValue: 0,
        };
        const countsAsWorkload = !isNonWorkloadWork(log);
        current.workLogCount += countsAsWorkload ? 1 : 0;
        current.totalValue += countsAsWorkload ? sumProductionValues(log.productionValues) : 0;
        summaries.set(buildingName, current);
    }

    return Array.from(summaries.values()).sort((left, right) => left.buildingName.localeCompare(right.buildingName, 'zh-CN'));
}

function normalizeNoContractExpected(value, fallback = false) {
    if (value === undefined) {
        return fallback;
    }

    return value === true || value === 'true' || value === 1 || value === '1';
}

async function getSiblingProjects(contractId) {
    if (!contractId) {
        return [];
    }

    return prisma.project.findMany({
        where: { contractId },
        orderBy: { id: 'asc' },
        select: {
            id: true,
            name: true,
            status: true,
            phase: true,
            buildingMode: true,
            _count: {
                select: {
                    workLogs: true,
                },
            },
            workLogs: {
                orderBy: [
                    { workDate: 'desc' },
                    { id: 'desc' },
                ],
                select: {
                    id: true,
                    workDate: true,
                    testContent: true,
                    quantity: true,
                    unit: true,
                    buildingName: true,
                    remarks: true,
                    staffMembers: {
                        select: {
                            staff: {
                                select: {
                                    name: true,
                                },
                            },
                        },
                    },
                },
            },
        },
    });
}

async function getMissingDetectionRecordCount(projectId) {
    return prisma.workLog.count({
        where: {
            projectId,
            detectionRecord: null,
        },
    });
}

export async function GET(_request, { params }) {
    const { id } = await params;
    const projectId = Number.parseInt(id, 10);
    if (Number.isNaN(projectId)) {
        return NextResponse.json({ error: '无效项目 ID' }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
            contract: {
                include: {
                    priceItems: true,
                },
            },
            workLogs: {
                orderBy: [
                    { workDate: 'desc' },
                    { id: 'desc' },
                ],
                include: {
                    staffMembers: {
                        include: {
                            staff: true,
                        },
                    },
                    detectionRecord: {
                        select: {
                            id: true,
                            sequence: true,
                        },
                    },
                    productionValues: true,
                },
            },
            detectionRecords: {
                orderBy: { sequence: 'asc' },
                include: {
                    workLog: {
                        include: {
                            staffMembers: { include: { staff: true } },
                        },
                    },
                },
            },
        },
    });

    if (!project) {
        return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    const detectionRecords = project.detectionRecords.map((record) => ({
        ...record,
        isEdited: computeDetectionDrift(record),
    }));

    const [siblingProjects, missingDetectionRecordCount] = await Promise.all([
        getSiblingProjects(project.contractId),
        getMissingDetectionRecordCount(projectId),
    ]);

    return NextResponse.json({
        ...project,
        buildingSummaries: buildBuildingSummaries(project.workLogs),
        detectionRecords,
        siblingProjects,
        repairNeeded: missingDetectionRecordCount > 0,
        missingDetectionRecordCount,
    });
}

export async function PUT(request, { params }) {
    const { id } = await params;
    const projectId = Number.parseInt(id, 10);
    if (Number.isNaN(projectId)) {
        return NextResponse.json({ error: '无效项目 ID' }, { status: 400 });
    }

    const body = await request.json();
    if (!Object.prototype.hasOwnProperty.call(body || {}, 'noContractExpected')) {
        return NextResponse.json({ error: '缺少 noContractExpected 字段' }, { status: 400 });
    }

    const existingProject = await prisma.project.findUnique({
        where: { id: projectId },
        select: {
            id: true,
            contractId: true,
            noContractExpected: true,
        },
    });

    if (!existingProject) {
        return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    const nextNoContractExpected = normalizeNoContractExpected(
        body.noContractExpected,
        Boolean(existingProject.noContractExpected),
    );

    if (existingProject.contractId && nextNoContractExpected) {
        return NextResponse.json({ error: '已关联合同的项目不能标记为无需合同' }, { status: 400 });
    }

    const project = await prisma.project.update({
        where: { id: projectId },
        data: {
            noContractExpected: nextNoContractExpected,
        },
        include: {
            contract: true,
        },
    });

    return NextResponse.json(project);
}
