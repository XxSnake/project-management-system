import prisma from '@/lib/prisma';
import { buildProjectDisplayName } from '@/lib/projectDisplayName';
import {
    evaluateProjectFuzzyMatch,
    serializeFuzzyMatchCandidateIds,
} from '@/lib/projectFuzzyMatchLLM';

const queuedProjectIds = new Set();

function normalizeProjectId(value) {
    const projectId = Number.parseInt(value, 10);
    return Number.isNaN(projectId) ? null : projectId;
}

async function loadProject(projectId, prismaClient) {
    return prismaClient.project.findUnique({
        where: { id: projectId },
        select: {
            id: true,
            name: true,
            phase: true,
            buildingMode: true,
            contractId: true,
            fuzzyMatchStatus: true,
            fuzzyMatchCandidateIds: true,
            fuzzyMatchedAt: true,
        },
    });
}

function buildProjectSnapshotWhere(project) {
    return {
        id: project.id,
        name: project.name,
        phase: project.phase,
        buildingMode: project.buildingMode,
        contractId: project.contractId,
        fuzzyMatchStatus: project.fuzzyMatchStatus,
        fuzzyMatchCandidateIds: project.fuzzyMatchCandidateIds,
        fuzzyMatchedAt: project.fuzzyMatchedAt,
    };
}

async function updateProjectFuzzyState(prismaClient, project, data) {
    const result = await prismaClient.project.updateMany({
        where: buildProjectSnapshotWhere(project),
        data,
    });

    return result.count > 0;
}

export async function runProjectFuzzyMatch(projectId, options = {}) {
    const normalizedProjectId = normalizeProjectId(projectId);
    if (!normalizedProjectId) {
        throw new Error('无效的项目 ID');
    }

    const prismaClient = options.prismaClient || prisma;
    const project = await loadProject(normalizedProjectId, prismaClient);
    if (!project) {
        return {
            projectId: normalizedProjectId,
            status: 'missing',
        };
    }

    if (!buildProjectDisplayName(project)) {
        const stateUpdated = await updateProjectFuzzyState(
            prismaClient,
            project,
            {
                fuzzyMatchStatus: 'error',
                fuzzyMatchCandidateIds: null,
                fuzzyMatchedAt: new Date(),
            },
        );

        return {
            projectId: normalizedProjectId,
            status: 'error',
            error: 'empty-project-name',
            stateUpdated,
        };
    }

    try {
        const evaluation = await evaluateProjectFuzzyMatch(project, {
            prismaClient,
            limit: options.limit,
            threshold: options.threshold,
        });
        const matchedAt = new Date();

        if (evaluation.status === 'review') {
            const stateUpdated = await updateProjectFuzzyState(
                prismaClient,
                project,
                {
                    fuzzyMatchStatus: 'pending-review',
                    fuzzyMatchCandidateIds: serializeFuzzyMatchCandidateIds(evaluation.candidateIds),
                    fuzzyMatchedAt: matchedAt,
                },
            );

            return {
                projectId: normalizedProjectId,
                status: 'pending-review',
                candidateIds: evaluation.candidateIds,
                matchedAt,
                reason: evaluation.reason || '',
                stateUpdated,
            };
        }

        const stateUpdated = await updateProjectFuzzyState(
            prismaClient,
            project,
            {
                fuzzyMatchStatus: null,
                fuzzyMatchCandidateIds: null,
                fuzzyMatchedAt: matchedAt,
            },
        );

        return {
            projectId: normalizedProjectId,
            status: 'distinct',
            candidateIds: [],
            matchedAt,
            reason: evaluation.reason || '',
            stateUpdated,
        };
    } catch (error) {
        const stateUpdated = await updateProjectFuzzyState(
            prismaClient,
            project,
            {
                fuzzyMatchStatus: 'error',
                fuzzyMatchCandidateIds: null,
                fuzzyMatchedAt: new Date(),
            },
        );

        return {
            projectId: normalizedProjectId,
            status: 'error',
            error: error.message,
            stateUpdated,
        };
    }
}

export async function runProjectFuzzyMatchBatch(projectIds, options = {}) {
    const normalizedProjectIds = Array.from(
        new Set(
            (Array.isArray(projectIds) ? projectIds : [projectIds])
                .map(normalizeProjectId)
                .filter((projectId) => Number.isInteger(projectId)),
        ),
    );

    const results = [];
    for (const projectId of normalizedProjectIds) {
        results.push(await runProjectFuzzyMatch(projectId, options));
    }

    return results;
}

export function scheduleProjectFuzzyMatch(projectId, options = {}) {
    const normalizedProjectId = normalizeProjectId(projectId);
    if (!normalizedProjectId || queuedProjectIds.has(normalizedProjectId)) {
        return false;
    }

    queuedProjectIds.add(normalizedProjectId);
    const delayMs = Math.max(0, Number(options.delayMs) || 0);

    setTimeout(() => {
        void runProjectFuzzyMatch(normalizedProjectId, options)
            .catch((error) => {
                console.error('[Project Fuzzy Match] async run failed:', error);
            })
            .finally(() => {
                queuedProjectIds.delete(normalizedProjectId);
            });
    }, delayMs);

    return true;
}

export function scheduleProjectFuzzyMatchBatch(projectIds, options = {}) {
    let scheduledCount = 0;

    for (const projectId of (Array.isArray(projectIds) ? projectIds : [projectIds])) {
        if (scheduleProjectFuzzyMatch(projectId, options)) {
            scheduledCount += 1;
        }
    }

    return scheduledCount;
}
