import { NextResponse } from 'next/server';
import { getDB, docToObj } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';

export async function GET() {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const db = getDB();
    const doc = await db.collection('settings').doc('site').get();
    return NextResponse.json({ success: true, data: doc.exists ? docToObj(doc) : {} });
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
