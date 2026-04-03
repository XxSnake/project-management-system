import { NextResponse } from 'next/server';
import { deleteModelProvider, loadModelConfig, updateTaskBindings, upsertModelProvider } from '@/lib/modelGateway';

export async function GET() {
    return NextResponse.json(loadModelConfig());
}

export async function POST(request) {
    try {
        const provider = await request.json();
        return NextResponse.json(upsertModelProvider(provider));
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
    }
}

export async function PUT(request) {
    try {
        const { taskBindings } = await request.json();
        return NextResponse.json(updateTaskBindings(taskBindings || {}));
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
    }
}

export async function DELETE(request) {
    try {
        const { id } = await request.json();
        if (!id) {
            return NextResponse.json({ error: '缺少模型 ID' }, { status: 400 });
        }
        return NextResponse.json(deleteModelProvider(id));
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
    }
}
