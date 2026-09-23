import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { hit, clientIp, LIMITS, tooManyRequests } from '@/lib/rateLimit';

export async function POST(request) {
  try {
    const { code, orderAmount: rawAmount } = await request.json();
    if (!code || typeof code !== 'string') return NextResponse.json({ success: false, message: 'Coupon code required' }, { status: 400 });
    const orderAmount = Math.max(0, Number(rawAmount) || 0);

    const db = getDB();
    /* Guessing codes: 20 checks an hour per IP. Checkout re-validates and
       enforces limits regardless (orders/route.js). */
    const limited = await hit(db, `coupon:ip:${clientIp(request.headers)}`, LIMITS.couponCheck);
    if (!limited.allowed) return tooManyRequests(limited.retryAfterSec, 'Too many coupon attempts. Please try again later.');
    const snap = await db.collection('coupons').where('code', '==', code.toUpperCase()).limit(1).get();
    if (snap.empty) return NextResponse.json({ success: false, message: 'Invalid coupon code' }, { status: 404 });

    const coupon = { id: snap.docs[0].id, ...snap.docs[0].data() };

    if (!coupon.isActive) return NextResponse.json({ success: false, message: 'Coupon is inactive' }, { status: 400 });
    if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
      return NextResponse.json({ success: false, message: 'Coupon has expired' }, { status: 400 });
    }
    if ((Number(coupon.maxUses) || 0) > 0 && (Number(coupon.usedCount) || 0) >= Number(coupon.maxUses)) {
      return NextResponse.json({ success: false, message: 'Coupon usage limit reached' }, { status: 400 });
    }
    if (orderAmount < coupon.minOrderAmount) {
      return NextResponse.json({ success: false, message: `Minimum order amount is ₹${coupon.minOrderAmount}` }, { status: 400 });
    }

    const discount = coupon.type === 'percentage'
      ? Math.round((orderAmount * coupon.value) / 100)
      : Math.min(coupon.value, orderAmount);

    return NextResponse.json({
      success: true,
      data: { coupon: { id: coupon.id, code: coupon.code, type: coupon.type, value: coupon.value }, discount },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
