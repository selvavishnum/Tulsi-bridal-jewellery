import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { getDB } from '@/lib/firebase';
import { hit, clientIp, LIMITS, tooManyRequests } from '@/lib/rateLimit';
import { hasPlacedOrder } from '@/lib/coupons';

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

    /* First-order-only codes (the welcome offer). Signed in: refuse it to a
       customer who already has a placed order. Not signed in: show the
       discount, flagged firstOrderOnly — checkout requires sign-in and the
       order endpoint checks again, so this is a preview, not the decision.
       Checked before the minimum, so a returning customer isn't asked to
       add more to the cart for a code they can't use. */
    const firstOrderOnly = coupon.firstOrderOnly === true;
    if (firstOrderOnly) {
      const user = (await getServerSession(authOptions).catch(() => null))?.user;
      if ((user?.id || user?.email) && await hasPlacedOrder(db, { userId: user.id, email: user.email })) {
        return NextResponse.json({ success: false, code: 'FIRST_ORDER_ONLY', message: 'This code is for your first order only.' }, { status: 400 });
      }
    }

    if (orderAmount < coupon.minOrderAmount) {
      return NextResponse.json({ success: false, message: `Minimum order amount is ₹${coupon.minOrderAmount}` }, { status: 400 });
    }

    const discount = coupon.type === 'percentage'
      ? Math.round((orderAmount * coupon.value) / 100)
      : Math.min(coupon.value, orderAmount);

    return NextResponse.json({
      success: true,
      data: {
        coupon: { id: coupon.id, code: coupon.code, type: coupon.type, value: coupon.value, firstOrderOnly },
        discount,
        firstOrderOnly,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
