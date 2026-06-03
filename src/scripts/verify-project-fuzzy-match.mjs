import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const tempDir = path.join(projectRoot, '.tmp-verification');
const dbPath = path.join(tempDir, `verify-project-fuzzy-match-${Date.now()}.db`);
const dbUrl = `file:../.tmp-verification/${path.basename(dbPath)}`;
const seedDbPath = path.join(projectRoot, 'prisma', 'dev.db');
const appPort = 3124;
const modelPort = 3125;
const baseUrl = `http://127.0.0.1:${appPort}`;
const nextCliPath = path.join(projectRoot, 'node_modules', 'next', 'dist', 'bin', 'next');

function spawnCli(command, args, options = {}) {
    return spawn(command, args, {
        ...options,
        shell: false,
    });
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeForMock(value) {
    return String(value || '')
        .normalize('NFKC')
        .replace(/[（]/gu, '(')
        .replace(/[）]/gu, ')')
        .replace(/[—–－]/gu, '-')
        .replace(/\u3000/gu, ' ')
        .replace(/[\s\-()[\]{}【】]/gu, '')
        .trim();
}

function safeJsonParse(value, fallback = {}) {
    try {
        return JSON.parse(value);
    } catch (error) {
        return fallback;
    }
}

async function waitForServer(url, timeoutMs = 120000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(url, { cache: 'no-store' });
            if (response.ok || response.status < 500) {
                return;
            }
        } catch (error) {
            // continue
        }

        await sleep(1000);
    }

    throw new Error(`Server did not become ready within ${timeoutMs}ms`);
}

async function requestJson(endpoint, options = {}) {
    const response = await fetch(`${baseUrl}${endpoint}`, {
        method: options.method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: 'no-store',
    });

    const text = await response.text();
    const data = text ? safeJsonParse(text, {}) : {};

    if (!response.ok) {
        throw new Error(`${endpoint} -> ${response.status}: ${data.error || text}`);
    }

    return data;
}

async function requestJsonWithStatus(endpoint, options = {}) {
    const response = await fetch(`${baseUrl}${endpoint}`, {
        method: options.method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: 'no-store',
    });
    const text = await response.text();

    return {
        status: response.status,
        data: text ? safeJsonParse(text, {}) : {},
        text,
    };
}

async function fetchPageAndScripts(endpoint) {
    const response = await fetch(`${baseUrl}${endpoint}`, { cache: 'no-store' });
    assert.equal(response.status, 200);

    const html = await response.text();
    const scriptSources = [...html.matchAll(/<script[^>]+src="([^"]+)"/gu)]
        .map((match) => match[1].replaceAll('&amp;', '&'));
    const scriptBodies = [];

    for (const source of scriptSources) {
        const scriptUrl = new URL(source, baseUrl);
        const scriptResponse = await fetch(scriptUrl, { cache: 'no-store' });
        if (scriptResponse.ok) {
            scriptBodies.push(await scriptResponse.text());
        }
    }

    return [html, ...scriptBodies].join('\n');
}

async function startMockModelServer() {
    const server = http.createServer(async (request, response) => {
        if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: 'not-found' }));
            return;
        }

        const chunks = [];
        for await (const chunk of request) {
            chunks.push(chunk);
        }

        const rawBody = Buffer.concat(chunks).toString('utf8');
        const payload = safeJsonParse(rawBody, {});
        const userMessage = Array.isArray(payload.messages)
            ? payload.messages.find((item) => item?.role === 'user')
            : null;
        const taskPayload = safeJsonParse(userMessage?.content || '{}', {});
        const targetKey = normalizeForMock(taskPayload?.targetProject?.displayName || taskPayload?.targetProject?.name);
        const candidateIds = Array.isArray(taskPayload?.candidates)
            ? taskPayload.candidates
                .filter((candidate) => normalizeForMock(candidate?.displayName || candidate?.name) === targetKey)
                .map((candidate) => Number(candidate.id))
                .filter((candidateId) => Number.isInteger(candidateId))
            : [];

        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
            id: 'mock-chatcmpl-project-fuzzy',
            object: 'chat.completion',
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: JSON.stringify({
                            needsReview: candidateIds.length > 0,
                            candidateIds,
                            reason: candidateIds.length > 0 ? 'mock-review' : 'mock-distinct',
                        }),
                    },
                },
            ],
        }));
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(modelPort, '127.0.0.1', resolve);
    });

    return server;
}

