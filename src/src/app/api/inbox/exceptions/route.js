import prisma from '@/lib/prisma';
import { buildProjectDisplayName, buildWorkLogProjectDisplayName } from '@/lib/projectDisplayName';
import {
    parseFuzzyMatchCandidateIds,
} from '@/lib/projectFuzzyMatchLLM';
import { allocationShareToPercent, normalizePricingMode } from '@/lib/worklogBilling';
import {
    buildInboxWhere,
    detectWorkLogExceptions,
    EXCEPTION_META,
    EXCEPTION_ORDER,
    EXCEPTION_TYPES,
    parseAcknowledgedExceptions,
} from '@/lib/workLogExceptions';

import { NextResponse } from 'next/server';

function parsePositiveInt(value, fallback, max = 200) {
    const numeric = Number.parseInt(value, 10);
    if (!Number.isInteger(numeric) || numeric <= 0) {
        return fallback;
    }

    return Math.min(numeric, max);
}

function getStaffNames(workLog) {
    return (workLog?.staffMembers || [])
        .map((item) => item.staff?.name)
        .filter(Boolean);
}

function serializeWorkLog(workLog, exceptions) {
    const project = workLog.project || null;
    const contract = project?.contract || null;
    const pricingMode = normalizePricingMode(contract?.pricingMode);

    return {
        itemType: 'worklog',
        sortTime: workLog.workDate,
        workLogId: workLog.id,
        workDate: workLog.workDate,
        projectId: project?.id || null,
        projectName: buildWorkLogProjectDisplayName(workLog),
        buildingName: workLog.buildingName || null,
        contractId: contract?.id || null,
        contractNo: contract?.contractNo || '',
        pricingMode,
        testContent: workLog.testContent || '',
        quantity: Number(workLog.quantity || 0),
        unit: workLog.unit || '',
        remarks: workLog.remarks || '',
        staffNames: getStaffNames(workLog),
        exceptions,
        exceptionMeta: Object.fromEntries(
            exceptions.map((type) => [type, EXCEPTION_META[type] || null]),
        ),
        acknowledgedExceptions: Array.from(parseAcknowledgedExceptions(workLog.acknowledgedExceptions)),
        allocationShare: workLog.allocationShare,
        allocationSharePercent: allocationShareToPercent(workLog.allocationShare),
        manualTotalValue: workLog.manualTotalValue,
        manualValueNote: workLog.manualValueNote || '',
        noContractExpected: Boolean(project?.noContractExpected),
        contractSummary: {
            areaPricingAmount: contract?.areaPricingAmount ?? null,
            areaPricingArea: contract?.areaPricingArea ?? null,
            lumpSumAmount: contract?.lumpSumAmount ?? null,
        },
    };
}

function buildCandidatePlaceholder(candidateId) {
    return {
        id: candidateId,
        projectName: `项目 #${candidateId}`,
        contractId: null,
        contractNo: '',
        buildingMode: false,
        missing: true,
    };
}

function serializeProjectFuzzyMatch(project, candidateMap) {
    const candidateIds = parseFuzzyMatchCandidateIds(project.fuzzyMatchCandidateIds);
    const candidates = candidateIds.map((candidateId) => {
        const candidate = candidateMap.get(candidateId);
        if (!candidate) {
            return buildCandidatePlaceholder(candidateId);
        }

        return {
            id: candidate.id,
            projectName: buildProjectDisplayName(candidate),
            contractId: candidate.contractId ?? null,
            contractNo: candidate.contract?.contractNo || '',
            buildingMode: Boolean(candidate.buildingMode),
            missing: false,
        };
    });

    return {
        itemType: 'project-fuzzy-match',
        sortTime: project.fuzzyMatchedAt || project.createdAt,
        projectId: project.id,
        projectName: buildProjectDisplayName(project),
        projectStatus: project.status || '',
        phase: project.phase || null,
        buildingMode: Boolean(project.buildingMode),
        contractId: project.contractId ?? null,
        contractNo: project.contract?.contractNo || '',
        projectCreatedAt: project.createdAt,
        fuzzyMatchedAt: project.fuzzyMatchedAt,
        candidateProjectIds: candidateIds,
        candidateProjects: candidates,
        exceptions: [EXCEPTION_TYPES.FUZZY_PROJECT_DUPLICATE],
        exceptionMeta: {
            [EXCEPTION_TYPES.FUZZY_PROJECT_DUPLICATE]: EXCEPTION_META[EXCEPTION_TYPES.FUZZY_PROJECT_DUPLICATE],
        },
    };
}

