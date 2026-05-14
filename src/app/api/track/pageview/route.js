import { NextResponse } from 'next/server';
import { getDB, FieldValue } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';

export async function POST(request) {
  try {
    const session = await getEffectiveSession();
    if (!session?.user?.id) return NextResponse.json({ success: false });

    const { path, category } = await request.json();
    const db = getDB();
    const now = new Date().toISOString();

    const ref = db.collection('users').doc(session.user.id);
    const snap = await ref.get();
    const existing = snap.exists ? (snap.data().recentPages || []) : [];

    // Append new entry and keep last 20
    const updated = [...existing, { path, visitedAt: now }].slice(-20);

    const updateData = { recentPages: updated };

    if (category) {
      updateData[`categoryInterests.${category}`] = FieldValue.increment(1);
    }

    await ref.update(updateData);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false });
  }
}
