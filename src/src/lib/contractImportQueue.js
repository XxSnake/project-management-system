import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

import { parseContract } from '@/lib/contractParser';

const HEARTBEAT_INTERVAL_MS = 4000;
const HEARTBEAT_STALE_MS = 20000;
const FILE_SLOW_MS = 90000;
const MAX_TASKS = 12;

function nowIso() {
    return new Date().toISOString();
}

function getContractsDir() {
    return path.join(process.cwd(), '..', 'contracts');
}

function ensureContractsDir() {
    const contractsDir = getContractsDir();
    fs.mkdirSync(contractsDir, { recursive: true });
    return contractsDir;
}

function getBatchCacheDir() {
    return path.join(ensureContractsDir(), '.batch-review-cache');
}

function ensureBatchCacheDir() {
    const cacheDir = getBatchCacheDir();
    fs.mkdirSync(cacheDir, { recursive: true });
    return cacheDir;
}

function getTaskCachePath(taskId, itemId) {
    return path.join(ensureBatchCacheDir(), `${taskId}_${itemId}.json`);
}

function getStateFilePath() {
    return path.join(ensureBatchCacheDir(), 'tasks.json');
}

function persistQueueState(state = getQueueState()) {
    const stateFilePath = getStateFilePath();
    const payload = {
        tasks: Array.from(state.tasks.values()),
    };

    fs.writeFileSync(stateFilePath, JSON.stringify(payload, null, 2), 'utf8');
}

function loadPersistedState() {
    const stateFilePath = getStateFilePath();
    if (!fs.existsSync(stateFilePath)) {
        return {
            tasks: new Map(),
            queue: [],
            running: false,
        };
    }

    try {
        const raw = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
        const tasks = new Map();
        const persistedTasks = Array.isArray(raw?.tasks) ? raw.tasks : [];

        for (const entry of persistedTasks) {
            const task = {
                ...entry,
                items: Array.isArray(entry?.items) ? entry.items : [],
                currentItemId: null,
                currentFileName: null,
                currentFileStartedAt: null,
            };

            // Background parsing cannot resume after a restart. Keep completed cache
            // items, and mark interrupted files as failed so the UI is explicit.
            task.items = task.items.map((item) => {
                if (item.status === 'queued' || item.status === 'processing') {
                    return {
                        ...item,
                        status: 'failed',
                        message: '服务重启导致任务中断，请重新上传该文件',
                        finishedAt: item.finishedAt || nowIso(),
                    };
                }

                return item;
            });

            finalizeTaskState(task, { force: true });
            tasks.set(task.id, task);
        }

        return {
            tasks,
            queue: [],
            running: false,
        };
    } catch {
        return {
            tasks: new Map(),
            queue: [],
            running: false,
        };
    }
}

function getQueueState() {
    if (!globalThis.__contractImportQueueState) {
        globalThis.__contractImportQueueState = loadPersistedState();
    }

    return globalThis.__contractImportQueueState;
}

function touchTask(taskId) {
    const state = getQueueState();
    const task = state.tasks.get(taskId);
    if (!task) {
        return;
    }

    task.lastHeartbeatAt = nowIso();
}

function getQueuePosition(taskId) {
    const index = getQueueState().queue.indexOf(taskId);
    return index === -1 ? null : index + 1;
}

function removeCacheFile(cachePath) {
    if (!cachePath) {
        return;
    }

    try {
        if (fs.existsSync(cachePath)) {
            fs.unlinkSync(cachePath);
        }
    } catch {
        // Ignore cache cleanup failures.
    }
}

function removeTaskArtifacts(task) {
    if (!task) {
        return;
    }

    for (const item of task.items || []) {
        removeCacheFile(item.cachePath);
    }
}

function writeParsedCache(taskId, item, parsedData) {
    const cachePath = getTaskCachePath(taskId, item.id);
    const payload = {
        taskId,
        itemId: item.id,
        fileName: item.fileName,
        savedPath: item.savedPath,
        createdAt: nowIso(),
        parsedData,
    };

    fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2), 'utf8');
    return cachePath;
}

