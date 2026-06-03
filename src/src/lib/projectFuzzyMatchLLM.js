import { buildProjectDisplayName } from '@/lib/projectDisplayName';
import { findFuzzyProjectCandidates } from '@/lib/projectNameMatcher';
import { hasTaskProvider, requestTaskModel } from '@/lib/modelGateway';

const MODEL_TASK_ID = 'worklogMatching';
const DEFAULT_LIMIT = 6;
const DEFAULT_THRESHOLD = 0.72;
const FALLBACK_REVIEW_THRESHOLD = 0.96;

function extractJsonPayload(content) {
    if (!content) {
        return null;
    }

    if (typeof content !== 'string') {
        return content;
    }

    try {
        return JSON.parse(content);
    } catch (error) {
        // continue
    }

    const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/u);
    if (codeBlockMatch) {
        try {
            return JSON.parse(codeBlockMatch[1].trim());
        } catch (error) {
            // continue
        }
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/u);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[0]);
        } catch (error) {
            // continue
        }
    }

    return null;
}

export function parseFuzzyMatchCandidateIds(value) {
    if (Array.isArray(value)) {
        return Array.from(
            new Set(
                value
                    .map((item) => Number.parseInt(item, 10))
                    .filter((item) => Number.isInteger(item)),
            ),
        );
    }

    if (!value) {
        return [];
    }

    try {
        return parseFuzzyMatchCandidateIds(JSON.parse(value));
    } catch (error) {
        return [];
    }
}

export function serializeFuzzyMatchCandidateIds(candidateIds) {
    const normalized = parseFuzzyMatchCandidateIds(candidateIds);
    return normalized.length > 0 ? JSON.stringify(normalized) : null;
}

function buildModelProject(project, similarityScore = null) {
    return {
        id: project.id,
        displayName: buildProjectDisplayName(project),
        name: project.name,
        phase: project.phase ?? null,
        buildingMode: Boolean(project.buildingMode),
        contractLinked: Boolean(project.contractId),
        similarityScore: Number.isFinite(similarityScore)
            ? Number(similarityScore.toFixed(4))
            : null,
    };
}

function resolveModelDecision(payload, candidates) {
    const candidateIds = parseFuzzyMatchCandidateIds(payload?.candidateIds).filter((candidateId) => (
        candidates.some((candidate) => candidate.id === candidateId)
    ));

    const needsReview = payload?.needsReview === true
        || payload?.suspectedDuplicate === true
        || (candidateIds.length > 0 && payload?.needsReview !== false);

    return {
        needsReview,
        candidateIds,
        reason: typeof payload?.reason === 'string' ? payload.reason.trim() : '',
    };
}

export async function evaluateProjectFuzzyMatch(project, options = {}) {
    const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : DEFAULT_LIMIT;
    const threshold = Number.isFinite(Number(options.threshold)) ? Number(options.threshold) : DEFAULT_THRESHOLD;
    const targetProject = {
        id: project.id,
        name: project.name,
        phase: project.phase ?? null,
        buildingMode: Boolean(project.buildingMode),
        contractId: project.contractId ?? null,
    };
    const targetDisplayName = buildProjectDisplayName(targetProject);

    if (!targetDisplayName) {
        return {
            status: 'distinct',
            candidateIds: [],
            reason: 'empty-project-name',
        };
    }

    const fuzzyCandidates = await findFuzzyProjectCandidates(targetDisplayName, {
        prismaClient: options.prismaClient,
        limit,
        threshold,
    });

    if (fuzzyCandidates.length === 0) {
        return {
            status: 'distinct',
            candidateIds: [],
            reason: 'no-candidates',
        };
    }

    if (!hasTaskProvider(MODEL_TASK_ID)) {
        throw new Error('未配置可用的文本模型，无法执行项目判重');
    }

    const candidates = fuzzyCandidates.map((item) => ({
        ...item.project,
        similarityScore: item.score,
    }));

    const { result } = await requestTaskModel(MODEL_TASK_ID, {
        messages: [
            {
                role: 'system',
                content: [
                    '你在做项目台账重名复核预判。',
                    '只根据项目名称、阶段/子项、是否单体建筑模式、是否已关联合同这几项信息判断。',
                    '不要引入金额、人员、产值等敏感业务数据。',
                    '如果只是同一大项目下明确不同的阶段、楼栋、单体或子项，不算重复。',
                    '如果名称只是标点、空格、简写或轻微措辞差异，但大概率是同一个项目，应该判为需要人工复核。',
                    '如果拿不准，但明显值得人工看一眼，也返回需要人工复核。',
                    '只返回 JSON，不要输出解释文本。',
                ].join('\n'),
            },
            {
                role: 'user',
                content: JSON.stringify({
                    targetProject: buildModelProject(targetProject),
                    candidates: candidates.map((candidate) => buildModelProject(candidate, candidate.similarityScore)),
                    outputSchema: {
                        needsReview: 'boolean',
                        candidateIds: 'number[]',
                        reason: 'string',
                    },
                }),
            },
        ],
        maxTokens: 500,
        timeoutMs: 30000,
    });

    const content = result?.choices?.[0]?.message?.content || result?.choices?.[0]?.message?.reasoning_content || '';
    const payload = extractJsonPayload(content);
    const decision = resolveModelDecision(payload, candidates);

    if (decision.needsReview && decision.candidateIds.length > 0) {
        return {
            status: 'review',
            candidateIds: decision.candidateIds,
            reason: decision.reason || 'model-review',
        };
    }

    const topCandidate = candidates[0];
    if (topCandidate && Number(topCandidate.similarityScore || 0) >= FALLBACK_REVIEW_THRESHOLD) {
        return {
            status: 'review',
            candidateIds: [topCandidate.id],
            reason: 'high-score-fallback',
        };
    }

    return {
        status: 'distinct',
        candidateIds: [],
        reason: 'model-distinct',
    };
}
