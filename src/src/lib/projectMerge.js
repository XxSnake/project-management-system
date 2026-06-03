import prisma from '@/lib/prisma';
import {
    isLikelyCorruptedProjectName,
    resolveProjectNameRepairCandidate,
} from '@/lib/projectNameRepair';

function normalizeProjectId(value) {
    const projectId = Number.parseInt(value, 10);
    return Number.isNaN(projectId) ? null : projectId;
}

export async function mergeProjects({ targetId, sourceIds, prismaClient = prisma }) {
    const targetProjectId = normalizeProjectId(targetId);
    const sourceProjectIds = Array.from(
        new Set(
            (Array.isArray(sourceIds) ? sourceIds : [])
                .map(normalizeProjectId)
                .filter((projectId) => Number.isInteger(projectId) && projectId !== targetProjectId),
        ),
    );

    if (!targetProjectId || sourceProjectIds.length === 0) {
        throw new Error('请选择目标项目和要合并的来源项目');
    }

    const targetProject = await prismaClient.project.findUnique({
        where: { id: targetProjectId },
        select: {
            id: true,
            name: true,
            contractId: true,
        },
    });

    if (!targetProject) {
        throw new Error('目标项目不存在');
    }

    return prismaClient.$transaction(async (tx) => {
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
                    data: {
                        name: repairedName,
                        fuzzyMatchStatus: null,
                        fuzzyMatchCandidateIds: null,
                        fuzzyMatchedAt: new Date(),
                    },
                    select: { name: true },
                });
                targetProjectName = updatedTargetProject.name;
            }
        } else {
            await tx.project.update({
                where: { id: targetProjectId },
                data: {
                    fuzzyMatchStatus: null,
                    fuzzyMatchCandidateIds: null,
                    fuzzyMatchedAt: new Date(),
                },
                select: { id: true },
            });
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
                    data: {
                        contractId: sourceWithContract.contractId,
                        noContractExpected: false,
                    },
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
            targetProjectId,
            targetProjectName,
            movedWorkLogs: workLogs.count,
            movedDetectionRecords: detectionRecords.count,
            movedTestReports: testReports.count,
            deletedProjects: deleted.count,
        };
    });
}
