import { NextResponse } from 'next/server';

import { createContractImportTask, listContractImportTasks } from '@/lib/contractImportQueue';

export async function GET() {
    return NextResponse.json({ tasks: listContractImportTasks() });
}

export async function POST(request) {
    try {
        const formData = await request.formData();
        const files = formData.getAll('files').filter(Boolean);

        if (files.length === 0) {
            return NextResponse.json({ error: '未上传合同文件' }, { status: 400 });
        }

        const task = await createContractImportTask(files);
        return NextResponse.json({ success: true, task });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
    }
}
