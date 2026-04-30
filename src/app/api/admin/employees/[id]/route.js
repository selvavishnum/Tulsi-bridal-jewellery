import { NextResponse } from 'next/server';
import { requireAdmin, updateDoc, deleteDoc } from '@/lib/adminCollection';

export async function PUT(request, context) {
  try {
    const { id } = await context.params;
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const body = await request.json();
    const doc = await updateDoc('employees', id, body);
    return NextResponse.json({ success: true, data: doc });
  } catch (e) { return NextResponse.json({ success: false, message: e.message }, { status: 500 }); }
}

export async function DELETE(request, context) {
  try {
    const { id } = await context.params;
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    await deleteDoc('employees', id);
    return NextResponse.json({ success: true, message: 'Deleted' });
  } catch (e) { return NextResponse.json({ success: false, message: e.message }, { status: 500 }); }
}
