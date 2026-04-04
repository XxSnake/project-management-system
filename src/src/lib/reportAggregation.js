import prisma from '@/lib/prisma';
import { normalizeAllocationShare, normalizePricingMode, sumProductionValues } from '@/lib/worklogBilling';

function getMonthRange(month) {
    if (!month) {
        return null;
    }

    const [year, monthIndex] = String(month)
        .split('-')
        .map((value) => Number.parseInt(value, 10));

    if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 1 || monthIndex > 12) {
        return null;
    }

    return {
        gte: new Date(year, monthIndex - 1, 1),
        lt: new Date(year, monthIndex, 1),
    };
}

export async function fetchReportLogs(month) {
    const range = getMonthRange(month);
    const where = range ? { workDate: range } : {};

    return prisma.workLog.findMany({
        where,
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
            productionValues: {
                include: {
                    staff: true,
                },
            },
        },
        orderBy: {
            workDate: 'asc',
        },
    });
}

function getLogMeta(log) {
    const quantity = Number.parseFloat(log.quantity) || 0;
    const staffMembers = Array.isArray(log.staffMembers) ? log.staffMembers : [];
    const staffCount = staffMembers.length;
    const totalValue = sumProductionValues(log);
    const contract = log.project?.contract || null;
    const pricingMode = normalizePricingMode(contract?.pricingMode);
    const share = normalizeAllocationShare(log.allocationShare);

    const isExceeded = (log.productionValues || []).some((item) => item.exceeded);

    return {
        quantity,
        totalValue,
        contract,
        pricingMode,
        share,
        staffMembers,
        staffCount,
        workloadPerStaff: staffCount > 0 ? quantity / staffCount : 0,
        hasContract: Boolean(contract?.id),
        isAreaPending: Boolean(contract?.id) && pricingMode === 'area' && totalValue <= 0,
        isExceeded,
    };
}

export function aggregateReports(logs, groupBy = 'staff') {
    if (groupBy === 'project') {
        const map = new Map();

        logs.forEach((log) => {
            const meta = getLogMeta(log);
            const projectId = log.project?.id || 0;
            const projectName = log.project?.name || '未绑定项目';

            if (!map.has(projectId)) {
                map.set(projectId, {
                    projectId,
                    projectName,
                    total: 0,
                    count: 0,
                    workloadCount: 0,
                    workloadQuantity: 0,
                    noContractCount: 0,
                    pendingAreaCount: 0,
                    exceededCount: 0,
                });
            }

            const entry = map.get(projectId);
            entry.total += meta.totalValue;
            entry.count += meta.totalValue > 0 ? 1 : 0;
            entry.workloadCount += 1;
            entry.workloadQuantity += meta.quantity;
            entry.noContractCount += meta.hasContract ? 0 : 1;
            entry.pendingAreaCount += meta.isAreaPending ? 1 : 0;
            entry.exceededCount += meta.isExceeded ? 1 : 0;
        });

        return Array.from(map.values())
            .map((item) => ({
                ...item,
                total: Number(item.total.toFixed(2)),
                workloadQuantity: Number(item.workloadQuantity.toFixed(2)),
            }))
            .sort((left, right) => (right.total - left.total) || (right.workloadQuantity - left.workloadQuantity));
    }

    const map = new Map();

    logs.forEach((log) => {
        const meta = getLogMeta(log);
        const productionByStaff = new Map(
            (log.productionValues || []).map((item) => [item.staffId, item]),
        );

        meta.staffMembers.forEach((item) => {
            const staffId = item.staffId;
            const staffName = item.staff?.name || '未命名人员';

            if (!map.has(staffId)) {
                map.set(staffId, {
                    staffId,
                    staffName,
                    total: 0,
                    count: 0,
                    workloadCount: 0,
                    workloadQuantity: 0,
                    noContractCount: 0,
                    pendingAreaCount: 0,
                    exceededCount: 0,
                });
            }

            const entry = map.get(staffId);
            const production = productionByStaff.get(staffId);

            entry.total += Number(production?.value || 0);
            entry.count += production ? 1 : 0;
            entry.workloadCount += 1;
            entry.workloadQuantity += meta.workloadPerStaff;
            entry.noContractCount += meta.hasContract ? 0 : 1;
            entry.pendingAreaCount += meta.isAreaPending ? 1 : 0;
            entry.exceededCount += meta.isExceeded ? 1 : 0;
        });
    });

    return Array.from(map.values())
        .map((item) => ({
            ...item,
            total: Number(item.total.toFixed(2)),
            workloadQuantity: Number(item.workloadQuantity.toFixed(2)),
        }))
        .sort((left, right) => (right.total - left.total) || (right.workloadQuantity - left.workloadQuantity));
}

