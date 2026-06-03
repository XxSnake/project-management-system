import prisma from '@/lib/prisma';

function formatTesters(staffMembers = []) {
    return staffMembers
        .map((item) => item.staff?.name)
        .filter(Boolean)
        .join('、');
}

function formatQuantity(quantity, unit) {
    if (quantity === null || quantity === undefined) return '';
    const q = Number(quantity);
    if (!Number.isFinite(q)) return '';
    return unit ? `${q}${unit}` : `${q}`;
}

/**
 * 在 WorkLog 写入后同步到项目检测记录覆盖层。
 * - 首次：根据 worklog 初始化 override 和 src 快照
 * - 已存在：仅刷新 src 快照（保留用户的覆盖层编辑）
 */
export async function syncDetectionRecordFromWorkLog(workLogId, options = {}) {
    const { tx = prisma } = options;

    if (!workLogId) return null;

    const log = await tx.workLog.findUnique({
        where: { id: workLogId },
        include: {
            project: true,
            staffMembers: { include: { staff: true } },
        },
    });

    if (!log || !log.projectId) return null;

    const srcTestItem = log.testContent || '';
    const srcQuantityText = formatQuantity(log.quantity, log.unit);
    const srcDetectDate = log.workDate || null;
    const srcMainTester = formatTesters(log.staffMembers);

    const existing = await tx.projectDetectionRecord.findUnique({
        where: { workLogId },
    });

    if (existing) {
        // 只更新 src 快照 + 项目归属；overrides 由用户管理
        return tx.projectDetectionRecord.update({
            where: { id: existing.id },
            data: {
                projectId: log.projectId,
                srcTestItem,
                srcQuantityText,
                srcDetectDate,
                srcMainTester,
            },
        });
    }

    const count = await tx.projectDetectionRecord.count({
        where: { projectId: log.projectId },
    });

    return tx.projectDetectionRecord.create({
        data: {
            projectId: log.projectId,
            workLogId,
            sequence: count + 1,
            testItem: srcTestItem,
            quantityText: srcQuantityText,
            detectDate: srcDetectDate,
            mainTester: srcMainTester,
            remarks: log.remarks || null,
            srcTestItem,
            srcQuantityText,
            srcDetectDate,
            srcMainTester,
        },
    });
}

export function computeDetectionDrift(record) {
    if (!record) return false;
    const sameStr = (a, b) => (a || '') === (b || '');
    const sameDate = (a, b) => {
        const aTs = a ? new Date(a).getTime() : 0;
        const bTs = b ? new Date(b).getTime() : 0;
        return aTs === bTs;
    };
    return !(
        sameStr(record.testItem, record.srcTestItem)
        && sameStr(record.quantityText, record.srcQuantityText)
        && sameDate(record.detectDate, record.srcDetectDate)
        && sameStr(record.mainTester, record.srcMainTester)
    );
}
