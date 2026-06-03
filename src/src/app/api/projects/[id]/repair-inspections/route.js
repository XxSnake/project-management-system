import prisma from '@/lib/prisma';
import { syncDetectionRecordFromWorkLog } from '@/lib/detectionRecordSync';
import { NextResponse } from 'next/server';

export async function POST(_request, { params }) {
    try {
        const { id } = await params;
        const projectId = Number.parseInt(id, 10);
        if (Number.isNaN(projectId)) {
            return NextResponse.json({ error: '无效项目 ID' }, { status: 400 });
        }

        const project = await prisma.project.findUnique({
            where: { id: projectId },
            select: { id: true },
        });

        if (!project) {
            return NextResponse.json({ error: '项目不存在' }, { status: 404 });
        }

        const workLogs = await prisma.workLog.findMany({
            where: { projectId },
            orderBy: [
                { workDate: 'asc' },
                { id: 'asc' },
            ],
            select: {
                id: true,
                detectionRecord: {
                    select: { id: true },
                },
            },
        });

        let repairedCount = 0;
        let skippedCount = 0;

        for (const log of workLogs) {
            if (log.detectionRecord?.id) {
                skippedCount += 1;
                continue;
            }

            await syncDetectionRecordFromWorkLog(log.id);
            repairedCount += 1;
        }

        return NextResponse.json({
            success: true,
            repairedCount,
            skippedCount,
        });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