export async function fetchTestReports(month) {
    const range = getMonthRange(month);
    const where = range ? { reportDate: range } : {};

    return prisma.testReport.findMany({
        where,
        include: {
            project: {
                include: {
                    contract: true,
                },
            },
            roles: {
                include: {
                    staff: true,
                },
            },
            productionValues: {
                include: {
                    staff: true,
                },
            },
        },
        orderBy: {
            reportDate: 'asc',
        },
    });
}

export function aggregateReportsWithType(logs, testReports, groupBy = 'staff') {
    if (groupBy === 'project') {
        const map = new Map();

        const ensureProject = (projectId, projectName) => {
            if (!map.has(projectId)) {
                map.set(projectId, {
                    projectId,
                    projectName,
                    total: 0,
                    testingTotal: 0,
                    reportTotal: 0,
                    count: 0,
                    workloadCount: 0,
                    workloadQuantity: 0,
                    reportCount: 0,
                    noContractCount: 0,
                    pendingAreaCount: 0,
                    exceededCount: 0,
                });
            }
            return map.get(projectId);
        };

        logs.forEach((log) => {
            const meta = getLogMeta(log);
            const entry = ensureProject(log.project?.id || 0, log.project?.name || '未绑定项目');
            entry.testingTotal += meta.totalValue;
            entry.total += meta.totalValue;
            entry.count += meta.totalValue > 0 ? 1 : 0;
            entry.workloadCount += 1;
            entry.workloadQuantity += meta.quantity;
            entry.noContractCount += meta.hasContract ? 0 : 1;
            entry.pendingAreaCount += meta.isAreaPending ? 1 : 0;
            entry.exceededCount += meta.isExceeded ? 1 : 0;
        });

        testReports.forEach((report) => {
            const reportValue = sumProductionValues(report);
            const entry = ensureProject(report.project?.id || 0, report.project?.name || '未绑定项目');
            entry.reportTotal += reportValue;
            entry.total += reportValue;
            entry.reportCount += 1;
            entry.count += reportValue > 0 ? 1 : 0;
        });

        return Array.from(map.values())
            .map((item) => ({
                ...item,
                total: Number(item.total.toFixed(2)),
                testingTotal: Number(item.testingTotal.toFixed(2)),
                reportTotal: Number(item.reportTotal.toFixed(2)),
                workloadQuantity: Number(item.workloadQuantity.toFixed(2)),
            }))
            .sort((a, b) => (b.total - a.total) || (b.workloadQuantity - a.workloadQuantity));
    }

    const map = new Map();

    const ensureStaff = (staffId, staffName) => {
        if (!map.has(staffId)) {
            map.set(staffId, {
                staffId,
                staffName,
                total: 0,
                testingTotal: 0,
                reportTotal: 0,
                count: 0,
                workloadCount: 0,
                workloadQuantity: 0,
                reportCount: 0,
                noContractCount: 0,
                pendingAreaCount: 0,
                exceededCount: 0,
            });
        }
        return map.get(staffId);
    };

    logs.forEach((log) => {
        const meta = getLogMeta(log);
        const productionByStaff = new Map(
            (log.productionValues || []).map((item) => [item.staffId, item]),
        );

        meta.staffMembers.forEach((item) => {
            const entry = ensureStaff(item.staffId, item.staff?.name || '未命名人员');
            const production = productionByStaff.get(item.staffId);
            const value = Number(production?.value || 0);

            entry.testingTotal += value;
            entry.total += value;
            entry.count += production ? 1 : 0;
            entry.workloadCount += 1;
            entry.workloadQuantity += meta.workloadPerStaff;
            entry.noContractCount += meta.hasContract ? 0 : 1;
            entry.pendingAreaCount += meta.isAreaPending ? 1 : 0;
            entry.exceededCount += meta.isExceeded ? 1 : 0;
        });
    });

    testReports.forEach((report) => {
        (report.productionValues || []).forEach((pv) => {
            const entry = ensureStaff(pv.staffId, pv.staff?.name || '未命名人员');
            const value = Number(pv.value || 0);

            entry.reportTotal += value;
            entry.total += value;
            entry.reportCount += 1;
            entry.count += value > 0 ? 1 : 0;
        });
    });

    return Array.from(map.values())
        .map((item) => ({
            ...item,
            total: Number(item.total.toFixed(2)),
            testingTotal: Number(item.testingTotal.toFixed(2)),
            reportTotal: Number(item.reportTotal.toFixed(2)),
            workloadQuantity: Number(item.workloadQuantity.toFixed(2)),
        }))
        .sort((a, b) => (b.total - a.total) || (b.workloadQuantity - a.workloadQuantity));
}

