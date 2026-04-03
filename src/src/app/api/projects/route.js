import prisma from '@/lib/prisma';
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

    const project = await prisma.project.create({
        data: {
            name: data.name,
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

    const project = await prisma.project.update({
        where: { id: Number(data.id) },
        data: {
            name: data.name,
            status: data.status || '进行中',
            phase: data.phase || null,
            contractId: data.contractId || null,
        },
        include: { contract: true },
    });

    return NextResponse.json(project);
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
