/**
 * 合同智能解析器
 * 支持 PDF / DOC / DOCX / JPG / PNG 格式
 * 
 * 核心策略：
 * 1. 扫描件PDF / 图片 → 转图片 → 调用 GLM-4.5V 视觉大模型直接提取结构化数据
 * 2. 文本PDF / DOC → 提取文本 → 调用 GLM-4.5V 文本模型提取结构化数据
 * 3. 若大模型 API 不可用，自动降级为本地正则解析（兜底）
 */

import { exec } from 'child_process';
import path from 'path';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { hasTaskProvider, requestTaskModel, requestTaskOcr } from './modelGateway.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(__dirname, '..', '..');

// ============ 配置 ============

const PDF_IMAGE_SCALE = Number(process.env.CONTRACT_PDF_IMAGE_SCALE || '2');
const VISION_INFO_MAX_TOKENS = Number(process.env.CONTRACT_VISION_INFO_MAX_TOKENS || '1536');
const VISION_PRICE_MAX_TOKENS = Number(process.env.CONTRACT_VISION_PRICE_MAX_TOKENS || '8192');
const TEXT_MAX_TOKENS = Number(process.env.CONTRACT_TEXT_MAX_TOKENS || '6144');
const GLM_REQUEST_TIMEOUT_MS = Number(process.env.CONTRACT_GLM_TIMEOUT_MS || '90000');
const GLM_OCR_REQUEST_TIMEOUT_MS = Number(process.env.CONTRACT_GLM_OCR_TIMEOUT_MS || '120000');
const PRICE_BATCH_SIZE = Number(process.env.CONTRACT_PRICE_BATCH_SIZE || '3');
const PRICE_BATCH_OVERLAP = Number(process.env.CONTRACT_PRICE_BATCH_OVERLAP || '1');
const PRICE_BATCH_CONCURRENCY = Number(process.env.CONTRACT_PRICE_BATCH_CONCURRENCY || '2');
const GLM_RETRY_DELAYS_MS = [1500, 4000];
const PRICE_TABLE_MIN_PAGES = Number(process.env.CONTRACT_PRICE_TABLE_MIN_PAGES || '4');
const PRICE_TABLE_TAIL_PAGES = Number(process.env.CONTRACT_PRICE_TABLE_TAIL_PAGES || '0');
const PREFIX_GENERIC_PRICE_ITEM_NAMES = false;
const PRICE_TABLE_STOP_MARKERS = ['支付方式', '付款方式', '双方的义务', '甲方的义务', '乙方的义务', '违约责任', '争议解决'];

// 合同提取的系统 Prompt
const CONTRACT_EXTRACTION_PROMPT = `
你是一个专业的工程合同解析助手。你的任务是从传入的图片或文本中，提取特定的结构化信息。
请严格按照以下JSON格式返回结果，**除了JSON之外不要输出任何其他文本、不要分析思考过程、不要做解释**。如果找不到某个字段，设为 null。

{
  "contractNo": "合同编号(尽量提取DLZJCHT及之后的完整字母数字符号组合)",
  "clientName": "甲方(委托方)名称",
  "partyB": "乙方(受托方/检测方)名称",
  "projectName": "工程项目名称",
  "signedDate": "签订日期(YYYY-MM-DD格式)",
  "priceItems": [
    {
      "testCategory": "所属检测类别（如:地基基础工程检测、工程建材类见证取样检测等）",
      "testItemName": "检测项目及内容名称(如:含水率、轻型动力触探等)",
      "unit": "计费单位(如:组、点、根、m、平方米等)",
      "quantity": 数量(必须是数字，如果是范围或非纯数字请尽量提取主要数字或留空),
      "unitPrice": 单价(数字，如没有单价但有总价和数量请推算，或填null),
      "totalPrice": 总价(数字)
    }
  ]
}

提取注意事项：
1. 价目表可能会跨越多页，请仔细识别长表格。
2. 表格中的“序号”、“备注”列可忽略，只提取核心内容。
3. 请确保数值(quantity, unitPrice, totalPrice)解析为数字类型，如果带"元"等单位请去掉。
4. **如果“检测内容”列为空或为“/”，请将对应的“检测项目”名称作为 testItemName 提取，不要提取成“/”。**
5. **如果“检测内容”是类似“常规检测”、“力学性能”等非常通用的词，请在 testItemName 前加上所属类别，例如“水泥(常规检测)”。**
6. **绝对禁止**输出推理过程（思考过程），只要最终的JSON对象！不要超过Token限制。
`;

// ============ 子进程辅助工具 ============

function getTempDir() {
    const tmpDir = path.join(srcRoot, '.temp-ocr');
    mkdirSync(tmpDir, { recursive: true });
    return tmpDir;
}

