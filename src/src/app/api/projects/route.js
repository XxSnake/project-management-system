import prisma from '@/lib/prisma';
import { buildProjectDisplayName } from '@/lib/projectDisplayName';
import { retroactiveCalculation } from '@/lib/productionCalculator';
import { scheduleProjectFuzzyMatch } from '@/lib/projectFuzzyMatchScheduler';
import {
    isLikelyCorruptedProjectName,
    resolveProjectNameRepairCandidate,
} from '@/lib/projectNameRepair';
import { NextResponse } from 'next/server';

function normalizeBuildingMode(value, fallback = false) {
    if (value === undefined) {
        return fallback;
    }

    return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeNoContractExpected(value, fallback = false) {
    if (value === undefined) {
        return fallback;
    }

    return value === true || value === 'true' || value === 1 || value === '1';
}

function shouldScheduleFuzzyMatch(oldProject, nextProject) {
    if (!oldProject) {
        return true;
    }

    return (
        oldProject.name !== nextProject.name
        || (oldProject.phase ?? null) !== (nextProject.phase ?? null)
        || Boolean(oldProject.buildingMode) !== Boolean(nextProject.buildingMode)
        || Number(oldProject.contractId || 0) !== Number(nextProject.contractId || 0)
    );
}

export async function GET() {
    const projects = await prisma.project.findMany({
        include: { contract: { include: { priceItems: true } } },
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
    const trimmedPhase = data.phase ? String(data.phase).trim() : null;
    const buildingMode = normalizeBuildingMode(data.buildingMode);
    const contractId = data.contractId || null;
    const noContractExpected = normalizeNoContractExpected(data.noContractExpected);

    if (contractId && noContractExpected) {
        return NextResponse.json({ error: '已关联合同的项目不能标记为无需合同' }, { status: 400 });
    }

    const duplicate = await prisma.project.findFirst({
        where: {
            name: trimmedName,
            phase: trimmedPhase,
        },
    });
    if (duplicate) {
        return NextResponse.json({ error: `已存在同名项目：${buildProjectDisplayName(trimmedName, trimmedPhase)}` }, { status: 409 });
    }

    const project = await prisma.project.create({
        data: {
            name: trimmedName,
            status: data.status || '进行中',
            phase: trimmedPhase,
            buildingMode,
            contractId,
            noContractExpected,
        },
    });

    scheduleProjectFuzzyMatch(project.id);
    return NextResponse.json(project);
}

export async function PUT(request) {
    const data = await request.json();

    if (!data.id) {
        return NextResponse.json({ error: '缺少项目 ID' }, { status: 400 });
    }

    const projectId = Number(data.id);
    const oldProject = await prisma.project.findUnique({
        where: { id: projectId },
        select: {
            id: true,
            name: true,
            phase: true,
            contractId: true,
            buildingMode: true,
            noContractExpected: true,
        },
    });

    if (!oldProject) {
        return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    const newContractId = data.contractId || null;
    const isNewContractLink = !oldProject.contractId && newContractId;
    let nextProjectName = String(data.name ?? '').trim();

    if (!nextProjectName) {
        return NextResponse.json({ error: '项目名称不能为空' }, { status: 400 });
    }

    if (isLikelyCorruptedProjectName(nextProjectName)) {
        const repairedName = !isLikelyCorruptedProjectName(oldProject.name)
            ? oldProject.name
            : await resolveProjectNameRepairCandidate(prisma, {
                projectId,
                contractId: oldProject.contractId || newContractId,
            });

        if (repairedName) {
            nextProjectName = repairedName;
        }
    }

    const nextPhase = data.phase ? String(data.phase).trim() : null;
    const nextBuildingMode = normalizeBuildingMode(
        data.buildingMode,
        Boolean(oldProject.buildingMode),
    );
    const nextNoContractExpected = Object.prototype.hasOwnProperty.call(data, 'noContractExpected')
        ? normalizeNoContractExpected(data.noContractExpected, Boolean(oldProject.noContractExpected))
        : (newContractId ? false : Boolean(oldProject.noContractExpected));

    if (newContractId && nextNoContractExpected) {
        return NextResponse.json({ error: '已关联合同的项目不能标记为无需合同' }, { status: 400 });
    }

    const duplicate = await prisma.project.findFirst({
        where: {
            name: nextProjectName,
            phase: nextPhase,
            NOT: {
                id: projectId,
            },
        },
    });
    if (duplicate) {
        return NextResponse.json({ error: `已存在同名项目：${buildProjectDisplayName(nextProjectName, nextPhase)}` }, { status: 409 });
    }

    const updateData = {
        name: nextProjectName,
        status: data.status || '进行中',
        phase: nextPhase,
        buildingMode: nextBuildingMode,
        contractId: newContractId,
        noContractExpected: nextNoContractExpected,
    };

    if (isNewContractLink) {
        updateData.contractLinkedAt = new Date();
    }

    const project = await prisma.project.update({
        where: { id: projectId },
        data: updateData,
        include: { contract: true },
    });

    if (shouldScheduleFuzzyMatch(oldProject, project)) {
        scheduleProjectFuzzyMatch(projectId);
    }

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
