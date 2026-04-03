/**
 * 合同 OCR 工作进程
 * 独立于 Next.js 运行，通过 stdout 输出 JSON 结果
 * 
 * 用法: node ocrWorker.mjs <文件路径>
 */

import { readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = process.argv[2];
if (!filePath) {
    process.stdout.write(JSON.stringify({ error: '未指定文件路径' }));
    process.exit(1);
}

const ext = path.extname(filePath).toLowerCase();

// 临时目录
const tmpDir = path.join(os.tmpdir(), 'contract-ocr-' + Date.now());
mkdirSync(tmpDir, { recursive: true });

function cleanup() {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { }
}

async function getTesseractWorker() {
    const Tesseract = await import('tesseract.js');
    const createWorker = Tesseract.createWorker || Tesseract.default?.createWorker;
    return await createWorker('chi_sim');
}

async function ocrPDF(filePath) {
    const { PDFParse } = await import('pdf-parse');
    const fileData = new Uint8Array(readFileSync(filePath));
    const parser = new PDFParse(fileData);
    const result = await parser.getText();

    const cleanText = result.text.replace(/--\s*\d+\s*of\s*\d+\s*--/g, '').trim();
    if (cleanText.length > 200) {
        return { text: cleanText, method: 'pdf-parse', pages: result.total };
    }

    console.error(`PDF 无文本层，OCR 识别 ${result.total} 页...`);

    // 用独立脚本转换 PDF 为图片（避免 pdf-to-img ESM 兼容性问题）
    const pdfToImagesScript = path.join(__dirname, 'pdfToImages.mjs');
    const pagesOutput = execFileSync('node', [pdfToImagesScript, filePath, tmpDir], {
        cwd: path.resolve(__dirname, '..', '..'),
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
    });
    const totalPages = parseInt(pagesOutput.toString().trim(), 10);
    console.error(`  已转换 ${totalPages} 页为图片`);

    const allTexts = [];
    let worker = null;
    try {
        worker = await getTesseractWorker();
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            const imgPath = path.join(tmpDir, `page_${pageNum}.png`);
            if (!existsSync(imgPath)) continue;

            console.error(`  OCR 第 ${pageNum}/${totalPages} 页...`);
            try {
                const { data: { text } } = await worker.recognize(imgPath);
                allTexts.push(`--- 第${pageNum}页 ---\n${text}`);
            } catch (err) {
                console.error(`  第 ${pageNum} 页 OCR 失败:`, err.message);
                allTexts.push(`--- 第${pageNum}页 --- (OCR失败)`);
            }
        }
    } finally {
        if (worker) await worker.terminate();
    }

    return { text: allTexts.join('\n'), method: 'ocr', pages: totalPages };
}

async function ocrDoc(filePath) {
    const mammoth = await import('mammoth');
    const extractFn = mammoth.extractRawText || mammoth.default?.extractRawText;
    const result = await extractFn({ path: filePath });
    return { text: result.value, method: 'mammoth', pages: null };
}

async function ocrImage(filePath) {
    const worker = await getTesseractWorker();
    const { data: { text } } = await worker.recognize(filePath);
    await worker.terminate();
    return { text, method: 'ocr', pages: 1 };
}

try {
    let result;

    switch (ext) {
        case '.pdf':
            result = await ocrPDF(filePath);
            break;
        case '.doc':
        case '.docx':
            result = await ocrDoc(filePath);
            break;
        case '.jpg': case '.jpeg':
        case '.png': case '.bmp':
        case '.tiff': case '.tif':
            result = await ocrImage(filePath);
            break;
        default:
            result = { error: `不支持的文件格式: ${ext}` };
    }

    cleanup();
    process.stdout.write(JSON.stringify(result));
} catch (err) {
    cleanup();
    process.stdout.write(JSON.stringify({ error: err.message }));
    process.exit(1);
}
