import prisma from '@/lib/prisma';
import { rebuildProjectProduction, retroactiveCalculation } from '@/lib/productionCalculator';
import { NextResponse } from 'next/server';

function buildNotes(projectName, fileName) {
    const parts = [];
    if (projectName) parts.push(`工程: ${projectName}`);
    if (fileName) parts.push(`文件: ${fileName}`);
    return parts.join(' | ') || null;
}

function extractNoteValue(notes, label) {
    if (!notes) {
        return '';
    }

    const match = String(notes).match(new RegExp(`${label}:\\s*(.+?)(?:\\s*\\||$)`));
    return match ? match[1].trim() : '';
}

function normalizeProjectPhase(value) {
    if (value == null) {
        return null;
    }

    const trimmed = String(value).trim();
    return trimmed || null;
}

function formatProjectLabel(projectName, projectPhase = null) {
    const phase = normalizeProjectPhase(projectPhase);
    return phase ? `${projectName}（${phase}）` : projectName;
}

const PROJECT_SELECT = {
    id: true,
    name: true,
    phase: true,
    contractId: true,
    contractLinkedAt: true,
};

async function findProjectByNameAndPhase(projectName, projectPhase) {
    if (!projectName) {
        return null;
    }

    return prisma.project.findFirst({
        where: {
            name: projectName,
            phase: projectPhase || null,
        },
        select: PROJECT_SELECT,
    });
}

async function assertProjectNameAvailable(projectName, projectPhase = null, excludedProjectId = null) {
    if (!projectName) {
        return;
    }

    const duplicate = await prisma.project.findFirst({
        where: {
            name: projectName,
            phase: projectPhase || null,
            ...(excludedProjectId ? { NOT: { id: excludedProjectId } } : {}),
        },
        select: {
            id: true,
            contractId: true,
        },
    });

    if (duplicate) {
        throw new Error(`项目名「${formatProjectLabel(projectName, projectPhase)}」已存在，请直接选择已有项目或换一个名称`);
    }
}