function runNodeScript(scriptContent, options = {}) {
    return new Promise((resolve, reject) => {
        const tmpDir = getTempDir();
        const scriptFile = path.join(tmpDir, `script_${Date.now()}_${Math.random().toString(36).slice(2)}.${options.esm ? 'mjs' : 'cjs'}`);

        writeFileSync(scriptFile, scriptContent, 'utf8');

        const cmd = `node "${scriptFile}"`;
        exec(cmd, {
            maxBuffer: options.maxBuffer || 50 * 1024 * 1024,
            timeout: options.timeout || 120000,
            cwd: srcRoot,
        }, (error, stdout, stderr) => {
            try { unlinkSync(scriptFile); } catch (e) { /* ignore */ }

            if (stderr && !error) {
                console.log('[OCR Worker]', stderr.substring(0, 500));
            }
            if (error) {
                reject(new Error(error.message + (stderr ? '\n' + stderr.substring(0, 500) : '')));
                return;
            }
            try {
                resolve(JSON.parse(stdout));
            } catch (e) {
                reject(new Error(`结果解析失败: ${e.message}, stdout: ${stdout.substring(0, 200)}`));
            }
        });
    });
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPricePageBatches(priceTablePages) {
    const normalizedBatchSize = Math.max(1, PRICE_BATCH_SIZE);
    const normalizedOverlap = Math.max(0, Math.min(PRICE_BATCH_OVERLAP, normalizedBatchSize - 1));
    const step = Math.max(1, normalizedBatchSize - normalizedOverlap);
    const batches = [];

    for (let batchStart = 0; batchStart < priceTablePages.length; batchStart += step) {
        const batch = priceTablePages.slice(batchStart, batchStart + normalizedBatchSize);
        if (!batch.length) {
            break;
        }

        batches.push({
            batchStart,
            pages: batch,
        });

        if (batchStart + normalizedBatchSize >= priceTablePages.length) {
            break;
        }
    }

    return batches;
}

async function narrowPriceTablePages(imagePaths) {
    if (imagePaths.length <= 4) {
        return imagePaths;
    }

    const narrowedPages = [imagePaths[0]];
    const minPages = Math.max(1, PRICE_TABLE_MIN_PAGES);
    const tailPages = Math.max(0, PRICE_TABLE_TAIL_PAGES);

    for (let i = 1; i < imagePaths.length; i++) {
        const pagePath = imagePaths[i];
        narrowedPages.push(pagePath);

        const ocrResult = await ocrImageLocal(pagePath);
        const text = cleanOCRText(ocrResult.text || '');

        if (narrowedPages.length >= minPages && PRICE_TABLE_STOP_MARKERS.some((marker) => text.includes(marker))) {
            for (let extraIndex = i + 1; extraIndex <= Math.min(imagePaths.length - 1, i + tailPages); extraIndex++) {
                narrowedPages.push(imagePaths[extraIndex]);
            }
            console.log(`[OCR] 检测到价目表结束标记，价目表页范围收敛为前 ${narrowedPages.length} 页`);
            break;
        }
    }

    return narrowedPages;
}

async function requestGLM(taskId, messages, { maxTokens, requestLabel, timeoutMs = GLM_REQUEST_TIMEOUT_MS }) {
    let lastError;

    for (let attempt = 0; attempt <= GLM_RETRY_DELAYS_MS.length; attempt++) {
        try {
            const { result } = await requestTaskModel(taskId, {
                messages,
                maxTokens,
                timeoutMs,
            });

            if (requestLabel === '__never__') {
                const errText = await response.text();
                const shouldRetry = [408, 429, 500, 502, 503, 504].includes(response.status) && attempt < GLM_RETRY_DELAYS_MS.length;

                if (shouldRetry) {
                    const retryDelay = GLM_RETRY_DELAYS_MS[attempt];
                    console.warn(`[GLM-4.5V] ${requestLabel} 请求失败 (${response.status})，${retryDelay}ms 后重试...`);
                    await sleep(retryDelay);
                    continue;
                }

                throw new Error(`GLM API 请求失败 (${response.status}): ${errText.substring(0, 300)}`);
            }

            void requestLabel;
            return result;
        } catch (error) {
            const isAbortError = error.name === 'AbortError';
            const shouldRetry = attempt < GLM_RETRY_DELAYS_MS.length;

            if (shouldRetry) {
                const retryDelay = GLM_RETRY_DELAYS_MS[attempt];
                console.warn(`[GLM-4.5V] ${requestLabel} ${isAbortError ? '超时' : '异常'}，${retryDelay}ms 后重试...`);
                lastError = error;
                await sleep(retryDelay);
                continue;
            }

            throw error;
        }
    }

    throw lastError || new Error(`GLM 请求失败: ${requestLabel}`);
}

// ============ 文件处理层 ============

function convertPDFToImages(filePath) {
    const tmpDir = getTempDir();
    const outputPrefix = path.join(tmpDir, `pdf_${Date.now()}`);

    const script = `
import { pdf } from 'pdf-to-img';
import { readFileSync, writeFileSync } from 'fs';
const fileData = readFileSync(${JSON.stringify(filePath)});
const pages = [];
let i = 0;
for await (const img of await pdf(fileData, { scale: ${JSON.stringify(PDF_IMAGE_SCALE)} })) {
  i++;
  const outPath = ${JSON.stringify(outputPrefix)} + '_' + i + '.png';
  writeFileSync(outPath, img);
  pages.push(outPath);
}
process.stdout.write(JSON.stringify({ pages, total: i }));
`;
    return runNodeScript(script, { esm: true, timeout: 120000 });
}

function checkPDFText(filePath) {
    const script = `
const {PDFParse} = require('pdf-parse');
const fs = require('fs');
const data = new Uint8Array(fs.readFileSync(${JSON.stringify(filePath)}));
const parser = new PDFParse(data);
parser.getText().then(r => {
  const clean = r.text.replace(/--\\s*\\d+\\s*of\\s*\\d+\\s*--/g, '').trim();
  process.stdout.write(JSON.stringify({text: clean, total: r.total}));
}).catch(e => { process.stdout.write(JSON.stringify({error: e.message})); process.exit(1); });
`;
    return runNodeScript(script, { timeout: 30000 }).catch(err => ({ text: '', total: 0, error: err.message }));
}

function extractDocText(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    let script;
    if (ext === '.docx') {
        script = `
const mammoth = require('mammoth');
mammoth.extractRawText({ path: ${JSON.stringify(filePath)} })
  .then(r => process.stdout.write(JSON.stringify({text: r.value})))
  .catch(e => { process.stdout.write(JSON.stringify({error: e.message})); process.exit(1); });
`;
    } else {
        script = `
const WordExtractor = require('word-extractor');
const extractor = new WordExtractor();
extractor.extract(${JSON.stringify(filePath)})
  .then(doc => process.stdout.write(JSON.stringify({text: doc.getBody()})))
  .catch(e => { process.stdout.write(JSON.stringify({error: e.message})); process.exit(1); });
`;
    }
    return runNodeScript(script, { timeout: 30000 });
}

function getFileMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.pdf') return 'application/pdf';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.png') return 'image/png';
    if (ext === '.bmp') return 'image/bmp';
    if (ext === '.tif' || ext === '.tiff') return 'image/tiff';

    return 'application/octet-stream';
}

