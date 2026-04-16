import prisma from '@/lib/prisma';
import { hasTaskProvider, requestTaskModel } from '@/lib/modelGateway';
import { STANDARD_TEST_ITEMS, findExactStandardItem, findBestStandardItem } from '@/lib/testItemRegistry';

const LOCAL_AUTO_MATCH_THRESHOLD = 0.96;
const LOCAL_FALLBACK_THRESHOLD = 0.78;
const MODEL_MATCH_THRESHOLD = 0.72;
const MAX_MODEL_CANDIDATES = 12;
const UNIT_COMPATIBILITY_GROUPS = new Map([
    ['m²', 'area'],
    ['㎡', 'area'],
    ['m2', 'area'],
    ['平方米', 'area'],
    ['吨', 'mass'],
    ['t', 'mass'],
    ['项', 'item'],
    ['次', 'item'],
    ['点', 'point'],
    ['根', 'root'],
    ['个构件', 'component'],
    ['构件', 'component'],
    ['个', 'component'],
    ['米', 'length'],
    ['m', 'length'],
    ['组', 'group'],
    ['栋', 'group'],
]);

// 从标准检测项目列表自动生成别名组
const ALIAS_GROUPS = STANDARD_TEST_ITEMS
    .filter((item) => item.aliases && item.aliases.length > 0)
    .map((item) => [item.name, ...item.aliases]);

const CONTRACT_BUNDLE_ALIASES = [
    {
        pattern: /桩身完整性检测/u,
        aliases: ['低应变', '低应变法', '小应变', '完整性检测'],
    },
    {
        pattern: /混凝土强度/u,
        aliases: ['实体检测', '混凝土强度', '混凝土(综合法）', '混凝土（综合法）', '保护层', '钢筋保护层', '板厚', '层高', '净高', '结构尺寸'],
    },
    {
        pattern: /后置埋件锚固承载力/u,
        aliases: ['植筋拉拔', '植筋', '后置埋件拉拔', '后置埋件现场拉拔力', '拉拔'],
    },
    {
        pattern: /竖向变形观测/u,
        aliases: ['沉降', '沉降观测', '周边道路竖向', '道路竖向', '周边竖向'],
    },
    {
        pattern: /基坑监测/u,
        aliases: ['基坑监测', '基坑竖向', '基坑水平', '水平', '水平位移'],
    },
];

function clampScore(score) {
    return Math.max(0, Math.min(1, score));
}

function normalizeText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[\s()（）\[\]【】\-_/\\,，。:：;；]/gu, '');
}

export function normalizeUnitForMatching(unit) {
    return String(unit || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/gu, '')
        .replace(/㎡/gu, 'm²')
        .replace(/m2/gu, 'm²')
        .replace(/平方米/gu, 'm²');
}

function resolveUnitCompatibilityGroup(unit) {
    const normalized = normalizeUnitForMatching(unit);
    if (!normalized) {
        return null;
    }

    return UNIT_COMPATIBILITY_GROUPS.get(normalized) || null;
}

export function areUnitsCompatibleForMatching(workLogUnit, candidateUnit) {
    const normalizedWorkLogUnit = normalizeUnitForMatching(workLogUnit);
    const normalizedCandidateUnit = normalizeUnitForMatching(candidateUnit);

    if (!normalizedWorkLogUnit && !normalizedCandidateUnit) {
        return true;
    }

    if (!normalizedWorkLogUnit || !normalizedCandidateUnit) {
        return false;
    }

    if (normalizedWorkLogUnit === normalizedCandidateUnit) {
        return true;
    }

    const workLogGroup = resolveUnitCompatibilityGroup(normalizedWorkLogUnit);
    const candidateGroup = resolveUnitCompatibilityGroup(normalizedCandidateUnit);
    return Boolean(workLogGroup && candidateGroup && workLogGroup === candidateGroup);
}

function buildVariants(text) {
    const normalized = normalizeText(text);
    const variants = new Set([normalized]);

    ALIAS_GROUPS.forEach((group) => {
        const normalizedGroup = group.map(normalizeText);
        normalizedGroup.forEach((current) => {
            if (!normalized.includes(current)) {
                return;
            }

            normalizedGroup.forEach((replacement) => {
                variants.add(normalized.replace(current, replacement));
            });
        });
    });

    return Array.from(variants).filter(Boolean);
}

function buildCandidateVariants(text) {
    const variants = new Set(buildVariants(text));
    const rawText = String(text || '');

    CONTRACT_BUNDLE_ALIASES.forEach((rule) => {
        if (!rule.pattern.test(rawText)) {
            return;
        }

        rule.aliases.forEach((alias) => {
            const normalizedAlias = normalizeText(alias);
            if (normalizedAlias) {
                variants.add(normalizedAlias);
            }
        });
    });

    return Array.from(variants).filter(Boolean);
}

