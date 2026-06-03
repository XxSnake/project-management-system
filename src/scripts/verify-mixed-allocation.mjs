import { PrismaClient } from '@prisma/client';
import { spawn } from 'child_process';
const prisma = new PrismaClient();
const baseUrl = process.env.VERIFY_BASE_URL || 'http://127.0.0.1:3215';
const serverPort = new URL(baseUrl).port || '3215';
const serverHost = new URL(baseUrl).hostname || '127.0.0.1';
const shouldStartServer = !process.env.VERIFY_BASE_URL;
const marker = `T015-${Date.now()}`;

let serverProcess = null;
let startedServerHere = false;

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertClose(actual, expected, message) {
    const delta = Math.abs(Number(actual || 0) - Number(expected || 0));
    if (delta > 0.0001) {
        throw new Error(`${message}（期望 ${expected}，实际 ${actual}）`);
    }
}

function wait(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function runCommand(command, args, label) {
    await new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: process.cwd(),
            env: {
                ...process.env,
                NEXT_TELEMETRY_DISABLED: '1',
            },
            stdio: 'inherit',
        });

        child.once('exit', (code) => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(`${label} 失败，退出码 ${code}`));
        });
        child.once('error', reject);
    });
}

async function ensureBuildReady() {
    const command = process.platform === 'win32'
        ? (process.env.ComSpec || 'cmd.exe')
        : 'npm';
    const args = process.platform === 'win32'
        ? ['/d', '/s', '/c', 'npm run build']
        : ['run', 'build'];

    await runCommand(command, args, '构建');
}

async function waitForServerReady() {
    for (let attempt = 0; attempt < 90; attempt += 1) {
        try {
            const response = await fetch(`${baseUrl}/api/worklog`);
            if (response.ok) {
                return;
            }
        } catch (error) {
            // keep waiting
        }

        await wait(1000);
    }

    throw new Error(`本地服务未能在 ${baseUrl} 启动`);
}

async function isServerReady() {
    try {
        const response = await fetch(`${baseUrl}/api/worklog`, {
            signal: AbortSignal.timeout(3000),
        });
        return response.ok;
    } catch (error) {
        return false;
    }
}

async function startServer() {
    if (!shouldStartServer) {
        return;
    }

    if (await isServerReady()) {
        return;
    }

    await ensureBuildReady();

    const command = process.platform === 'win32'
        ? (process.env.ComSpec || 'cmd.exe')
        : 'npm';
    const args = process.platform === 'win32'
        ? ['/d', '/s', '/c', `npm run start -- --hostname ${serverHost} --port ${serverPort}`]
        : ['run', 'start', '--', '--hostname', serverHost, '--port', serverPort];

    serverProcess = spawn(command, args, {
        cwd: process.cwd(),
        env: {
            ...process.env,
            NEXT_TELEMETRY_DISABLED: '1',
        },
        stdio: 'pipe',
    });
    startedServerHere = true;

    serverProcess.stdout.on('data', (chunk) => {
        process.stdout.write(String(chunk));
    });
    serverProcess.stderr.on('data', (chunk) => {
        process.stderr.write(String(chunk));
    });
}

async function stopServer() {
    if (!startedServerHere || !serverProcess) {
        return;
    }

    if (process.platform === 'win32') {
        await runCommand(
            process.env.ComSpec || 'cmd.exe',
            ['/d', '/s', '/c', `taskkill /pid ${serverProcess.pid} /t /f >nul 2>&1 || exit /b 0`],
            '关闭本地服务',
        );
    } else {
        const exited = new Promise((resolve) => {
            serverProcess.once('exit', resolve);
        });

        serverProcess.kill('SIGTERM');
        await Promise.race([exited, wait(5000)]);
    }

    serverProcess.stdout?.destroy();
    serverProcess.stderr?.destroy();
    serverProcess = null;
    startedServerHere = false;
}

async function requestJson(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(`${options.method || 'GET'} ${path} 失败：${data.error || response.status}`);
    }

    return data;
}

async function sumProductionValue(workLogId) {
    const aggregate = await prisma.productionValue.aggregate({
        where: { workLogId },
        _sum: { value: true },
    });

    return Number(aggregate._sum.value || 0);
}

