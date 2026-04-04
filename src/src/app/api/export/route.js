import {
    aggregateReportsWithType,
    buildReportDetailRows,
    buildWorklogDetailRows,
    fetchReportLogs,
    fetchTestReports,
} from '@/lib/reportAggregation';

import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

function buildProjectMatrixRows(logs) {
    const staffNames = Array.from(
        new Set(
            logs.flatMap((log) => (log.staffMembers || []).map((item) => item.staff?.name).filter(Boolean)),
        ),
    ).sort((left, right) => left.localeCompare(right, 'zh-CN'));

    const map = new Map();

    logs.forEach((log) => {
        const projectId = log.project?.id || 0;
        const projectName = log.project?.name || '未绑定项目';
        const totalValue = (log.productionValues || []).reduce((sum, item) => sum + Number(item.value || 0), 0);

        if (!map.has(projectId)) {
            const row = {
                项目名称: projectName,
                项目总产值: 0,
            };
            staffNames.forEach((name) => {
                row[name] = 0;
            });
            map.set(projectId, row);
        }

        const row = map.get(projectId);
        row.项目总产值 += totalValue;

        (log.productionValues || []).forEach((item) => {
            const name = item.staff?.name;
            if (name && Object.prototype.hasOwnProperty.call(row, name)) {
                row[name] += Number(item.value || 0);
            }
        });
    });

    const rows = Array.from(map.values()).sort((left, right) => right.项目总产值 - left.项目总产值);
    if (rows.length === 0) {
        return rows;
    }

    const totalRow = {
        项目名称: '合计',
        项目总产值: rows.reduce((sum, row) => sum + row.项目总产值, 0),
    };
    staffNames.forEach((name) => {
        totalRow[name] = rows.reduce((sum, row) => sum + row[name], 0);
    });
    rows.push(totalRow);

    return rows;
}

function addSheet(workbook, rows, sheetName) {
    if (rows.length === 0) return;
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const columns = Object.keys(rows[0] || {}).map((key) => {
        const maxLength = Math.max(
            key.length * 2,
            ...rows.map((row) => String(row[key] ?? '').length),
        );
        return { wch: Math.min(maxLength + 2, 36) };
    });
    worksheet['!cols'] = columns;
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
}

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const groupBy = searchParams.get('groupBy') || 'staff';

    const [logs, testReports] = await Promise.all([
        fetchReportLogs(month),
        fetchTestReports(month),
    ]);

    const workbook = XLSX.utils.book_new();

    if (groupBy === 'detail') {
        const worklogRows = buildWorklogDetailRows(logs);
        const reportRows = buildReportDetailRows(testReports);
        addSheet(workbook, worklogRows.length > 0 ? worklogRows : [{ 提示: '暂无检测工作记录' }], '检测工作明细');
        addSheet(workbook, reportRows.length > 0 ? reportRows : [{ 提示: '暂无报告记录' }], '出具报告明细');
    } else if (groupBy === 'staff') {
        const items = aggregateReportsWithType(logs, testReports, 'staff');
        const rows = items.map((item) => ({
            人员: item.staffName,
            检测工作产值: item.testingTotal,
            出具报告产值: item.reportTotal,
            产值合计: item.total,
            计价记录数: item.count,
            工作量记录数: item.workloadCount,
            报告记录数: item.reportCount,
            工作量合计: item.workloadQuantity,
            未签合同记录: item.noContractCount,
            待确认占比: item.pendingAreaCount,
            产值超限: item.exceededCount,
        }));

        rows.push({
            人员: '合计',
            检测工作产值: Number(rows.reduce((s, r) => s + Number(r.检测工作产值 || 0), 0).toFixed(2)),
            出具报告产值: Number(rows.reduce((s, r) => s + Number(r.出具报告产值 || 0), 0).toFixed(2)),
            产值合计: Number(rows.reduce((s, r) => s + Number(r.产值合计 || 0), 0).toFixed(2)),
            计价记录数: rows.reduce((s, r) => s + Number(r.计价记录数 || 0), 0),
            工作量记录数: rows.reduce((s, r) => s + Number(r.工作量记录数 || 0), 0),
            报告记录数: rows.reduce((s, r) => s + Number(r.报告记录数 || 0), 0),
            工作量合计: Number(rows.reduce((s, r) => s + Number(r.工作量合计 || 0), 0).toFixed(2)),
            未签合同记录: rows.reduce((s, r) => s + Number(r.未签合同记录 || 0), 0),
            待确认占比: rows.reduce((s, r) => s + Number(r.待确认占比 || 0), 0),
            产值超限: rows.reduce((s, r) => s + Number(r.产值超限 || 0), 0),
        });

        addSheet(workbook, rows, '人员产值汇总');
    } else if (groupBy === 'project') {
        const items = aggregateReportsWithType(logs, testReports, 'project');
        const rows = items.map((item) => ({
            项目: item.projectName,
            检测工作产值: item.testingTotal,
            出具报告产值: item.reportTotal,
            产值合计: item.total,
            计价记录数: item.count,
            工作量记录数: item.workloadCount,
            报告记录数: item.reportCount,
            工作量合计: item.workloadQuantity,
            未签合同记录: item.noContractCount,
            待确认占比: item.pendingAreaCount,
            产值超限: item.exceededCount,
        }));
        addSheet(workbook, rows, '项目产值汇总');
    } else {
        const rows = buildProjectMatrixRows(logs);
        addSheet(workbook, rows.length > 0 ? rows : [{ 提示: '暂无数据' }], '项目-人员矩阵');
    }

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const fileName = `产值报表_${month || '全部'}_${groupBy}.xlsx`;

    return new NextResponse(buffer, {
        headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        },
    });
}
