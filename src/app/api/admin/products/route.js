import { NextResponse } from 'next/server';
import { getDB, snapshotToArr } from '@/lib/firebase';
import { requireRole, CAN } from '@/lib/requireRole';
import { stripCostFields } from '@/lib/access';

// Admin-specific products endpoint — no composite index needed
export async function GET() {
  try {
    const auth = await requireRole(CAN.editStock);
    if (auth.error) return auth.error;

    const db = getDB();
    const snap = await db.collection('products').orderBy('createdAt', 'desc').get();
    let products = snapshotToArr(snap);
    if (!CAN.manageCatalog.includes(auth.tier)) products = products.map(stripCostFields); // no supply/purchase costs for catalog staff
    return NextResponse.json({ success: true, data: { products } });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
