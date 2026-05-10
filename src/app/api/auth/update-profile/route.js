import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';

export async function POST(request) {
  try {
    const session = await getEffectiveSession();
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

    const { phone, city, birthday, weddingDate } = await request.json();
    const db = getDB();

    const update = { updatedAt: new Date().toISOString() };
    if (phone !== undefined) update.phone = phone;
    if (city !== undefined) update.city = city;
    if (birthday !== undefined) update.birthday = birthday;
    if (weddingDate !== undefined) update.weddingDate = weddingDate;

    await db.collection('users').doc(session.user.id).update(update);
    return NextResponse.json({ success: true, message: 'Profile updated' });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
