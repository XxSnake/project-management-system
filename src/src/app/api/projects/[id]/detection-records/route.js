import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function POST(request, { params }) {
    const { id } = await params;
    const projectId = Number.parseInt(id, 10);
    if (Number.isNaN(projectId)) {
        return NextResponse.json({ error: '无效项目 ID' }, { status: 400 });
    }

    try {
        const data = await request.json();

        // Get next sequence number for this project
        const lastRecord = await prisma.projectDetectionRecord.findFirst({
            where: { projectId },
            orderBy: { sequence: 'desc' },
        });
        const nextSequence = (lastRecord?.sequence || 0) + 1;

        const record = await prisma.projectDetectionRecord.create({
            data: {
                projectId,
                sequence: nextSequence,
                testCategory: data.testCategory || null,
                testItem: data.testItem || null,
                quantityText: data.quantityText || null,
                detectDate: data.detectDate ? new Date(data.detectDate) : null,
                reportNo: data.reportNo || null,
                reportEditor: data.reportEditor || null,
                mainTester: data.mainTester || null,
                reviewer: data.reviewer || null,
                approver: data.approver || null,
                remarks: data.remarks || null,
            },
        });

        return NextResponse.json(record);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
