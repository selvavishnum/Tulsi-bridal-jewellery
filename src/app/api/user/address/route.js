import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';

export async function GET() {
  try {
    const session = await getEffectiveSession();
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    const db = getDB();
    const doc = await db.collection('users').doc(session.user.id).get();
    const addresses = doc.exists ? (doc.data().savedAddresses || []) : [];
    return NextResponse.json({ success: true, data: addresses });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
