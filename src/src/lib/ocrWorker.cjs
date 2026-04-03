/**
 * 合同 OCR 工作进程 (CJS)
 * 用法: node ocrWorker.cjs <文件路径>
 */

const { readFileSync, writeFileSync, mkdirSync, unlinkSync } = require('fs');
const path = require('path');
const os = require('os');
const Tesseract = require('tesseract.js');

const filePath = process.argv[2];
if (!filePath) {
    process.stdout.write(JSON.stringify({ error: '未指定文件路径' }));
    process.exit(1);
}

const ext = path.extname(filePath).toLowerCase();

function getTempPath(suffix) {
    const tmpDir = path.join(os.tmpdir(), 'contract-ocr');
    mkdirSync(tmpDir, { recursive: true });
    return path.join(tmpDir, `page_${Date.now()}_${Math.random().toString(36).slice(2)}${suffix}`);
}

async function ocrPDF(filePath) {
    const { PDFParse } = require('pdf-parse');
    const fileData = new Uint8Array(readFileSync(filePath));
    const parser = new PDFParse(fileData);
    const result = await parser.getText();

    const cleanText = result.text.replace(/--\s*\d+\s*of\s*\d+\s*--/g, '').trim();

    if (cleanText.length > 200) {
        return { text: cleanText, method: 'pdf-parse', pages: result.total };
    }

    console.error(`PDF 无文本层，OCR 识别 ${result.total} 页...`);

    // pdf-to-img is ESM-only, use dynamic import
    const { pdf } = await import('pdf-to-img');

    const allTexts = [];
    let pageNum = 0;

    for await (const pageImage of await pdf(fileData, { scale: 2 })) {
        pageNum++;
        console.error(`  OCR 第 ${pageNum}/${result.total} 页...`);

        const tmpFile = getTempPath('.png');
        try {
            writeFileSync(tmpFile, pageImage);
            const { data: { text } } = await Tesseract.recognize(tmpFile, 'chi_sim');
            allTexts.push(`--- 第${pageNum}页 ---\n${text}`);
        } catch (err) {
            console.error(`  第 ${pageNum} 页 OCR 失败:`, err.message);
            allTexts.push(`--- 第${pageNum}页 --- (OCR失败)`);
        } finally {
            try { unlinkSync(tmpFile); } catch (e) { /* ignore */ }
        }
    }

    return { text: allTexts.join('\n'), method: 'ocr', pages: result.total };
}

async function ocrDoc(filePath) {
    const mammoth = await import('mammoth');
    const result = await (mammoth.default || mammoth).extractRawText({ path: filePath });
    return { text: result.value, method: 'mammoth', pages: null };
}

async function ocrImage(filePath) {
    const { data: { text } } = await Tesseract.recognize(filePath, 'chi_sim');
    return { text, method: 'ocr', pages: 1 };
}

(async () => {
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
            case '.jpg':
            case '.jpeg':
            case '.png':
            case '.bmp':
            case '.tiff':
            case '.tif':
                result = await ocrImage(filePath);
                break;
            default:
                result = { error: `不支持的文件格式: ${ext}` };
        }

        process.stdout.write(JSON.stringify(result));
    } catch (err) {
        process.stdout.write(JSON.stringify({ error: err.message }));
        process.exit(1);
    }
})();
