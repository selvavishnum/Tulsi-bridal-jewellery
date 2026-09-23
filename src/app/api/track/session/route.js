import { NextResponse } from 'next/server';
import { getDB, FieldValue } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';
import { isBotRequest } from '@/lib/isBotRequest';

const MAX_DURATION_SECONDS = 4 * 60 * 60; // one foreground burst is never realistically hours long

export async function POST(request) {
  try {
    if (isBotRequest(request)) return NextResponse.json({ success: false });

    const session = await getEffectiveSession();
    if (!session?.user?.id) return NextResponse.json({ success: false });

    const { action, durationSeconds } = await request.json();
    const db = getDB();
    const now = new Date().toISOString();

    if (action === 'start') {
      await db.collection('users').doc(session.user.id).update({
        lastLoginAt: now,
      });
    } else if (action === 'end') {
      /* durationSeconds is client-computed (Date.now() diff) — clamp to a
         sane range before it ever reaches an atomic increment. A negative
         value (clock skew) or an absurdly large one (crafted request, or a
         client whose clock jumped) would otherwise corrupt
         totalSessionSeconds permanently — an increment can't be "undone"
         by a later correct value the way a plain field overwrite could. */
      const safeDuration = Math.max(0, Math.min(MAX_DURATION_SECONDS, Math.floor(Number(durationSeconds) || 0)));
      await db.collection('users').doc(session.user.id).update({
        lastLogoutAt: now,
        totalSessionSeconds: FieldValue.increment(safeDuration),
        sessionCount: FieldValue.increment(1),
      });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false });
  }
}
