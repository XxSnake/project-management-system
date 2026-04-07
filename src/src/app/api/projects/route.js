import prisma from '@/lib/prisma';
import { retroactiveCalculation } from '@/lib/productionCalculator';
import { NextResponse } from 'next/server';

export async function GET() {
    const projects = await prisma.project.findMany({
        include: { contract: true },
        orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(projects);
}

export async function POST(request) {
    const data = await request.json();

    if (!data.name || !String(data.name).trim()) {
        return NextResponse.json({ error: '项目名称不能为空' }, { status: 400 });
    }
    const trimmedName = String(data.name).trim();
    const duplicate = await prisma.project.findFirst({ where: { name: trimmedName } });
    if (duplicate) {
        return NextResponse.json({ error: `已存在同名项目：${trimmedName}` }, { status: 409 });
    }

    const project = await prisma.project.create({
        data: {
            name: trimmedName,
            status: data.status || '进行中',
            phase: data.phase || null,
            contractId: data.contractId || null,
        },
    });

    return NextResponse.json(project);
}

export async function PUT(request) {
    const data = await request.json();

    if (!data.id) {
        return NextResponse.json({ error: '缺少项目 ID' }, { status: 400 });
    }

    const projectId = Number(data.id);

    // 检查是否是新关联合同（之前没有合同，现在有了）
    const oldProject = await prisma.project.findUnique({
        where: { id: projectId },
        select: { contractId: true },
    });

    const newContractId = data.contractId || null;
    const isNewContractLink = !oldProject?.contractId && newContractId;

    const updateData = {
        name: data.name,
        status: data.status || '进行中',
        phase: data.phase || null,
        contractId: newContractId,
    };

    // 首次关联合同时记录时间
    if (isNewContractLink) {
        updateData.contractLinkedAt = new Date();
    }

    const project = await prisma.project.update({
        where: { id: projectId },
        data: updateData,
        include: { contract: true },
    });

    // 首次关联合同 → 自动触发补算
    let retroResult = null;
    if (isNewContractLink) {
        retroResult = await retroactiveCalculation(projectId);
    }

    return NextResponse.json({
        ...project,
        retroactiveResult: retroResult,
    });
}

export async function DELETE(request) {
    const { id, ids } = await request.json();

    if (Array.isArray(ids) && ids.length > 0) {
        const normalizedIds = ids
            .map((item) => Number.parseInt(item, 10))
            .filter((item) => !Number.isNaN(item));

        if (normalizedIds.length === 0) {
            return NextResponse.json({ error: '无效的项目 ID 列表' }, { status: 400 });
        }

        const result = await prisma.project.deleteMany({
            where: { id: { in: normalizedIds } },
        });

        return NextResponse.json({ success: true, deletedCount: result.count });
    }

    if (!id) {
        return NextResponse.json({ error: '缺少项目 ID' }, { status: 400 });
    }

    await prisma.project.delete({ where: { id } });
    return NextResponse.json({ success: true, deletedCount: 1 });
}