export async function GET() {
    const contracts = await prisma.contract.findMany({
        include: {
            priceItems: true,
            projects: { select: { id: true, name: true, phase: true } },
        },
        orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(contracts);
}

/**
 * 创建合同 + 价目表，并按工程名自动关联/创建项目。
 * 规则：
 *   - 必须提供 projectName（或 projectId）
 *   - 按 projectName 查找项目：存在且已有合同 → 409 拒绝；存在且无合同 → 关联 + 补算；不存在 → 新建并关联
 *   - 明确传 projectId 时，按该项目走同样的"已有合同则拒绝"逻辑
 */
export async function POST(request) {
    try {
        const data = await request.json();

        const projectName = typeof data.projectName === 'string' ? data.projectName.trim() : '';
        const projectPhase = normalizeProjectPhase(data.projectPhase);
        const explicitProjectId = data.projectId ? Number.parseInt(data.projectId, 10) : null;

        if (!projectName && !explicitProjectId) {
            return NextResponse.json({ error: '缺少工程名称（projectName）或项目 ID' }, { status: 400 });
        }

        // 定位目标项目
        let targetProject = null;
        if (explicitProjectId) {
            targetProject = await prisma.project.findUnique({
                where: { id: explicitProjectId },
                select: PROJECT_SELECT,
            });
            if (!targetProject) {
                return NextResponse.json({ error: '指定的项目不存在' }, { status: 404 });
            }
            if (targetProject.contractId) {
                return NextResponse.json({ error: `项目「${targetProject.name}」已关联合同，不能重复上传` }, { status: 409 });
            }
        } else {
            targetProject = await findProjectByNameAndPhase(projectName, projectPhase);
            if (targetProject && targetProject.contractId) {
                return NextResponse.json({ error: `工程「${formatProjectLabel(projectName, projectPhase)}」已存在且已关联合同，不能重复上传` }, { status: 409 });
            }
        }

        const validModes = ['unit', 'area', 'mixed', 'lumpsum'];
        const pricingMode = validModes.includes(data.pricingMode) ? data.pricingMode : 'unit';
        const priceItems = Array.isArray(data.priceItems) ? data.priceItems : [];

        // 创建合同 + 价目表
        const contract = await prisma.contract.create({
            data: {
                contractNo: data.contractNo || null,
                clientName: data.clientName || null,
                partyB: data.partyB || null,
                filePath: data.filePath || null,
                signedDate: data.signedDate ? new Date(data.signedDate) : null,
                notes: data.notes || buildNotes(projectName || targetProject?.name, data.fileName),
                pricingMode,
                areaPricingAmount: (pricingMode === 'area' || pricingMode === 'mixed') ? (Number(data.areaPricingAmount) || null) : null,
                areaPricingArea: (pricingMode === 'area' || pricingMode === 'mixed') ? (Number(data.areaPricingArea) || null) : null,
                lumpSumAmount: pricingMode === 'lumpsum' ? (Number(data.lumpSumAmount) || null) : null,
                priceItems: {
                    create: priceItems
                        .filter((item) => item && item.testItemName)
                        .map((item) => ({
                            testCategory: item.testCategory || null,
                            testItemName: String(item.testItemName).trim(),
                            quantity: item.quantity != null ? Number(item.quantity) : null,
                            unit: item.unit || null,
                            unitPrice: Number(item.unitPrice) || 0,
                        })),
                },
            },
        });

        // 关联/创建项目
        let project;
        let retroResult = null;
        if (targetProject) {
            project = await prisma.project.update({
                where: { id: targetProject.id },
                data: {
                    contractId: contract.id,
                    contractLinkedAt: new Date(),
                    phase: projectPhase ?? targetProject.phase ?? null,
                },
            });
            retroResult = await retroactiveCalculation(project.id);
        } else {
            project = await prisma.project.create({
                data: {
                    name: projectName,
                    phase: projectPhase,
                    contractId: contract.id,
                    contractLinkedAt: new Date(),
                },
            });
        }

        return NextResponse.json({
            success: true,
            contract,
            project,
            retroactiveResult: retroResult,
        });
    } catch (error) {
        console.error('[contracts POST]', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function PUT(request) {
    try {
        const data = await request.json();
        const contractId = Number.parseInt(data.id, 10);
        if (!contractId) {
            return NextResponse.json({ error: '缺少合同 ID' }, { status: 400 });
        }

        const existing = await prisma.contract.findUnique({
            where: { id: contractId },
            include: {
                projects: {
                    select: PROJECT_SELECT,
                },
            },
        });
        if (!existing) {
            return NextResponse.json({ error: '合同不存在' }, { status: 404 });
        }

        const validModes = ['unit', 'area', 'mixed', 'lumpsum'];
        const pricingMode = validModes.includes(data.pricingMode) ? data.pricingMode : existing.pricingMode;
        const priceItems = Array.isArray(data.priceItems) ? data.priceItems : [];
        const projectName = typeof data.projectName === 'string' ? data.projectName.trim() : '';
        const hasProjectPhase = Object.prototype.hasOwnProperty.call(data, 'projectPhase');
        const projectPhase = hasProjectPhase ? normalizeProjectPhase(data.projectPhase) : null;
        const explicitProjectId = data.projectId ? Number.parseInt(data.projectId, 10) : null;
        const currentProjects = existing.projects || [];
        const currentProjectIds = currentProjects.map((project) => project.id);
        const currentPrimaryProject = currentProjects[0] || null;
        const replaceLinkedProjects = data.replaceLinkedProjects === true;
        const sharedContractMode = typeof data.sharedContractMode === 'string' ? data.sharedContractMode : null;
        const allowBlankSharedPhase = data.allowBlankSharedPhase === true;

        let targetProject = null;
        let targetProjectName = projectName;
        let targetProjectPhase = projectPhase;
        let targetProjectWasNewlyLinked = false;

        if (explicitProjectId) {
            targetProject = await prisma.project.findUnique({
                where: { id: explicitProjectId },
                select: PROJECT_SELECT,
            });

            if (!targetProject) {
                return NextResponse.json({ error: '指定的项目不存在' }, { status: 404 });
            }

            if (targetProject.contractId && targetProject.contractId !== contractId) {
                return NextResponse.json({ error: `项目「${targetProject.name}」已关联合同，不能改绑到这条合同` }, { status: 409 });
            }

            targetProjectName = projectName || targetProject.name;
            targetProjectPhase = hasProjectPhase ? projectPhase : (targetProject.phase ?? null);
            if (
                targetProjectName
                && (targetProjectName !== targetProject.name || (targetProject.phase ?? null) !== targetProjectPhase)
            ) {
                await assertProjectNameAvailable(targetProjectName, targetProjectPhase, targetProject.id);
            }
            targetProjectWasNewlyLinked = !currentProjectIds.includes(targetProject.id);
        } else if (projectName) {
            targetProject = await findProjectByNameAndPhase(projectName, targetProjectPhase);

            if (targetProject && targetProject.contractId && targetProject.contractId !== contractId) {
                return NextResponse.json({ error: `项目「${formatProjectLabel(projectName, targetProjectPhase)}」已关联合同，不能重复绑定` }, { status: 409 });
            }

            if (!targetProject) {
                targetProjectWasNewlyLinked = true;
            } else {
                targetProjectName = targetProject.name;
                targetProjectPhase = targetProject.phase ?? null;
                targetProjectWasNewlyLinked = !currentProjectIds.includes(targetProject.id);
            }
        } else if (currentPrimaryProject) {
            targetProject = currentPrimaryProject;
            targetProjectName = currentPrimaryProject.name;
            targetProjectPhase = currentPrimaryProject.phase ?? null;
        } else {
            return NextResponse.json({ error: '缺少工程名称或项目 ID' }, { status: 400 });
        }

        const isAddingAnotherProject = currentProjects.length > 0 && (targetProjectWasNewlyLinked || !targetProject);
        if (isAddingAnotherProject && !replaceLinkedProjects) {
            if (sharedContractMode !== 'merge' && sharedContractMode !== 'subitem') {
                return NextResponse.json({ error: '这份合同已经关联了其他项目，请先选择“合并”还是“子项”后再保存' }, { status: 409 });
            }

            if (sharedContractMode === 'subitem' && !targetProjectPhase && !allowBlankSharedPhase) {
                return NextResponse.json({ error: '这份合同已经关联了多个项目，请先补填“工程阶段 / 子项”，或明确确认留空后再保存' }, { status: 409 });
            }
        }

        const fileName = data.fileName || extractNoteValue(existing.notes, '文件') || null;
        const nextNotes = data.notes !== undefined
            ? data.notes
            : buildNotes(targetProjectName || extractNoteValue(existing.notes, '工程'), fileName);

        // 更新合同基本信息
        await prisma.contract.update({
            where: { id: contractId },
            data: {
                contractNo: data.contractNo ?? existing.contractNo,
                clientName: data.clientName ?? existing.clientName,
                partyB: data.partyB ?? existing.partyB,
                signedDate: data.signedDate ? new Date(data.signedDate) : existing.signedDate,
                pricingMode,
                areaPricingAmount: (pricingMode === 'area' || pricingMode === 'mixed') ? (Number(data.areaPricingAmount) || null) : null,
                areaPricingArea: (pricingMode === 'area' || pricingMode === 'mixed') ? (Number(data.areaPricingArea) || null) : null,
                lumpSumAmount: pricingMode === 'lumpsum' ? (Number(data.lumpSumAmount) || null) : null,
                notes: nextNotes,
            },
        });

        // 替换价目表：删除旧的，创建新的
        await prisma.priceItem.deleteMany({ where: { contractId } });
        if (priceItems.length > 0) {
            await prisma.priceItem.createMany({
                data: priceItems
                    .filter((item) => item && item.testItemName)
                    .map((item) => ({
                        contractId,
                        testCategory: item.testCategory || null,
                        testItemName: String(item.testItemName).trim(),
                        quantity: item.quantity != null ? Number(item.quantity) : null,
                        unit: item.unit || null,
                        unitPrice: Number(item.unitPrice) || 0,
                    })),
                });
        }

        let linkedProjectId = targetProject?.id || null;

        if (targetProject) {
            const projectsToUnlink = replaceLinkedProjects
                ? currentProjectIds.filter((projectId) => projectId !== targetProject.id)
                : [];
            if (projectsToUnlink.length > 0) {
                await prisma.project.updateMany({
                    where: { id: { in: projectsToUnlink } },
                    data: {
                        contractId: null,
                        contractLinkedAt: null,
                    },
                });
            }

            const shouldUpdateTargetProject = (
                targetProjectWasNewlyLinked
                || targetProject.name !== targetProjectName
                || (targetProject.phase ?? null) !== targetProjectPhase
                || targetProject.contractId !== contractId
            );

            if (shouldUpdateTargetProject) {
                const updatedProject = await prisma.project.update({
                    where: { id: targetProject.id },
                    data: {
                        name: targetProjectName || targetProject.name,
                        phase: targetProjectPhase,
                        contractId,
                        contractLinkedAt: targetProject.contractLinkedAt || new Date(),
                    },
                    select: { id: true, name: true, phase: true },
                });
                linkedProjectId = updatedProject.id;
                targetProjectName = updatedProject.name;
                targetProjectPhase = updatedProject.phase ?? null;
            }
        } else {
            if (replaceLinkedProjects && currentProjectIds.length > 0) {
                await prisma.project.updateMany({
                    where: { id: { in: currentProjectIds } },
                    data: {
                        contractId: null,
                        contractLinkedAt: null,
                    },
                });
            }

            const createdProject = await prisma.project.create({
                data: {
                    name: targetProjectName,
                    phase: targetProjectPhase,
                    contractId,
                    contractLinkedAt: new Date(),
                },
                select: { id: true, name: true, phase: true },
            });
            linkedProjectId = createdProject.id;
            targetProjectName = createdProject.name;
            targetProjectPhase = createdProject.phase ?? null;
        }

        const affectedProjectIds = Array.from(new Set([
            ...currentProjectIds,
            ...(linkedProjectId ? [linkedProjectId] : []),
        ]));

        const recalculationResults = [];
        for (const projectId of affectedProjectIds) {
            const result = await rebuildProjectProduction(projectId, {
                clearManualValues: projectId === linkedProjectId && targetProjectWasNewlyLinked,
            });
            recalculationResults.push(result);
        }

        const updated = await prisma.contract.findUnique({
            where: { id: contractId },
            include: { priceItems: true, projects: { select: { id: true, name: true, phase: true } } },
        });

        return NextResponse.json({
            success: true,
            contract: updated,
            recalculationResults,
        });
    } catch (error) {
        console.error('[contracts PUT]', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function DELETE(request) {
    try {
        const { id } = await request.json();
        if (!id) {
            return NextResponse.json({ error: '缺少合同 ID' }, { status: 400 });
        }
        const contractId = Number.parseInt(id, 10);

        // 解除项目关联
        await prisma.project.updateMany({
            where: { contractId },
            data: { contractId: null, contractLinkedAt: null },
        });
        await prisma.contract.delete({ where: { id: contractId } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
