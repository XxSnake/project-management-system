export function normalizeProjectName(value) {
    return String(value ?? '').trim();
}

export function splitProjectNameAndPhase(projectName) {
    const normalized = normalizeProjectName(projectName);
    if (!normalized) {
        return {
            originalName: '',
            name: '',
            phase: null,
        };
    }

    const match = normalized.match(/^(.*?)[（(]([^（）()]+)[）)]$/u);
    if (!match) {
        return {
            originalName: normalized,
            name: normalized,
            phase: null,
        };
    }

    const name = normalizeProjectName(match[1]);
    const phase = normalizeProjectName(match[2]);
    if (!name || !phase) {
        return {
            originalName: normalized,
            name: normalized,
            phase: null,
        };
    }

    return {
        originalName: normalized,
        name,
        phase,
    };
}

export function buildProjectDisplayName(projectOrName, phase = null) {
    if (projectOrName && typeof projectOrName === 'object' && !Array.isArray(projectOrName)) {
        const name = normalizeProjectName(projectOrName.name);
        const projectPhase = normalizeProjectName(projectOrName.phase);
        if (!name) {
            return '';
        }

        return projectPhase ? `${name}（${projectPhase}）` : name;
    }

    const name = normalizeProjectName(projectOrName);
    const normalizedPhase = normalizeProjectName(phase);
    if (!name) {
        return '';
    }

    return normalizedPhase ? `${name}（${normalizedPhase}）` : name;
}

export function buildWorkLogProjectDisplayName(workLog) {
    if (!workLog || typeof workLog !== 'object' || Array.isArray(workLog)) {
        return buildProjectDisplayName(workLog);
    }

    const project = workLog.project && typeof workLog.project === 'object'
        ? workLog.project
        : workLog;
    const name = normalizeProjectName(project?.name);
    if (!name) {
        return '';
    }

    const phase = normalizeProjectName(project?.phase);
    const buildingName = normalizeProjectName(workLog.buildingName);
    if (phase) {
        return buildingName ? `${name}（${phase} · ${buildingName}）` : `${name}（${phase}）`;
    }

    return project?.buildingMode && buildingName ? `${name}（${buildingName}）` : name;
}
