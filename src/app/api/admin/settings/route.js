import { NextResponse } from 'next/server';
import { getDB, docToObj } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';

export async function GET() {
  try {
    // Public — anyone can read site settings (phone, address, email shown on website)
    const db = getDB();
    const doc = await db.collection('settings').doc('site').get();
    /* No caching — this doc now also gates live behavior (payment methods,
       loyalty/referral toggles), so an admin flipping a switch must take
       effect immediately, not up to an hour later from a stale edge cache. */
    const res = NextResponse.json({ success: true, data: doc.exists ? docToObj(doc) : {} });
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (e) { return NextResponse.json({ success: false, message: e.message }, { status: 500 }); }
}

export async function POST(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const db = getDB();
    const body = await request.json();
    await db.collection('settings').doc('site').set({ ...body, updatedAt: new Date().toISOString() }, { merge: true });
    return NextResponse.json({ success: true, message: 'Settings saved' });
  } catch (e) { return NextResponse.json({ success: false, message: e.message }, { status: 500 }); }
}