function buildDataUriFromFile(filePath) {
    const mimeType = getFileMimeType(filePath);
    const fileBuffer = readFileSync(filePath);
    return `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
}

function stringifyGlmOcrNode(node) {
    if (!node) {
        return '';
    }

    if (typeof node === 'string') {
        return node;
    }

    if (Array.isArray(node)) {
        return node.map((item) => stringifyGlmOcrNode(item)).filter(Boolean).join('\n');
    }

    const candidateKeys = ['content', 'text', 'html', 'markdown', 'md', 'table_html', 'tableHtml'];
    for (const key of candidateKeys) {
        if (typeof node[key] === 'string' && node[key].trim()) {
            return node[key];
        }
    }

    return '';
}

function decodeHtmlEntities(text) {
    return String(text || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
}

function normalizeGlmOcrMarkdown(markdown) {
    if (!markdown) {
        return '';
    }

    return decodeHtmlEntities(markdown)
        .replace(/!\[\]\([^)]+\)\s*/g, '')
        .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, '\t')
        .replace(/<\/tr>/gi, '\n')
        .replace(/<tr[^>]*>/gi, '')
        .replace(/<table[^>]*>/gi, '')
        .replace(/<\/table>/gi, '\n')
        .replace(/<div[^>]*>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\r/g, '')
        .replace(/(^|\n)(\d+)\s*\.\s+(\d+)/g, '$1$2.$3')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function buildGlmOcrText(result) {
    const data = result?.data || result || {};
    const markdown = data.md_results || data.md_result || data.markdown || '';
    if (markdown) {
        return normalizeGlmOcrMarkdown(markdown);
    }

    const textParts = [];
    const layoutDetails = Array.isArray(data.layout_details)
        ? data.layout_details
        : Array.isArray(data.layoutDetails)
            ? data.layoutDetails
            : [];

    for (const item of layoutDetails) {
        const text = stringifyGlmOcrNode(item);
        if (text) {
            textParts.push(text);
        }
    }

    return textParts.filter(Boolean).join('\n\n');
}

async function callGlmOcr(filePath) {
    if (!hasTaskProvider('contractOcr')) {
        throw new Error('contractOcr task is not configured');
    }

    const file = buildDataUriFromFile(filePath);
    const { result } = await requestTaskOcr('contractOcr', {
        file,
        timeoutMs: GLM_OCR_REQUEST_TIMEOUT_MS,
    });

    const data = result?.data || result || {};
    const text = buildGlmOcrText(result);

    return {
        raw: result,
        data,
        text,
        markdown: data.md_results || data.md_result || data.markdown || '',
        layoutDetails: Array.isArray(data.layout_details) ? data.layout_details : [],
    };
}

// ============ GLM-4.5V 大模型调用层 ============

/**
 * 调用 GLM-4.5V 视觉模型，发送图片获取结构化 JSON
 * @param {string[]} imagePaths - 图片文件路径数组
 * @returns {Object} 解析结果
 */
async function callGLMVision(imagePaths) {
    if (!hasTaskProvider('contractVision')) {
        throw new Error('未配置 ZHIPU_API_KEY');
    }

    // 策略：将页面分为两组分别请求
    // 第1组: 前1-2页（封面、基本信息）→ 提取甲乙方、合同编号等
    // 第2组: 第3页开始到最后（价目表详情页）→ 提取检测项目清单

    const basicInfoPages = imagePaths.slice(0, Math.min(2, imagePaths.length));
    let priceTablePages = imagePaths.length > 2
        ? imagePaths.slice(2)
        : [];

    // 第1步: 从封面页提取基本信息
    console.log(`[GLM-4.5V] 第1步: 从前 ${basicInfoPages.length} 页提取基本信息...`);
    const basicResult = await callGLMVisionSingle(basicInfoPages,
        '请从以下合同图片中提取基本信息（合同编号、甲方、乙方、项目名称、签订日期）。如果图片中有价目表也请一并提取。');

    if (!priceTablePages.length) {
        return basicResult;
    }

    if (priceTablePages.length > 4) {
        priceTablePages = await narrowPriceTablePages(priceTablePages);
    }

    // 合并结果容器
    const merged = { ...basicResult };

    const allPriceItems = [];

    const headerPage = priceTablePages.length > 0 ? priceTablePages[0] : null;
    const batches = buildPricePageBatches(priceTablePages);

    let hasSuccessfulPriceBatch = false;
    const normalizedBatchConcurrency = Math.max(1, PRICE_BATCH_CONCURRENCY);
    const finalPageRecoveryPrompt = 'Extract only the numbered price-table rows that are visibly present on the last page in this image set. Do not infer rows from other pages, do not merge rows, and ignore contract clauses outside the table. If a cell is blank or "/" cell, inherit the last non-empty value from the same page. Return JSON only.';
    const parallelPricePrompt = 'Extract every numbered row from these contract price-table images. Do not merge adjacent rows. If a category, item name, or "/" cell is blank, inherit the last non-empty value from the same table. Include rows from both 专项类 and 见证取样类, and preserve quantity, unitPrice, and totalPrice exactly. Return JSON only.';

    for (let chunkStart = 0; chunkStart < batches.length; chunkStart += normalizedBatchConcurrency) {
        const chunk = batches.slice(chunkStart, chunkStart + normalizedBatchConcurrency);
        const chunkResults = await Promise.allSettled(chunk.map(async ({ batchStart, pages: currentBatch }, offset) => {
            const batchWithHeader = [];
            if (headerPage && !currentBatch.includes(headerPage)) {
                batchWithHeader.push(headerPage);
            }
            batchWithHeader.push(...currentBatch);

            const batchNum = chunkStart + offset + 1;
            console.log(`[GLM-4.5V] 绗?姝?鎵规${batchNum}: 鎻愬彇绗?{3 + batchStart}-${2 + batchStart + currentBatch.length}椤垫娴嬮」鐩?(甯︽湁琛ㄥご涓婁笅鏂?...`);

            const priceResult = await callGLMVisionSingle(batchWithHeader, parallelPricePrompt, {
                maxTokens: VISION_PRICE_MAX_TOKENS,
                requestLabel: `price-batch-${batchNum}`,
            });

            return { priceResult };
        }));

        for (const chunkResult of chunkResults) {
            if (chunkResult.status === 'fulfilled') {
                const { priceResult } = chunkResult.value;
                hasSuccessfulPriceBatch = true;
                if (priceResult && Array.isArray(priceResult.priceItems)) {
                    allPriceItems.push(...priceResult.priceItems);
                }
                if (!merged.contractNo && priceResult?.contractNo) merged.contractNo = priceResult.contractNo;
                continue;
            }

            const errorInfo = chunkResult.reason || {};
            console.error(`[GLM-4.5V] price batch failed: ${errorInfo.message || errorInfo}`);
        }
    }

    for (let chunkStart = priceTablePages.length; chunkStart < priceTablePages.length; chunkStart += normalizedBatchConcurrency) {
        const chunk = priceTablePages.slice(chunkStart, chunkStart + normalizedBatchConcurrency);
        const chunkResults = await Promise.allSettled(chunk.map(async (pagePath, offset) => {
            const recoveryImages = pagePath === headerPage ? [pagePath] : [headerPage, pagePath];
            const pageNum = chunkStart + offset + 1;
            console.log(`[GLM-4.5V] page recovery ${pageNum}: extracting visible rows only...`);

            const recoveryResult = await callGLMVisionSingle(recoveryImages, finalPageRecoveryPrompt, {
                maxTokens: VISION_PRICE_MAX_TOKENS,
                requestLabel: `price-page-${pageNum}`,
            });

            return { recoveryResult };
        }));

        for (const chunkResult of chunkResults) {
            if (chunkResult.status === 'fulfilled') {
                const { recoveryResult } = chunkResult.value;
                if (recoveryResult && Array.isArray(recoveryResult.priceItems)) {
                    allPriceItems.push(...recoveryResult.priceItems);
                }
                continue;
            }

            const errorInfo = chunkResult.reason || {};
            console.error(`[GLM-4.5V] page recovery failed: ${errorInfo.message || errorInfo}`);
        }
    }

    for (let index = batches.length; index < batches.length; index++) {
        const { batchStart, pages: currentBatch } = batches[index];

        // 强制带上包含表头的第1页作为上下文(去重)，避免模型在没有表头的续页上迷失
        const batchWithHeader = [];
        if (headerPage && !currentBatch.includes(headerPage)) {
            batchWithHeader.push(headerPage);
        }
        batchWithHeader.push(...currentBatch);

        const batchNum = index + 1;
        console.log(`[GLM-4.5V] 第2步-批次${batchNum}: 提取第${3 + batchStart}-${2 + batchStart + currentBatch.length}页检测项目 (带有表头上下文)...`);
        try {
            const priceResult = await callGLMVisionSingle(batchWithHeader,
                '请从以下合同价目表图片中提取所有检测项目清单，尽可能完整。图1可能是表头参考，请重点提取后续图片中的新数据。',
                { maxTokens: VISION_PRICE_MAX_TOKENS, requestLabel: `价目表批次${batchNum}` });
            hasSuccessfulPriceBatch = true;
            if (priceResult && Array.isArray(priceResult.priceItems)) {
                allPriceItems.push(...priceResult.priceItems);
            }
            if (!merged.contractNo && priceResult?.contractNo) merged.contractNo = priceResult.contractNo;
        } catch (e) {
            console.error(`[GLM-4.5V] 第2步-批次${batchNum}失败: ${e.message}`);
        }
    }

    if (!hasSuccessfulPriceBatch && priceTablePages.length > 0) {
        throw new Error('所有价目表批次均解析失败');
    }

    // --- 阶段1：严格精确去重 ---
    // 抵消由于批次重叠(overlap)造成的同一行在重叠页被识别取两次
    const exactSeen = new Set();
    const uniqueRawItems = [];
    for (const item of allPriceItems) {
        const str = JSON.stringify({ ...item, quantity: Number(item.quantity) }); // 保证数值化比较
        if (!exactSeen.has(str)) {
            exactSeen.add(str);
            uniqueRawItems.push(item);
        }
    }

    // --- 阶段2：动态重命名与语义聚合合并 ---
    const existingItems = Array.isArray(merged.priceItems) ? merged.priceItems : [];
    const allCombined = [...existingItems, ...uniqueRawItems];

    // 统计各项目名称在多少个不同的类别下出现过，用于动态前缀
    const nameToCategories = new Map();
    for (const item of allCombined) {
        let itemName = (item.testItemName || '').trim();
        if (!itemName || itemName === '/' || itemName === '-' || itemName.toLowerCase() === 'null') continue;
        const cat = (item.testCategory || '').trim();
        if (cat) {
            if (!nameToCategories.has(itemName)) nameToCategories.set(itemName, new Set());
            nameToCategories.get(itemName).add(cat);
        }
    }

    const dedupedItems = [];
    const dedupedRowKeys = new Set();
    for (const item of allCombined) {
        let itemName = (item.testItemName || '').trim();
        const categoryName = (item.testCategory || '').trim();

        // 过滤掉如“一、专项类”、“二、见证取样类”等表格结构大标题
        if (/^[一二三四五六七八九十]+[、.]/.test(itemName) || /^[一二三四五六七八九十]+[、.]/.test(categoryName)) {
            continue;
        }

        // 应对空名或符号
        if (!itemName || itemName === '/' || itemName === '-' || itemName.toLowerCase() === 'null') {
            itemName = categoryName || '未命名项目';
        } else {
            // 应对重名参数：在该合同中，若该名称属于多个不同类，或属于通用词汇，强行加减类别前缀
            const cats = nameToCategories.get(itemName);
            const isGeneric = ['常规检测', '力学性能', '物理性能', '化学分析', '常规', '压实度', '抗压强度', '厚度', '弯沉', '构造深度', '配合比设计'].includes(itemName);

            if (PREFIX_GENERIC_PRICE_ITEM_NAMES && categoryName && !itemName.includes(categoryName)) {
                if ((cats && cats.size > 1) || isGeneric) {
                    itemName = `${categoryName}(${itemName})`;
                }
            }
        }

        item.testItemName = itemName;

        // 生成唯一维度的 key，仅包括项目名称、单位、单价 
        const quantity = Number(item.quantity) || 0;
        const unitPrice = Number(item.unitPrice) || 0;
        const totalPrice = Number(item.totalPrice) || 0;
        const normalizedCategory = categoryName || '';
        const normalizedUnit = (item.unit || '').trim();
        const rowLeafName = itemName.replace(/^[^()（）]+[(（]([^()（）]+)[)）]$/, '$1');
        void rowLeafName;
        const dedupeKey = `${normalizedCategory}_${itemName}_${normalizedUnit}_${quantity}_${Math.round(unitPrice * 100)}_${Math.round(totalPrice * 100)}`;

        if (!dedupedRowKeys.has(dedupeKey)) {
            // 语义相同 -> 不同表单中的同类项目数量累计
            dedupedRowKeys.add(dedupeKey);
            dedupedItems.push({
                ...item,
                quantity,
                unitPrice,
                totalPrice,
            });
        }
    }

    merged.priceItems = dedupedItems;

    return merged;
}

/**
 * 发送一批图片给 GLM-4.5V 视觉模型（单次调用）
 */
async function callGLMVisionSingle(imagePaths, userPrompt, options = {}) {
    const imageContents = imagePaths.map(imgPath => {
        const imgBuffer = readFileSync(imgPath);
        const base64 = imgBuffer.toString('base64');
        const ext = path.extname(imgPath).toLowerCase();
        const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
        return {
            type: 'image_url',
            image_url: {
                url: `data:${mimeType};base64,${base64}`
            }
        };
    });

    const messages = [
        {
            role: 'system',
            content: CONTRACT_EXTRACTION_PROMPT
        },
        {
            role: 'user',
            content: [
                { type: 'text', text: userPrompt },
                ...imageContents
            ]
        }
    ];

    console.log(`[GLM-4.5V] 发送 ${imagePaths.length} 张图片进行识别...`);

    const result = await requestGLM('contractVision', messages, {
        maxTokens: options.maxTokens || VISION_INFO_MAX_TOKENS,
        requestLabel: options.requestLabel || `视觉识别(${imagePaths.length}页)`,
        timeoutMs: options.timeoutMs || Math.max(GLM_REQUEST_TIMEOUT_MS, imagePaths.length * 80000),
    });
    writeFileSync(path.join(srcRoot, `.temp-ocr`, `glm_raw_vision_batch_${Date.now()}.json`), JSON.stringify(result, null, 2), 'utf8');

    if (result.error) {
        throw new Error(`GLM API 返回错误: ${JSON.stringify(result.error)}`);
    }

    const message = result.choices?.[0]?.message;
    if (!message || (!message.content && !message.reasoning_content)) {
        console.error(`[GLM-4.5V ERROR DETAILS] ${JSON.stringify(result, null, 2)}`);
        throw new Error('GLM API 返回内容为空');
    }

    console.log(`[GLM-4.5V] 收到响应，长度: ${(message.content || message.reasoning_content).length} 字符`);

    return parseGLMResponse(message);
}

/**
 * 调用 GLM-4.5V 文本模型，发送纯文本获取结构化 JSON
 * @param {string} text - 合同文本内容
 * @returns {Object} 解析结果
 */
async function callGLMText(text) {
    if (!hasTaskProvider('contractText')) {
        throw new Error('未配置 ZHIPU_API_KEY');
    }

    // 截取前 8000 字符避免超长
    const truncatedText = text.length > 8000 ? text.substring(0, 8000) + '\n...(后续内容省略)' : text;

    const messages = [
        {
            role: 'system',
            content: CONTRACT_EXTRACTION_PROMPT
        },
        {
            role: 'user',
            content: `以下是一份工程检测合同的文本内容，请提取所有信息：\n\n${truncatedText}`
        }
    ];

    console.log(`[GLM-4.5V] 发送文本 (${truncatedText.length} 字) 进行解析...`);

    const result = await requestGLM('contractText', messages, {
        maxTokens: TEXT_MAX_TOKENS,
        requestLabel: '文本识别',
    });
    writeFileSync(path.join(srcRoot, `.temp-ocr`, `glm_raw_text_batch_${Date.now()}.json`), JSON.stringify(result, null, 2), 'utf8');

    if (result.error) {
        throw new Error(`GLM API 返回错误: ${JSON.stringify(result.error)}`);
    }

    const message = result.choices?.[0]?.message;
    if (!message || (!message.content && !message.reasoning_content)) {
        console.error(`[GLM-4.5V ERROR DETAILS] ${JSON.stringify(result, null, 2)}`);
        throw new Error('GLM API 返回内容为空');
    }

    console.log(`[GLM-4.5V] 收到响应，长度: ${(message.content || message.reasoning_content).length} 字符`);

    return parseGLMResponse(message);
}

/**
 * 解析 GLM 返回的文本，提取 JSON 或通过正则强行提取
 */
function parseGLMResponse(contentObj) {
    // 兼容传入整个 message 对象（含 reasoning_content）
    let content = typeof contentObj === 'string' ? contentObj : (contentObj.content || contentObj.reasoning_content || '');

    // 尝试直接解析
    try {
        return JSON.parse(content);
    } catch (e) {
        // 模型可能在 JSON 前后加了说明文本或 markdown 代码块标记
    }

    // 尝试从 markdown 代码块中提取
    const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
        try {
            return JSON.parse(codeBlockMatch[1].trim());
        } catch (e) { /* continue */ }
    }

    // 尝试提取第一个 { ... } 块
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[0]);
        } catch (e) { /* continue */ }
    }

    // ==========================================
    // 终极兜底：当 JSON 被阶段或全在 reasoning_content 里时，使用正则强行提取
    // ==========================================
    const items = [];
    const itemRegex = /testCategory["']?\s*[:：]\s*["']([^"']+)["'].*?testItemName["']?\s*[:：]\s*["']([^"']+)["'].*?unit["']?\s*[:：]\s*["']([^"']+)["'].*?quantity["']?\s*[:：]\s*([\d.]+).*?unitPrice["']?\s*[:：]\s*([\d.]+).*?totalPrice["']?\s*[:：]\s*([\d.]+)/gs;

    let m;
    while ((m = itemRegex.exec(content)) !== null) {
        items.push({
            testCategory: m[1],
            testItemName: m[2],
            unit: m[3],
            quantity: Number(m[4]),
            unitPrice: Number(m[5]),
            totalPrice: Number(m[6])
        });
    }

    if (items.length > 0 || content.includes('contractNo')) {
        const extractField = (fieldName) => {
            const regex = new RegExp(`${fieldName}["']?\\s*[:：]\\s*["']([^"']+)["']`);
            const match = content.match(regex);
            return match ? match[1] : null;
        };

        return {
            contractNo: extractField('contractNo'),
            clientName: extractField('clientName'),
            partyB: extractField('partyB'),
            projectName: extractField('projectName'),
            signedDate: extractField('signedDate'),
            priceItems: items
        };
    }

    require('fs').writeFileSync(path.join(srcRoot, '.temp-ocr', `failed_glm_parse_${Date.now()}.txt`), content, 'utf8');
    throw new Error(`无法从 GLM 响应中解析 JSON`);
}

