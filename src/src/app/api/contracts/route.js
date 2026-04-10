import prisma from '@/lib/prisma';
import { retroactiveCalculation } from '@/lib/productionCalculator';
import { NextResponse } from 'next/server';

function buildNotes(projectName, fileName) {
    const parts = [];
    if (projectName) parts.push(`工程: ${projectName}`);
    if (fileName) parts.push(`文件: ${fileName}`);
    return parts.join(' | ') || null;
}

export async function GET() {
    const contracts = await prisma.contract.findMany({
        include: {
            priceItems: true,
            projects: { select: { id: true, name: true } },
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
        const explicitProjectId = data.projectId ? Number.parseInt(data.projectId, 10) : null;

        if (!projectName && !explicitProjectId) {
            return NextResponse.json({ error: '缺少工程名称（projectName）或项目 ID' }, { status: 400 });
        }

        // 定位目标项目
        let targetProject = null;
        if (explicitProjectId) {
            targetProject = await prisma.project.findUnique({ where: { id: explicitProjectId } });
            if (!targetProject) {
                return NextResponse.json({ error: '指定的项目不存在' }, { status: 404 });
            }
            if (targetProject.contractId) {
                return NextResponse.json({ error: `项目「${targetProject.name}」已关联合同，不能重复上传` }, { status: 409 });
            }
        } else {
            targetProject = await prisma.project.findFirst({ where: { name: projectName } });
            if (targetProject && targetProject.contractId) {
                return NextResponse.json({ error: `工程「${projectName}」已存在且已关联合同，不能重复上传` }, { status: 409 });
            }
        }

        const pricingMode = data.pricingMode === 'area' ? 'area' : 'unit';
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
                areaPricingAmount: pricingMode === 'area' ? (Number(data.areaPricingAmount) || null) : null,
                areaPricingArea: pricingMode === 'area' ? (Number(data.areaPricingArea) || null) : null,
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
                data: { contractId: contract.id, contractLinkedAt: new Date() },
            });
            retroResult = await retroactiveCalculation(project.id);
        } else {
            project = await prisma.project.create({
                data: {
                    name: projectName,
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
