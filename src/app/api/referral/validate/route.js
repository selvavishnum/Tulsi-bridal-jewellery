import { NextResponse } from 'next/server';
import { getDB, FieldValue } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';

const REFERRAL_POINTS = 20;

export async function POST(request) {
  try {
    const session = await getEffectiveSession();
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    const { referralCode } = await request.json();
    if (!referralCode) return NextResponse.json({ success: false, message: 'Referral code required' });
    const db = getDB();

    const currentUser = await db.collection('users').doc(session.user.id).get();
    if (currentUser.data()?.referredBy) {
      return NextResponse.json({ success: false, message: 'You have already used a referral code' });
    }

    const referrerSnap = await db.collection('users').where('referralCode', '==', referralCode.toUpperCase()).limit(1).get();
    if (referrerSnap.empty) {
      return NextResponse.json({ success: false, message: 'Invalid referral code' });
    }
    const referrerDoc = referrerSnap.docs[0];
    if (referrerDoc.id === session.user.id) {
      return NextResponse.json({ success: false, message: 'You cannot use your own referral code' });
    }

    /* Record the link and pay both sides in one transaction. A batch is atomic
       but not conditional, so concurrent calls would each re-observe an unset
       referredBy and pay out repeatedly. */
    const applied = await db.runTransaction(async (tx) => {
      const meRef = db.collection('users').doc(session.user.id);
      const me = await tx.get(meRef);
      if (me.data()?.referredBy) return false;

      tx.update(db.collection('users').doc(referrerDoc.id), { loyaltyPoints: FieldValue.increment(REFERRAL_POINTS) });
      tx.update(meRef, { loyaltyPoints: FieldValue.increment(REFERRAL_POINTS), referredBy: referrerDoc.id });
      return true;
    });

    if (!applied) {
      return NextResponse.json({ success: false, message: 'You have already used a referral code' });
    }

    await Promise.all([
      db.collection('loyaltyTransactions').add({
        userId: referrerDoc.id, type: 'referral_reward', points: REFERRAL_POINTS,
        description: 'Referral reward — friend joined', createdAt: new Date().toISOString(),
      }),
      db.collection('loyaltyTransactions').add({
        userId: session.user.id, type: 'referral_bonus', points: REFERRAL_POINTS,
        description: 'Welcome bonus — joined via referral', createdAt: new Date().toISOString(),
      }),
    ]);

    return NextResponse.json({ success: true, message: `Referral applied! You and your friend each earned ${REFERRAL_POINTS} points!`, data: { points: REFERRAL_POINTS } });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
