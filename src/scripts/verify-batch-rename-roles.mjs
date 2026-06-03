import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';

const prisma = new PrismaClient();
const baseUrl = process.env.VERIFY_BASE_URL || 'http://127.0.0.1:3216';
const marker = `VERIFY-BATCH-RENAME-${Date.now()}`;

function wait(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function isServerReady() {
    try {
        const response = await fetch(`${baseUrl}/api/projects`, {
            signal: AbortSignal.timeout(3000),
        });
        return response.ok;
    } catch (error) {
        return false;
    }
}

async function waitForServerReady() {
    for (let attempt = 0; attempt < 90; attempt += 1) {
        if (await isServerReady()) {
            return;
        }

        await wait(1000);
    }

    throw new Error(`server did not start at ${baseUrl}`);
}

async function cleanupMarkerData() {
    const projects = await prisma.project.findMany({
        where: { name: { startsWith: marker } },
        select: { id: true },
    });
    const projectIds = projects.map((project) => project.id);

    if (projectIds.length > 0) {
        await prisma.workLog.deleteMany({ where: { projectId: { in: projectIds } } });
        await prisma.projectDetectionRecord.deleteMany({ where: { projectId: { in: projectIds } } });
        await prisma.testReport.deleteMany({ where: { projectId: { in: projectIds } } });
        await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    }

    await prisma.contract.deleteMany({ where: { contractNo: { startsWith: marker } } });
}

async function createContract() {
    return prisma.contract.create({
        data: {
            contractNo: `${marker}-CONTRACT`,
            clientName: `${marker}-CLIENT`,
            pricingMode: 'mixed',
        },
    });
}

async function createProjects(contractId) {
    const p1 = await prisma.project.create({ data: { name: `${marker}-P1`, contractId } });
    const p2 = await prisma.project.create({ data: { name: `${marker}-P2`, contractId } });
    const p3 = await prisma.project.create({ data: { name: `${marker}-P3`, contractId } });

    await prisma.workLog.create({
        data: {
            projectId: p2.id,
            workDate: new Date('2026-04-16T00:00:00.000Z'),
            testContent: `${marker}-Test-1`,
            quantity: 1,
            unit: 'm',
            rawText: marker,
        },
    });
    await prisma.workLog.create({
        data: {
            projectId: p3.id,
            workDate: new Date('2026-04-16T00:00:00.000Z'),
            testContent: `${marker}-Test-2`,
            quantity: 2,
            unit: 'm',
            rawText: marker,
        },
    });

    return [p1, p2, p3];
}

async function resetProjects(projects) {
    const projectIds = projects.map((project) => project.id);
    await prisma.workLog.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
}

async function callBatchRename(payload) {
    const response = await fetch(`${baseUrl}/api/projects/batch-rename`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data;
}

async function main() {
    await cleanupMarkerData();
    await waitForServerReady();

    const contract = await createContract();

    try {
        console.log('verify-batch-rename-roles');

        let projects = await createProjects(contract.id);
        await callBatchRename({
            contractId: contract.id,
            parentName: `${marker}-统一名称`,
            projects: projects.map((project, index) => ({
                id: project.id,
                role: 'subproject',
                phase: `阶段${index + 1}`,
            })),
        });

        let dbProjects = await prisma.project.findMany({
            where: { contractId: contract.id },
            orderBy: { id: 'asc' },
        });
        assert.equal(dbProjects.length, 3);
        assert.equal(dbProjects[0].name, `${marker}-统一名称`);
        assert.equal(dbProjects[0].phase, '阶段1');
        console.log('case1 PASS all subprojects');

        await resetProjects(dbProjects);

        projects = await createProjects(contract.id);
        await callBatchRename({
            contractId: contract.id,
            parentName: `${marker}-统一名称`,
            projects: [
                { id: projects[0].id, role: 'subproject', phase: '保留' },
                { id: projects[1].id, role: 'merge-into', mergeTargetId: projects[0].id },
                { id: projects[2].id, role: 'subproject', phase: '保留2' },
            ],
        });

        dbProjects = await prisma.project.findMany({
            where: { contractId: contract.id },
            orderBy: { id: 'asc' },
        });
        assert.equal(dbProjects.length, 2);
        const mergedInto = await prisma.project.findUnique({
            where: { id: projects[0].id },
            include: { workLogs: true },
        });
        assert.equal(mergedInto.workLogs.length, 1);
        console.log('case2 PASS merge into');

        await resetProjects(dbProjects);

        projects = await createProjects(contract.id);
        await callBatchRename({
            contractId: contract.id,
            parentName: `${marker}-统一名称`,
            projects: [
                { id: projects[0].id, role: 'subproject', phase: '总项目' },
                {
                    id: projects[1].id,
                    role: 'building-under',
                    buildingParentId: projects[0].id,
                    buildingName: '单体1',
                },
                {
                    id: projects[2].id,
                    role: 'building-under',
                    buildingParentId: projects[0].id,
                    buildingName: '单体2',
                },
            ],
        });

        dbProjects = await prisma.project.findMany({
            where: { contractId: contract.id },
            orderBy: { id: 'asc' },
        });
        assert.equal(dbProjects.length, 1);
        const buildingParent = await prisma.project.findUnique({
            where: { id: projects[0].id },
            include: { workLogs: true },
        });
        assert.equal(buildingParent.buildingMode, true);
        assert.equal(buildingParent.workLogs.length, 2);
        const nameSet = new Set(buildingParent.workLogs.map((workLog) => workLog.buildingName));
        assert.equal(nameSet.has('单体1'), true);
        assert.equal(nameSet.has('单体2'), true);
        console.log('case3 PASS building under');
        console.log('ALL PASS');
    } finally {
        await cleanupMarkerData();
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
});