// ============ 本地正则解析（兜底） ============

export function cleanOCRText(text) {
    if (!text) return '';
    let cleaned = text;
    for (let i = 0; i < 5; i++) {
        cleaned = cleaned.replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2');
    }
    cleaned = cleaned.replace(/([\u4e00-\u9fff])\s+([（()）:：,，。、;；""''《》【】])/g, '$1$2');
    cleaned = cleaned.replace(/([（()）:：,，。、;；""''《》【】])\s+([\u4e00-\u9fff])/g, '$1$2');
    cleaned = cleaned.replace(/([（(])\s+/g, '$1');
    cleaned = cleaned.replace(/([）)])\s+([：:])/g, '$1$2');
    cleaned = cleaned.replace(/(\d+)\s*\.\s*(\d+)/g, '$1.$2');
    return cleaned;
}

function cleanCompanyName(name) {
    if (!name) return name;
    const suffixMatch = name.match(/^(.*?(?:公司|政府|委员会|管委会|办事处|局|部|处|院|所|中心|集团|服务站|指挥部))/);
    if (suffixMatch) return suffixMatch[1].trim();
    return name;
}

export function extractClientName(text) {
    const patterns = [
        /甲方[（(]?委托[方人][)）]?\s*[：:.]\s*(.+)/,
        /委托方[（(]?甲方[)）]?\s*[：:.]\s*(.+)/,
        /委托单位\s*[：:.]\s*(.+)/,
        /委托方\s*[：:.]\s*(.+)/,
        /甲方\s*[：:.]\s*(.+)/,
    ];

    for (const regex of patterns) {
        const match = text.match(regex);
        if (match) {
            let name = match[1].trim();
            name = cleanCompanyName(name);
            if (name && name.length >= 4) return name;
        }
    }
    return null;
}

