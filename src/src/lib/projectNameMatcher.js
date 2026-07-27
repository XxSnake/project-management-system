import prisma from './prisma.js';
import {
    buildProjectDisplayName,
    normalizeProjectName,
    splitProjectNameAndPhase,
} from './projectDisplayName.js';

const DEFAULT_LIMIT = 5;
const DEFAULT_THRESHOLD = 0.75;

function normalizeForExactMatch(value) {
    return normalizeProjectName(value)
        .normalize('NFKC')
        .replace(/[（]/gu, '(')
        .replace(/[）]/gu, ')')
        .replace(/[—–－]/gu, '-')
        .replace(/\u3000/gu, ' ')
        .replace(/\s+/gu, '');
}

function normalizeForSimilarity(value) {
    return normalizeForExactMatch(value)
        .replace(/[-()[\]{}【】]/gu, '');
}

function toChineseBuildingNumber(value) {
    const number = Number.parseInt(value, 10);
    const values = {
        1: '一',
        2: '二',
        3: '三',
        4: '四',
        5: '五',
        6: '六',
        7: '七',
        8: '八',
        9: '九',
        10: '十',
    };
    return values[number] || value;
}

function normalizeKnownProjectAliases(value) {
    let normalized = normalizeForSimilarity(value)
        .replace(/弥渡(?:县)?一中/gu, '弥渡县第一完全中学')
        .replace(/(\d{1,2})#/gu, (match, number) => `${toChineseBuildingNumber(number)}号`);

    if (normalized.includes('弥渡县第一完全中学')) {
        normalized = normalized
            .replace(/整体搬迁/gu, '')
            .replace(/[一二三四五六七八九十0-9]+期/gu, '')
            .replace(/建设项目|建设工程|项目|工程/gu, '');
    }

    return normalized;
}

function extractSpecificityMarkers(value) {
    const normalized = normalizeForExactMatch(value);
    return new Set(normalized.match(/[一二三四五六七八九十0-9]+期|[一二三四五六七八九十0-9]+标段/gu) || []);
}

function adjustScoreForSpecificity(left, right, score) {
    const inputMarkers = extractSpecificityMarkers(left);
    if (inputMarkers.size === 0) {
        return score;
    }

    const candidateMarkers = extractSpecificityMarkers(right);
    let matched = 0;
    let missing = 0;

    inputMarkers.forEach((marker) => {
        if (candidateMarkers.has(marker)) {
            matched += 1;
        } else {
            missing += 1;
        }
    });

    return Math.max(0, Math.min(1, score + matched * 0.06 - missing * 0.06));
}

function buildMatcherProject(project) {
    return {
        id: project.id,
        name: project.name,
        phase: project.phase ?? null,
        buildingMode: Boolean(project.buildingMode),
        contractId: project.contractId ?? null,
    };
}

function buildCharacterSet(text) {
    return new Set(Array.from(text));
}

function computeJaccardScore(left, right) {
    if (!left && !right) {
        return 1;
    }

    const leftSet = buildCharacterSet(left);
    const rightSet = buildCharacterSet(right);
    const union = new Set([...leftSet, ...rightSet]);
    if (union.size === 0) {
        return 1;
    }

    let intersectionCount = 0;
    for (const item of leftSet) {
        if (rightSet.has(item)) {
            intersectionCount += 1;
        }
    }

    return intersectionCount / union.size;
}

function computeLevenshteinDistance(left, right) {
    const leftChars = Array.from(left);
    const rightChars = Array.from(right);

    if (leftChars.length === 0) {
        return rightChars.length;
    }

    if (rightChars.length === 0) {
        return leftChars.length;
    }

    const previous = new Array(rightChars.length + 1).fill(0);
    const current = new Array(rightChars.length + 1).fill(0);

    for (let index = 0; index <= rightChars.length; index += 1) {
        previous[index] = index;
    }

    for (let leftIndex = 1; leftIndex <= leftChars.length; leftIndex += 1) {
        current[0] = leftIndex;
        for (let rightIndex = 1; rightIndex <= rightChars.length; rightIndex += 1) {
            const cost = leftChars[leftIndex - 1] === rightChars[rightIndex - 1] ? 0 : 1;
            current[rightIndex] = Math.min(
                current[rightIndex - 1] + 1,
                previous[rightIndex] + 1,
                previous[rightIndex - 1] + cost,
            );
        }

        for (let rightIndex = 0; rightIndex <= rightChars.length; rightIndex += 1) {
            previous[rightIndex] = current[rightIndex];
        }
    }

    return previous[rightChars.length];
}

function computeEditSimilarity(left, right) {
    const maxLength = Math.max(Array.from(left).length, Array.from(right).length);
    if (maxLength === 0) {
        return 1;
    }

    return 1 - (computeLevenshteinDistance(left, right) / maxLength);
}

function computeLcsLength(left, right) {
    const leftChars = Array.from(left);
    const rightChars = Array.from(right);
    if (leftChars.length === 0 || rightChars.length === 0) {
        return 0;
    }

    const dp = Array.from({ length: leftChars.length + 1 }, () => new Array(rightChars.length + 1).fill(0));
    for (let leftIndex = 1; leftIndex <= leftChars.length; leftIndex += 1) {
        for (let rightIndex = 1; rightIndex <= rightChars.length; rightIndex += 1) {
            if (leftChars[leftIndex - 1] === rightChars[rightIndex - 1]) {
                dp[leftIndex][rightIndex] = dp[leftIndex - 1][rightIndex - 1] + 1;
            } else {
                dp[leftIndex][rightIndex] = Math.max(dp[leftIndex - 1][rightIndex], dp[leftIndex][rightIndex - 1]);
            }
        }
    }

    return dp[leftChars.length][rightChars.length];
}

function computeLcsSimilarity(left, right) {
    const maxLength = Math.max(Array.from(left).length, Array.from(right).length);
    if (maxLength === 0) {
        return 1;
    }

    return computeLcsLength(left, right) / maxLength;
}

export function scoreProjectNameSimilarity(left, right) {
    const normalizedLeft = normalizeForExactMatch(left);
    const normalizedRight = normalizeForExactMatch(right);
    if (!normalizedLeft || !normalizedRight) {
        return 0;
    }

    if (normalizedLeft === normalizedRight) {
        return 1;
    }

    const directScore = (
        computeJaccardScore(normalizedLeft, normalizedRight) * 0.4
        + computeEditSimilarity(normalizedLeft, normalizedRight) * 0.4
        + computeLcsSimilarity(normalizedLeft, normalizedRight) * 0.2
    );

    const compactLeft = normalizeForSimilarity(left);
    const compactRight = normalizeForSimilarity(right);
    let bestScore = directScore;

    if (compactLeft && compactRight) {
        if (compactLeft === compactRight) {
            bestScore = Math.max(bestScore, 0.98);
        } else {
            const compactScore = (
                computeJaccardScore(compactLeft, compactRight) * 0.4
                + computeEditSimilarity(compactLeft, compactRight) * 0.4
                + computeLcsSimilarity(compactLeft, compactRight) * 0.2
            );
            bestScore = Math.max(bestScore, compactScore * 0.98);
        }

        if (compactLeft.includes(compactRight) || compactRight.includes(compactLeft)) {
            const shorterLength = Math.min(Array.from(compactLeft).length, Array.from(compactRight).length);
            const longerLength = Math.max(Array.from(compactLeft).length, Array.from(compactRight).length);
            const ratio = longerLength > 0 ? shorterLength / longerLength : 0;
            bestScore = Math.max(bestScore, Math.min(0.8, 0.55 + ratio * 0.4));
        }
    }

    const aliasLeft = normalizeKnownProjectAliases(left);
    const aliasRight = normalizeKnownProjectAliases(right);
    if (aliasLeft && aliasRight) {
        if (aliasLeft === aliasRight) {
            bestScore = Math.max(bestScore, 0.96);
        } else {
            const aliasScore = (
                computeJaccardScore(aliasLeft, aliasRight) * 0.4
                + computeEditSimilarity(aliasLeft, aliasRight) * 0.4
                + computeLcsSimilarity(aliasLeft, aliasRight) * 0.2
            );
            bestScore = Math.max(bestScore, aliasScore * 0.94);
        }
    }

    bestScore = adjustScoreForSpecificity(left, right, bestScore);
    return Number(bestScore.toFixed(4));
}

function extractBuildingNameSuggestion(parsedPhase, projectPhase) {
    const rawParsedPhase = normalizeProjectName(parsedPhase);
    const rawProjectPhase = normalizeProjectName(projectPhase);
    if (!rawParsedPhase || !rawProjectPhase) {
        return null;
    }

    if (rawParsedPhase.startsWith(rawProjectPhase)) {
        return normalizeProjectName(rawParsedPhase.slice(rawProjectPhase.length).replace(/^[-—–:：]+/u, '')) || null;
    }

    const compactParsedPhase = normalizeForExactMatch(rawParsedPhase);
    const compactProjectPhase = normalizeForExactMatch(rawProjectPhase);
    if (!compactParsedPhase.startsWith(compactProjectPhase)) {
        return null;
    }

    const simplified = rawParsedPhase
        .replace(rawProjectPhase, '')
        .replace(/^[-—–:：]+/u, '');
    return normalizeProjectName(simplified) || null;
}

function extractDelimitedBuildingName(projectName, project) {
    if (!project?.buildingMode || !normalizeProjectName(project.phase)) {
        return null;
    }

    const input = normalizeProjectName(projectName);
    const baseName = normalizeProjectName(project.name);
    const projectPhase = normalizeProjectName(project.phase);
    if (!input || !baseName || !input.startsWith(baseName)) {
        return null;
    }

    const remainderAfterName = input
        .slice(baseName.length)
        .replace(/^[\s\-—–－:：（(·]+/u, '');
    if (!remainderAfterName.startsWith(projectPhase)) {
        return null;
    }

    return normalizeProjectName(
        remainderAfterName
            .slice(projectPhase.length)
            .replace(/^[\s\-—–－:：·]+/u, '')
            .replace(/[）)\s]+$/u, '')
            .replace(/项目$/u, ''),
    ) || null;
}

async function loadProjects(options) {
    if (Array.isArray(options.projects)) {
        return options.projects.map(buildMatcherProject);
    }

    const prismaClient = options.prismaClient || prisma;
    const projects = await prismaClient.project.findMany({
        select: {
            id: true,
            name: true,
            phase: true,
            buildingMode: true,
            contractId: true,
        },
        orderBy: [
            { name: 'asc' },
            { id: 'asc' },
        ],
    });

    return projects.map(buildMatcherProject);
}

function buildCandidate(project, score, extra = {}) {
    return {
        project,
        score: Number(score.toFixed(4)),
        matchedBy: 'fuzzy',
        matchedAs: extra.matchedAs || 'project',
        buildingName: extra.buildingName || null,
    };
}

function deduplicateCandidates(candidates) {
    const bestByKey = new Map();

    for (const candidate of candidates) {
        const key = `${candidate.project.id}:${candidate.matchedAs}:${candidate.buildingName || ''}`;
        const existing = bestByKey.get(key);
        if (!existing || candidate.score > existing.score) {
            bestByKey.set(key, candidate);
        }
    }

    return Array.from(bestByKey.values())
        .sort((left, right) => {
            if (right.score !== left.score) {
                return right.score - left.score;
            }
            return left.project.id - right.project.id;
        });
}

function findExactProjectCandidate(projectName, projects) {
    const parsed = splitProjectNameAndPhase(projectName);
    const normalizedInput = normalizeForExactMatch(projectName);

    for (const project of projects) {
        if (normalizeForExactMatch(buildProjectDisplayName(project)) === normalizedInput) {
            return {
                project,
                matchedAs: 'project',
                buildingName: null,
            };
        }
    }

    for (const project of projects) {
        if (
            project.buildingMode
            && !normalizeProjectName(project.phase)
            && parsed.phase
            && normalizeForExactMatch(parsed.name) === normalizeForExactMatch(project.name)
        ) {
            return {
                project,
                matchedAs: 'building',
                buildingName: normalizeProjectName(parsed.phase) || null,
            };
        }
    }

    return null;
}

export async function findFuzzyProjectCandidates(projectName, options = {}) {
    const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : DEFAULT_LIMIT;
    const threshold = Number.isFinite(Number(options.threshold)) ? Number(options.threshold) : DEFAULT_THRESHOLD;
    const projects = await loadProjects(options);
    const parsed = splitProjectNameAndPhase(projectName);
    const normalizedInput = normalizeForExactMatch(projectName);
    const fuzzyCandidates = [];

    for (const project of projects) {
        const displayName = buildProjectDisplayName(project);
        const normalizedDisplayName = normalizeForExactMatch(displayName);
        if (!displayName || normalizedDisplayName === normalizedInput) {
            continue;
        }

        const score = scoreProjectNameSimilarity(projectName, displayName);
        if (score >= threshold) {
            fuzzyCandidates.push(buildCandidate(project, score));
        }

        if (
            parsed.phase
            && project.buildingMode
            && normalizeProjectName(project.phase)
            && normalizeForExactMatch(parsed.name) === normalizeForExactMatch(project.name)
            && normalizeForExactMatch(parsed.phase).startsWith(normalizeForExactMatch(project.phase))
        ) {
            const buildingName = extractBuildingNameSuggestion(parsed.phase, project.phase);
            if (buildingName) {
                fuzzyCandidates.push(buildCandidate(project, Math.max(score, 0.97), {
                    matchedAs: 'building-in-subproject',
                    buildingName,
                }));
            }
        }

        const delimitedBuildingName = extractDelimitedBuildingName(projectName, project);
        if (delimitedBuildingName) {
            fuzzyCandidates.push(buildCandidate(project, Math.max(score, 0.97), {
                matchedAs: 'building-in-subproject',
                buildingName: delimitedBuildingName,
            }));
        }
    }

    return deduplicateCandidates(fuzzyCandidates).slice(0, limit);
}

export async function analyzeProjectNameResolution(projectName, options = {}) {
    const projects = await loadProjects(options);
    const exact = findExactProjectCandidate(projectName, projects);
    if (exact) {
        return {
            status: 'exact',
            exactProjectId: exact.project.id,
            project: exact.project,
            matchedAs: exact.matchedAs,
            buildingName: exact.buildingName,
            candidates: [],
        };
    }

    const candidates = await findFuzzyProjectCandidates(projectName, {
        ...options,
        projects,
    });

    if (candidates.length === 0) {
        return {
            status: 'none',
            exactProjectId: null,
            project: null,
            matchedAs: null,
            buildingName: null,
            candidates: [],
        };
    }

    return {
        status: 'fuzzy',
        exactProjectId: null,
        project: null,
        matchedAs: null,
        buildingName: null,
        candidates,
    };
}

export function buildProjectMatcherOption(project) {
    return {
        id: project.id,
        projectDisplayName: buildProjectDisplayName(project),
        buildingMode: Boolean(project.buildingMode),
        phase: project.phase ?? null,
        contractId: project.contractId ?? null,
    };
}