function readParsedCache(cachePath) {
    if (!cachePath || !fs.existsSync(cachePath)) {
        return null;
    }

    const raw = fs.readFileSync(cachePath, 'utf8');
    return JSON.parse(raw);
}

function refreshTaskStats(task) {
    const counts = {
        processed: 0,
        pendingReview: 0,
        saved: 0,
        failed: 0,
        skipped: 0,
    };

    for (const item of task.items) {
        if (item.status !== 'queued' && item.status !== 'processing') {
            counts.processed += 1;
        }

        if (item.status === 'pending_review') {
            counts.pendingReview += 1;
        } else if (item.status === 'saved') {
            counts.saved += 1;
        } else if (item.status === 'failed') {
            counts.failed += 1;
        } else if (item.status === 'skipped') {
            counts.skipped += 1;
        }
    }

    task.completedCount = counts.processed;
    task.pendingReviewCount = counts.pendingReview;
    task.savedCount = counts.saved;
    task.failedCount = counts.failed;
    task.skippedCount = counts.skipped;

    // Keep successCount for compatibility with the current UI.
    task.successCount = counts.saved;

    return counts;
}

function updateTaskSummary(task) {
    if (task.status === 'queued') {
        task.summaryMessage = '等待后台开始解析合同';
        return;
    }

    if (task.status === 'processing') {
        task.summaryMessage = `已解析 ${task.completedCount}/${task.totalCount} 份，剩余文件继续排队中`;
        return;
    }

    if (task.status === 'awaiting_confirmation') {
        task.summaryMessage = `已完成识别，待确认 ${task.pendingReviewCount} 份，已保存 ${task.savedCount} 份`;
        return;
    }

    if (task.status === 'completed') {
        task.summaryMessage = `全部处理完成，已保存 ${task.savedCount} 份合同`;
        return;
    }

    if (task.status === 'partial') {
        task.summaryMessage = `已保存 ${task.savedCount} 份，失败 ${task.failedCount} 份，跳过 ${task.skippedCount} 份`;
        return;
    }

    if (task.status === 'failed') {
        task.summaryMessage = '本次批量任务全部识别失败';
    }
}

function finalizeTaskState(task, { force = false } = {}) {
    if (!force && (task.status === 'queued' || task.status === 'processing')) {
        refreshTaskStats(task);
        updateTaskSummary(task);
        return;
    }

    const counts = refreshTaskStats(task);

    if (counts.pendingReview > 0) {
        task.status = 'awaiting_confirmation';
    } else if (counts.failed === task.totalCount) {
        task.status = 'failed';
    } else if (counts.saved === task.totalCount) {
        task.status = 'completed';
    } else if (counts.saved > 0 || counts.failed > 0 || counts.skipped > 0) {
        task.status = 'partial';
    } else {
        task.status = 'completed';
    }

    if (task.completedCount === task.totalCount && !task.finishedAt) {
        task.finishedAt = nowIso();
    }

    updateTaskSummary(task);
}

function deriveMonitorStatus(task) {
    if (task.status === 'queued') {
        return { code: 'queued', label: '排队中' };
    }

    if (task.status === 'awaiting_confirmation') {
        return { code: 'awaiting_confirmation', label: '待确认保存' };
    }

    if (task.status === 'completed') {
        return { code: 'completed', label: '已完成' };
    }

    if (task.status === 'partial') {
        return { code: 'partial', label: '部分完成' };
    }

    if (task.status === 'failed') {
        return { code: 'failed', label: '已失败' };
    }

    const now = Date.now();
    const heartbeatAgeMs = task.lastHeartbeatAt ? now - Date.parse(task.lastHeartbeatAt) : Number.POSITIVE_INFINITY;
    const currentFileAgeMs = task.currentFileStartedAt ? now - Date.parse(task.currentFileStartedAt) : 0;

    if (heartbeatAgeMs > HEARTBEAT_STALE_MS) {
        return { code: 'stalled', label: '可能卡住' };
    }

    if (currentFileAgeMs > FILE_SLOW_MS) {
        return { code: 'slow', label: '处理过慢' };
    }

    return { code: 'running', label: '进行中' };
}