function sortInboxItems(items) {
    return [...items].sort((left, right) => {
        const rightTime = new Date(right.sortTime || 0).getTime();
        const leftTime = new Date(left.sortTime || 0).getTime();
        if (rightTime !== leftTime) {
            return rightTime - leftTime;
        }

        const rightId = right.itemType === 'project-fuzzy-match' ? right.projectId : right.workLogId;
        const leftId = left.itemType === 'project-fuzzy-match' ? left.projectId : left.workLogId;
        return Number(rightId || 0) - Number(leftId || 0);
    });
}

export async function GET(request) {
    try {
        const url = new URL(request.url);
        const type = url.searchParams.get('type');
        const normalizedType = type && type !== 'all' ? type : null;
        if (normalizedType && !EXCEPTION_ORDER.includes(normalizedType)) {
            return NextResponse.json({ error: '无效的异常类型' }, { status: 400 });
        }

        const page = parsePositiveInt(url.searchParams.get('page'), 1, Number.MAX_SAFE_INTEGER);
        const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 50, 200);
        const projectId = url.searchParams.get('projectId');
        const counts = Object.fromEntries(EXCEPTION_ORDER.map((item) => [item, 0]));

        const shouldQueryWorkLogs = normalizedType !== EXCEPTION_TYPES.FUZZY_PROJECT_DUPLICATE;
        const shouldQueryFuzzyProjects = !normalizedType || normalizedType === EXCEPTION_TYPES.FUZZY_PROJECT_DUPLICATE;

        const workLogs = shouldQueryWorkLogs
            ? await prisma.workLog.findMany({
                where: buildInboxWhere({ projectId }),
                include: {
                    project: {
                        include: {
                            contract: true,
                        },
                    },
                    staffMembers: {
                        include: {
                            staff: true,
                        },
                    },
                    productionValues: true,
                },
                orderBy: [
                    { workDate: 'desc' },
                    { id: 'desc' },
                ],
            })
            : [];

        const workLogItems = workLogs
            .map((workLog) => {
                const detected = detectWorkLogExceptions(workLog);
                const exceptions = EXCEPTION_ORDER.filter((item) => detected.has(item));
                if (exceptions.length === 0) {
                    return null;
                }

                exceptions.forEach((item) => {
                    counts[item] += 1;
                });

                return serializeWorkLog(workLog, exceptions);
            })
            .filter(Boolean);

        const fuzzyProjects = shouldQueryFuzzyProjects
            ? await prisma.project.findMany({
                where: {
                    fuzzyMatchStatus: 'pending-review',
                    ...(Number.isInteger(Number.parseInt(projectId, 10))
                        ? { id: Number.parseInt(projectId, 10) }
                        : {}),
                },
                include: {
                    contract: {
                        select: {
                            id: true,
                            contractNo: true,
                        },
                    },
                },
                orderBy: [
                    { fuzzyMatchedAt: 'desc' },
                    { id: 'desc' },
                ],
            })
            : [];

        const allCandidateIds = Array.from(
            new Set(
                fuzzyProjects.flatMap((project) => parseFuzzyMatchCandidateIds(project.fuzzyMatchCandidateIds)),
            ),
        );

        const candidateProjects = allCandidateIds.length > 0
            ? await prisma.project.findMany({
                where: {
                    id: { in: allCandidateIds },
                },
                include: {
                    contract: {
                        select: {
                            id: true,
                            contractNo: true,
                        },
                    },
                },
            })
            : [];

        const candidateMap = new Map(candidateProjects.map((project) => [project.id, project]));
        const fuzzyItems = fuzzyProjects.map((project) => serializeProjectFuzzyMatch(project, candidateMap));
        counts[EXCEPTION_TYPES.FUZZY_PROJECT_DUPLICATE] = fuzzyItems.length;

        const resolvedItems = sortInboxItems([...workLogItems, ...fuzzyItems]);
        counts.total = resolvedItems.length;

        const filteredItems = normalizedType
            ? resolvedItems.filter((item) => item.exceptions.includes(normalizedType))
            : resolvedItems;
        const total = filteredItems.length;
        const start = (page - 1) * pageSize;
        const items = filteredItems.slice(start, start + pageSize);

        return NextResponse.json({
            counts,
            items,
            total,
            page,
            pageSize,
        });
    } catch (error) {
        console.error('List inbox exceptions error:', error);
        return NextResponse.json({ error: error.message || '获取异常收件箱失败' }, { status: 500 });
    }
}
