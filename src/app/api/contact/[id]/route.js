import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { requireAccess } from '@/lib/adminCollection';
import { CAN } from '@/lib/access';

export async function PATCH(request, context) {
  try {
    const { id } = await context.params;
    const session = await requireAccess(CAN.manageOperations);
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const { read } = await request.json();
    const db = getDB();
    await db.collection('contact_messages').doc(id).update({ read: !!read });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function DELETE(request, context) {
  try {
    const { id } = await context.params;
    const session = await requireAccess(CAN.manageOperations);
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const db = getDB();
    await db.collection('contact_messages').doc(id).delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