function getBigrams(text) {
    if (text.length < 2) {
        return [text];
    }

    const bigrams = [];
    for (let index = 0; index < text.length - 1; index += 1) {
        bigrams.push(text.slice(index, index + 2));
    }
    return bigrams;
}

function diceCoefficient(left, right) {
    if (!left || !right) {
        return 0;
    }

    if (left === right) {
        return 1;
    }

    if (left.includes(right) || right.includes(left)) {
        return 0.94;
    }

    const leftBigrams = getBigrams(left);
    const rightBigrams = getBigrams(right);
    const rightCounts = new Map();

    rightBigrams.forEach((item) => {
        rightCounts.set(item, (rightCounts.get(item) || 0) + 1);
    });

    let intersection = 0;
    leftBigrams.forEach((item) => {
        const count = rightCounts.get(item) || 0;
        if (count > 0) {
            intersection += 1;
            rightCounts.set(item, count - 1);
        }
    });

    return (2 * intersection) / (leftBigrams.length + rightBigrams.length);
}

function scoreNameAgainstCandidate(worklogName, candidateName) {
    const worklogVariants = buildVariants(worklogName);
    const candidateVariants = buildCandidateVariants(candidateName);
    let bestScore = 0;

    worklogVariants.forEach((worklogVariant) => {
        candidateVariants.forEach((candidateVariant) => {
            bestScore = Math.max(bestScore, diceCoefficient(worklogVariant, candidateVariant));
        });
    });

    return bestScore;
}

function scoreCandidate(workLog, candidate) {
    const nameScore = scoreNameAgainstCandidate(workLog.testContent, candidate.testItemName);
    const contextScore = Math.max(
        scoreNameAgainstCandidate(`${workLog.testContent} ${workLog.remarks || ''}`, candidate.testItemName),
        nameScore,
    );

    let score = Math.max(nameScore, contextScore * 0.92);

    if (workLog.unit || candidate.unit) {
        score += areUnitsCompatibleForMatching(workLog.unit, candidate.unit) ? 0.03 : -0.02;
    }

    if (candidate.source === 'contract') {
        score += 0.02;
    }

    return clampScore(score);
}

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

async function resolveProjectContext(workLog) {
    const projectId = workLog.projectId || workLog.project?.id;
    if (!projectId) {
        return {
            projectName: workLog.project?.name || '',
            contractId: workLog.project?.contractId || null,
        };
    }

    if (workLog.project?.contractId !== undefined) {
        return {
            projectName: workLog.project?.name || '',
            contractId: workLog.project?.contractId,
        };
    }

    const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { name: true, contractId: true },
    });

    return {
        projectName: project?.name || workLog.project?.name || '',
        contractId: project?.contractId || null,
    };
}

function finalizeMatch(candidate, matchMethod) {
    return {
        candidateId: candidate.id,
        testItemName: candidate.testItemName,
        unitPrice: candidate.unitPrice,
        source: candidate.source,
        matchMethod,
        priceSource: candidate.source === 'contract'
            ? (matchMethod === 'model' ? '合同价(智能匹配)' : '合同价')
            : (matchMethod === 'model' ? '内部价(智能匹配)' : '内部价'),
    };
}

