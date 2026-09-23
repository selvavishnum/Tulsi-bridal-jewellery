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
export const REFERRAL_POINTS = 20;

export async function awardLoyaltyPoints(orderRef, db = getDB()) {
  const { userId, points, total, referrerId } = await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return {};

    const order = snap.data();
    if (order.pointsAwarded) return {};
    if (order.payment?.status !== 'paid') return {};
    if (order.status === 'cancelled') return {};
    if (!order.userId) return {};

    const userRef = db.collection('users').doc(order.userId);
    const user = (await tx.get(userRef)).data() || {};
    /* A referral pays out on the referred customer's first paid order —
       not at sign-up, so fake accounts earn nothing. */
    const payReferral = !!user.referredBy && user.referralRewarded === false;
    const referrerRef = payReferral ? db.collection('users').doc(user.referredBy) : null;
    const referrerExists = referrerRef ? (await tx.get(referrerRef)).exists : false;

    const orderTotal = Number(order.total) || 0;
    const pointsEarned = Math.floor(orderTotal / 100);

    tx.update(orderRef, { pointsAwarded: true, pointsEarned });
    tx.update(userRef, {
      loyaltyPoints: FieldValue.increment(pointsEarned + (payReferral ? REFERRAL_POINTS : 0)),
      totalOrders: FieldValue.increment(1),
      totalSpent: FieldValue.increment(orderTotal),
      lastSeen: new Date().toISOString(),
      ...(payReferral && { referralRewarded: true }),
    });
    if (referrerExists) tx.update(referrerRef, { loyaltyPoints: FieldValue.increment(REFERRAL_POINTS) });

    return { userId: order.userId, points: pointsEarned, total: orderTotal, referrerId: referrerExists ? user.referredBy : null };
  });
  if (referrerId) {
    const at = new Date().toISOString();
    await Promise.all([
      db.collection('loyaltyTransactions').add({ userId: referrerId, type: 'referral_reward', points: REFERRAL_POINTS, description: 'Referral reward — your friend’s first order', createdAt: at }),
      db.collection('loyaltyTransactions').add({ userId, type: 'referral_bonus', points: REFERRAL_POINTS, description: 'Welcome bonus — joined via referral', createdAt: at }),
    ]).catch(() => {});
  }

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

/**
 * Undo what an order did to loyalty and coupons, once, when it is cancelled
 * or refunded:
 *   - points earned for it are taken back (floored at 0 — points already
 *     spent can't be un-spent, but can no longer be earned twice),
 *   - loyalty discount spent on it is handed back to the customer,
 *   - the coupon use it consumed is released.
 * Each part is guarded by its own flag on the order, so calling this again
 * (a replayed request, cancel then refund) does nothing.
 */
export async function reverseOrderRewards(db, orderRef) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return { skipped: 'no order' };
    const order = snap.data();
    const userRef = order.userId ? db.collection('users').doc(order.userId) : null;
    const couponRef = order.coupon && !order.couponReleased ? db.collection('coupons').doc(order.coupon) : null;
    // All reads before any write (Firestore transaction rule).
    const [userSnap, couponSnap] = await Promise.all([
      userRef ? tx.get(userRef) : null,
      couponRef ? tx.get(couponRef) : null,
    ]);

    const now = new Date().toISOString();
    const orderUpdate = {};
    if (userSnap?.exists) {
      const u = userSnap.data();
      const userUpdate = {};
      if (order.pointsAwarded && !order.pointsReversed) {
        const earned = Number(order.pointsEarned ?? Math.floor((Number(order.total) || 0) / 100)) || 0;
        userUpdate.loyaltyPoints = Math.max(0, (Number(u.loyaltyPoints) || 0) - earned);
        userUpdate.totalOrders = Math.max(0, (Number(u.totalOrders) || 0) - 1);
        userUpdate.totalSpent = Math.max(0, (Number(u.totalSpent) || 0) - (Number(order.total) || 0));
        orderUpdate.pointsReversed = true;
      }
      const spent = Number(order.loyaltyDiscount) || 0;
      if (spent > 0 && !order.loyaltyRestored) {
        userUpdate.pendingLoyaltyDiscount = (Number(u.pendingLoyaltyDiscount) || 0) + spent;
        orderUpdate.loyaltyRestored = true;
      }
      if (Object.keys(userUpdate).length) tx.update(userRef, userUpdate);
    }
    if (couponSnap?.exists) {
      const c = couponSnap.data();
      const usedBy = Array.isArray(c.usedBy) ? [...c.usedBy] : [];
      const at = order.couponUserKey ? usedBy.indexOf(order.couponUserKey) : -1;
      if (at >= 0) usedBy.splice(at, 1);
      tx.update(couponRef, { usedCount: Math.max(0, (Number(c.usedCount) || 0) - 1), usedBy });
      orderUpdate.couponReleased = true;
    }
    if (Object.keys(orderUpdate).length) tx.update(orderRef, { ...orderUpdate, rewardsReversedAt: now });
    return orderUpdate;
  });
}

/**
 * Redeems points into a parked discount (₹1 per point, in blocks of 50),
 * read and written in one transaction so parallel requests can't spend the
 * same balance twice.
 */
export async function redeemLoyaltyPoints(db, userId, requested) {
  const userRef = db.collection('users').doc(userId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const current = snap.exists ? Math.max(0, Math.floor(Number(snap.data().loyaltyPoints) || 0)) : 0;
    const want = requested === undefined || requested === null || requested === ''
      ? Math.floor(current / 50) * 50
      : Math.floor(Number(requested));
    if (!Number.isFinite(want) || want < 50 || want % 50 !== 0) return { error: 'Redeem points in blocks of 50 (50 points = ₹50).' };
    if (want > current) return { error: `You have ${current} points.` };
    tx.update(userRef, {
      loyaltyPoints: current - want,
      pendingLoyaltyDiscount: (Number(snap.data().pendingLoyaltyDiscount) || 0) + want,
    });
    return { pointsRedeemed: want, discount: want };
  });
}
