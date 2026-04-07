import prisma from '@/lib/prisma';
import { computeDetectionDrift } from '@/lib/detectionRecordSync';
import { NextResponse } from 'next/server';

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

    return NextResponse.json({
        ...project,
        detectionRecords,
    });
}
