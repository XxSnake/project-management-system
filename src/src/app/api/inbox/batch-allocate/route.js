import prisma from '@/lib/prisma';
import { updateWorkLogAndRecalculate, WorkLogMutationError } from '@/lib/workLogMutations';
import { normalizeAllocationShare } from '@/lib/worklogBilling';
import { detectWorkLogExceptions, EXCEPTION_TYPES } from '@/lib/workLogExceptions';

import { NextResponse } from 'next/server';

class ClientInputError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'ClientInputError';
        this.status = status;
    }
}

function normalizeItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
        throw new ClientInputError('请先提交要处理的记录');
    }

    const seen = new Set();

    return items.map((item) => {
        const workLogId = Number.parseInt(item?.workLogId, 10);
        const allocationShare = normalizeAllocationShare(item?.allocationShare);

        if (!Number.isInteger(workLogId) || workLogId <= 0) {
            throw new ClientInputError('存在无效的工作记录 ID');
        }

        if (allocationShare === null) {
            throw new ClientInputError(`工作记录 #${workLogId} 的占比无效`);
        }

        if (seen.has(workLogId)) {
            throw new ClientInputError(`工作记录 #${workLogId} 重复提交`);
        }
        seen.add(workLogId);

        return {
            workLogId,
            allocationShare,
        };
    });
}

export async function POST(request) {
    try {
        const body = await request.json();
        const items = normalizeItems(body?.items);
        const workLogIds = items.map((item) => item.workLogId);
        const workLogs = await prisma.workLog.findMany({
            where: {
                id: {
                    in: workLogIds,
                },
            },
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
        });

        if (workLogs.length !== workLogIds.length) {
            const existingIds = new Set(workLogs.map((item) => item.id));
            const missingId = workLogIds.find((id) => !existingIds.has(id));
            return NextResponse.json({ error: `工作记录 #${missingId} 不存在` }, { status: 404 });
        }

        const logsById = new Map(workLogs.map((item) => [item.id, item]));
        const contractIds = new Set();

        for (const item of items) {
            const workLog = logsById.get(item.workLogId);
            const contractId = workLog?.project?.contract?.id || null;
            if (!contractId) {
                return NextResponse.json({ error: `工作记录 #${item.workLogId} 未绑定合同，不能批量填占比` }, { status: 400 });
            }

            contractIds.add(contractId);
            const exceptions = detectWorkLogExceptions(workLog);
            if (!exceptions.has(EXCEPTION_TYPES.PENDING_ALLOCATION_SHARE)) {
                return NextResponse.json({ error: `工作记录 #${item.workLogId} 当前已经不属于缺占比` }, { status: 400 });
            }
        }

        if (contractIds.size > 1) {
            return NextResponse.json({ error: '请先按合同分组处理，本次只能处理同一合同' }, { status: 400 });
        }

        const updatedItems = await prisma.$transaction(async (tx) => {
            const results = [];

            for (const item of items) {
                const result = await updateWorkLogAndRecalculate(item.workLogId, {
                    allocationShare: item.allocationShare,
                }, { tx });

                results.push({
                    workLogId: item.workLogId,
                    hasPendingAllocation: Boolean(result?.calculation?.pendingAllocation),
                });
            }

            return results;
        });

        return NextResponse.json({
            ok: true,
            updatedCount: updatedItems.length,
            items: updatedItems,
        });
    } catch (error) {
        console.error('Batch allocate inbox items error:', error);
        const status = error instanceof ClientInputError || error instanceof WorkLogMutationError
            ? error.status
            : 500;
        return NextResponse.json({ error: error.message || '批量填占比失败' }, { status });
    }
}
