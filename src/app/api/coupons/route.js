import { NextResponse } from 'next/server';
import { getDB, snapshotToArr } from '@/lib/firebase';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'admin') {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }
    const db = getDB();
    const snap = await db.collection('coupons').orderBy('createdAt', 'desc').get();
    return NextResponse.json({ success: true, data: snapshotToArr(snap) });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'admin') {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }
    const db = getDB();
    const body = await request.json();
    const ref = db.collection('coupons').doc();
    const couponData = {
      code: (body.code || '').toUpperCase(),
      type: body.type || 'percentage',
      value: Number(body.value) || 0,
      minOrderAmount: Number(body.minOrderAmount) || 0,
      maxUses: Number(body.maxUses) || 100,
      usedCount: 0,
      expiresAt: body.expiresAt || null,
      isActive: true,
      usedBy: [],
      createdAt: new Date().toISOString(),
    };
    await ref.set(couponData);
    return NextResponse.json({ success: true, data: { id: ref.id, ...couponData } }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
