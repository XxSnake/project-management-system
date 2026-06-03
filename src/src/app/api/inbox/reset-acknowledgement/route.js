import prisma from '@/lib/prisma';
import {
    removeAcknowledgement,
    WORKLOG_EXCEPTION_ORDER,
} from '@/lib/workLogExceptions';

import { NextResponse } from 'next/server';

export async function POST(request) {
    try {
        const body = await request.json();
        const workLogId = Number.parseInt(body?.workLogId, 10);
        const exceptionType = String(body?.exceptionType || '').trim();

        if (!Number.isInteger(workLogId) || workLogId <= 0) {
            return NextResponse.json({ error: '缺少有效的工作记录 ID' }, { status: 400 });
        }

        if (!WORKLOG_EXCEPTION_ORDER.includes(exceptionType)) {
            return NextResponse.json({ error: '无效的异常类型' }, { status: 400 });
        }

        const existing = await prisma.workLog.findUnique({
            where: { id: workLogId },
            select: {
                acknowledgedExceptions: true,
            },
        });

        if (!existing) {
            return NextResponse.json({ error: '工作记录不存在' }, { status: 404 });
        }

        const acknowledgedExceptions = removeAcknowledgement(existing.acknowledgedExceptions, exceptionType);
        await prisma.workLog.update({
            where: { id: workLogId },
            data: {
                acknowledgedExceptions,
            },
        });

        return NextResponse.json({
            ok: true,
            acknowledgedExceptions,
        });
    } catch (error) {
        console.error('Reset inbox acknowledgement error:', error);
        return NextResponse.json({ error: error.message || '取消已知忽略失败' }, { status: 500 });
    }
}
