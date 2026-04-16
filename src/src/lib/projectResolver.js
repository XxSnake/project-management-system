import prisma from '@/lib/prisma';
import {
    buildProjectDisplayName,
    normalizeProjectName,
    splitProjectNameAndPhase,
} from '@/lib/projectDisplayName';

export {
    buildProjectDisplayName,
    buildWorkLogProjectDisplayName,
    splitProjectNameAndPhase,
} from '@/lib/projectDisplayName';

function buildResolvedProject(project, buildingName = null) {
    return {
        project: project || null,
        buildingName: normalizeProjectName(buildingName) || null,
    };
}

export async function findProjectByDisplayName(
    projectName,
    fallbackProjectId = null,
    prismaClient = prisma,
) {
    const normalized = normalizeProjectName(projectName);
    const fallbackProject = fallbackProjectId
        ? await prismaClient.project.findUnique({ where: { id: fallbackProjectId } })
        : null;

    if (!normalized) {
        return buildResolvedProject(fallbackProject);
    }

    const parsed = splitProjectNameAndPhase(normalized);
    if (fallbackProject) {
        if (normalized === buildProjectDisplayName(fallbackProject)) {
            return buildResolvedProject(fallbackProject);
        }

        if (
            fallbackProject.buildingMode
            && !normalizeProjectName(fallbackProject.phase)
            && parsed.phase
            && parsed.name === normalizeProjectName(fallbackProject.name)
        ) {
            return buildResolvedProject(fallbackProject, parsed.phase);
        }
    }

    if (parsed.phase) {
        const phasedProject = await prismaClient.project.findFirst({
            where: {
                name: parsed.name,
                phase: parsed.phase,
            },
        });
        if (phasedProject) {
            return buildResolvedProject(phasedProject);
        }

        const buildingModeProject = await prismaClient.project.findFirst({
            where: {
                name: parsed.name,
                phase: null,
                buildingMode: true,
            },
        });
        if (buildingModeProject) {
            return buildResolvedProject(buildingModeProject, parsed.phase);
        }
    }

    const exactRootProject = await prismaClient.project.findFirst({
        where: {
            name: normalized,
            phase: null,
        },
    });
    if (exactRootProject) {
        return buildResolvedProject(exactRootProject);
    }

    const exactProject = await prismaClient.project.findFirst({
        where: { name: normalized },
    });
    if (exactProject) {
        return buildResolvedProject(exactProject);
    }

    return buildResolvedProject(null);
}

export async function findOrCreateProjectByDisplayName(
    projectName,
    fallbackProjectId = null,
    prismaClient = prisma,
) {
    const existingProject = await findProjectByDisplayName(projectName, fallbackProjectId, prismaClient);
    if (existingProject.project) {
        return existingProject;
    }

    const parsed = splitProjectNameAndPhase(projectName);
    const project = await prismaClient.project.create({
        data: {
            name: parsed.name,
            phase: parsed.phase,
        },
    });

    return buildResolvedProject(project);
}
