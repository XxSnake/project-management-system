import { NextResponse } from 'next/server';
import { testModelProvider } from '@/lib/modelGateway';

export async function POST(request) {
    try {
        const provider = await request.json();
        return NextResponse.json(await testModelProvider(provider));
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
    }
}
