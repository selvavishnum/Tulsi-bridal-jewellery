import { getDB, FieldValue } from './firebase';

/**
 * Award loyalty points for an order that has actually been paid.
 *
 * Idempotent: the order's `pointsAwarded` flag is set inside the same
 * transaction that credits the points, so a retried verification or a later
 * admin status change can never credit the same order twice.
 *
 * ₹100 spent = 1 point, and 1 point redeems as ₹1, so these are real money —
 * they must never be granted for an order that was not paid for.
 */
export async function awardLoyaltyPoints(orderRef) {
  const db = getDB();

  const { userId, points, total } = await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return {};

    const order = snap.data();
    if (order.pointsAwarded) return {};
    if (order.payment?.status !== 'paid') return {};
    if (!order.userId) return {};

    const orderTotal = Number(order.total) || 0;
    const pointsEarned = Math.floor(orderTotal / 100);

    tx.update(orderRef, { pointsAwarded: true });
    tx.update(db.collection('users').doc(order.userId), {
      loyaltyPoints: FieldValue.increment(pointsEarned),
      totalOrders: FieldValue.increment(1),
      totalSpent: FieldValue.increment(orderTotal),
      lastSeen: new Date().toISOString(),
    });

    return { userId: order.userId, points: pointsEarned, total: orderTotal };
  });

  if (userId && points > 0) {
    await db.collection('loyaltyTransactions').add({
      userId,
      type: 'earn',
      points,
      orderId: orderRef.id,
      description: `Earned for order ₹${total}`,
      createdAt: new Date().toISOString(),
    }).catch(() => {});
  }
}
