import { NextResponse } from 'next/server';
import { getDB, FieldValue } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';

export async function POST(request) {
  try {
    const session = await getEffectiveSession();
    if (!session?.user?.id) return NextResponse.json({ success: false });

    const { items } = await request.json();

    // Only save if items exist (don't clear savedCart on empty)
    if (!items || items.length === 0) return NextResponse.json({ success: true });

    const db = getDB();
    const now = new Date().toISOString();

    await db.collection('users').doc(session.user.id).update({
      savedCart: items,
      cartUpdatedAt: now,
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false });
  }
}
