import { normalizeAllocationShare, normalizePricingMode } from '@/lib/worklogBilling';
import { isNonBillableLayoutWork, isNonWorkloadWork } from '@/lib/worklogClassification';

export const EXCEPTION_TYPES = {
    INVALID_QUANTITY: 'invalid-quantity',
    MISSING_STAFF: 'missing-staff',
    NO_PRICE_MATCH: 'no-price-match',
    PENDING_ALLOCATION_SHARE: 'pending-area-share',
    CONTRACT_INCOMPLETE: 'contract-incomplete',
    WORKLOAD_ONLY: 'workload-only',
    FUZZY_PROJECT_DUPLICATE: 'fuzzy-project-duplicate',
    EXCEEDED: 'exceeded',
};

export const EXCEPTION_ORDER = [
    EXCEPTION_TYPES.INVALID_QUANTITY,
    EXCEPTION_TYPES.MISSING_STAFF,
    EXCEPTION_TYPES.NO_PRICE_MATCH,
    EXCEPTION_TYPES.PENDING_ALLOCATION_SHARE,
    EXCEPTION_TYPES.CONTRACT_INCOMPLETE,
    EXCEPTION_TYPES.WORKLOAD_ONLY,
    EXCEPTION_TYPES.FUZZY_PROJECT_DUPLICATE,
    EXCEPTION_TYPES.EXCEEDED,
];

export const WORKLOG_EXCEPTION_ORDER = EXCEPTION_ORDER.filter((type) => type !== EXCEPTION_TYPES.FUZZY_PROJECT_DUPLICATE);

export const ACKNOWLEDGEABLE_EXCEPTION_TYPES = new Set([
    EXCEPTION_TYPES.INVALID_QUANTITY,
    EXCEPTION_TYPES.MISSING_STAFF,
    EXCEPTION_TYPES.NO_PRICE_MATCH,
    EXCEPTION_TYPES.WORKLOAD_ONLY,
]);

export const EXCEPTION_META = {
    [EXCEPTION_TYPES.INVALID_QUANTITY]: {
        code: 'E1',
        label: '数量异常',
        tone: 'danger',
    },
    [EXCEPTION_TYPES.MISSING_STAFF]: {
        code: 'E3',
        label: '缺人员',
        tone: 'warning',
    },
    [EXCEPTION_TYPES.NO_PRICE_MATCH]: {
        code: 'E4',
        label: '缺单价',
        tone: 'warning',
    },
    [EXCEPTION_TYPES.PENDING_ALLOCATION_SHARE]: {
        code: 'E5',
        label: '缺占比',
        tone: 'warning',
    },
    [EXCEPTION_TYPES.CONTRACT_INCOMPLETE]: {
        code: 'E6',
        label: '合同缺字段',
        tone: 'warning',
    },
    [EXCEPTION_TYPES.WORKLOAD_ONLY]: {
        code: 'E7',
        label: '项目未绑合同',
        tone: 'warning',
    },
    [EXCEPTION_TYPES.FUZZY_PROJECT_DUPLICATE]: {
        code: 'E8',
        label: '项目疑似重名',
        tone: 'warning',
    },
    [EXCEPTION_TYPES.EXCEEDED]: {
        code: 'E9',
        label: '产值超限',
        tone: 'danger',
    },
};

const VALID_WORKLOG_EXCEPTION_TYPES = new Set(WORKLOG_EXCEPTION_ORDER);

