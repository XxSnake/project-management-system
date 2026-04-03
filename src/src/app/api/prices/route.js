import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';

// GET all internal prices
export async function GET() {
    const prices = await prisma.internalPrice.findMany({ orderBy: { testItemName: 'asc' } });
    return NextResponse.json(prices);
}

// POST create internal price
export async function POST(request) {
    const data = await request.json();
    const price = await prisma.internalPrice.create({
        data: {
            testItemName: data.testItemName,
            unit: data.unit || null,
            unitPrice: parseFloat(data.unitPrice),
        },
    });
    return NextResponse.json(price);
}

// DELETE internal price
export async function DELETE(request) {
    const { id } = await request.json();
    await prisma.internalPrice.delete({ where: { id } });
    return NextResponse.json({ success: true });
}