function serializeItem(item, task) {
    const monitor = deriveMonitorStatus(task);
    const isCurrent = task.currentItemId === item.id && task.status === 'processing';

    let statusLabel = '等待中';
    if (item.status === 'processing') {
        if (monitor.code === 'stalled' && isCurrent) {
            statusLabel = '可能卡住';
        } else if (monitor.code === 'slow' && isCurrent) {
            statusLabel = '处理过慢';
        } else {
            statusLabel = '进行中';
        }
    } else if (item.status === 'pending_review') {
        statusLabel = '待确认保存';
    } else if (item.status === 'saved') {
        statusLabel = '已保存';
    } else if (item.status === 'failed') {
        statusLabel = '失败';
    } else if (item.status === 'skipped') {
        statusLabel = '已跳过';
    }

    return {
        id: item.id,
        fileName: item.fileName,
        savedPath: item.savedPath,
        status: item.status,
        statusLabel,
        message: item.message || '',
        startedAt: item.startedAt || null,
        finishedAt: item.finishedAt || null,
        contractId: item.contractId || null,
        contractNo: item.contractNo || null,
        method: item.method || null,
        confidence: item.confidence || null,
        timeMs: item.timeMs || null,
        priceItemsCount: item.priceItemsCount || 0,
        isCurrent,
        canReview: item.status === 'pending_review',
        hasCache: Boolean(item.cachePath),
    };
}

function serializeTask(task, { includeItems = true } = {}) {
    if ((task.status === 'queued' || task.status === 'processing')
        && !task.currentItemId
        && task.items.every((item) => item.status !== 'queued' && item.status !== 'processing')) {
        finalizeTaskState(task, { force: true });
        persistQueueState();
    }

    refreshTaskStats(task);

    const now = Date.now();
    const heartbeatAgeMs = task.lastHeartbeatAt ? now - Date.parse(task.lastHeartbeatAt) : null;
    const currentFileAgeMs = task.currentFileStartedAt ? now - Date.parse(task.currentFileStartedAt) : null;
    const monitor = deriveMonitorStatus(task);

    return {
        id: task.id,
        status: task.status,
        statusLabel: monitor.label,
        monitorStatus: monitor.code,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
        lastHeartbeatAt: task.lastHeartbeatAt,
        heartbeatAgeMs,
        currentFileName: task.currentFileName || null,
        currentFileStartedAt: task.currentFileStartedAt || null,
        currentFileAgeMs,
        queuePosition: task.status === 'queued' ? getQueuePosition(task.id) : null,
        totalCount: task.totalCount,
        completedCount: task.completedCount,
        successCount: task.successCount,
        savedCount: task.savedCount,
        pendingReviewCount: task.pendingReviewCount,
        failedCount: task.failedCount,
        skippedCount: task.skippedCount,
        progressPercent: task.totalCount > 0 ? Math.round((task.completedCount / task.totalCount) * 100) : 0,
        summaryMessage: task.summaryMessage || '',
        items: includeItems ? task.items.map((item) => serializeItem(item, task)) : undefined,
    };
}

function pruneTasks() {
    const state = getQueueState();
    const tasks = Array.from(state.tasks.values()).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

    tasks.slice(MAX_TASKS).forEach((task) => {
        removeTaskArtifacts(task);
        state.tasks.delete(task.id);
        state.queue = state.queue.filter((taskId) => taskId !== task.id);
    });

    persistQueueState(state);
}