export function buildReportDetailRows(testReports) {
    const rows = [];
    const roleTypes = ['编写', '主检', '审核', '批准'];

    testReports.forEach((report) => {
        const quantity = Number.parseFloat(report.quantity) || 0;
        const pvByRole = new Map(
            (report.productionValues || []).map((pv) => [pv.roleType, pv]),
        );

        roleTypes.forEach((roleType) => {
            const role = (report.roles || []).find((r) => r.roleType === roleType);
            if (!role) return;

            const pv = pvByRole.get(roleType);

            rows.push({
                类型: '出具报告',
                日期: report.reportDate ? report.reportDate.toISOString().split('T')[0] : '',
                报告编号: report.reportNo || '',
                项目: report.project?.name || '未绑定项目',
                检测内容: report.testContent,
                数量: quantity,
                单位: report.unit || '',
                角色: roleType,
                人员: role.staff?.name || '',
                产值: Number((pv?.value || 0).toFixed(2)),
                价格来源: pv?.priceSource || '',
                状态: pv ? '已计价' : '未匹配',
            });
        });
    });

    return rows;
}

export function buildWorklogDetailRows(logs) {
    const rows = [];

    logs.forEach((log) => {
        const meta = getLogMeta(log);
        const productionByStaff = new Map(
            (log.productionValues || []).map((item) => [item.staffId, item]),
        );
        const staffMembers = meta.staffMembers.length > 0
            ? meta.staffMembers
            : [{ staffId: null, staff: { name: '' } }];

        staffMembers.forEach((item) => {
            const production = item.staffId ? productionByStaff.get(item.staffId) : null;

            rows.push({
                日期: log.workDate.toISOString().split('T')[0],
                项目: log.project?.name || '未绑定项目',
                检测内容: log.testContent,
                数量: meta.quantity,
                单位: log.unit || '',
                人员: item.staff?.name || '',
                工作量分摊: item.staffId ? Number(meta.workloadPerStaff.toFixed(2)) : meta.quantity,
                计价方式: meta.pricingMode === 'area' && meta.hasContract ? '面积合同' : (meta.hasContract ? '单价合同' : '未签合同'),
                占比: meta.share === null ? '' : `${(meta.share * 100).toFixed(2).replace(/\.?0+$/u, '')}%`,
                产值: Number((production?.value || 0).toFixed(2)),
                原始产值: production?.exceeded ? Number((production?.originalValue || 0).toFixed(2)) : '',
                价格来源: production?.priceSource || '',
                状态: meta.isExceeded
                    ? '产值超限'
                    : meta.isAreaPending
                        ? '待确认占比'
                        : (meta.hasContract ? (meta.totalValue > 0 ? '已计价' : '未匹配单价') : '仅统计工作量'),
            });
        });
    });

    return rows;
}