export function extractPartyB(text) {
    const patterns = [
        /乙方[（(]?(?:受托方?|检测方?|服务方?)[)）]?\s*[：:.]\s*(.+)/,
        /服务方[（(]?乙方[)）]?\s*[：:.]\s*(.+)/,
        /检测单位\s*[：:.]\s*(.+)/,
        /乙方\s*[：:.]\s*(.+)/,
    ];
    for (const regex of patterns) {
        const match = text.match(regex);
        if (match) {
            let name = match[1].trim();
            name = cleanCompanyName(name);
            if (name && name.length >= 4) return name;
        }
    }
    return null;
}

export function extractContractNo(text, fileName) {
    const patterns = [
        /合同编号\s*[：:.]\s*([\w\-]+)/,
        /编号\s*[：:.]\s*([\w\-]+)/,
        /((?:DLZJC?H?T?-?)?JC-\d{4}-\d{3,4})/i,
    ];
    for (const regex of patterns) {
        const match = text.match(regex);
        if (match) {
            let no = match[1].trim();
            if (no.length >= 5) return no;
        }
    }
    return null;
}

export function extractProjectName(text) {
    const patterns = [
        /工程名称\s*[：:.。]\s*(.+)/,
        /项目名称\s*[：:.。]\s*(.+)/,
    ];
    for (const regex of patterns) {
        const match = text.match(regex);
        if (match) {
            let name = match[1].trim().replace(/\s+/g, '');
            if (name.length >= 4) return name;
        }
    }
    return null;
}

export function extractSignedDate(text) {
    const match = text.match(/签订日期\s*[：:.]\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    return null;
}

function normalizeStructuredToken(token) {
    return (token || '')
        .replace(/\r/g, '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseStructuredNumber(token) {
    if (!token) return null;
    const normalized = token.replace(/,/g, '').trim();
    if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
        return null;
    }
    return Number(normalized);
}

function looksLikeStructuredPriceTable(text) {
    if (!text) return false;
    return text.includes('序号')
        && (text.includes('检测项目') || text.includes('检测类别'))
        && text.includes('单位')
        && text.includes('单价')
        && text.includes('小计');
}

function getStructuredPriceSections(text) {
    const normalized = (text || '').replace(/\r/g, '');
    const startMarkers = ['1、检验项目及检验费用', '检验项目及检验费用'];
    let startIndex = 0;

    for (const marker of startMarkers) {
        const idx = normalized.indexOf(marker);
        if (idx !== -1) {
            startIndex = idx;
            break;
        }
    }

    const endMarkers = ['2、支付方式', '2.1本工程所有检验总检验费', '甲、乙双方的义务'];
    let endIndex = normalized.length;
    for (const marker of endMarkers) {
        const idx = normalized.indexOf(marker, startIndex);
        if (idx !== -1) {
            endIndex = Math.min(endIndex, idx);
        }
    }

    const scopedText = normalized.slice(startIndex, endIndex);
    const sectionRegex = /1\.\d+[^\n]*[\s\S]*?(?=(?:\n1\.\d+[^\n]*)|\n2、支付方式|甲、乙双方的义务|$)/g;
    const sections = scopedText.match(sectionRegex) || [];

    return sections.filter((section) => section.includes('序号'));
}

function isStructuredRowStart(tokens, index) {
    const token = tokens[index];
    if (!/^\d+$/.test(token)) {
        return false;
    }

    const nextToken = tokens[index + 1];
    if (!nextToken) {
        return false;
    }

    return parseStructuredNumber(nextToken) === null;
}

function parseStructuredPriceRow(rowTokens, state) {
    const compactTokens = rowTokens
        .map(normalizeStructuredToken)
        .filter((token) => token && !['暂估', '数量', '单价', '（元）', '小计', '备注'].includes(token));

    if (compactTokens.length < 4) {
        return null;
    }

    let totalIndex = -1;
    for (let i = compactTokens.length - 1; i >= 0; i--) {
        if (parseStructuredNumber(compactTokens[i]) !== null) {
            totalIndex = i;
            break;
        }
    }

    if (totalIndex < 3) {
        return null;
    }

    const totalPrice = parseStructuredNumber(compactTokens[totalIndex]);
    const unitPrice = parseStructuredNumber(compactTokens[totalIndex - 1]);
    const quantity = parseStructuredNumber(compactTokens[totalIndex - 2]);
    const unit = compactTokens[totalIndex - 3];

    if (totalPrice === null || unitPrice === null || quantity === null || !unit) {
        return null;
    }

    const prefixTokens = compactTokens.slice(0, totalIndex - 3);
    let testCategory = state.currentCategory || '';
    let testItemName = state.currentItem || '';

    if (prefixTokens.length >= 2) {
        testCategory = prefixTokens[0];
        testItemName = prefixTokens.slice(1).join(' ');
    } else if (prefixTokens.length === 1) {
        const onlyToken = prefixTokens[0];
        if (onlyToken !== '/' && onlyToken !== '-') {
            testItemName = onlyToken;
        }
    }

    if (!testItemName || testItemName === '/' || testItemName === '-') {
        testItemName = testCategory || state.currentItem || '未命名项目';
    }

    if (!testCategory || testCategory === '/' || testCategory === '-') {
        testCategory = state.currentCategory || '';
    }

    state.currentCategory = testCategory;
    state.currentItem = testItemName;

    return {
        testCategory,
        testItemName,
        unit,
        quantity,
        unitPrice,
        totalPrice,
    };
}

function pushStructuredPriceItem(items, seen, parsedRow) {
    if (!parsedRow) {
        return;
    }

    const dedupeKey = `${parsedRow.testCategory}|${parsedRow.testItemName}|${parsedRow.unit}|${parsedRow.quantity}|${parsedRow.unitPrice}|${parsedRow.totalPrice}`;
    if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        items.push(parsedRow);
    }
}

function extractStructuredPriceItems(text) {
    if (!looksLikeStructuredPriceTable(text)) {
        return [];
    }

    const sections = getStructuredPriceSections(text);
    const items = [];
    const seen = new Set();

    for (const section of sections) {
        const tokens = section
            .split(/[\t\n]+/)
            .map(normalizeStructuredToken)
            .filter(Boolean);

        const state = {
            currentCategory: '',
            currentItem: '',
        };

        const lineState = {
            currentCategory: '',
            currentItem: '',
        };

        const sectionLines = section
            .replace(/\r/g, '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (!isStructuredRowStart(tokens, i)) {
                continue;
            }

            const rowTokens = [];
            let j = i + 1;
            while (j < tokens.length) {
                const nextToken = tokens[j];
                if (isStructuredRowStart(tokens, j) || nextToken.startsWith('专项类合计') || nextToken.startsWith('见证取样类合计') || nextToken.startsWith('总价')) {
                    break;
                }
                rowTokens.push(nextToken);
                j++;
            }

            pushStructuredPriceItem(items, seen, parseStructuredPriceRow(rowTokens, state));

            i = j - 1;
        }

        for (const line of sectionLines) {
            if (!line.includes('\t')) {
                continue;
            }

            const columns = line
                .split('\t')
                .map(normalizeStructuredToken)
                .filter(Boolean);

            if (columns.length < 6 || columns.length > 8 || !/^\d+$/.test(columns[0])) {
                continue;
            }

            pushStructuredPriceItem(items, seen, parseStructuredPriceRow(columns.slice(1), lineState));
        }
    }

    return items;
}