function startHeartbeat(taskId) {
    touchTask(taskId);

    return setInterval(() => {
        touchTask(taskId);
    }, HEARTBEAT_INTERVAL_MS);
}

async function processTask(taskId) {
    const state = getQueueState();
    const task = state.tasks.get(taskId);

    if (!task) {
        return;
    }

    task.status = 'processing';
    task.startedAt = nowIso();
    updateTaskSummary(task);
    touchTask(taskId);
    persistQueueState(state);

    for (const item of task.items) {
        const heartbeat = startHeartbeat(taskId);

        task.currentItemId = item.id;
        task.currentFileName = item.fileName;
        task.currentFileStartedAt = nowIso();

        item.status = 'processing';
        item.startedAt = nowIso();
        item.message = '正在识别合同内容';
        touchTask(taskId);
        persistQueueState(state);

        try {
            const parsedData = await parseContract(item.savedPath, item.fileName);

            item.method = parsedData.method || null;
            item.confidence = parsedData.confidence || null;
            item.timeMs = parsedData.timeMs || null;
            item.priceItemsCount = Array.isArray(parsedData.priceItems) ? parsedData.priceItems.length : 0;
            item.contractNo = parsedData.contractNo || null;

            if (!parsedData.success) {
                item.status = 'failed';
                item.message = parsedData.error || '合同识别失败';
            } else {
                item.cachePath = writeParsedCache(task.id, item, parsedData);
                item.status = 'pending_review';
                item.message = '识别完成，请载入表单确认后保存';
            }
        } catch (error) {
            item.status = 'failed';
            item.message = error.message;
        } finally {
            clearInterval(heartbeat);

            item.finishedAt = nowIso();
            task.currentItemId = null;
            task.currentFileName = null;
            task.currentFileStartedAt = null;
            refreshTaskStats(task);
            updateTaskSummary(task);
            touchTask(taskId);
            persistQueueState(state);
        }
    }

    task.finishedAt = nowIso();
    finalizeTaskState(task, { force: true });
    touchTask(taskId);
    persistQueueState(state);
}

async function runQueue() {
    const state = getQueueState();
    if (state.running) {
        return;
    }

    state.running = true;
    try {
        while (state.queue.length > 0) {
            const taskId = state.queue.shift();
            await processTask(taskId);
        }
    } finally {
        state.running = false;
    }
}

function ensureQueueRunner() {
    void runQueue();
}

async function saveUploadedFile(file) {
    const contractsDir = ensureContractsDir();
    const fileName = path.basename(file.name || `contract-${Date.now()}`);
    const savedName = `${Date.now()}_${randomUUID()}_${fileName}`;
    const savedPath = path.join(contractsDir, savedName);
    const bytes = await file.arrayBuffer();

    fs.writeFileSync(savedPath, Buffer.from(bytes));

    return {
        id: randomUUID(),
        fileName,
        savedPath,
        cachePath: null,
        status: 'queued',
        message: '等待处理',
        startedAt: null,
        finishedAt: null,
        contractId: null,
        contractNo: null,
        method: null,
        confidence: null,
        timeMs: null,
        priceItemsCount: 0,
    };
}

function getTaskAndItem(taskId, itemId) {
    const task = getQueueState().tasks.get(taskId);
    if (!task) {
        return { task: null, item: null };
    }

    const item = task.items.find((entry) => entry.id === itemId) || null;
    return { task, item };
}

export async function createContractImportTask(files) {
    const state = getQueueState();
    const normalizedFiles = (Array.isArray(files) ? files : []).filter(Boolean);

    if (normalizedFiles.length === 0) {
        throw new Error('未上传合同文件');
    }

    const items = [];
    for (const file of normalizedFiles) {
        items.push(await saveUploadedFile(file));
    }

    const task = {
        id: randomUUID(),
        createdAt: nowIso(),
        startedAt: null,
        finishedAt: null,
        lastHeartbeatAt: nowIso(),
        status: 'queued',
        totalCount: items.length,
        completedCount: 0,
        successCount: 0,
        savedCount: 0,
        pendingReviewCount: 0,
        failedCount: 0,
        skippedCount: 0,
        currentItemId: null,
        currentFileName: null,
        currentFileStartedAt: null,
        summaryMessage: '等待后台处理',
        items,
    };

    state.tasks.set(task.id, task);
    state.queue.push(task.id);
    pruneTasks();
    persistQueueState(state);
    ensureQueueRunner();

    return serializeTask(task);
}

