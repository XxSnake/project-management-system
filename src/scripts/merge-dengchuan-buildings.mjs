import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TARGET_PROJECT_ID = 819;
const SOURCE_PROJECT_ID = 851;
const BUILDING_NAME = '污水处理用房';
const API_BASE = process.env.APP_BASE_URL || 'http://127.0.0.1:3000';

function parseArgs(argv) {
    return {
        apply: argv.includes('--apply'),
    };
}

function logSection(title) {
    console.log(`\n=== ${title} ===`);
}

function resolveDbPaths() {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const rootDir = path.resolve(scriptDir, '..');
    const dbPath = path.join(rootDir, 'prisma', 'dev.db');
    const backupPath = path.join(rootDir, 'prisma', 'dev.db.bak-20260415-dengchuan');
    return { dbPath, backupPath };
}

async function loadState() {
    const [targetProject, sourceProject, targetLogs, sourceLogs] = await Promise.all([
        prisma.project.findUnique({
            where: { id: TARGET_PROJECT_ID },
            include: { contract: true },
        }),
        prisma.project.findUnique({
            where: { id: SOURCE_PROJECT_ID },
            include: { contract: true },
        }),
        prisma.workLog.findMany({
            where: { projectId: TARGET_PROJECT_ID },
            select: { id: true, buildingName: true },
            orderBy: { id: 'asc' },
        }),
        prisma.workLog.findMany({
            where: { projectId: SOURCE_PROJECT_ID },
            select: { id: true, buildingName: true },
            orderBy: { id: 'asc' },
        }),
    ]);

    return {
        targetProject,
        sourceProject,
        targetLogs,
        sourceLogs,
    };
}

async function postJson(url, body) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || `请求失败: ${url}`);
    }
    return data;
}

async function main() {
    const { apply } = parseArgs(process.argv.slice(2));
    const { dbPath, backupPath } = resolveDbPaths();
    const state = await loadState();

    logSection(apply ? '应用模式' : '预演模式');
    console.log(apply ? '将执行真实写库和接口调用。' : '当前只打印计划，不改数据库。');

    if (!state.targetProject) {
        throw new Error(`目标项目 ${TARGET_PROJECT_ID} 不存在`);
    }
    if (!state.sourceProject) {
        throw new Error(`来源项目 ${SOURCE_PROJECT_ID} 不存在`);
    }

    console.log(`目标项目: #${state.targetProject.id} ${state.targetProject.name}`);
    console.log(`来源项目: #${state.sourceProject.id} ${state.sourceProject.name}（${state.sourceProject.phase || '无子项'}）`);
    console.log(`目标项目工作记录: ${state.targetLogs.length} 条`);
    console.log(`来源项目工作记录: ${state.sourceLogs.length} 条`);
    console.log(`来源项目待写入单体建筑: ${BUILDING_NAME}`);
    console.log(`数据库备份路径: ${backupPath}`);
    console.log(`接口地址: ${API_BASE}`);

    if (!apply) {
        logSection('即将执行的步骤');
        console.log(`1. 备份 dev.db 到 ${backupPath}`);
        console.log(`2. 把项目 ${SOURCE_PROJECT_ID} 的 ${state.sourceLogs.length} 条工作记录写成 buildingName="${BUILDING_NAME}"`);
        console.log(`3. 调用 ${API_BASE}/api/projects/merge 合并 ${SOURCE_PROJECT_ID} -> ${TARGET_PROJECT_ID}`);
        console.log(`4. 把项目 ${TARGET_PROJECT_ID} 的 buildingMode 改成 true`);
        console.log(`5. 调用 ${API_BASE}/api/projects/retroactive 对项目 ${TARGET_PROJECT_ID} 补算`);
        return;
    }

    logSection('执行备份');
    if (!fs.existsSync(dbPath)) {
        throw new Error(`数据库文件不存在: ${dbPath}`);
    }
    if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(dbPath, backupPath);
        console.log(`已创建备份: ${backupPath}`);
    } else {
        console.log(`备份已存在，沿用现有文件: ${backupPath}`);
    }

    logSection('写入单体建筑');
    const updateResult = await prisma.workLog.updateMany({
        where: { projectId: SOURCE_PROJECT_ID },
        data: { buildingName: BUILDING_NAME },
    });
    console.log(`已更新 ${updateResult.count} 条工作记录`);

    logSection('合并项目');
    const mergeResult = await postJson(`${API_BASE}/api/projects/merge`, {
        targetId: TARGET_PROJECT_ID,
        sourceIds: [SOURCE_PROJECT_ID],
    });
    console.log(JSON.stringify(mergeResult, null, 2));
    if (
        mergeResult.movedWorkLogs !== state.sourceLogs.length
        || mergeResult.movedDetectionRecords !== state.sourceLogs.length
        || mergeResult.deletedProjects !== 1
    ) {
        throw new Error('项目合并返回结果不符合预期');
    }

    logSection('开启单体建筑模式');
    await prisma.project.update({
        where: { id: TARGET_PROJECT_ID },
        data: { buildingMode: true },
    });
    console.log(`项目 ${TARGET_PROJECT_ID} 已设置 buildingMode=true`);

    logSection('触发补算');
    const retroactiveResult = await postJson(`${API_BASE}/api/projects/retroactive`, {
        projectId: TARGET_PROJECT_ID,
    });
    console.log(JSON.stringify(retroactiveResult, null, 2));

    logSection('执行后校验');
    const postState = await prisma.project.findUnique({
        where: { id: TARGET_PROJECT_ID },
        include: {
            workLogs: {
                select: { id: true, buildingName: true },
                orderBy: { id: 'asc' },
            },
        },
    });
    const deletedSource = await prisma.project.findUnique({
        where: { id: SOURCE_PROJECT_ID },
    });
    const movedBuildingLogs = postState?.workLogs.filter((item) => item.buildingName === BUILDING_NAME) || [];
    const emptyBuildingLogs = postState?.workLogs.filter((item) => !item.buildingName) || [];

    console.log(`来源项目是否已删除: ${deletedSource ? '否' : '是'}`);
    console.log(`目标项目 buildingMode: ${postState?.buildingMode ? 'true' : 'false'}`);
    console.log(`目标项目工作记录总数: ${postState?.workLogs.length || 0}`);
    console.log(`单体建筑=${BUILDING_NAME} 的记录数: ${movedBuildingLogs.length}`);
    console.log(`未指定单体的记录数: ${emptyBuildingLogs.length}`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
