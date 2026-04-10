import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { parseContract } from '@/lib/contractParser';

// POST - upload contract file and auto-parse with OCR
export async function POST(request) {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
        return NextResponse.json({ error: '未上传文件' }, { status: 400 });
    }

    const contractsDir = path.join(process.cwd(), '..', 'contracts');
    if (!fs.existsSync(contractsDir)) {
        fs.mkdirSync(contractsDir, { recursive: true });
    }

    const originalName = file.name;
    const savedName = `${Date.now()}_${originalName}`;
    const savedPath = path.join(contractsDir, savedName);

    const bytes = await file.arrayBuffer();
    fs.writeFileSync(savedPath, Buffer.from(bytes));

    // 尝试自动解析合同
    let parsedData = null;
    try {
        console.log(`[OCR] 开始解析合同: ${originalName}`);
        parsedData = await parseContract(savedPath, originalName);
        console.log(`[OCR] 解析完成, 置信度: ${parsedData.confidence}, 耗时: ${parsedData.timeMs}ms`);

        // OCR 识别出的价目表直接传给前端，由用户自行确认编辑
    } catch (err) {
        console.error('[OCR] 合同解析失败:', err.message);
        parsedData = {
            success: false,
            error: err.message,
        };
    }

    return NextResponse.json({
        success: true,
        fileName: originalName,
        savedPath,
        parsedData,
    });
}

// DELETE - clean up uploaded contract file that user chose not to save
export async function DELETE(request) {
    try {
        const { filePath } = await request.json();

        if (!filePath) {
            return NextResponse.json({ error: '未指定文件路径' }, { status: 400 });
        }

        // Security: only allow deleting files within the contracts directory
        const contractsDir = path.join(process.cwd(), '..', 'contracts');
        const resolvedPath = path.resolve(filePath);
        const resolvedContractsDir = path.resolve(contractsDir);

        if (!resolvedPath.startsWith(resolvedContractsDir)) {
            return NextResponse.json({ error: '不允许删除合同目录之外的文件' }, { status: 403 });
        }

        if (fs.existsSync(resolvedPath)) {
            fs.unlinkSync(resolvedPath);
            console.log(`[清理] 已删除未保存的合同文件: ${resolvedPath}`);
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
