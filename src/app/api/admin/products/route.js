import { NextResponse } from 'next/server';
import { getDB, snapshotToArr } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';

// Admin-specific products endpoint — no composite index needed
export async function GET() {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const db = getDB();
    const snap = await db.collection('products').orderBy('createdAt', 'desc').get();
    return NextResponse.json({ success: true, data: { products: snapshotToArr(snap) } });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