async function loadProductionMeta(workLogId) {
    const rows = await prisma.productionValue.findMany({
        where: { workLogId },
        orderBy: { id: 'asc' },
        select: {
            calculationMode: true,
            workloadShare: true,
            priceSource: true,
        },
    });

    return rows[0] || null;
}

async function createFixture(options = {}) {
    const fixtureLabel = options.label || 'MAIN';
    const fixtureMarker = `${marker}-${fixtureLabel}`;
    const priceItems = Array.isArray(options.priceItems) && options.priceItems.length > 0
        ? options.priceItems
        : [
            {
                testItemName: `${fixtureMarker}-ITEM-A`,
                quantity: 100,
                unit: '点',
                unitPrice: 123,
            },
            {
                testItemName: `${fixtureMarker}-ITEM-B`,
                quantity: 50,
                unit: '点',
                unitPrice: 45,
            },
        ];
    const primaryItemName = priceItems[0]?.testItemName || `${fixtureMarker}-ITEM-A`;

    const contract = await prisma.contract.create({
        data: {
            contractNo: `${fixtureMarker}-CONTRACT`,
            clientName: fixtureMarker,
            partyB: fixtureMarker,
            pricingMode: 'mixed',
            lumpSumAmount: options.lumpSumAmount ?? 100000,
            notes: fixtureMarker,
            priceItems: {
                create: priceItems,
            },
        },
    });

    const project = await prisma.project.create({
        data: {
            name: `${fixtureMarker}-PROJECT`,
            contractId: contract.id,
        },
    });

    const staff = await prisma.staff.create({
        data: {
            name: `${fixtureMarker}-STAFF`,
        },
    });

    const createWorkLog = async (suffix, quantity) => {
        const workLog = await prisma.workLog.create({
            data: {
                workDate: new Date('2026-04-20'),
                projectId: project.id,
                testContent: primaryItemName,
                quantity,
                unit: '点',
                remarks: `${fixtureMarker}-${suffix}`,
            },
        });

        await prisma.workLogStaff.create({
            data: {
                workLogId: workLog.id,
                staffId: staff.id,
            },
        });

        return workLog;
    };

    return {
        contract,
        project,
        staff,
        workLogA: await createWorkLog('A', 10),
        workLogB: await createWorkLog('B', 5),
        workLogC: await createWorkLog('C', 4),
    };
}

async function cleanupFixture(fixture) {
    if (!fixture) {
        await prisma.workLog.deleteMany({
            where: {
                remarks: {
                    startsWith: marker,
                },
            },
        });
        await prisma.project.deleteMany({
            where: {
                name: {
                    startsWith: marker,
                },
            },
        });
        await prisma.staff.deleteMany({
            where: {
                name: {
                    startsWith: marker,
                },
            },
        });
        await prisma.contract.deleteMany({
            where: {
                contractNo: {
                    startsWith: marker,
                },
            },
        });
        return;
    }

    await prisma.workLog.deleteMany({
        where: { projectId: fixture.project.id },
    });
    await prisma.project.deleteMany({
        where: { id: fixture.project.id },
    });
    await prisma.staff.deleteMany({
        where: { id: fixture.staff.id },
    });
    await prisma.contract.deleteMany({
        where: { id: fixture.contract.id },
    });
}

