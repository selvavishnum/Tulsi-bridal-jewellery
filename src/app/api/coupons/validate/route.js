import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { getDB } from '@/lib/firebase';
import { hit, clientIp, LIMITS, tooManyRequests } from '@/lib/rateLimit';
import { hasPlacedOrder, couponDiscountFor, couponStateRefusal, couponUsesBy } from '@/lib/coupons';
import { canMatchGuestOrders } from '@/lib/orderOwnership';

const STATE_MESSAGES = {
  inactive: 'Coupon is inactive',
  not_started: 'This coupon isn’t active yet',
  expired: 'Coupon has expired',
  limit: 'Coupon usage limit reached',
};

/* A preview of what checkout (POST /api/orders) will decide, with the same
   rules and the same discount formula (couponDiscountFor). The answer's
   coupon carries what a screen needs to recompute the discount when the
   basket changes: type, value, minOrderAmount and maxDiscount. */
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
    const firstOrderOnly = coupon.firstOrderOnly === true;
    /* Only for the signed-in account (never another email's history). */
    const user = (await getServerSession(authOptions).catch(() => null))?.user;
    const userKey = user?.id ? `u:${user.id}` : null;
    /* This account already holds a use: spent if any order with it was
       placed; an abandoned online attempt doesn't spend it (checkout gives
       it back on the retry), and doesn't count against the limit again. */
    const heldByMe = !!userKey && Array.isArray(coupon.usedBy) && coupon.usedBy.includes(userKey);

    const state = couponStateRefusal(coupon, { ownUseCounted: heldByMe });
    if (state) return NextResponse.json({ success: false, message: STATE_MESSAGES[state] }, { status: 400 });

    /* First-order-only codes (the welcome offer). Signed in: refuse it to a
       customer who already has a placed order — matched by account, and by
       email only once they've proved it (an unverified registration must
       not reveal another person's order history). Not signed in: show the
       discount, flagged firstOrderOnly — checkout requires sign-in and the
       order endpoint never applies it without one, so this is a preview,
       not the decision. Checked before the minimum, so a returning customer
       isn't asked to add more to the cart for a code they can't use. */
    const provenEmail = canMatchGuestOrders(user) ? user.email : null;
    if (firstOrderOnly && (user?.id || provenEmail)) {
      if (await hasPlacedOrder(db, { userId: user.id, email: provenEmail })) {
        return NextResponse.json({ success: false, code: 'FIRST_ORDER_ONLY', message: 'This code is for your first order only.' }, { status: 400 });
      }
    }
    if (heldByMe && (await couponUsesBy(db, { couponId: coupon.id, userKey })).placed) {
      return NextResponse.json({ success: false, code: 'COUPON_USED', message: 'You have already used this coupon.' }, { status: 400 });
    }

    const minOrderAmount = Number(coupon.minOrderAmount) || 0;
    if (orderAmount < minOrderAmount) {
      return NextResponse.json({ success: false, message: `Minimum order amount is ₹${minOrderAmount}` }, { status: 400 });
    }

    const maxDiscount = Number(coupon.maxDiscount) > 0 ? Number(coupon.maxDiscount) : null;
    const publicCoupon = {
      id: coupon.id, code: coupon.code, type: coupon.type, value: coupon.value,
      minOrderAmount, maxDiscount, firstOrderOnly,
    };
    return NextResponse.json({
      success: true,
      data: {
        coupon: publicCoupon,
        discount: couponDiscountFor(publicCoupon, orderAmount),
        firstOrderOnly,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
