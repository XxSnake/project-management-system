import { runProjectFuzzyMatchBatch } from '@/lib/projectFuzzyMatchScheduler';
import { NextResponse } from 'next/server';

export async function POST(request) {
    try {
        const body = await request.json().catch(() => ({}));
        const projectIds = Array.isArray(body?.projectIds)
            ? body.projectIds
            : (body?.projectId !== undefined ? [body.projectId] : []);

        if (projectIds.length === 0) {
            return NextResponse.json({ error: '缺少 projectId 或 projectIds' }, { status: 400 });
        }

        const results = await runProjectFuzzyMatchBatch(projectIds, {
            limit: body?.limit,
            threshold: body?.threshold,
        });

        return NextResponse.json({
            success: true,
            results,
        });
    } catch (error) {
        return NextResponse.json({
            error: error instanceof Error ? error.message : '运行项目判重扫描失败',
        }, { status: 500 });
    }
}
