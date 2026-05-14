import { NextResponse } from 'next/server';
import { getDB, FieldValue } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';

export async function POST(request) {
  try {
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
      await db.collection('users').doc(session.user.id).update({
        lastLogoutAt: now,
        totalSessionSeconds: FieldValue.increment(durationSeconds || 0),
        sessionCount: FieldValue.increment(1),
      });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false });
  }
}
