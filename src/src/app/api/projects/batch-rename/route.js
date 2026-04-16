import prisma from '@/lib/prisma';
import { buildProjectDisplayName } from '@/lib/projectDisplayName';
import { NextResponse } from 'next/server';

function normalizeRequiredText(value) {
    return String(value ?? '').trim();
}

function normalizeOptionalText(value) {
    const normalized = String(value ?? '').trim();
    return normalized || null;
}

function phaseKey(value) {
    return value ?? '__EMPTY_PHASE__';
}

export async function PUT(request) {
    try {
        const data = await request.json();
        const contractId = Number.parseInt(data?.contractId, 10);
        const parentName = normalizeRequiredText(data?.parentName);
        const rawProjects = Array.isArray(data?.projects) ? data.projects : [];

        if (Number.isNaN(contractId)) {
            return NextResponse.json({ error: '缺少有效的合同 ID' }, { status: 400 });
        }

        if (!parentName) {
            return NextResponse.json({ error: '大项目名称不能为空' }, { status: 400 });
        }

        if (rawProjects.length === 0) {
            return NextResponse.json({ error: '请至少选择一个项目' }, { status: 400 });
        }

        const parsedProjects = rawProjects.map((item) => ({
            id: Number.parseInt(item?.id, 10),
            phase: normalizeOptionalText(item?.phase),
        }));

        if (parsedProjects.some((item) => Number.isNaN(item.id))) {
            return NextResponse.json({ error: '项目列表里包含无效的项目 ID' }, { status: 400 });
        }

        const uniqueProjectIds = new Set(parsedProjects.map((item) => item.id));
        if (uniqueProjectIds.size !== parsedProjects.length) {
            return NextResponse.json({ error: '项目列表里存在重复的项目 ID' }, { status: 400 });
        }

        const contractProjects = await prisma.project.findMany({
            where: { contractId },
            orderBy: { id: 'asc' },
            select: {
                id: true,
                name: true,
                phase: true,
                buildingMode: true,
            },
        });

        if (contractProjects.length === 0) {
            return NextResponse.json({ error: '这份合同下没有可整理的项目' }, { status: 404 });
        }

        const contractProjectIds = new Set(contractProjects.map((item) => item.id));
        const missingProjectIds = contractProjects
            .filter((item) => !uniqueProjectIds.has(item.id))
            .map((item) => item.id);
        if (missingProjectIds.length > 0) {
            return NextResponse.json({
                error: `请一次性提交这份合同下的全部项目，缺少：${missingProjectIds.join('、')}`,
            }, { status: 400 });
        }

        const invalidProject = parsedProjects.find((item) => !contractProjectIds.has(item.id));
        if (invalidProject) {
            return NextResponse.json({
                error: `项目 #${invalidProject.id} 不属于合同 #${contractId}`,
            }, { status: 400 });
        }

        const payloadPhaseKeys = new Set();
        for (const item of parsedProjects) {
            const project = contractProjects.find((contractProject) => contractProject.id === item.id);
            // Removed phase check for buildingMode

            const currentPhaseKey = phaseKey(item.phase);
            if (payloadPhaseKeys.has(currentPhaseKey)) {
                return NextResponse.json({
                    error: `统一后的项目会重复，请检查子项名称：${buildProjectDisplayName(parentName, item.phase)}`,
                }, { status: 409 });
            }
            payloadPhaseKeys.add(currentPhaseKey);
        }

        const externalConflicts = await prisma.project.findMany({
            where: {
                name: parentName,
                NOT: {
                    id: {
                        in: Array.from(uniqueProjectIds),
                    },
                },
            },
            select: {
                id: true,
                phase: true,
            },
        });

        const conflictingProject = externalConflicts.find((item) => payloadPhaseKeys.has(phaseKey(item.phase)));
        if (conflictingProject) {
            return NextResponse.json({
                error: `已存在同名项目：${buildProjectDisplayName(parentName, conflictingProject.phase)}`,
            }, { status: 409 });
        }

        const updatedProjects = await prisma.$transaction(async (tx) => {
            const results = [];

            for (const item of parsedProjects) {
                const updated = await tx.project.update({
                    where: { id: item.id },
                    data: {
                        name: parentName,
                        phase: item.phase,
                    },
                    select: {
                        id: true,
                        name: true,
                        status: true,
                        phase: true,
                        buildingMode: true,
                        contractId: true,
                    },
                });
                results.push(updated);
            }

            return results.sort((left, right) => left.id - right.id);
        });

        return NextResponse.json({
            success: true,
            contractId,
            parentName,
            projects: updatedProjects,
        });
    } catch (error) {
        return NextResponse.json({
            error: error instanceof Error ? error.message : '批量整理项目组失败',
        }, { status: 500 });
    }
}
