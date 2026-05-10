import { NextResponse } from 'next/server';
import { getDB, FieldValue } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';

export async function GET() {
  try {
    const session = await getEffectiveSession();
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    const db = getDB();
    const userDoc = await db.collection('users').doc(session.user.id).get();
    const points = userDoc.exists ? (userDoc.data().loyaltyPoints || 0) : 0;
    const txSnap = await db.collection('loyaltyTransactions')
      .where('userId', '==', session.user.id)
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();
    const transactions = txSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ success: true, data: { points, transactions } });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await getEffectiveSession();
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    const { action, orderId, orderTotal, pointsToRedeem } = await request.json();
    const db = getDB();

    if (action === 'earn') {
      const pointsEarned = Math.floor((orderTotal || 0) / 100);
      if (pointsEarned <= 0) return NextResponse.json({ success: true, data: { pointsEarned: 0 } });
      await db.collection('users').doc(session.user.id).update({
        loyaltyPoints: FieldValue.increment(pointsEarned),
      });
      await db.collection('loyaltyTransactions').add({
        userId: session.user.id,
        type: 'earn',
        points: pointsEarned,
        orderId: orderId || null,
        description: `Earned for order ₹${orderTotal}`,
        createdAt: new Date().toISOString(),
      });
      return NextResponse.json({ success: true, data: { pointsEarned } });
    }

    if (action === 'redeem') {
      const userDoc = await db.collection('users').doc(session.user.id).get();
      const currentPoints = userDoc.exists ? (userDoc.data().loyaltyPoints || 0) : 0;
      const redeemAmt = pointsToRedeem || Math.floor(currentPoints / 50) * 50;
      if (currentPoints < 50 || redeemAmt < 50) {
        return NextResponse.json({ success: false, message: 'Need at least 50 points to redeem (= ₹50 discount)' });
      }
      const finalRedeem = Math.min(redeemAmt, currentPoints);
      const discount = (finalRedeem / 50) * 50;
      await db.collection('users').doc(session.user.id).update({
        loyaltyPoints: FieldValue.increment(-finalRedeem),
      });
      await db.collection('loyaltyTransactions').add({
        userId: session.user.id,
        type: 'redeem',
        points: -finalRedeem,
        description: `Redeemed for ₹${discount} discount`,
        createdAt: new Date().toISOString(),
      });
      return NextResponse.json({ success: true, data: { pointsRedeemed: finalRedeem, discount } });
    }

    return NextResponse.json({ success: false, message: 'Invalid action' });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
