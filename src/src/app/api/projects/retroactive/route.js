import { retroactiveCalculation } from '@/lib/productionCalculator';
import { NextResponse } from 'next/server';

export async function POST(request) {
    try {
        const { projectId } = await request.json();

        if (!projectId) {
            return NextResponse.json({ error: '缺少项目 ID' }, { status: 400 });
        }

        const result = await retroactiveCalculation(Number(projectId));
        return NextResponse.json(result);
    } catch (error) {
        console.error('Retroactive calculation error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
