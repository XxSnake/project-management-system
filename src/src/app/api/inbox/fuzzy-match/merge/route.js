import prisma from '@/lib/prisma';
import { parseFuzzyMatchCandidateIds } from '@/lib/projectFuzzyMatchLLM';
import { mergeProjects } from '@/lib/projectMerge';
import { scheduleProjectFuzzyMatch } from '@/lib/projectFuzzyMatchScheduler';
import { NextResponse } from 'next/server';

export async function POST(request) {
    try {
        const { projectId, targetProjectId } = await request.json();
        const normalizedProjectId = Number.parseInt(projectId, 10);
        const normalizedTargetProjectId = Number.parseInt(targetProjectId, 10);

        if (!Number.isInteger(normalizedProjectId) || !Number.isInteger(normalizedTargetProjectId)) {
            return NextResponse.json({ error: '缺少有效的项目 ID' }, { status: 400 });
        }

        if (normalizedProjectId === normalizedTargetProjectId) {
            return NextResponse.json({ error: '不能合并到自己' }, { status: 400 });
        }

        const project = await prisma.project.findUnique({
            where: { id: normalizedProjectId },
            select: {
                id: true,
                fuzzyMatchStatus: true,
                fuzzyMatchCandidateIds: true,
            },
        });

        if (!project) {
            return NextResponse.json({ error: '项目不存在' }, { status: 404 });
        }

        if (project.fuzzyMatchStatus !== 'pending-review') {
            return NextResponse.json({ error: '这条疑似重名记录已经不在待处理状态' }, { status: 409 });
        }

        const candidateIds = parseFuzzyMatchCandidateIds(project.fuzzyMatchCandidateIds);
        if (!candidateIds.includes(normalizedTargetProjectId)) {
            return NextResponse.json({ error: '合并目标不在当前候选项目列表里' }, { status: 400 });
        }

        const result = await mergeProjects({
            targetId: normalizedTargetProjectId,
            sourceIds: [normalizedProjectId],
            prismaClient: prisma,
        });

        scheduleProjectFuzzyMatch(result.targetProjectId);

        return NextResponse.json({
            success: true,
            targetProject: result.targetProjectName,
            ...result,
        });
    } catch (error) {
        return NextResponse.json({
            error: error instanceof Error ? error.message : '合并疑似重名项目失败',
        }, { status: 500 });
    }
}
