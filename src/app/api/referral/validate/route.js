import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';

import { REFERRAL_POINTS } from '@/lib/loyalty';

export async function POST(request) {
  try {
    const session = await getEffectiveSession();
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    const { referralCode } = await request.json();
    if (!referralCode) return NextResponse.json({ success: false, message: 'Referral code required' });
    const db = getDB();
    const settings = (await db.collection('settings').doc('site').get()).data() || {};
    if (settings.referralEnabled === false) {
      return NextResponse.json({ success: false, message: 'Referrals are paused right now.' }, { status: 400 });
    }

    const currentUser = await db.collection('users').doc(session.user.id).get();
    /* Throwaway accounts would farm points: the referee must have proved
       their email, and can only link before their first paid order. */
    if (currentUser.data()?.emailVerified !== true) {
      return NextResponse.json({ success: false, message: 'Verify your email first: sign in once with "Email code", then apply the referral code.' }, { status: 400 });
    }
    if ((Number(currentUser.data()?.totalOrders) || 0) > 0) {
      return NextResponse.json({ success: false, message: 'Referral codes can only be used before your first order.' }, { status: 400 });
    }
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

    /* Record the link only. Both sides are paid when this customer's first
       order is paid (awardLoyaltyPoints) — a referral with no purchase
       earns nothing, so fake sign-ups are worthless. Transactional so
       concurrent calls can't link twice. */
    const applied = await db.runTransaction(async (tx) => {
      const meRef = db.collection('users').doc(session.user.id);
      const me = await tx.get(meRef);
      if (me.data()?.referredBy) return false;
      tx.update(meRef, { referredBy: referrerDoc.id, referralRewarded: false, referredAt: new Date().toISOString() });
      return true;
    });

    if (!applied) {
      return NextResponse.json({ success: false, message: 'You have already used a referral code' });
    }

    return NextResponse.json({ success: true, message: `Referral applied! You and your friend each get ${REFERRAL_POINTS} points when your first order is paid.`, data: { points: REFERRAL_POINTS } });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
