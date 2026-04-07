import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';

const EDITABLE_FIELDS = [
    'testCategory',
    'testItem',
    'quantityText',
    'reportNo',
    'reportEditor',
    'mainTester',
    'reviewer',
    'approver',
    'remarks',
];

export async function PATCH(request, { params }) {
    const { rid } = await params;
    const recordId = Number.parseInt(rid, 10);
    if (Number.isNaN(recordId)) {
        return NextResponse.json({ error: '无效记录 ID' }, { status: 400 });
    }

    const body = await request.json();
    const data = {};
    for (const key of EDITABLE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(body, key)) {
            const value = body[key];
            data[key] = value === '' ? null : value;
        }
    }
    if (Object.prototype.hasOwnProperty.call(body, 'detectDate')) {
        data.detectDate = body.detectDate ? new Date(body.detectDate) : null;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'sequence')) {
        const n = Number.parseInt(body.sequence, 10);
        if (Number.isFinite(n)) data.sequence = n;
    }

    const updated = await prisma.projectDetectionRecord.update({
        where: { id: recordId },
        data,
    });
    return NextResponse.json(updated);
}

export async function DELETE(_request, { params }) {
    const { rid } = await params;
    const recordId = Number.parseInt(rid, 10);
    if (Number.isNaN(recordId)) {
        return NextResponse.json({ error: '无效记录 ID' }, { status: 400 });
    }
    await prisma.projectDetectionRecord.delete({ where: { id: recordId } });
    return NextResponse.json({ success: true });
}