export function extractPriceItems(text) {
    const structuredItems = extractStructuredPriceItems(text);
    if (structuredItems.length >= 5) {
        return structuredItems;
    }

    const cleanedInput = cleanOCRText(text);
    const lines = cleanedInput.split('\n');
    const items = [];
    let inPriceTable = false;
    let currentCategory = '';
    let previousLineText = '';

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        if (line.includes('检测控制价') || line.includes('检测项目') || line.includes('检验项目') ||
            line.includes('检测费用') || line.includes('检验费用') || line.includes('报价清单') ||
            line.includes('检测服务费') || line.includes('费用清单')) {
            inPriceTable = true;
            continue;
        }
        if (inPriceTable && (line.includes('支付方式') || line.includes('双方的义务') || line.includes('二、付款') || line.match(/^2[、.]/))) {
            inPriceTable = false;
        }
        if ((line.includes('检测类别') && line.includes('检测内容')) ||
            (line.includes('检验类别') && line.includes('检验内容')) ||
            (line.includes('序号') && (line.includes('单价') || line.includes('单位')))) {
            inPriceTable = true;
            continue;
        }
        if (!inPriceTable) continue;

        // 模式1: 序号 类别 内容 单位 数量 单价
        const m1 = line.match(
            /^\d+\s+([\u4e00-\u9fff]{2,20})\s+([\u4e00-\u9fff（()）\s]{2,50}?)\s+([\u4e00-\u9fff㎡m²m³]+)\s+(\d+)\s+([\d.]+)\s*([\d.]*)/
        );
        if (m1) {
            items.push({
                testCategory: cleanOCRText(m1[1]).trim(),
                testItemName: cleanOCRText(m1[2]).trim(),
                unit: m1[3].trim(),
                quantity: parseInt(m1[4]),
                unitPrice: parseFloat(m1[5]),
                totalPrice: m1[6] ? parseFloat(m1[6]) : parseFloat(m1[5]) * parseInt(m1[4]),
            });
            continue;
        }

        // 模式2: 内容 单位 数量 单价 总价
        const m2 = line.match(
            /^([\u4e00-\u9fff（()）、\s]{2,50}?)\s+([\u4e00-\u9fff㎡m²m³根项组件个吨t次套台批点块处份]+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)/
        );
        if (m2) {
            items.push({
                testCategory: currentCategory || '常规检测',
                testItemName: cleanOCRText(m2[1]).trim(),
                unit: m2[2].trim(),
                quantity: parseInt(m2[3]),
                unitPrice: parseFloat(m2[4]),
                totalPrice: parseFloat(m2[5]),
            });
            continue;
        }

        // 模式3: 名称 + 单价 + 总价（无单位/数量列）
        const m3 = line.match(/([\u4e00-\u9fff（()）、\s]{3,}?)\s+([\d.]+)\s+([\d.]+)\s*$/);
        if (m3) {
            const unitPrice = parseFloat(m3[2]);
            const totalPrice = parseFloat(m3[3]);
            if (unitPrice > 0 && totalPrice >= unitPrice) {
                const qty = Math.round(totalPrice / unitPrice) || 1;
                items.push({
                    testCategory: currentCategory || '常规检测',
                    testItemName: cleanOCRText(m3[1]).trim(),
                    unit: '项',
                    quantity: qty,
                    unitPrice,
                    totalPrice,
                });
                continue;
            }
        }

        // 模式4: 碎片化 OCR — 搜索含有两个小数的行
        const decimals = line.match(/\d+\.\d{2}/g);
        if (decimals && decimals.length >= 2) {
            const nums = decimals.map(d => parseFloat(d));
            let price = Math.min(...nums);
            let total = Math.max(...nums);
            let qty = Math.round(total / price) || 1;
            let nameText = line.replace(/[\d.,\s|｜%_a-zA-Z]/g, '').trim();
            const finalName = nameText.length < 5 ? (previousLineText + nameText) : nameText;

            if (price > 0 && finalName.length > 1) {
                items.push({
                    testCategory: currentCategory || '常规检测',
                    testItemName: finalName.replace(/^[、，。；：\s\d]+|[、，。；：\s]+$/g, ''),
                    unit: '项',
                    quantity: qty,
                    unitPrice: price,
                    totalPrice: total,
                });
                continue;
            }
        }

        const catMatch = line.match(/^(\d+)\s+([\u4e00-\u9fff]{2,15})\s*$/);
        if (catMatch) currentCategory = cleanOCRText(catMatch[2]).trim();

        const possibleName = line.replace(/[\d.,a-zA-Z|%\-_]/g, '').trim();
        if (possibleName.length > 2) {
            previousLineText = possibleName;
        }
    }
    return items;
}

// ============ 文件名解析 ============

function parseFileName(fileName) {
    const info = {};
    const noMatch = fileName.match(/((?:DLZJCHT-)?JC-\d{4}-\d{3,4})/i);
    if (noMatch) info.contractNo = noMatch[1];
    const nameMatch = fileName.match(/JC-\d{4}-\d{3,4}[_\s]?(.+?)(?:\.\w+)?$/);
    if (nameMatch) {
        let pn = nameMatch[1].replace(/[_-]/g, '').replace(/(检测合同|合同|第三方检测服务合同)$/g, '').trim();
        if (pn.length >= 2) info.projectName = pn;
    }
    return info;
}

// ============ 主解析函数 ============

function buildStructuredTextContractResult(text, fileName, fileNameInfo, method, startTime) {
    const priceItems = extractPriceItems(text);
    if (priceItems.length < 5) {
        return null;
    }

    const cleanedText = cleanOCRText(text);
    const rawProjectNameMatch = text.match(/工程名称\s*[：:]\s*([^\t\r\n]+)/);
    const rawProjectName = rawProjectNameMatch ? rawProjectNameMatch[1].trim() : null;
    const extractedProjectName = extractProjectName(cleanedText);
    const projectName = rawProjectName
        || ((extractedProjectName && extractedProjectName.length < 80 && !extractedProjectName.includes('委托单位')) ? extractedProjectName : null)
        || fileNameInfo.projectName
        || null;
    const contractNo = extractContractNo(cleanedText, fileName) || fileNameInfo.contractNo || null;
    const clientName = extractClientName(cleanedText);
    const partyB = extractPartyB(cleanedText);
    const signedDate = extractSignedDate(cleanedText);

    return {
        success: true,
        contractNo,
        clientName,
        partyB,
        projectName,
        signedDate,
        priceItems,
        rawText: text.substring(0, 5000),
        method,
        pages: null,
        confidence: 'high',
        timeMs: Date.now() - startTime,
    };
}

function hasUsefulAiResult(result) {
    if (!result || typeof result !== 'object') {
        return false;
    }

    const itemCount = Array.isArray(result.priceItems) ? result.priceItems.length : 0;
    if (itemCount > 0) {
        return true;
    }

    const fieldCount = [
        result.contractNo,
        result.clientName,
        result.partyB,
        result.projectName,
        result.signedDate,
    ].filter(Boolean).length;

    return fieldCount >= 2;
}

