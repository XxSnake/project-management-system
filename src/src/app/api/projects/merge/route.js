import prisma from '@/lib/prisma';
import { mergeProjects } from '@/lib/projectMerge';
import { scheduleProjectFuzzyMatch } from '@/lib/projectFuzzyMatchScheduler';
import { NextResponse } from 'next/server';

export async function POST(request) {
    try {
        const { targetId, sourceIds } = await request.json();
        const result = await mergeProjects({
            targetId,
            sourceIds,
            prismaClient: prisma,
        });

        scheduleProjectFuzzyMatch(result.targetProjectId);

        return NextResponse.json({
            success: true,
            targetProject: result.targetProjectName,
            ...result,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : '合并项目失败';
        const status = message.includes('不存在') ? 404 : 400;
        return NextResponse.json({ error: message }, { status });
    }
}
