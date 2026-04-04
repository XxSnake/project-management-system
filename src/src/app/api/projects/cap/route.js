import prisma from '@/lib/prisma';
import { getProjectCapProgress } from '@/lib/productionCap';
import { NextResponse } from 'next/server';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const projectId = Number(searchParams.get('projectId'));

    if (!projectId || Number.isNaN(projectId)) {
        return NextResponse.json({ error: '缺少项目 ID' }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: { contract: { include: { priceItems: true } } },
    });

    if (!project) {
        return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    const progress = await getProjectCapProgress(projectId, project.contract);
    return NextResponse.json({
        projectId,
        projectName: project.name,
        hasContract: Boolean(project.contract),
        pricingMode: project.contract?.pricingMode || null,
        progress,
    });
}
