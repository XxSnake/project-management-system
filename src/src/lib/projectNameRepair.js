export function isLikelyCorruptedProjectName(name) {
    const normalized = String(name ?? '').trim().replace(/\s+/gu, '');
    if (!normalized) {
        return false;
    }

    return /^[?\uFF1F\uFFFD]+$/u.test(normalized);
}

export function extractProjectNameFromRawText(rawText) {
    const firstLine = String(rawText ?? '')
        .split(/\r?\n/u)
        .map((item) => item.trim())
        .find(Boolean);

    if (!firstLine) {
        return null;
    }

    const parts = firstLine
        .split('\t')
        .map((item) => item.trim())
        .filter(Boolean);

    if (parts.length < 2) {
        return null;
    }

    const candidate = parts[1];
    return candidate && !isLikelyCorruptedProjectName(candidate) ? candidate : null;
}

export async function resolveProjectNameRepairCandidate(
    prismaClient,
    {
        projectId = null,
        preferredProjectIds = [],
        contractId = null,
    } = {},
) {
    const preferredIds = Array.from(new Set(
        preferredProjectIds
            .map((item) => Number.parseInt(item, 10))
            .filter((item) => Number.isFinite(item)),
    ));

    for (const preferredId of preferredIds) {
        const project = await prismaClient.project.findUnique({
            where: { id: preferredId },
            select: {
                name: true,
                contractId: true,
            },
        });

        if (project?.name && !isLikelyCorruptedProjectName(project.name)) {
            return project.name.trim();
        }

        if (!contractId && project?.contractId) {
            contractId = project.contractId;
        }
    }

    if (projectId) {
        const project = await prismaClient.project.findUnique({
            where: { id: projectId },
            select: {
                name: true,
                contractId: true,
            },
        });

        if (project?.name && !isLikelyCorruptedProjectName(project.name)) {
            return project.name.trim();
        }

        if (!contractId && project?.contractId) {
            contractId = project.contractId;
        }
    }

    if (contractId) {
        const siblingProjects = await prismaClient.project.findMany({
            where: { contractId },
            orderBy: { createdAt: 'desc' },
            select: {
                name: true,
            },
            take: 20,
        });

        const siblingCandidate = siblingProjects
            .map((item) => String(item.name ?? '').trim())
            .find((item) => item && !isLikelyCorruptedProjectName(item));

        if (siblingCandidate) {
            return siblingCandidate;
        }
    }

    if (projectId) {
        const logs = await prismaClient.workLog.findMany({
            where: {
                projectId,
                rawText: { not: null },
            },
            orderBy: [
                { workDate: 'desc' },
                { id: 'desc' },
            ],
            select: {
                rawText: true,
            },
            take: 20,
        });

        for (const log of logs) {
            const extractedName = extractProjectNameFromRawText(log.rawText);
            if (extractedName) {
                return extractedName;
            }
        }
    }

    return null;
}
