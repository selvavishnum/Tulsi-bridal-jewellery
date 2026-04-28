import { NextResponse } from 'next/server';
import { getDB, docToObj } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';

export async function DELETE(request, { params }) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const db = getDB();
    await db.collection('coupons').doc(params.id).delete();
    return NextResponse.json({ success: true, message: 'Coupon deleted' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const db = getDB();
    const body = await request.json();
    const ref = db.collection('coupons').doc(params.id);
    await ref.update({ ...body, updatedAt: new Date().toISOString() });
    const updated = await ref.get();
    return NextResponse.json({ success: true, data: docToObj(updated) });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
