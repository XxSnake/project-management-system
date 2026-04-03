import { NextResponse } from 'next/server';

import {
    deleteContractImportItem,
    getContractImportTask,
    getContractImportTaskItem,
    markContractImportItemSaved,
    skipContractImportItem,
} from '@/lib/contractImportQueue';

export async function GET(request, { params }) {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const itemId = searchParams.get('itemId');

    if (itemId) {
        const itemPayload = getContractImportTaskItem(id, itemId);
        if (!itemPayload) {
            return NextResponse.json({ error: '缓存识别结果不存在' }, { status: 404 });
        }

        return NextResponse.json(itemPayload);
    }

    const task = getContractImportTask(id);
    if (!task) {
        return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    return NextResponse.json(task);
}

export async function POST(request, { params }) {
    const { id } = await params;

    try {
        const data = await request.json();

        if (data.action === 'mark_saved') {
            const task = markContractImportItemSaved(id, data.itemId, {
                contractId: data.contractId,
                contractNo: data.contractNo,
            });
            return NextResponse.json({ success: true, task });
        }

        if (data.action === 'skip_item') {
            const task = skipContractImportItem(id, data.itemId);
            return NextResponse.json({ success: true, task });
        }

        if (data.action === 'delete_item') {
            const task = deleteContractImportItem(id, data.itemId);
            return NextResponse.json({ success: true, task, deleted: task === null });
        }

        return NextResponse.json({ error: '不支持的批量任务操作' }, { status: 400 });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
    }
}