export function getContractImportTask(taskId) {
    const task = getQueueState().tasks.get(taskId);
    return task ? serializeTask(task) : null;
}

export function listContractImportTasks() {
    return Array.from(getQueueState().tasks.values())
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
        .map((task) => serializeTask(task, { includeItems: false }));
}

export function getContractImportTaskItem(taskId, itemId) {
    const { task, item } = getTaskAndItem(taskId, itemId);
    if (!task || !item) {
        return null;
    }

    if (!item.cachePath) {
        return {
            task: serializeTask(task),
            item: serializeItem(item, task),
            parsedData: null,
        };
    }

    const cached = readParsedCache(item.cachePath);
    if (!cached?.parsedData) {
        return null;
    }

    return {
        task: serializeTask(task),
        item: serializeItem(item, task),
        parsedData: cached.parsedData,
        fileName: cached.fileName,
        savedPath: cached.savedPath,
    };
}

export function markContractImportItemSaved(taskId, itemId, { contractId = null, contractNo = null } = {}) {
    const { task, item } = getTaskAndItem(taskId, itemId);
    if (!task || !item) {
        throw new Error('批量导入任务不存在');
    }

    if (item.status !== 'pending_review' && item.status !== 'saved') {
        throw new Error('当前文件不在待确认状态');
    }

    item.status = 'saved';
    item.contractId = contractId;
    item.contractNo = contractNo || item.contractNo || null;
    item.message = '已确认并保存到合同档案';
    task.finishedAt = nowIso();

    finalizeTaskState(task);
    touchTask(taskId);
    persistQueueState();

    return serializeTask(task);
}

export function skipContractImportItem(taskId, itemId) {
    const { task, item } = getTaskAndItem(taskId, itemId);
    if (!task || !item) {
        throw new Error('批量导入任务不存在');
    }

    if (item.status !== 'pending_review' && item.status !== 'failed' && item.status !== 'skipped') {
        throw new Error('当前文件不允许跳过');
    }

    item.status = 'skipped';
    item.message = '已标记为暂不保存';
    task.finishedAt = nowIso();

    finalizeTaskState(task);
    touchTask(taskId);
    persistQueueState();

    return serializeTask(task);
}

export function deleteContractImportItem(taskId, itemId) {
    const { task, item } = getTaskAndItem(taskId, itemId);
    if (!task || !item) {
        throw new Error('批量导入任务不存在');
    }

    if (item.status === 'processing' || item.status === 'queued') {
        throw new Error('正在处理或排队中的文件不允许删除');
    }

    // Delete the cached OCR result
    removeCacheFile(item.cachePath);

    // Delete the uploaded contract file
    if (item.savedPath) {
        try {
            if (fs.existsSync(item.savedPath)) {
                fs.unlinkSync(item.savedPath);
            }
        } catch {
            // Ignore file deletion failures
        }
    }

    // Remove the item from the task
    task.items = task.items.filter((entry) => entry.id !== itemId);
    task.totalCount = task.items.length;

    if (task.items.length === 0) {
        // All items deleted, remove the entire task
        const state = getQueueState();
        state.tasks.delete(taskId);
        state.queue = state.queue.filter((id) => id !== taskId);
        persistQueueState(state);
        return null;
    }

    finalizeTaskState(task, { force: true });
    touchTask(taskId);
    persistQueueState();

    return serializeTask(task);
}
