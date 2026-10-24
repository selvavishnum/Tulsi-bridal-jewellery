import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { redeemLoyaltyPoints, parkedLoyaltyDiscount } from '@/lib/loyalty';
import { getEffectiveSession } from '@/lib/adminCollection';

/* GET /api/loyalty → { points, transactions, parkedDiscount }
     points          spendable loyalty points
     transactions    the latest 10 loyalty transactions
     parkedDiscount  ₹ of loyalty discount the customer's NEXT order gets
                     automatically: redeemed points not yet spent
                     (pendingLoyaltyDiscount) plus what their unpaid,
                     abandoned online attempts hold — a new order takes that
                     over (POST /api/orders). Before the order's caps — 20%
                     of its subtotal, and no more than the coupon discount
                     leaves of it — so a page shows
                     loyaltyDiscountFor(parkedDiscount, subtotal, couponDiscount)
                     (checkoutRules), and sends that as the order's
                     loyaltyDiscount. */
export async function GET() {
  try {
    const session = await getEffectiveSession();
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    const db = getDB();
    const userDoc = await db.collection('users').doc(session.user.id).get();
    const user = userDoc.exists ? userDoc.data() : {};
    const points = user.loyaltyPoints || 0;
    const [txSnap, parkedDiscount] = await Promise.all([
      db.collection('loyaltyTransactions')
        .where('userId', '==', session.user.id)
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get(),
      parkedLoyaltyDiscount(db, session.user.id, user),
    ]);
    const transactions = txSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ success: true, data: { points, transactions, parkedDiscount } });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await getEffectiveSession();
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    const { action, pointsToRedeem } = await request.json();
    const db = getDB();

    /* There is deliberately no 'earn' action here. Points are awarded by
       /api/orders from the server-computed order total. An endpoint that took
       the amount from the request body would let a caller mint unlimited
       points, and those points are real money via pendingLoyaltyDiscount. */

    if (action === 'redeem') {
      const settings = (await db.collection('settings').doc('site').get()).data() || {};
      if (settings.loyaltyEnabled === false) {
        return NextResponse.json({ success: false, message: 'Loyalty points are paused right now.' }, { status: 400 });
      }
      /* Read and write in one transaction — see redeemLoyaltyPoints. */
      const result = await redeemLoyaltyPoints(db, session.user.id, pointsToRedeem);
      if (result.error) return NextResponse.json({ success: false, message: result.error }, { status: 400 });
      await db.collection('loyaltyTransactions').add({
        userId: session.user.id,
        type: 'redeem',
        points: -result.pointsRedeemed,
        description: `Redeemed for ₹${result.discount} discount`,
        createdAt: new Date().toISOString(),
      });
      return NextResponse.json({ success: true, data: result });
    }

    return NextResponse.json({ success: false, message: 'Invalid action' });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
