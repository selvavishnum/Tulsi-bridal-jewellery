import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { requireAdmin, requireOwner } from '@/lib/adminCollection';
import { summarizeLedger } from '@/lib/settlement';
import { postDeliverySettlement, recordVendorPayout, LedgerError } from '@/lib/vendorLedger';

/* GET /api/admin/vendor-ledger?vendorId=… — one vendor's ledger lines and payouts. */
export async function GET(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const vendorId = new URL(request.url).searchParams.get('vendorId');
    if (!vendorId) return NextResponse.json({ success: false, message: 'vendorId required' }, { status: 400 });

    const db = getDB();
    const [ledgerSnap, payoutSnap] = await Promise.all([
      db.collection('vendorLedger').where('vendorId', '==', vendorId).get(),
      db.collection('vendorPayouts').where('vendorId', '==', vendorId).get(),
    ]);
    const entries = ledgerSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const payouts = payoutSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return NextResponse.json({ success: true, data: { entries, payouts, summary: summarizeLedger(entries) } });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

/* POST /api/admin/vendor-ledger
     { action: 'payout', vendorId, reference, note }  — owner only
     { action: 'payout_all', reference, note }         — owner only; one payout per vendor with a balance
     { action: 'settle_order', orderId, recalculate }  — re-post / recalculate an order's vendor earnings */
export async function POST(request) {
  try {
    const body = await request.json();
    const db = getDB();

    if (body.action === 'settle_order') {
      const session = await requireAdmin();
      if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
      if (!body.orderId) return NextResponse.json({ success: false, message: 'orderId required' }, { status: 400 });
      const orderId = String(body.orderId).trim();
      /* Admins know orders by their number (TBJ…); accept that as well as the id. */
      let id = orderId;
      if (!(await db.collection('orders').doc(orderId).get()).exists) {
        const byNumber = await db.collection('orders').where('orderNumber', '==', orderId).limit(1).get();
        if (byNumber.empty) return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
        id = byNumber.docs[0].id;
      }
      const result = await postDeliverySettlement(db, id, { recalculate: !!body.recalculate });
      return NextResponse.json({ success: true, data: result });
    }

    if (body.action === 'payout' || body.action === 'payout_all') {
      const session = await requireOwner();
      if (!session) return NextResponse.json({ success: false, message: 'Only the store owner can record payouts.' }, { status: 403 });
      const createdBy = session.user.email || null;

      if (body.action === 'payout') {
        const result = await recordVendorPayout(db, { vendorId: body.vendorId, reference: body.reference, note: body.note, createdBy });
        return NextResponse.json({ success: true, data: result });
      }

      if (!body.reference || !String(body.reference).trim()) {
        return NextResponse.json({ success: false, message: 'Enter the bank batch reference for this bulk transfer.' }, { status: 400 });
      }
      const vendors = await db.collection('vendors').get();
      const batchId = `batch_${Date.now()}`;
      const results = [];
      for (const v of vendors.docs) {
        if (v.data().isPlatformOwner) continue;
        try {
          const r = await recordVendorPayout(db, { vendorId: v.id, reference: body.reference, note: body.note, createdBy, batchId });
          results.push({ vendorId: v.id, name: v.data().name, ok: true, ...r });
        } catch (e) {
          // "Nothing to pay" is the normal case for most vendors — only report real failures.
          if (!(e instanceof LedgerError)) results.push({ vendorId: v.id, name: v.data().name, ok: false, message: e.message });
        }
      }
      return NextResponse.json({ success: true, data: { batchId, results } });
    }

    return NextResponse.json({ success: false, message: 'Unknown action' }, { status: 400 });
  } catch (e) {
    const status = e instanceof LedgerError ? 400 : 500;
    return NextResponse.json({ success: false, message: e.message }, { status });
  }
}
