import { NextResponse } from 'next/server';
import { getDB, FieldValue } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';

export async function POST(request) {
  try {
    const session = await getEffectiveSession();
    if (!session?.user?.id) return NextResponse.json({ success: false });

    const { id, name, slug, image, price } = await request.json();
    const db = getDB();
    const now = new Date().toISOString();

    await db.collection('users').doc(session.user.id).update({
      lastSeenProduct: { id, name, slug, image, price, viewedAt: now },
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false });
  }
}
