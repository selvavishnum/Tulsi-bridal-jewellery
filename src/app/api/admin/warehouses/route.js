import { NextResponse } from 'next/server';
import { requireAdmin, listCollection, createDoc } from '@/lib/adminCollection';

export async function GET() {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const data = await listCollection('warehouses');
    return NextResponse.json({ success: true, data });
  } catch (e) { return NextResponse.json({ success: false, message: e.message }, { status: 500 }); }
}

export async function POST(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const body = await request.json();
    const doc = await createDoc('warehouses', body);
    return NextResponse.json({ success: true, data: doc }, { status: 201 });
  } catch (e) { return NextResponse.json({ success: false, message: e.message }, { status: 500 }); }
}
