/**
 * PDF 转图片工具
 * 用法: node pdfToImages.mjs <pdf路径> <输出目录>
 * 输出: 页数 (stdout)
 */
import { pdf } from 'pdf-to-img';
import { readFileSync, writeFileSync } from 'fs';

const pdfPath = process.argv[2];
const outputDir = process.argv[3];

const buf = readFileSync(pdfPath);
let i = 0;
for await (const img of await pdf(buf, { scale: 2 })) {
    i++;
    writeFileSync(`${outputDir}/page_${i}.png`, img);
}
console.log(i);