async function matchCandidateWithModel(workLog, candidates, projectName) {
    if (!hasTaskProvider('worklogMatching') || candidates.length === 0) {
        return null;
    }

    try {
        // 查找标准项目作为参考提示
        const standardHint = findBestStandardItem(workLog.testContent);
        const standardContext = standardHint && standardHint.score >= 0.5
            ? `\nHint: the worklog item "${workLog.testContent}" likely refers to standard test item "${standardHint.item.name}" (category: ${standardHint.item.category}, confidence: ${standardHint.score.toFixed(2)}).`
            : '';

        const { result } = await requestTaskModel('worklogMatching', {
            messages: [
                {
                    role: 'system',
                    content: [
                        'You match a worklog inspection item to one price candidate.',
                        'The worklog description may be abbreviated or colloquial. Use domain knowledge of construction inspection (工程检测) to infer the correct match.',
                        'Prefer contract candidates when they are semantically equal to the worklog item.',
                        standardContext,
                        'Return JSON only.',
                    ].filter(Boolean).join('\n'),
                },
                {
                    role: 'user',
                    content: JSON.stringify({
                        worklog: {
                            projectName,
                            testContent: workLog.testContent,
                            quantity: workLog.quantity,
                            unit: workLog.unit,
                            remarks: workLog.remarks,
                            rawText: workLog.rawText,
                        },
                        candidates: candidates.map((candidate) => ({
                            candidateId: `${candidate.source}:${candidate.id}`,
                            source: candidate.source,
                            testItemName: candidate.testItemName,
                            unit: candidate.unit,
                            unitPrice: candidate.unitPrice,
                        })),
                        outputSchema: {
                            matched: 'boolean',
                            candidateId: 'string|null',
                            confidence: 'number',
                            reason: 'string',
                        },
                    }),
                },
            ],
            maxTokens: 400,
            timeoutMs: 30000,
        });

        const content = result?.choices?.[0]?.message?.content || result?.choices?.[0]?.message?.reasoning_content || '';
        const payload = extractJsonPayload(content);
        if (!payload?.matched || !payload?.candidateId) {
            return null;
        }

        const matchedCandidate = candidates.find((candidate) => `${candidate.source}:${candidate.id}` === payload.candidateId);
        if (!matchedCandidate) {
            return null;
        }

        const confidence = Number.parseFloat(payload.confidence);
        if (!Number.isFinite(confidence) || confidence < MODEL_MATCH_THRESHOLD) {
            return null;
        }

        return finalizeMatch(matchedCandidate, 'model');
    } catch (error) {
        console.warn('[Worklog Matching] model match failed:', error.message);
        return null;
    }
}

export async function matchPriceCandidateFromList(workLog, candidates, projectName = '') {
    if (candidates.length === 0) {
        return null;
    }

    // 先尝试用标准检测项目列表做预匹配，规范化 testContent
    const standardMatch = findExactStandardItem(workLog.testContent);
    const effectiveTestContent = standardMatch ? standardMatch.name : workLog.testContent;
    const effectiveWorkLog = standardMatch
        ? { ...workLog, testContent: effectiveTestContent }
        : workLog;
    const compatibleCandidates = candidates.filter((candidate) => (
        areUnitsCompatibleForMatching(effectiveWorkLog.unit, candidate.unit)
    ));

    if (compatibleCandidates.length === 0) {
        return null;
    }

    const rankedCandidates = compatibleCandidates
        .map((candidate) => ({
            ...candidate,
            score: scoreCandidate(effectiveWorkLog, candidate),
        }))
        .sort((left, right) => right.score - left.score);

    const bestCandidate = rankedCandidates[0];
    const secondCandidate = rankedCandidates[1];
    if (bestCandidate && (
        bestCandidate.score >= LOCAL_AUTO_MATCH_THRESHOLD
        || (bestCandidate.score >= 0.9 && (!secondCandidate || bestCandidate.score - secondCandidate.score >= 0.08))
    )) {
        return finalizeMatch(bestCandidate, 'local');
    }

    if (bestCandidate && bestCandidate.score >= LOCAL_FALLBACK_THRESHOLD) {
        return finalizeMatch(bestCandidate, 'local-fallback');
    }

    // 描述模糊时，用大模型做智能判断
    // 条件放宽：只要有候选且最高分 >= 0.45 就尝试让模型判断
    const shouldAskModel = Boolean(
        bestCandidate
        && bestCandidate.score >= 0.45
        && (
            // 原始条件：两个候选分差小
            (secondCandidate && bestCandidate.score - secondCandidate.score <= 0.08)
            // 新增条件：分数处于模糊区间 (0.45 ~ 0.78) 时也请求模型
            || bestCandidate.score < LOCAL_FALLBACK_THRESHOLD
        )
    );

    if (shouldAskModel) {
        const modelMatch = await matchCandidateWithModel(
            workLog,
            rankedCandidates.slice(0, MAX_MODEL_CANDIDATES),
            projectName,
        );
        if (modelMatch) {
            return modelMatch;
        }
    }

    return null;
}

export async function findBestPriceMatch(workLog) {
    const { projectName, contractId } = await resolveProjectContext(workLog);
    const [contractCandidates, internalCandidates] = await Promise.all([
        contractId
            ? prisma.priceItem.findMany({
                where: { contractId },
                select: { id: true, testItemName: true, unit: true, unitPrice: true },
            })
            : Promise.resolve([]),
        prisma.internalPrice.findMany({
            select: { id: true, testItemName: true, unit: true, unitPrice: true },
        }),
    ]);

    const candidates = [
        ...contractCandidates.map((candidate) => ({ ...candidate, source: 'contract' })),
        ...internalCandidates.map((candidate) => ({ ...candidate, source: 'internal' })),
    ];

    return matchPriceCandidateFromList(workLog, candidates, projectName);
}
