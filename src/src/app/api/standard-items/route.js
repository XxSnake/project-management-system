import { getGroupedStandardItems, STANDARD_TEST_ITEMS } from '@/lib/testItemRegistry';
import { NextResponse } from 'next/server';

export async function GET() {
    return NextResponse.json({
        items: STANDARD_TEST_ITEMS.map((item) => ({
            name: item.name,
            category: item.category,
            unit: item.unit || null,
        })),
        grouped: getGroupedStandardItems(),
    });
}
