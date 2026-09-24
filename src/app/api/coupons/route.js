import { NextResponse } from 'next/server';
import { getDB, snapshotToArr } from '@/lib/firebase';
import { requireAccess } from '@/lib/adminCollection';
import { CAN } from '@/lib/access';
import { parseCouponInput, checkCouponValue } from '@/lib/coupons';

export async function GET(request) {
  try {
    const session = await requireAccess(CAN.manageCRM);
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const db = getDB();
    const snap = await db.collection('coupons').orderBy('createdAt', 'desc').get();
    return NextResponse.json({ success: true, data: snapshotToArr(snap) });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await requireAccess(CAN.manageCRM);
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const db = getDB();
    const parsed = parseCouponInput(await request.json());
    if (parsed.error) return NextResponse.json({ success: false, message: parsed.error }, { status: 400 });
    const bad = checkCouponValue(parsed.data);
    if (bad) return NextResponse.json({ success: false, message: bad }, { status: 400 });
    const dup = await db.collection('coupons').where('code', '==', parsed.data.code).limit(1).get();
    if (!dup.empty) return NextResponse.json({ success: false, message: 'That code already exists.' }, { status: 409 });
    const ref = db.collection('coupons').doc();
    const couponData = {
      ...parsed.data,
      usedCount: 0,
      isActive: parsed.data.isActive ?? true,
      usedBy: [],
      createdAt: new Date().toISOString(),
    };
    await ref.set(couponData);
    return NextResponse.json({ success: true, data: { id: ref.id, ...couponData } }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
