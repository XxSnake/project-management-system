import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function POST(request) {
    try {
        const { targetId, sourceIds } = await request.json();

        if (!targetId || !Array.isArray(sourceIds) || sourceIds.length === 0) {
            return NextResponse.json({ error: '请选择目标项目和要合并的来源项目' }, { status: 400 });
        }

        const targetProjectId = Number.parseInt(targetId, 10);
        const sourceProjectIds = sourceIds
            .map((id) => Number.parseInt(id, 10))
            .filter((id) => !Number.isNaN(id) && id !== targetProjectId);

        if (sourceProjectIds.length === 0) {
            return NextResponse.json({ error: '没有需要合并的来源项目' }, { status: 400 });
        }

        // Verify target project exists
        const targetProject = await prisma.project.findUnique({ where: { id: targetProjectId } });
        if (!targetProject) {
            return NextResponse.json({ error: '目标项目不存在' }, { status: 404 });
        }

        const result = await prisma.$transaction(async (tx) => {
            // Move work logs
            const workLogs = await tx.workLog.updateMany({
                where: { projectId: { in: sourceProjectIds } },
                data: { projectId: targetProjectId },
            });

            // Move detection records
            const detectionRecords = await tx.projectDetectionRecord.updateMany({
                where: { projectId: { in: sourceProjectIds } },
                data: { projectId: targetProjectId },
            });

            // Move test reports
            const testReports = await tx.testReport.updateMany({
                where: { projectId: { in: sourceProjectIds } },
                data: { projectId: targetProjectId },
            });

            // If target has no contract but a source does, inherit the first one found
            if (!targetProject.contractId) {
                const sourceWithContract = await tx.project.findFirst({
                    where: { id: { in: sourceProjectIds }, contractId: { not: null } },
                    select: { contractId: true },
                });
                if (sourceWithContract?.contractId) {
                    await tx.project.update({
                        where: { id: targetProjectId },
                        data: { contractId: sourceWithContract.contractId },
                    });
                }
            }

            // Unlink contracts from source projects before deleting
            await tx.project.updateMany({
                where: { id: { in: sourceProjectIds } },
                data: { contractId: null },
            });

            // Delete source projects
            const deleted = await tx.project.deleteMany({
                where: { id: { in: sourceProjectIds } },
            });

            return {
                movedWorkLogs: workLogs.count,
                movedDetectionRecords: detectionRecords.count,
                movedTestReports: testReports.count,
                deletedProjects: deleted.count,
            };
        });

        return NextResponse.json({
            success: true,
            targetProject: targetProject.name,
            ...result,
        });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
