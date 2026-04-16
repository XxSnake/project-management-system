import prisma from '@/lib/prisma';
import {
    isLikelyCorruptedProjectName,
    resolveProjectNameRepairCandidate,
} from '@/lib/projectNameRepair';
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

        const targetProject = await prisma.project.findUnique({
            where: { id: targetProjectId },
            select: {
                id: true,
                name: true,
                contractId: true,
            },
        });

        if (!targetProject) {
            return NextResponse.json({ error: '目标项目不存在' }, { status: 404 });
        }

        const result = await prisma.$transaction(async (tx) => {
            let targetProjectName = targetProject.name;

            if (isLikelyCorruptedProjectName(targetProject.name)) {
                const repairedName = await resolveProjectNameRepairCandidate(tx, {
                    projectId: targetProjectId,
                    preferredProjectIds: sourceProjectIds,
                    contractId: targetProject.contractId,
                });

                if (repairedName && repairedName !== targetProject.name) {
                    const updatedTargetProject = await tx.project.update({
                        where: { id: targetProjectId },
                        data: { name: repairedName },
                        select: { name: true },
                    });
                    targetProjectName = updatedTargetProject.name;
                }
            }

            const workLogs = await tx.workLog.updateMany({
                where: { projectId: { in: sourceProjectIds } },
                data: { projectId: targetProjectId },
            });

            const detectionRecords = await tx.projectDetectionRecord.updateMany({
                where: { projectId: { in: sourceProjectIds } },
                data: { projectId: targetProjectId },
            });

            const testReports = await tx.testReport.updateMany({
                where: { projectId: { in: sourceProjectIds } },
                data: { projectId: targetProjectId },
            });

            if (!targetProject.contractId) {
                const sourceWithContract = await tx.project.findFirst({
                    where: {
                        id: { in: sourceProjectIds },
                        contractId: { not: null },
                    },
                    select: { contractId: true },
                });

                if (sourceWithContract?.contractId) {
                    await tx.project.update({
                        where: { id: targetProjectId },
                        data: { contractId: sourceWithContract.contractId },
                    });
                }
            }

            await tx.project.updateMany({
                where: { id: { in: sourceProjectIds } },
                data: { contractId: null },
            });

            const deleted = await tx.project.deleteMany({
                where: { id: { in: sourceProjectIds } },
            });

            return {
                targetProjectName,
                movedWorkLogs: workLogs.count,
                movedDetectionRecords: detectionRecords.count,
                movedTestReports: testReports.count,
                deletedProjects: deleted.count,
            };
        });

        return NextResponse.json({
            success: true,
            targetProject: result.targetProjectName,
            ...result,
        });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