function buildAiContractResult(aiResult, fileNameInfo, method, startTime) {
    const contractNo = aiResult.contractNo || fileNameInfo.contractNo || null;
    const projectName = aiResult.projectName || fileNameInfo.projectName || null;
    const priceItems = Array.isArray(aiResult.priceItems) ? aiResult.priceItems : [];

    return {
        success: true,
        contractNo,
        clientName: aiResult.clientName || null,
        partyB: aiResult.partyB || null,
        projectName,
        signedDate: aiResult.signedDate || null,
        priceItems,
        rawText: [
            '[AI parser result]',
            `contractNo: ${contractNo || ''}`,
            `clientName: ${aiResult.clientName || ''}`,
            `partyB: ${aiResult.partyB || ''}`,
            `projectName: ${projectName || ''}`,
            `priceItems: ${priceItems.length}`,
        ].join('\n'),
        method,
        pages: null,
        confidence: 'high',
        timeMs: Date.now() - startTime,
    };
}

function buildExtractionFallbackResult(extraction, fileName, fileNameInfo, startTime) {
    const rawText = extraction.text || '';
    const cleanedText = cleanOCRText(rawText);

    const textContractNo = extractContractNo(cleanedText, fileName);
    const contractNo = textContractNo || fileNameInfo.contractNo || null;
    const clientName = extractClientName(cleanedText);
    const partyB = extractPartyB(cleanedText);
    const projectName = fileNameInfo.projectName || extractProjectName(cleanedText);
    const signedDate = extractSignedDate(cleanedText);
    const priceItems = extractPriceItems(rawText);

    const fieldsFound = [contractNo, clientName, partyB, projectName, signedDate].filter((value) => value !== null).length;
    let confidence = 'low';
    if (fieldsFound >= 4) confidence = 'high';
    else if (fieldsFound >= 2) confidence = 'medium';

    return {
        success: true,
        contractNo,
        clientName,
        partyB,
        projectName,
        signedDate,
        priceItems,
        rawText: rawText.substring(0, 5000),
        method: extraction.method,
        pages: extraction.pages,
        confidence,
        timeMs: Date.now() - startTime,
    };
}

export async function parseContract(filePath, fileName) {
    const startTime = Date.now();
    const normalizedFileName = fileName || path.basename(filePath);
    const fileNameInfo = parseFileName(normalizedFileName);
    const ext = path.extname(filePath).toLowerCase();
    const isImageFile = ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif'].includes(ext);

    console.log(`[ContractParser] start parsing ${normalizedFileName} (${ext})`);

    let preferredExtraction = null;
    let aiResult = null;
    let aiMethod = null;

    try {
        if (isImageFile) {
            if (hasTaskProvider('contractOcr')) {
                console.log('[ContractParser] image -> GLM-OCR first');
                const ocrResult = await callGlmOcr(filePath);
                if (ocrResult.text && ocrResult.text.trim()) {
                    preferredExtraction = {
                        text: ocrResult.text,
                        method: 'glm-ocr',
                        pages: 1,
                    };

                    const structuredResult = buildStructuredTextContractResult(
                        ocrResult.text,
                        normalizedFileName,
                        fileNameInfo,
                        'glm-ocr-structured',
                        startTime,
                    );
                    if (structuredResult) {
                        return structuredResult;
                    }

                    if (hasTaskProvider('contractText')) {
                        aiResult = await callGLMText(ocrResult.text);
                        aiMethod = 'glm-ocr+glm-text';
                    }
                }
            }

            if (!hasUsefulAiResult(aiResult) && hasTaskProvider('contractVision')) {
                console.log('[ContractParser] image -> vision fallback');
                aiResult = await callGLMVision([filePath]);
                aiMethod = 'glm-vision';
            }
        } else if (ext === '.pdf') {
            console.log('[ContractParser] pdf -> checking text layer');
            const pdfInfo = await checkPDFText(filePath);

            if (pdfInfo.text && pdfInfo.text.length > 200) {
                preferredExtraction = {
                    text: pdfInfo.text,
                    method: 'pdf-parse',
                    pages: pdfInfo.total || null,
                };

                const structuredResult = buildStructuredTextContractResult(
                    pdfInfo.text,
                    normalizedFileName,
                    fileNameInfo,
                    'pdf-parse-structured',
                    startTime,
                );
                if (structuredResult) {
                    return structuredResult;
                }

                if (hasTaskProvider('contractText')) {
                    aiResult = await callGLMText(pdfInfo.text);
                    aiMethod = 'glm-text';
                }
            } else {
                if (hasTaskProvider('contractOcr')) {
                    console.log('[ContractParser] scanned pdf -> GLM-OCR first');
                    const ocrResult = await callGlmOcr(filePath);
                    if (ocrResult.text && ocrResult.text.trim()) {
                        preferredExtraction = {
                            text: ocrResult.text,
                            method: 'glm-ocr',
                            pages: pdfInfo.total || null,
                        };

                        const structuredResult = buildStructuredTextContractResult(
                            ocrResult.text,
                            normalizedFileName,
                            fileNameInfo,
                            'glm-ocr-structured',
                            startTime,
                        );
                        if (structuredResult) {
                            return structuredResult;
                        }

                        if (hasTaskProvider('contractText')) {
                            aiResult = await callGLMText(ocrResult.text);
                            aiMethod = 'glm-ocr+glm-text';
                        }
                    }
                }

                if (!hasUsefulAiResult(aiResult) && hasTaskProvider('contractVision')) {
                    console.log('[ContractParser] scanned pdf -> vision fallback');
                    const { pages } = await convertPDFToImages(filePath);
                    try {
                        aiResult = await callGLMVision(pages);
                        aiMethod = 'glm-vision';
                    } finally {
                        pages.forEach((pagePath) => {
                            try { unlinkSync(pagePath); } catch (error) { /* ignore */ }
                        });
                    }
                }
            }
        } else if (ext === '.doc' || ext === '.docx') {
            console.log('[ContractParser] word -> local extraction first');
            const docResult = await extractDocText(filePath);
            if (docResult.text && docResult.text.length > 50) {
                preferredExtraction = {
                    text: docResult.text,
                    method: ext === '.docx' ? 'mammoth' : 'word-extractor',
                    pages: null,
                };

                const structuredResult = buildStructuredTextContractResult(
                    docResult.text,
                    normalizedFileName,
                    fileNameInfo,
                    `${preferredExtraction.method}-structured`,
                    startTime,
                );
                if (structuredResult) {
                    return structuredResult;
                }

                if (hasTaskProvider('contractText')) {
                    aiResult = await callGLMText(docResult.text);
                    aiMethod = 'glm-text';
                }
            }
        }
    } catch (error) {
        console.error(`[ContractParser] AI-first parse failed for ${normalizedFileName}: ${error.message}`);
    }

    if (hasUsefulAiResult(aiResult)) {
        return buildAiContractResult(aiResult, fileNameInfo, aiMethod || 'ai', startTime);
    }

    let extraction = preferredExtraction;
    if (!extraction) {
        console.log('[ContractParser] falling back to local extraction');
        try {
            extraction = await extractTextLocal(filePath);
        } catch (error) {
            return {
                success: false,
                error: `文件解析失败: ${error.message}`,
                contractNo: fileNameInfo.contractNo || null,
                clientName: null,
                partyB: null,
                projectName: fileNameInfo.projectName || null,
                signedDate: null,
                priceItems: [],
                rawText: '',
                method: 'failed',
                timeMs: Date.now() - startTime,
            };
        }
    }

    return buildExtractionFallbackResult(extraction, normalizedFileName, fileNameInfo, startTime);
}

