import { NextResponse } from 'next/server';
import { getDB, snapshotToArr, docToObj, FieldValue } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';

export async function GET() {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const db = getDB();
    const snap = await db.collection('returns').orderBy('createdAt', 'desc').get();
    return NextResponse.json({ success: true, data: snapshotToArr(snap) });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const body = await request.json();
    const { id, ...rest } = body;
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });
    const db = getDB();
    const ref = db.collection('returns').doc(id);

    await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) throw new Error('Return request not found');
      const current = doc.data();
      const update = { ...rest, updatedAt: new Date().toISOString() };

      /* Restock only once the item has physically come back (not merely
         "approved", which is just a decision, not a receipt), and only once
         — a status flipped back and forth must not restock twice. */
      if (rest.returnStatus === 'product_received' && current.returnStatus !== 'product_received' && !current.stockRestored) {
        for (const item of (current.items || [])) {
          if (!item.product) continue;
          const qty = Math.max(0, Math.floor(Number(item.quantity) || 0));
          if (qty > 0) tx.update(db.collection('products').doc(item.product), { stock: FieldValue.increment(qty) });
        }
        update.stockRestored = true;
        update.stockRestoredAt = new Date().toISOString();
      }

      tx.update(ref, update);
    });

    return NextResponse.json({ success: true, data: docToObj(await ref.get()) });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });
    const db = getDB();
    await db.collection('returns').doc(id).delete();
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
