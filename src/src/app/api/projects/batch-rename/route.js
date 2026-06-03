import prisma from '@/lib/prisma';
import { buildProjectDisplayName } from '@/lib/projectDisplayName';
import { scheduleProjectFuzzyMatchBatch } from '@/lib/projectFuzzyMatchScheduler';
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

        const parsedProjects = rawProjects.map((item) => {
            const role = item?.role || 'subproject';
            const parsed = {
                id: Number.parseInt(item?.id, 10),
                role,
            };
            if (role === 'subproject' || role === 'building-mode-self') {
                parsed.phase = normalizeOptionalText(item?.phase);
            } else if (role === 'merge-into') {
                parsed.mergeTargetId = Number.parseInt(item?.mergeTargetId, 10);
            } else if (role === 'building-under') {
                parsed.buildingParentId = Number.parseInt(item?.buildingParentId, 10);
                parsed.buildingName = normalizeRequiredText(item?.buildingName);
            }
            return parsed;
        });

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

        const baseProjects = new Map();
        const buildingsUnderParent = new Map();

        for (const item of parsedProjects) {
            if (item.role === 'subproject' || item.role === 'building-mode-self') {
                baseProjects.set(item.id, item);
            }
        }

        for (const item of parsedProjects) {
            if (item.role === 'merge-into') {
                if (Number.isNaN(item.mergeTargetId)) {
                    return NextResponse.json({ error: `项目 #${item.id} 缺少合并目标 ID` }, { status: 400 });
                }
                if (!uniqueProjectIds.has(item.mergeTargetId)) {
                    return NextResponse.json({ error: `项目 #${item.id} 的合并目标 #${item.mergeTargetId} 不在当前整理列表中` }, { status: 400 });
                }
                if (item.id === item.mergeTargetId) {
                    return NextResponse.json({ error: `项目 #${item.id} 不能合并到自己` }, { status: 409 });
                }
                if (!baseProjects.has(item.mergeTargetId)) {
                    return NextResponse.json({ error: `项目 #${item.mergeTargetId} 自身是合并源，不能作为合并目标` }, { status: 409 });
                }
            } else if (item.role === 'building-under') {
                if (Number.isNaN(item.buildingParentId)) {
                    return NextResponse.json({ error: `项目 #${item.id} 缺少单体父项目 ID` }, { status: 400 });
                }
                if (!uniqueProjectIds.has(item.buildingParentId)) {
                    return NextResponse.json({ error: `项目 #${item.id} 的单体父项目 #${item.buildingParentId} 不在当前整理列表中` }, { status: 400 });
                }
                if (item.id === item.buildingParentId) {
                    return NextResponse.json({ error: `项目 #${item.id} 不能作为自己的单体` }, { status: 409 });
                }
                if (!baseProjects.has(item.buildingParentId)) {
                    return NextResponse.json({ error: `项目 #${item.buildingParentId} 自身是合并源，不能作为单体父项目` }, { status: 409 });
                }
                if (!item.buildingName) {
                    return NextResponse.json({ error: `项目 #${item.id} 作为单体时，需要提供单体名称` }, { status: 400 });
                }

                let bSet = buildingsUnderParent.get(item.buildingParentId);
                if (!bSet) {
                    bSet = new Set();
                    buildingsUnderParent.set(item.buildingParentId, bSet);
                }
                if (bSet.has(item.buildingName)) {
                    return NextResponse.json({ error: `项目 #${item.buildingParentId} 下单体名 '${item.buildingName}' 重复` }, { status: 409 });
                }
                bSet.add(item.buildingName);
            }
        }

        const payloadPhaseKeys = new Set();
        for (const item of baseProjects.values()) {
            const currentPhaseKey = phaseKey(item.phase);
            if (payloadPhaseKeys.has(currentPhaseKey)) {
                return NextResponse.json({
                    error: `统一后的项目会重复，请检查子项名称：${buildProjectDisplayName(parentName, item.phase)}`,
                }, { status: 409 });
            }
            payloadPhaseKeys.add(currentPhaseKey);
        }

        const remainingProjectIds = Array.from(baseProjects.keys());
        const externalConflicts = await prisma.project.findMany({
            where: {
                name: parentName,
                NOT: {
                    id: { in: remainingProjectIds }
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
            await tx.project.updateMany({
                where: { id: { in: Array.from(uniqueProjectIds) } },
                data: { name: parentName },
            });

            for (const item of baseProjects.values()) {
                const buildingMode = item.role === 'building-mode-self' || buildingsUnderParent.has(item.id);
                await tx.project.update({
                    where: { id: item.id },
                    data: {
                        phase: item.phase,
                        ...(buildingMode ? { buildingMode: true } : {}),
                    },
                });
            }

            for (const item of parsedProjects) {
                if (item.role === 'building-under') {
                    await tx.workLog.updateMany({
                        where: { projectId: item.id },
                        data: { projectId: item.buildingParentId, buildingName: item.buildingName },
                    });
                    await tx.projectDetectionRecord.updateMany({
                        where: { projectId: item.id },
                        data: { projectId: item.buildingParentId },
                    });
                    await tx.testReport.updateMany({
                        where: { projectId: item.id },
                        data: { projectId: item.buildingParentId },
                    });
                    await tx.project.delete({ where: { id: item.id } });
                } else if (item.role === 'merge-into') {
                    await tx.workLog.updateMany({
                        where: { projectId: item.id },
                        data: { projectId: item.mergeTargetId },
                    });
                    await tx.projectDetectionRecord.updateMany({
                        where: { projectId: item.id },
                        data: { projectId: item.mergeTargetId },
                    });
                    await tx.testReport.updateMany({
                        where: { projectId: item.id },
                        data: { projectId: item.mergeTargetId },
                    });
                    await tx.project.delete({ where: { id: item.id } });
                }
            }

            const results = await tx.project.findMany({
                where: { id: { in: remainingProjectIds } },
                include: {
                    _count: {
                        select: { workLogs: true },
                    },
                },
            });

            return results.sort((left, right) => left.id - right.id);
        });

        scheduleProjectFuzzyMatchBatch(updatedProjects.map((project) => project.id));

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
