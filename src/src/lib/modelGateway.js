import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const ENV_CHAT_PROVIDER_ID = 'env-zhipu-default';
const ENV_OCR_PROVIDER_ID = 'env-zhipu-ocr';
const MODEL_CONFIG_DIR = path.join(process.cwd(), 'config');
const MODEL_CONFIG_PATH = path.join(MODEL_CONFIG_DIR, 'model-providers.json');
const DEFAULT_CHAT_COMPLETIONS_URL = 'https://api.edgefn.net/v1/chat/completions';
const DEFAULT_GLM_OCR_URL = 'https://open.bigmodel.cn/api/paas/v4/layout_parsing';

export const MODEL_TASKS = [
    { id: 'contractOcr', label: '合同 OCR 解析', capability: 'ocr' },
    { id: 'contractVision', label: '合同视觉识别', capability: 'vision' },
    { id: 'contractText', label: '合同文本识别', capability: 'text' },
    { id: 'worklogMatching', label: '工作日志智能匹配', capability: 'text' },
    { id: 'contractReview', label: '合同结果校对', capability: 'text' },
];

function createEmptyConfig() {
    return {
        version: 1,
        providers: [],
        taskBindings: Object.fromEntries(MODEL_TASKS.map((task) => [task.id, null])),
    };
}

function ensureConfigDir() {
    fs.mkdirSync(MODEL_CONFIG_DIR, { recursive: true });
}

function normalizeChatApiUrl(apiUrl) {
    const trimmed = String(apiUrl || '').trim();
    if (!trimmed) {
        return DEFAULT_CHAT_COMPLETIONS_URL;
    }

    if (trimmed.endsWith('/chat/completions')) {
        return trimmed;
    }

    if (trimmed.endsWith('/v1')) {
        return `${trimmed}/chat/completions`;
    }

    if (trimmed.includes('/v1/')) {
        return trimmed;
    }

    return `${trimmed.replace(/\/+$/, '')}/v1/chat/completions`;
}

function normalizeGlmOcrApiUrl(apiUrl) {
    const trimmed = String(apiUrl || '').trim();
    if (!trimmed) {
        return DEFAULT_GLM_OCR_URL;
    }

    if (trimmed.includes('/layout_parsing')) {
        return trimmed;
    }

    return `${trimmed.replace(/\/+$/, '')}/api/paas/v4/layout_parsing`;
}

