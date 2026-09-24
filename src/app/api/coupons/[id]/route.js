import { NextResponse } from 'next/server';
import { getDB, docToObj } from '@/lib/firebase';
import { requireAccess } from '@/lib/adminCollection';
import { CAN } from '@/lib/access';
import { parseCouponInput, checkCouponValue } from '@/lib/coupons';

export async function DELETE(request, context) {
  try {
    const { id } = await context.params;
    const session = await requireAccess(CAN.manageCRM);
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const db = getDB();
    await db.collection('coupons').doc(id).delete();
    return NextResponse.json({ success: true, message: 'Coupon deleted' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function PUT(request, context) {
  try {
    const { id } = await context.params;
    const session = await requireAccess(CAN.manageCRM);
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const db = getDB();
    const parsed = parseCouponInput(await request.json(), { partial: true });
    if (parsed.error) return NextResponse.json({ success: false, message: parsed.error }, { status: 400 });
    const ref = db.collection('coupons').doc(id);
    const current = await ref.get();
    if (!current.exists) return NextResponse.json({ success: false, message: 'Coupon not found' }, { status: 404 });
    const bad = checkCouponValue({ ...current.data(), ...parsed.data });
    if (bad) return NextResponse.json({ success: false, message: bad }, { status: 400 });
    if (parsed.data.code && parsed.data.code !== current.data().code) {
      const dup = await db.collection('coupons').where('code', '==', parsed.data.code).limit(1).get();
      if (!dup.empty) return NextResponse.json({ success: false, message: 'That code already exists.' }, { status: 409 });
    }
    await ref.update({ ...parsed.data, updatedAt: new Date().toISOString() });
    const updated = await ref.get();
    return NextResponse.json({ success: true, data: docToObj(updated) });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