async function closeHttpServer(server) {
    if (!server) {
        return;
    }

    await new Promise((resolve) => {
        server.close(() => resolve());
    });
}

async function stopChildProcess(childProcess) {
    if (!childProcess || childProcess.exitCode !== null) {
        return;
    }

    childProcess.kill();
    const closed = await Promise.race([
        new Promise((resolve) => childProcess.once('exit', resolve)),
        sleep(5000).then(() => false),
    ]);

    if (closed === false && childProcess.exitCode === null) {
        childProcess.kill('SIGKILL');
        await new Promise((resolve) => childProcess.once('exit', resolve));
    }
}

async function removeFileWithRetry(filePath, retries = 5) {
    for (let attempt = 0; attempt < retries; attempt += 1) {
        try {
            fs.rmSync(filePath, { force: true });
            return;
        } catch (error) {
            if (attempt === retries - 1) {
                throw error;
            }
            await sleep(1000);
        }
    }
}

function relayOutput(prefix, stream) {
    if (!stream) {
        return;
    }

    stream.on('data', (chunk) => {
        const text = String(chunk || '').trim();
        if (text) {
            console.log(`[${prefix}] ${text}`);
        }
    });
}

async function main() {
    fs.mkdirSync(tempDir, { recursive: true });

    const env = {
        ...process.env,
        DATABASE_URL: dbUrl,
        NODE_ENV: 'development',
        NEXT_TELEMETRY_DISABLED: '1',
        ZHIPU_API_KEY: 'mock-key',
        ZHIPU_API_URL: `http://127.0.0.1:${modelPort}/v1`,
        ZHIPU_MODEL: 'mock-project-fuzzy',
    };

    let modelServer = null;
    let appServer = null;

    try {
        console.log('1. 初始化临时数据库');
        fs.copyFileSync(seedDbPath, dbPath);

        console.log('2. 启动本地假模型服务');
        modelServer = await startMockModelServer();

        console.log('3. 启动本地服务');
        appServer = spawnCli(process.execPath, [nextCliPath, 'dev', '--hostname', '127.0.0.1', '--port', String(appPort)], {
            cwd: projectRoot,
            env,
            stdio: 'pipe',
        });

        relayOutput('dev', appServer.stdout);
        relayOutput('dev', appServer.stderr);

        await waitForServer(`${baseUrl}/api/projects`);

        console.log('4. 造一组相似项目并触发判重');
        const baseProject = await requestJson('/api/projects', {
            method: 'POST',
            body: {
                name: 'E8 判重验证项目一期（总包）',
                status: '进行中',
                phase: null,
                buildingMode: false,
            },
        });

        const duplicateProjectA = await requestJson('/api/projects', {
            method: 'POST',
            body: {
                name: 'E8判重验证项目一期总包',
                status: '进行中',
                phase: null,
                buildingMode: false,
            },
        });

        const fuzzyRunA = await requestJson('/api/internal/run-fuzzy-match', {
            method: 'POST',
            body: {
                projectId: duplicateProjectA.id,
            },
        });

        assert.equal(fuzzyRunA.results[0]?.status, 'pending-review');
        assert.ok((fuzzyRunA.results[0]?.candidateIds || []).includes(baseProject.id));

        const fuzzyInboxA = await requestJson('/api/inbox/exceptions?type=fuzzy-project-duplicate&page=1&pageSize=20');
        assert.equal(fuzzyInboxA.total, 1);
        assert.equal(fuzzyInboxA.counts?.['fuzzy-project-duplicate'], 1);
        assert.equal(fuzzyInboxA.items[0]?.projectId, duplicateProjectA.id);
        assert.ok((fuzzyInboxA.items[0]?.candidateProjectIds || []).includes(baseProject.id));

        console.log('5. 确认“不是同一个项目”后，这条记录应从 E8 消失');
        const confirmResult = await requestJson('/api/inbox/fuzzy-match/confirm', {
            method: 'POST',
            body: {
                projectId: duplicateProjectA.id,
            },
        });
        assert.equal(confirmResult.fuzzyMatchStatus, 'confirmed-distinct');

        const fuzzyInboxAfterConfirm = await requestJson('/api/inbox/exceptions?type=fuzzy-project-duplicate&page=1&pageSize=20');
        assert.equal(fuzzyInboxAfterConfirm.total, 0);

        console.log('6. 把确认过的项目改成明显不同的名字，再次扫描不应回到 E8');
        await requestJson('/api/projects', {
            method: 'PUT',
            body: {
                id: duplicateProjectA.id,
                name: 'E8 判重验证项目二期（独立项目）',
                status: '进行中',
                phase: null,
                buildingMode: false,
                contractId: null,
            },
        });

        const renameScan = await requestJson('/api/internal/run-fuzzy-match', {
            method: 'POST',
            body: {
                projectId: duplicateProjectA.id,
            },
        });
        assert.equal(renameScan.results[0]?.status, 'distinct');

        const fuzzyInboxAfterRename = await requestJson('/api/inbox/exceptions?type=fuzzy-project-duplicate&page=1&pageSize=20');
        assert.equal(fuzzyInboxAfterRename.total, 0);

        console.log('7. 再造一条相似项目，验证“并入候选项目”');
        const duplicateProjectB = await requestJson('/api/projects', {
            method: 'POST',
            body: {
                name: 'E8 判重验证项目一期-总包',
                status: '进行中',
                phase: null,
                buildingMode: false,
            },
        });

        const fuzzyRunB = await requestJson('/api/internal/run-fuzzy-match', {
            method: 'POST',
            body: {
                projectId: duplicateProjectB.id,
            },
        });
        assert.equal(fuzzyRunB.results[0]?.status, 'pending-review');
        assert.ok((fuzzyRunB.results[0]?.candidateIds || []).includes(baseProject.id));

        const mergeResult = await requestJson('/api/inbox/fuzzy-match/merge', {
            method: 'POST',
            body: {
                projectId: duplicateProjectB.id,
                targetProjectId: baseProject.id,
            },
        });
        assert.equal(mergeResult.targetProjectId, baseProject.id);
        assert.equal(mergeResult.deletedProjects, 1);

        const projectsAfterMerge = await requestJson('/api/projects');
        assert.ok(!projectsAfterMerge.some((item) => item.id === duplicateProjectB.id));
        assert.ok(projectsAfterMerge.some((item) => item.id === baseProject.id));

        const fuzzyInboxAfterMerge = await requestJson('/api/inbox/exceptions?type=fuzzy-project-duplicate&page=1&pageSize=20');
        if (fuzzyInboxAfterMerge.total !== 0) {
            console.log('合并后残留 E8 项:', JSON.stringify(fuzzyInboxAfterMerge, null, 2));
            console.log('合并后项目状态:', JSON.stringify(
                projectsAfterMerge.map((item) => ({
                    id: item.id,
                    name: item.name,
                    phase: item.phase,
                    fuzzyMatchStatus: item.fuzzyMatchStatus,
                    fuzzyMatchCandidateIds: item.fuzzyMatchCandidateIds,
                })),
                null,
                2,
            ));
        }
        assert.equal(fuzzyInboxAfterMerge.total, 0);

        const inboxPageText = await fetchPageAndScripts('/master/inbox');
        assert.ok(inboxPageText.includes('后台已把这条项目判成“疑似重名”'), '收件箱页面缺少正确的 E8 提示语');
        assert.ok(inboxPageText.includes('候选：'), '收件箱页面缺少正确的候选项目文案');
        assert.ok(inboxPageText.includes('不重名'), '收件箱页面缺少正确的不重名文案');

        const invalidConfirm = await requestJsonWithStatus('/api/inbox/fuzzy-match/confirm', {
            method: 'POST',
            body: {},
        });
        assert.equal(invalidConfirm.status, 400);
        assert.equal(invalidConfirm.data.error, '缺少有效的项目 ID');

        const invalidMerge = await requestJsonWithStatus('/api/inbox/fuzzy-match/merge', {
            method: 'POST',
            body: {},
        });
        assert.equal(invalidMerge.status, 400);
        assert.equal(invalidMerge.data.error, '缺少有效的项目 ID');

        console.log('验证通过：E8 判重、人工确认、改名清除和并入候选项目全部正常');
    } finally {
        await stopChildProcess(appServer);
        await closeHttpServer(modelServer);
        await removeFileWithRetry(dbPath);
    }
}

main().catch((error) => {
    console.error('验证失败:', error);
    process.exitCode = 1;
});
