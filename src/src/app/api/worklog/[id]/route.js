import prisma from '@/lib/prisma';
import {
    buildPendingAllocationPayload,
    WorkLogMutationError,
    updateWorkLogAndRecalculate,
} from '@/lib/workLogMutations';

import { NextResponse } from 'next/server';

export async function PUT(request, { params }) {
    try {
        const { id } = await params;
        const worklogId = Number.parseInt(id, 10);
        if (Number.isNaN(worklogId)) {
            return NextResponse.json({ error: '无效记录 ID' }, { status: 400 });
        }

        const data = await request.json();
        const { refreshedLog, calculation } = await updateWorkLogAndRecalculate(worklogId, data);

        return NextResponse.json({
            success: true,
            log: refreshedLog,
            calculation,
            pendingAllocation: buildPendingAllocationPayload(refreshedLog, calculation),
        });
    } catch (error) {
        console.error('Update worklog error:', error);
        const status = error instanceof WorkLogMutationError ? error.status : 500;
        return NextResponse.json({ error: error.message }, { status });
    }
}

export async function DELETE(request, { params }) {
    try {
        const { id } = await params;
        const worklogId = Number.parseInt(id, 10);

        await prisma.workLog.delete({
            where: { id: worklogId },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
