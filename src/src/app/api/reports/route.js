import { aggregateReportsWithType, fetchReportLogs, fetchTestReports } from '@/lib/reportAggregation';

import { NextResponse } from 'next/server';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const groupBy = searchParams.get('groupBy') || 'staff';

    const [logs, testReports] = await Promise.all([
        fetchReportLogs(month),
        fetchTestReports(month),
    ]);

    const items = aggregateReportsWithType(logs, testReports, groupBy === 'project' ? 'project' : 'staff');

    return NextResponse.json(items);
}
