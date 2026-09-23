import { NextResponse } from 'next/server';
import { getDB, snapshotToArr, docToObj, FieldValue } from '@/lib/firebase';
import { requireAccess } from '@/lib/adminCollection';
import { CAN } from '@/lib/access';
import { reverseOrderSettlements } from '@/lib/vendorLedger';
import { reverseOrderRewards } from '@/lib/loyalty';

const RETURN_STATUSES = ['requested', 'under_review', 'approved', 'rejected', 'product_received', 'refund_processed'];
const REFUND_STATUSES = ['pending', 'approved', 'processed', 'rejected'];

export async function GET() {
  try {
    const session = await requireAccess(CAN.manageCRM);
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
    const session = await requireAccess(CAN.manageCRM);
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const body = await request.json();
    /* Bookkeeping fields are set by this handler only — accepting them from
       the body would let a replayed request reset stockRestored and restock
       the same return twice, or re-point the return at another order. */
    /* Staff decide the status and leave a note — nothing else. Refund
       amount, customer and order come from the order and can't be rewritten
       here (a replayed or crafted request can't re-point a refund). */
    const { id } = body;
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });
    const rest = {};
    if (body.returnStatus !== undefined) {
      if (!RETURN_STATUSES.includes(body.returnStatus)) return NextResponse.json({ success: false, message: 'Invalid return status' }, { status: 400 });
      rest.returnStatus = body.returnStatus;
    }
    if (body.refundStatus !== undefined) {
      if (!REFUND_STATUSES.includes(body.refundStatus)) return NextResponse.json({ success: false, message: 'Invalid refund status' }, { status: 400 });
      rest.refundStatus = body.refundStatus;
    }
    if (body.adminNote !== undefined) rest.adminNote = String(body.adminNote).slice(0, 2000);
    const db = getDB();
    const ref = db.collection('returns').doc(id);

    let orderId = null;
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) throw new Error('Return request not found');
      const current = doc.data();
      orderId = current.orderId;
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

    /* Money went back to the customer, so the vendor's earnings on that
       order are voided (or clawed back if already paid out). Idempotent. */
    let settlementError = null;
    if (orderId && (rest.refundStatus === 'processed' || rest.returnStatus === 'refund_processed')) {
      await reverseOrderSettlements(db, orderId, { reason: 'refund' }).catch((e) => {
        settlementError = e.message;
        console.error('[settlement] reversal failed for order', orderId, e.message);
      });
      /* Refunded: loyalty earned on the order is taken back (once). */
      await reverseOrderRewards(db, db.collection('orders').doc(orderId)).catch((e) => console.error('[Loyalty] reversal failed:', e.message));
    }

    return NextResponse.json({ success: true, data: docToObj(await ref.get()), ...(settlementError && { settlementError }) });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const session = await requireAccess(CAN.manageCRM);
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