async function main() {
    const fixtures = [];

    try {
        await startServer();
        await waitForServerReady();
        const fixture = await createFixture();
        fixtures.push(fixture);

        const caseA = await requestJson(`/api/worklog/${fixture.workLogA.id}`, {
            method: 'PUT',
            body: JSON.stringify({}),
        });
        assert(caseA.success === true, 'Case A 更新失败');
        assert(caseA.calculation?.mode === 'unit', 'Case A 应走单价逻辑');
        assertClose(await sumProductionValue(fixture.workLogA.id), 1230, 'Case A 产值不对');

        const caseB = await requestJson(`/api/worklog/${fixture.workLogA.id}`, {
            method: 'PUT',
            body: JSON.stringify({ allocationShare: 30 }),
        });
        assert(caseB.success === true, 'Case B 更新失败');
        assert(caseB.calculation?.mode === 'allocation-share', 'Case B 应走占比分摊');
        assertClose(await sumProductionValue(fixture.workLogA.id), 30000, 'Case B 产值不对');
        const caseBMeta = await loadProductionMeta(fixture.workLogA.id);
        assert(caseBMeta?.calculationMode === 'allocation-share', 'Case B calculationMode 不对');
        assertClose(caseBMeta?.workloadShare, 0.3, 'Case B workloadShare 不对');
        assert(caseBMeta?.priceSource === '混合计费打包部分占比 30%', 'Case B priceSource 不对');

        const caseC = await requestJson(`/api/worklog/${fixture.workLogB.id}`, {
            method: 'PUT',
            body: JSON.stringify({ allocationShare: 20 }),
        });
        assert(caseC.success === true, 'Case C 更新失败');
        assertClose(await sumProductionValue(fixture.workLogA.id), 30000, 'Case C A 产值不对');
        assertClose(await sumProductionValue(fixture.workLogB.id), 20000, 'Case C B 产值不对');

        await requestJson(`/api/worklog/${fixture.workLogB.id}`, {
            method: 'PUT',
            body: JSON.stringify({ allocationShare: '' }),
        });

        const caseD = await requestJson(`/api/worklog/${fixture.workLogA.id}`, {
            method: 'PUT',
            body: JSON.stringify({
                manualTotalValue: 12345,
                manualValueNote: `${marker}-manual`,
            }),
        });
        assert(caseD.success === true, 'Case D 更新失败');
        assert(caseD.calculation?.mode === 'manual', 'Case D 应走手工产值');
        assertClose(await sumProductionValue(fixture.workLogA.id), 12345, 'Case D 产值不对');
        const caseDMeta = await loadProductionMeta(fixture.workLogA.id);
        assert(caseDMeta?.calculationMode === 'manual', 'Case D calculationMode 不对');

        const caseE = await requestJson(`/api/worklog/${fixture.workLogA.id}`, {
            method: 'PUT',
            body: JSON.stringify({
                allocationShare: 30,
                manualTotalValue: 6789,
                manualValueNote: `${marker}-manual-priority`,
            }),
        });
        assert(caseE.success === true, 'Case E 更新失败');
        assert(caseE.calculation?.mode === 'manual', 'Case E 应由手工产值优先');
        assertClose(await sumProductionValue(fixture.workLogA.id), 6789, 'Case E 产值不对');

        const lowCapFixture = await createFixture({
            label: 'LOW-CAP',
            priceItems: [
                {
                    testItemName: `${marker}-LOW-CAP-ITEM-A`,
                    quantity: 50,
                    unit: '点',
                    unitPrice: 100,
                },
            ],
        });
        fixtures.push(lowCapFixture);

        const caseF = await requestJson(`/api/worklog/${lowCapFixture.workLogA.id}`, {
            method: 'PUT',
            body: JSON.stringify({
                manualTotalValue: 12345,
                manualValueNote: `${marker}-low-cap-manual`,
            }),
        });
        assert(caseF.success === true, 'Case F 更新失败');
        assert(caseF.calculation?.mode === 'manual', 'Case F 应走手工产值');
        assertClose(await sumProductionValue(lowCapFixture.workLogA.id), 12345, 'Case F 产值不对');

        const splitResult = await requestJson(`/api/worklog/${fixture.workLogC.id}/split`, {
            method: 'POST',
            body: JSON.stringify({}),
        });
        assert(splitResult.success === true, 'split 验证失败');
        const pendingForCopy = (splitResult.pendingAllocations || []).find(
            (item) => item.workLogId === splitResult.splitLog?.id,
        );
        assert(Boolean(pendingForCopy), 'split 后新副本没有进入 pendingAllocations');
        assert(pendingForCopy.pricingMode === 'mixed', 'split 后 pendingAllocations 的 pricingMode 不对');
        assertClose(pendingForCopy.contractAmount, 100000, 'split 后 pendingAllocations 的合同金额不对');

        console.log('verify-mixed-allocation');
        console.log('caseA PASS unit fallback without allocationShare');
        console.log('caseB PASS allocationShare uses mixed lumpSumAmount');
        console.log('caseC PASS multiple mixed allocationShare totals stay scoped to lumpSumAmount');
        console.log('caseD PASS manualTotalValue overrides mixed auto calc');
        console.log('caseE PASS manualTotalValue wins over allocationShare');
        console.log('caseF PASS manualTotalValue is not capped by mixed unitTotal only');
        console.log('split PASS mixed copy returns pendingAllocations');
        console.log('ALL PASS');
    } finally {
        for (const fixture of fixtures) {
            await cleanupFixture(fixture);
        }
        await stopServer();
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
});