async function parseContractLegacy(filePath, fileName) {
    const startTime = Date.now();
    if (!fileName) fileName = path.basename(filePath);
    const fileNameInfo = parseFileName(fileName);
    const ext = path.extname(filePath).toLowerCase();

    console.log(`[ContractParser] 开始解析: ${fileName} (${ext})`);

    // === 策略A: 尝试 GLM-4.5V 大模型解析 ===
    if (hasTaskProvider('contractVision') || hasTaskProvider('contractText')) {
        try {
            let glmResult = null;

            if (['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif'].includes(ext)) {
                // 图片文件 → 直接发给 GLM 视觉模型
                console.log('[GLM] 图片文件，直接发送视觉模型...');
                glmResult = await callGLMVision([filePath]);

            } else if (ext === '.pdf') {
                // PDF → 先检查有无文本层
                console.log('[GLM] PDF文件，检查文本层...');
                const pdfInfo = await checkPDFText(filePath);

                if (pdfInfo.text && pdfInfo.text.length > 200) {
                    const structuredResult = buildStructuredTextContractResult(pdfInfo.text, fileName, fileNameInfo, 'pdf-parse-structured', startTime);
                    if (structuredResult) {
                        console.log(`[TextParser] structured PDF parsing succeeded: ${structuredResult.contractNo}, items=${structuredResult.priceItems.length}`);
                        return structuredResult;
                    }
                    // 有文本层 → 用文本模式
                    console.log(`[GLM] PDF 含文本层 (${pdfInfo.text.length} 字)，使用文本模式...`);
                    glmResult = await callGLMText(pdfInfo.text);
                } else {
                    const companionTextFile = null;
                    if (companionTextFile) {
                        console.log(`[TextParser] found companion source: ${path.basename(companionTextFile)}`);
                        const companionResult = await extractDocText(companionTextFile);
                        if (companionResult.text && companionResult.text.length > 50) {
                            const structuredResult = buildStructuredTextContractResult(companionResult.text, fileName, fileNameInfo, 'sidecar-structured', startTime);
                            if (structuredResult) {
                                console.log(`[TextParser] companion source parsing succeeded: ${structuredResult.contractNo}, items=${structuredResult.priceItems.length}`);
                                return structuredResult;
                            }
                        }
                    }
                    // 纯扫描件 → 转图片 → 视觉模式
                    console.log(`[GLM] PDF 为扫描件，正在转换图片...`);
                    const { pages, total } = await convertPDFToImages(filePath);
                    console.log(`[GLM] 已转换 ${total} 页，发送给视觉模型...`);

                    try {
                        glmResult = await callGLMVision(pages);
                    } finally {
                        // 清理临时图片
                        pages.forEach(p => { try { unlinkSync(p); } catch (e) { } });
                    }
                }

            } else if (ext === '.doc' || ext === '.docx') {
                // DOC/DOCX → 提取文本 → 文本模式
                console.log('[GLM] DOC 文件，提取文本后发送文本模式...');
                const docResult = await extractDocText(filePath);
                if (docResult.text && docResult.text.length > 50) {
                    const structuredResult = buildStructuredTextContractResult(docResult.text, fileName, fileNameInfo, `${ext === '.docx' ? 'mammoth' : 'word-extractor'}-structured`, startTime);
                    if (structuredResult) {
                        console.log(`[TextParser] structured DOC parsing succeeded: ${structuredResult.contractNo}, items=${structuredResult.priceItems.length}`);
                        return structuredResult;
                    }
                    glmResult = await callGLMText(docResult.text);
                }
            }

            // 如果 GLM 返回了有效结果
            if (glmResult) {
                console.log(`[GLM] 解析成功! 合同编号: ${glmResult.contractNo}, 项目数: ${glmResult.priceItems?.length || 0}`);

                // 用文件名信息补充可能漏掉的字段
                const contractNo = glmResult.contractNo || fileNameInfo.contractNo || null;
                const projectName = glmResult.projectName || fileNameInfo.projectName || null;

                return {
                    success: true,
                    contractNo,
                    clientName: glmResult.clientName || null,
                    partyB: glmResult.partyB || null,
                    projectName,
                    signedDate: glmResult.signedDate || null,
                    priceItems: Array.isArray(glmResult.priceItems) ? glmResult.priceItems : [],
                    rawText: `[GLM-4.5V 解析结果]\n合同编号: ${contractNo}\n甲方: ${glmResult.clientName}\n乙方: ${glmResult.partyB}\n项目: ${projectName}\n检测项目数: ${glmResult.priceItems?.length || 0}`,
                    method: 'glm-4.5v',
                    pages: null,
                    confidence: 'high',
                    timeMs: Date.now() - startTime,
                };
            }
        } catch (err) {
            console.error(`[GLM] 大模型解析失败，降级为本地正则: ${err.message}`);
        }
    } else {
        console.log('[GLM] 未配置 API Key，使用本地正则解析');
    }

    // === 策略B: 降级为本地 OCR + 正则解析 ===
    console.log('[本地] 使用本地 OCR + 正则解析...');
    let extraction;
    try {
        extraction = await extractTextLocal(filePath);
    } catch (err) {
        return {
            success: false, error: `文件解析失败: ${err.message}`,
            contractNo: fileNameInfo.contractNo || null, clientName: null, partyB: null,
            projectName: fileNameInfo.projectName || null, signedDate: null, priceItems: [],
            rawText: '', method: 'failed', timeMs: Date.now() - startTime,
        };
    }

    const rawText = extraction.text;
    const cleanedText = cleanOCRText(rawText);

    const textContractNo = extractContractNo(cleanedText, fileName);
    const contractNo = textContractNo || fileNameInfo.contractNo;
    const clientName = extractClientName(cleanedText);
    const partyB = extractPartyB(cleanedText);
    const projectName = fileNameInfo.projectName || extractProjectName(cleanedText);
    const signedDate = extractSignedDate(cleanedText);
    const priceItems = extractPriceItems(rawText);

    const fieldsFound = [contractNo, clientName, partyB, projectName, signedDate].filter(v => v !== null).length;
    let confidence = 'low';
    if (fieldsFound >= 4) confidence = 'high';
    else if (fieldsFound >= 2) confidence = 'medium';

    return {
        success: true, contractNo, clientName, partyB, projectName, signedDate, priceItems,
        rawText: rawText.substring(0, 5000),
        method: extraction.method, pages: extraction.pages,
        confidence, timeMs: Date.now() - startTime,
    };
}

// ============ 本地文本提取（不含 GLM） ============

async function extractTextLocal(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.pdf') {
        console.log('  检查 PDF 文本层...');
        const pdfInfo = await checkPDFText(filePath);

        if (pdfInfo.text && pdfInfo.text.length > 200) {
            return { text: pdfInfo.text, method: 'pdf-parse', pages: pdfInfo.total };
        }

        console.log(`  PDF 为扫描件，共 ${pdfInfo.total} 页，正在转换为图片...`);
        const { pages, total } = await convertPDFToImages(filePath);

        console.log(`  开始本地 OCR 识别 ${total} 页...`);
        const text = await ocrImagesLocal(pages);

        pages.forEach(p => { try { unlinkSync(p); } catch (e) { } });

        return { text, method: 'ocr', pages: total };

    } else if (ext === '.doc' || ext === '.docx') {
        const result = await extractDocText(filePath);
        return { text: result.text, method: ext === '.docx' ? 'mammoth' : 'word-extractor', pages: null };

    } else if (['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif'].includes(ext)) {
        console.log('  本地 OCR 识别图片...');
        const result = await ocrImageLocal(filePath);
        if (result.error) throw new Error(result.error);
        return { text: result.text, method: 'ocr', pages: 1 };

    } else {
        throw new Error(`不支持的文件格式: ${ext}`);
    }
}

function ocrImageLocal(imagePath) {
    const script = `
const T = require('tesseract.js');
T.recognize(${JSON.stringify(imagePath)}, 'chi_sim')
  .then(({data:{text}}) => process.stdout.write(JSON.stringify({text})))
  .catch(e => { process.stdout.write(JSON.stringify({error:e.message})); process.exit(1); });
`;
    return runNodeScript(script, { timeout: 120000 }).catch(err => ({ text: '', error: err.message }));
}

async function ocrImagesLocal(imagePaths) {
    const allTexts = [];
    for (let i = 0; i < imagePaths.length; i++) {
        console.log(`  OCR 第 ${i + 1}/${imagePaths.length} 页...`);
        const result = await ocrImageLocal(imagePaths[i]);
        if (result.error) {
            console.error(`  第 ${i + 1} 页 OCR 失败:`, result.error);
            allTexts.push(`--- 第${i + 1}页 --- (OCR失败)`);
        } else {
            allTexts.push(`--- 第${i + 1}页 ---\n${result.text}`);
        }
    }
    return allTexts.join('\n');
}