function parseNumber(value) {
    const numeric = Number.parseFloat(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function hasPositiveNumber(value) {
    const numeric = parseNumber(value);
    return numeric !== null && numeric > 0;
}

function hasPositiveManualValue(workLog) {
    return hasPositiveNumber(workLog?.manualTotalValue);
}

function hasStaff(workLog) {
    return Array.isArray(workLog?.staffMembers) && workLog.staffMembers.length > 0;
}

function hasProductionValues(workLog) {
    return Array.isArray(workLog?.productionValues) && workLog.productionValues.length > 0;
}

function hasExceededProduction(workLog) {
    return (workLog?.productionValues || []).some((item) => item?.exceeded);
}

function hasContract(workLog) {
    return Boolean(workLog?.project?.contractId || workLog?.project?.contract?.id);
}

function collectAllExceptions(workLog) {
    const exceptions = new Set();
    const quantity = parseNumber(workLog?.quantity);
    const allocationShare = normalizeAllocationShare(workLog?.allocationShare);
    const contract = workLog?.project?.contract || null;
    const pricingMode = normalizePricingMode(contract?.pricingMode);
    const nonBillableLayout = isNonBillableLayoutWork(workLog);
    const nonWorkload = isNonWorkloadWork(workLog);
    const excludedFromBilling = nonBillableLayout || nonWorkload;
    const manualValued = hasPositiveManualValue(workLog);
    const contractExists = hasContract(workLog);

    if ((quantity === null || quantity <= 0) && !excludedFromBilling) {
        exceptions.add(EXCEPTION_TYPES.INVALID_QUANTITY);
    }

    if (!hasStaff(workLog)) {
        exceptions.add(EXCEPTION_TYPES.MISSING_STAFF);
    }

    if (
        contractExists
        && (pricingMode === 'unit' || pricingMode === 'mixed')
        && !hasProductionValues(workLog)
        && !manualValued
        && !excludedFromBilling
        && allocationShare === null
    ) {
        exceptions.add(EXCEPTION_TYPES.NO_PRICE_MATCH);
    }

    if (contractExists && !manualValued && !excludedFromBilling) {
        if (pricingMode === 'area' && allocationShare === null) {
            exceptions.add(EXCEPTION_TYPES.PENDING_ALLOCATION_SHARE);
        }

        if (pricingMode === 'lumpsum' && allocationShare === null && hasPositiveNumber(contract?.lumpSumAmount)) {
            exceptions.add(EXCEPTION_TYPES.PENDING_ALLOCATION_SHARE);
        }

        if (pricingMode === 'mixed' && allocationShare === null && hasPositiveNumber(contract?.lumpSumAmount)) {
            exceptions.add(EXCEPTION_TYPES.PENDING_ALLOCATION_SHARE);
        }
    }

    if (
        contractExists
        && !manualValued
        && !excludedFromBilling
        && (
            (pricingMode === 'area' && !hasPositiveNumber(contract?.areaPricingAmount))
            || (pricingMode === 'lumpsum' && !hasPositiveNumber(contract?.lumpSumAmount))
        )
    ) {
        exceptions.add(EXCEPTION_TYPES.CONTRACT_INCOMPLETE);
    }

    if (!contractExists && !workLog?.project?.noContractExpected && !manualValued && !excludedFromBilling) {
        exceptions.add(EXCEPTION_TYPES.WORKLOAD_ONLY);
    }

    if (hasExceededProduction(workLog) && !nonWorkload) {
        exceptions.add(EXCEPTION_TYPES.EXCEEDED);
    }

    return exceptions;
}

export function parseAcknowledgedExceptions(value) {
    if (value === null || value === undefined) {
        return new Set();
    }

    return new Set(
        String(value)
            .split(',')
            .map((item) => item.trim())
            .filter((item) => VALID_WORKLOG_EXCEPTION_TYPES.has(item)),
    );
}

export function serializeAcknowledgedExceptions(values) {
    const items = Array.isArray(values) ? values : Array.from(values || []);
    const seen = new Set(items);
    const deduped = WORKLOG_EXCEPTION_ORDER.filter((item) => seen.has(item));

    if (deduped.length === 0) {
        return null;
    }

    return deduped.join(',');
}

export function addAcknowledgement(current, type) {
    if (!VALID_WORKLOG_EXCEPTION_TYPES.has(type)) {
        return serializeAcknowledgedExceptions(parseAcknowledgedExceptions(current));
    }

    const next = parseAcknowledgedExceptions(current);
    next.add(type);
    return serializeAcknowledgedExceptions(next);
}

export function removeAcknowledgement(current, type) {
    const next = parseAcknowledgedExceptions(current);
    next.delete(type);
    return serializeAcknowledgedExceptions(next);
}

export function detectWorkLogExceptions(workLog, options = {}) {
    const { includeAcknowledged = false } = options;
    const detected = collectAllExceptions(workLog);

    if (includeAcknowledged) {
        return detected;
    }

    const acknowledged = parseAcknowledgedExceptions(workLog?.acknowledgedExceptions);
    return new Set(Array.from(detected).filter((item) => !acknowledged.has(item)));
}

function buildTypeCondition(type) {
    switch (type) {
    case EXCEPTION_TYPES.INVALID_QUANTITY:
        return { quantity: { lte: 0 } };
    case EXCEPTION_TYPES.MISSING_STAFF:
        return { staffMembers: { none: {} } };
    case EXCEPTION_TYPES.NO_PRICE_MATCH:
        return {
            AND: [
                { productionValues: { none: {} } },
                { manualTotalValue: null },
                { allocationShare: null },
                {
                    project: {
                        is: {
                            contractId: { not: null },
                            contract: {
                                is: {
                                    pricingMode: {
                                        in: ['unit', 'mixed'],
                                    },
                                },
                            },
                        },
                    },
                },
            ],
        };
    case EXCEPTION_TYPES.PENDING_ALLOCATION_SHARE:
        return {
            AND: [
                { manualTotalValue: null },
                {
                    NOT: {
                        OR: [
                            { testContent: { contains: '布点' } },
                            { testContent: { contains: '布设' } },
                            { testContent: '布' },
                        ],
                    },
                },
                {
                    OR: [
                        {
                            AND: [
                                { allocationShare: null },
                                {
                                    project: {
                                        is: {
                                            contractId: { not: null },
                                            contract: {
                                                is: {
                                                    pricingMode: 'area',
                                                },
                                            },
                                        },
                                    },
                                },
                            ],
                        },
                        {
                            AND: [
                                { allocationShare: null },
                                {
                                    project: {
                                        is: {
                                            contractId: { not: null },
                                            contract: {
                                                is: {
                                                    pricingMode: 'lumpsum',
                                                    lumpSumAmount: { gt: 0 },
                                                },
                                            },
                                        },
                                    },
                                },
                            ],
                        },
                        {
                            AND: [
                                { allocationShare: null },
                                {
                                    project: {
                                        is: {
                                            contractId: { not: null },
                                            contract: {
                                                is: {
                                                    pricingMode: 'mixed',
                                                    lumpSumAmount: { gt: 0 },
                                                },
                                            },
                                        },
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        };
    case EXCEPTION_TYPES.CONTRACT_INCOMPLETE:
        return {
            AND: [
                { manualTotalValue: null },
                {
                    OR: [
                        {
                            project: {
                                is: {
                                    contractId: { not: null },
                                    contract: {
                                        is: {
                                            pricingMode: 'area',
                                            OR: [
                                                { areaPricingAmount: null },
                                                { areaPricingAmount: { lte: 0 } },
                                            ],
                                        },
                                    },
                                },
                            },
                        },
                        {
                            project: {
                                is: {
                                    contractId: { not: null },
                                    contract: {
                                        is: {
                                            pricingMode: 'lumpsum',
                                            OR: [
                                                { lumpSumAmount: null },
                                                { lumpSumAmount: { lte: 0 } },
                                            ],
                                        },
                                    },
                                },
                            },
                        },
                    ],
                },
            ],
        };
    case EXCEPTION_TYPES.WORKLOAD_ONLY:
        return {
            AND: [
                { manualTotalValue: null },
                {
                    OR: [
                        { project: { is: null } },
                        {
                            project: {
                                is: {
                                    contractId: null,
                                    noContractExpected: false,
                                },
                            },
                        },
                    ],
                },
            ],
        };
    case EXCEPTION_TYPES.EXCEEDED:
        return {
            productionValues: {
                some: {
                    exceeded: true,
                },
            },
        };
    default:
        return null;
    }
}

export function buildInboxWhere(filter = {}) {
    const type = VALID_WORKLOG_EXCEPTION_TYPES.has(filter?.type) ? filter.type : null;
    const projectId = Number.parseInt(filter?.projectId, 10);
    const conditions = (type ? [buildTypeCondition(type)] : WORKLOG_EXCEPTION_ORDER.map(buildTypeCondition)).filter(Boolean);
    const where = {};

    if (Number.isInteger(projectId)) {
        where.projectId = projectId;
    }

    if (conditions.length > 0) {
        where.OR = conditions;
    }

    return where;
}
