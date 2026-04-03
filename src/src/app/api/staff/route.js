import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';

// GET all staff
export async function GET() {
    const staff = await prisma.staff.findMany({ orderBy: { createdAt: 'desc' } });
    return NextResponse.json(staff);
}

// POST create staff
export async function POST(request) {
    const data = await request.json();
    const staff = await prisma.staff.create({ data: { name: data.name, phone: data.phone || null, role: data.role || null } });
    return NextResponse.json(staff);
}

// DELETE staff
export async function DELETE(request) {
    const { id } = await request.json();
    await prisma.staff.delete({ where: { id } });
    return NextResponse.json({ success: true });
}
