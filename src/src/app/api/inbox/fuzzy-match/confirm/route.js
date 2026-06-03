import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function POST(request) {
    try {
        const { projectId } = await request.json();
        const normalizedProjectId = Number.parseInt(projectId, 10);

        if (!Number.isInteger(normalizedProjectId)) {
            return NextResponse.json({ error: '缺少有效的项目 ID' }, { status: 400 });
        }

        const project = await prisma.project.findUnique({
            where: { id: normalizedProjectId },
            select: { id: true },
        });

        if (!project) {
            return NextResponse.json({ error: '项目不存在' }, { status: 404 });
        }

        const updatedProject = await prisma.project.update({
            where: { id: normalizedProjectId },
            data: {
                fuzzyMatchStatus: 'confirmed-distinct',
                fuzzyMatchCandidateIds: null,
                fuzzyMatchedAt: new Date(),
            },
        });

        return NextResponse.json({
            success: true,
            projectId: updatedProject.id,
            fuzzyMatchStatus: updatedProject.fuzzyMatchStatus,
        });
    } catch (error) {
        return NextResponse.json({
            error: error instanceof Error ? error.message : '确认项目不重复失败',
        }, { status: 500 });
    }
}