function maskApiKey(apiKey) {
    const value = String(apiKey || '');
    if (!value) {
        return '';
    }

    if (value.length <= 8) {
        return `${value.slice(0, 2)}***${value.slice(-2)}`;
    }

    return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function sanitizeProvider(provider, includeSecrets = false) {
    const sanitized = {
        id: provider.id,
        name: provider.name,
        providerType: provider.providerType,
        apiUrl: provider.apiUrl,
        model: provider.model,
        enabled: Boolean(provider.enabled),
        supportsText: provider.supportsText !== false,
        supportsVision: Boolean(provider.supportsVision),
        supportsOcr: Boolean(provider.supportsOcr),
        notes: provider.notes || '',
        isSystem: Boolean(provider.isSystem),
        hasApiKey: Boolean(provider.apiKey),
        maskedApiKey: maskApiKey(provider.apiKey),
        createdAt: provider.createdAt || null,
        updatedAt: provider.updatedAt || null,
    };

    if (includeSecrets) {
        sanitized.apiKey = provider.apiKey || '';
    }

    return sanitized;
}

function readStoredConfig() {
    if (!fs.existsSync(MODEL_CONFIG_PATH)) {
        return createEmptyConfig();
    }

    try {
        const raw = fs.readFileSync(MODEL_CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            ...createEmptyConfig(),
            ...parsed,
            providers: Array.isArray(parsed.providers) ? parsed.providers : [],
            taskBindings: {
                ...createEmptyConfig().taskBindings,
                ...(parsed.taskBindings || {}),
            },
        };
    } catch (error) {
        console.error('[ModelGateway] Failed to read model config:', error);
        return createEmptyConfig();
    }
}

function writeStoredConfig(config) {
    ensureConfigDir();
    fs.writeFileSync(MODEL_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function createEnvChatProvider() {
    const apiKey = String(process.env.ZHIPU_API_KEY || '').trim();
    if (!apiKey) {
        return null;
    }

    return {
        id: ENV_CHAT_PROVIDER_ID,
        name: '环境默认 GLM',
        providerType: 'openai-compatible',
        apiUrl: normalizeChatApiUrl(process.env.ZHIPU_API_URL || DEFAULT_CHAT_COMPLETIONS_URL),
        apiKey,
        model: String(process.env.ZHIPU_MODEL || 'GLM-4.5V').trim() || 'GLM-4.5V',
        enabled: true,
        supportsText: true,
        supportsVision: true,
        supportsOcr: false,
        notes: '来自环境变量',
        isSystem: true,
        createdAt: null,
        updatedAt: null,
    };
}

function createEnvOcrProvider() {
    const apiKey = String(process.env.GLM_OCR_API_KEY || '').trim();
    if (!apiKey) {
        return null;
    }

    return {
        id: ENV_OCR_PROVIDER_ID,
        name: '环境默认 GLM-OCR',
        providerType: 'glm-ocr-maas',
        apiUrl: normalizeGlmOcrApiUrl(process.env.GLM_OCR_API_URL || DEFAULT_GLM_OCR_URL),
        apiKey,
        model: String(process.env.GLM_OCR_MODEL || 'glm-ocr').trim() || 'glm-ocr',
        enabled: true,
        supportsText: false,
        supportsVision: false,
        supportsOcr: true,
        notes: '来自环境变量',
        isSystem: true,
        createdAt: null,
        updatedAt: null,
    };
}

function resolveTaskBindings(storedBindings, providers) {
    const availableIds = new Set(providers.map((provider) => provider.id));
    const bindings = { ...createEmptyConfig().taskBindings, ...(storedBindings || {}) };
    const envChatProvider = providers.find((provider) => provider.id === ENV_CHAT_PROVIDER_ID);
    const envOcrProvider = providers.find((provider) => provider.id === ENV_OCR_PROVIDER_ID);

    for (const task of MODEL_TASKS) {
        const providerId = bindings[task.id];
        if (providerId && !availableIds.has(providerId)) {
            bindings[task.id] = null;
        }

        if (bindings[task.id]) {
            continue;
        }

        if (task.capability === 'ocr' && envOcrProvider?.supportsOcr) {
            bindings[task.id] = envOcrProvider.id;
            continue;
        }

        if (!envChatProvider) {
            continue;
        }

        if (task.capability === 'vision' && envChatProvider.supportsVision) {
            bindings[task.id] = envChatProvider.id;
        }

        if (task.capability === 'text' && envChatProvider.supportsText) {
            bindings[task.id] = envChatProvider.id;
        }
    }

    return bindings;
}

function normalizeProviderPayload(provider, existingProvider) {
    const now = new Date().toISOString();
    const providerType = String(provider.providerType || existingProvider?.providerType || 'openai-compatible').trim() || 'openai-compatible';
    const normalized = {
        id: existingProvider?.id || provider.id || randomUUID(),
        name: String(provider.name || existingProvider?.name || '').trim(),
        providerType,
        apiUrl: providerType === 'glm-ocr-maas'
            ? normalizeGlmOcrApiUrl(provider.apiUrl || existingProvider?.apiUrl || '')
            : normalizeChatApiUrl(provider.apiUrl || existingProvider?.apiUrl || ''),
        apiKey: String(provider.apiKey || '').trim() || existingProvider?.apiKey || '',
        model: String(provider.model || existingProvider?.model || (providerType === 'glm-ocr-maas' ? 'glm-ocr' : '')).trim(),
        enabled: provider.enabled !== undefined ? Boolean(provider.enabled) : existingProvider?.enabled !== false,
        supportsText: provider.supportsText !== undefined
            ? Boolean(provider.supportsText)
            : providerType === 'glm-ocr-maas'
                ? Boolean(existingProvider?.supportsText)
                : existingProvider?.supportsText !== false,
        supportsVision: provider.supportsVision !== undefined
            ? Boolean(provider.supportsVision)
            : providerType === 'openai-compatible'
                ? Boolean(existingProvider?.supportsVision ?? true)
                : Boolean(existingProvider?.supportsVision),
        supportsOcr: provider.supportsOcr !== undefined
            ? Boolean(provider.supportsOcr)
            : providerType === 'glm-ocr-maas'
                ? true
                : Boolean(existingProvider?.supportsOcr),
        notes: String(provider.notes || existingProvider?.notes || '').trim(),
        isSystem: Boolean(existingProvider?.isSystem),
        createdAt: existingProvider?.createdAt || now,
        updatedAt: now,
    };

    if (!normalized.name) {
        throw new Error('模型名称不能为空');
    }
    if (!normalized.model) {
        throw new Error('模型名不能为空');
    }
    if (!normalized.apiKey) {
        throw new Error('API Key 不能为空');
    }

    return normalized;
}

function getAuthHeaderValue(apiKey) {
    const value = String(apiKey || '').trim();
    if (!value) {
        return '';
    }

    return /^Bearer\s+/i.test(value) ? value : `Bearer ${value}`;
}

function extractOcrPreview(result) {
    const data = result?.data || result;
    const markdown = data?.md_results || data?.md_result || data?.markdown || '';
    if (markdown) {
        return String(markdown).substring(0, 200);
    }

    const firstLayout = Array.isArray(data?.layout_details) ? data.layout_details[0] : null;
    if (firstLayout) {
        return JSON.stringify(firstLayout).substring(0, 200);
    }

    return JSON.stringify(data || {}).substring(0, 200);
}

export function getModelConfigPath() {
    return MODEL_CONFIG_PATH;
}

export function loadModelConfig({ includeSecrets = false } = {}) {
    const stored = readStoredConfig();
    const providers = [...stored.providers];
    const envProviders = [createEnvOcrProvider(), createEnvChatProvider()].filter(Boolean);

    for (const envProvider of envProviders.reverse()) {
        if (!providers.some((provider) => provider.id === envProvider.id)) {
            providers.unshift(envProvider);
        }
    }

    const taskBindings = resolveTaskBindings(stored.taskBindings, providers);

    return {
        version: stored.version || 1,
        providers: providers.map((provider) => sanitizeProvider(provider, includeSecrets)),
        taskBindings,
        tasks: MODEL_TASKS,
        configPath: MODEL_CONFIG_PATH,
    };
}

export function upsertModelProvider(providerInput) {
    const stored = readStoredConfig();
    const existingIndex = stored.providers.findIndex((provider) => provider.id === providerInput.id);
    const existingProvider = existingIndex >= 0 ? stored.providers[existingIndex] : null;

    if (existingProvider?.isSystem) {
        throw new Error('环境默认模型不能在页面内修改');
    }

    const normalized = normalizeProviderPayload(providerInput, existingProvider);

    if (existingIndex >= 0) {
        stored.providers[existingIndex] = normalized;
    } else {
        stored.providers.unshift(normalized);
    }

    writeStoredConfig(stored);
    return loadModelConfig();
}

export function updateTaskBindings(nextBindings) {
    const stored = readStoredConfig();
    const availableIds = new Set(loadModelConfig({ includeSecrets: true }).providers.map((provider) => provider.id));
    const merged = { ...stored.taskBindings };

    for (const task of MODEL_TASKS) {
        if (!(task.id in nextBindings)) {
            continue;
        }

        const providerId = nextBindings[task.id] || null;
        if (providerId && !availableIds.has(providerId)) {
            throw new Error(`任务 ${task.label} 绑定的模型不存在`);
        }
        merged[task.id] = providerId;
    }

    stored.taskBindings = merged;
    writeStoredConfig(stored);
    return loadModelConfig();
}

export function deleteModelProvider(id) {
    if (id === ENV_CHAT_PROVIDER_ID || id === ENV_OCR_PROVIDER_ID) {
        throw new Error('环境默认模型不能删除');
    }

    const stored = readStoredConfig();
    stored.providers = stored.providers.filter((provider) => provider.id !== id);

    for (const task of MODEL_TASKS) {
        if (stored.taskBindings[task.id] === id) {
            stored.taskBindings[task.id] = null;
        }
    }

    writeStoredConfig(stored);
    return loadModelConfig();
}

export function getTaskProvider(taskId) {
    const config = loadModelConfig({ includeSecrets: true });
    const providerId = config.taskBindings[taskId];
    const task = MODEL_TASKS.find((item) => item.id === taskId);
    const provider = config.providers.find((item) => item.id === providerId);

    if (!task || !provider || !provider.enabled || !provider.apiKey) {
        return null;
    }

    if (task.capability === 'vision' && !provider.supportsVision) {
        return null;
    }

    if (task.capability === 'text' && !provider.supportsText) {
        return null;
    }

    if (task.capability === 'ocr' && !provider.supportsOcr) {
        return null;
    }

    return provider;
}

export function hasTaskProvider(taskId) {
    return Boolean(getTaskProvider(taskId));
}

export async function requestTaskModel(taskId, { messages, maxTokens, timeoutMs }) {
    const provider = getTaskProvider(taskId);
    if (!provider) {
        throw new Error(`任务 ${taskId} 未配置可用模型`);
    }

    if (provider.providerType !== 'openai-compatible') {
        throw new Error(`${provider.name} 不是聊天模型接口`);
    }

    const response = await fetch(provider.apiUrl, {
        method: 'POST',
        headers: {
            Authorization: getAuthHeaderValue(provider.apiKey),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: provider.model,
            messages,
            temperature: 0.1,
            max_tokens: maxTokens,
        }),
        signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`${provider.name} 请求失败 (${response.status}): ${text.substring(0, 300)}`);
    }

    return {
        provider,
        result: await response.json(),
    };
}

export async function requestTaskOcr(taskId, { file, prompt, timeoutMs }) {
    const provider = getTaskProvider(taskId);
    if (!provider) {
        throw new Error(`任务 ${taskId} 未配置可用 OCR 模型`);
    }

    if (provider.providerType !== 'glm-ocr-maas') {
        throw new Error(`${provider.name} 不是 GLM-OCR MaaS 接口`);
    }

    const payload = {
        model: provider.model || 'glm-ocr',
        file,
    };

    if (prompt) {
        payload.prompt = prompt;
    }

    const response = await fetch(provider.apiUrl, {
        method: 'POST',
        headers: {
            Authorization: getAuthHeaderValue(provider.apiKey),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`${provider.name} 请求失败 (${response.status}): ${text.substring(0, 300)}`);
    }

    return {
        provider,
        result: await response.json(),
    };
}

export async function testModelProvider(providerInput) {
    const currentConfig = loadModelConfig({ includeSecrets: true });
    const currentProvider = providerInput.id
        ? currentConfig.providers.find((provider) => provider.id === providerInput.id)
        : null;
    const provider = currentProvider && currentProvider.isSystem
        ? currentProvider
        : normalizeProviderPayload(providerInput, currentProvider);

    if (provider.providerType === 'glm-ocr-maas') {
        const response = await fetch(provider.apiUrl, {
            method: 'POST',
            headers: {
                Authorization: getAuthHeaderValue(provider.apiKey),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: provider.model || 'glm-ocr',
                file: 'https://cdn.bigmodel.cn/static/logo/introduction.png',
            }),
            signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`${provider.name} 连接失败 (${response.status}): ${text.substring(0, 300)}`);
        }

        const payload = await response.json();
        return {
            success: true,
            providerName: provider.name,
            model: provider.model,
            preview: extractOcrPreview(payload),
        };
    }

    const response = await fetch(provider.apiUrl, {
        method: 'POST',
        headers: {
            Authorization: getAuthHeaderValue(provider.apiKey),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: provider.model,
            messages: [
                { role: 'system', content: 'Reply with JSON only.' },
                { role: 'user', content: 'Return {"ok":true,"message":"pong"}.' },
            ],
            temperature: 0,
            max_tokens: 64,
        }),
        signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`${provider.name} 连接失败 (${response.status}): ${text.substring(0, 300)}`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content || '';

    return {
        success: true,
        providerName: provider.name,
        model: provider.model,
        preview: String(content).substring(0, 200),
    };
}
