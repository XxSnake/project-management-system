import prisma from '@/lib/prisma';
import {
    computeDetectionDrift,
    syncDetectionRecordFromWorkLog,
} from '@/lib/detectionRecordSync';
import { normalizeProjectName } from '@/lib/projectDisplayName';
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
        current.workLogCount += 1;
        current.totalValue += sumProductionValues(log.productionValues);
        summaries.set(buildingName, current);
    }

    return Array.from(summaries.values()).sort((left, right) => left.buildingName.localeCompare(right.buildingName, 'zh-CN'));
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

export async function GET(_request, { params }) {
    const { id } = await params;
    const projectId = Number.parseInt(id, 10);
    if (Number.isNaN(projectId)) {
        return NextResponse.json({ error: '无效项目 ID' }, { status: 400 });
    }

    const missingWorkLogs = await prisma.workLog.findMany({
        where: {
            projectId,
            detectionRecord: null,
        },
        orderBy: [
            { workDate: 'asc' },
            { id: 'asc' },
        ],
        select: {
            id: true,
        },
    });

    for (const log of missingWorkLogs) {
        await syncDetectionRecordFromWorkLog(log.id);
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

    const siblingProjects = await getSiblingProjects(project.contractId);

    return NextResponse.json({
        ...project,
        buildingSummaries: buildBuildingSummaries(project.workLogs),
        detectionRecords,
        siblingProjects,
    });
}
