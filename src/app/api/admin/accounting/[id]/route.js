import { NextResponse } from 'next/server';
import { requireAdmin, updateDoc, deleteDoc } from '@/lib/adminCollection';

export async function PUT(request, { params }) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const body = await request.json();
    const doc = await updateDoc('accounting', params.id, body);
    return NextResponse.json({ success: true, data: doc });
  } catch (e) { return NextResponse.json({ success: false, message: e.message }, { status: 500 }); }
}

export async function DELETE(request, { params }) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    await deleteDoc('accounting', params.id);
    return NextResponse.json({ success: true, message: 'Deleted' });
  } catch (e) { return NextResponse.json({ success: false, message: e.message }, { status: 500 }); }
}
