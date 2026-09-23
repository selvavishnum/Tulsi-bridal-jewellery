/* ─────────────────────────────────────────────
   Vendor ledger persistence (collection `vendorLedger`, `vendorPayouts`).

   Every write that moves money is a Firestore transaction whose first
   reads decide whether it has already happened, so a retried request, a
   double click, or two admins acting at once can never credit or pay a
   vendor twice:
     • settlement entries use a deterministic id (order + vendor), so
       posting the same delivered order again finds the entry and stops;
     • a payout settles exactly the entries it read, inside the same
       transaction — a concurrent payout retries, sees them settled, and
       finds nothing left to pay.
   Takes `db` as a parameter (no '@/…' imports) so tests can drive it.
   ───────────────────────────────────────────── */
import { computeVendorSettlements, RETURN_WINDOW_DAYS } from './settlement.js';

export class LedgerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LedgerError';
  }
}

export const settlementEntryId = (orderId, vendorId) => `${orderId}__${vendorId}`;
const reversalEntryId = (orderId, vendorId) => `${orderId}__${vendorId}__reversal`;
const DAY_MS = 24 * 60 * 60 * 1000;
/* Keeps one payout transaction under Firestore's 500-writes-per-commit cap;
   anything beyond is simply paid in the next payout. */
const MAX_ENTRIES_PER_PAYOUT = 450;

/**
 * Posts settlement entries for a delivered, paid order — one per vendor in
 * it. Idempotent. With `recalculate`, also refreshes entries that haven't
 * been paid out yet (e.g. after correcting the actual shipping charge).
 */
export async function postDeliverySettlement(db, orderId, { recalculate = false } = {}) {
  const orderRef = db.collection('orders').doc(String(orderId));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new LedgerError('Order not found');
    const order = { id: snap.id, ...snap.data() };
    if (order.status !== 'delivered') return { posted: 0, updated: 0, skipped: 'Order is not delivered yet' };
    if (order.payment?.status !== 'paid') return { posted: 0, updated: 0, skipped: 'Order is not paid yet — post its vendor earnings from the Vendors page once payment is confirmed' };
    /* The customer got their money back; nothing — a recalculation, a
       re-delivery, the admin settle tool — may credit the vendor again. */
    if (order.vendorRefundedAt) return { posted: 0, updated: 0, skipped: 'Order was refunded — no vendor earnings' };

    const settlements = computeVendorSettlements(order);
    if (!settlements.length) return { posted: 0, updated: 0, skipped: 'No vendor items in this order' };

    const refs = settlements.map((s) => db.collection('vendorLedger').doc(settlementEntryId(order.id, s.vendorId)));
    const reversalRefs = settlements.map((s) => db.collection('vendorLedger').doc(reversalEntryId(order.id, s.vendorId)));
    const redeliveryRefs = settlements.map((s) => db.collection('vendorLedger').doc(`${settlementEntryId(order.id, s.vendorId)}__redelivered`));
    const [existing, reversals, redeliveries] = await Promise.all([
      Promise.all(refs.map((r) => tx.get(r))),
      Promise.all(reversalRefs.map((r) => tx.get(r))),
      Promise.all(redeliveryRefs.map((r) => tx.get(r))),
    ]);

    const now = new Date().toISOString();
    const deliveredAt = order.deliveredAt || now;
    const availableAt = new Date(new Date(deliveredAt).getTime() + RETURN_WINDOW_DAYS * DAY_MS).toISOString();

    let posted = 0;
    let updated = 0;
    settlements.forEach((s, i) => {
      const doc = {
        ...s,
        type: 'order_settlement',
        orderId: order.id,
        orderNumber: order.orderNumber || order.id,
        deliveredAt,
        availableAt,
        updatedAt: now,
      };
      const prior = existing[i].exists ? existing[i].data().status : null;
      if (!prior) {
        tx.set(refs[i], { ...doc, status: 'unsettled', payoutId: null, createdAt: now });
        posted += 1;
      } else if (prior === 'reversed') {
        /* Delivered, then cancelled (voided), then delivered again — the
           vendor is owed this sale after all. */
        tx.update(refs[i], { ...doc, status: 'unsettled', reversedAt: null, reversalReason: null });
        updated += 1;
      } else if (recalculate && prior === 'unsettled') {
        tx.update(refs[i], doc);
        updated += 1;
      } else if (prior === 'settled' && reversals[i].exists && reversals[i].data().status !== 'reversed') {
        /* Paid out, then cancelled (clawback posted), now delivered after all.
           The original entry is never rewritten — instead undo the clawback:
           void it if not yet netted, or re-credit the sale if it was. */
        if (reversals[i].data().status === 'unsettled') {
          tx.update(reversalRefs[i], { status: 'reversed', reversedAt: now, reversalReason: 'delivered again' });
          updated += 1;
        } else if (!redeliveries[i].exists) {
          tx.set(redeliveryRefs[i], { ...doc, status: 'unsettled', payoutId: null, createdAt: now });
          posted += 1;
        }
      }
      // Otherwise prior === 'settled': already paid out — never rewritten.

    });
    tx.update(orderRef, { vendorSettlementPostedAt: now });
    return { posted, updated };
  });
}

/**
 * Undo an order's vendor earnings after a refund. Unpaid entries are voided;
 * entries already paid out get a matching negative entry that is netted
 * against the vendor's next payout. Idempotent.
 */
export async function reverseOrderSettlements(db, orderId, { reason = 'refund', now = Date.now() } = {}) {
  const q = db.collection('vendorLedger').where('orderId', '==', String(orderId));
  const orderRef = db.collection('orders').doc(String(orderId));
  return db.runTransaction(async (tx) => {
    const [snap, orderSnap] = await Promise.all([tx.get(q), tx.get(orderRef)]);
    const settlements = snap.docs.filter((d) => d.data().type === 'order_settlement');
    const settledOnes = settlements.filter((d) => d.data().status === 'settled');
    /* One reversal per entry it reverses: `${entryId}__reversal` (for an
       original settlement that equals reversalEntryId(order, vendor)). */
    const reversalRefs = settledOnes.map((d) => db.collection('vendorLedger').doc(`${d.id}__reversal`));
    const reversalSnaps = await Promise.all(reversalRefs.map((r) => tx.get(r)));

    const at = new Date(now).toISOString();
    /* A refund is final (unlike a cancel, which a re-delivery can undo), so
       mark the order — even when no entries exist yet (refunded before it
       was ever delivered) — and postDeliverySettlement will refuse it. */
    if (reason === 'refund' && orderSnap.exists && !orderSnap.data().vendorRefundedAt) {
      tx.update(orderRef, { vendorRefundedAt: at });
    }
    let voided = 0;
    let clawedBack = 0;
    for (const d of settlements) {
      if (d.data().status === 'unsettled') {
        tx.update(d.ref, { status: 'reversed', reversedAt: at, reversalReason: reason });
        voided += 1;
      }
    }
    settledOnes.forEach((d, i) => {
      if (reversalSnaps[i].exists) return;
      const e = d.data();
      tx.set(reversalRefs[i], {
        type: 'reversal',
        vendorId: e.vendorId,
        orderId: e.orderId,
        orderNumber: e.orderNumber,
        reversesEntryId: d.id,
        reason,
        itemsPaise: -(e.itemsPaise || 0),
        grossPaise: -(e.grossPaise || 0),
        supplyCostPaise: -(e.supplyCostPaise || 0),
        shippingPaise: -(e.shippingPaise || 0),
        platformFeePaise: -(e.platformFeePaise || 0),
        netPaise: -(e.netPaise || 0),
        status: 'unsettled',
        payoutId: null,
        availableAt: at,
        createdAt: at,
        updatedAt: at,
      });
      clawedBack += 1;
    });
    return { voided, clawedBack };
  });
}

export function maskPayoutDestination(payout) {
  if (!payout) return '';
  if (payout.method === 'upi') return payout.upiId || '';
  const acct = String(payout.accountNumber || '');
  return [payout.accountName, acct ? `••••${acct.slice(-4)}` : '', payout.ifsc].filter(Boolean).join(' · ');
}

/**
 * Pays out everything that is past its hold window for one vendor and marks
 * those entries settled. The bank/UPI transfer itself is made by the admin
 * outside the app; `reference` is its UTR / transaction id.
 */
export async function recordVendorPayout(db, { vendorId, reference, note = '', createdBy, batchId = null, now = Date.now() }) {
  if (!vendorId) throw new LedgerError('vendorId is required');
  if (!reference || !String(reference).trim()) throw new LedgerError('Enter the UTR / transaction reference of the transfer');

  const vendorRef = db.collection('vendors').doc(String(vendorId));
  const q = db.collection('vendorLedger').where('vendorId', '==', String(vendorId)).where('status', '==', 'unsettled');

  return db.runTransaction(async (tx) => {
    const [vendorSnap, entriesSnap] = await Promise.all([tx.get(vendorRef), tx.get(q)]);
    if (!vendorSnap.exists) throw new LedgerError('Vendor not found');

    const due = entriesSnap.docs
      .filter((d) => new Date(d.data().availableAt).getTime() <= now)
      .sort((a, b) => String(a.data().availableAt).localeCompare(String(b.data().availableAt)))
      .slice(0, MAX_ENTRIES_PER_PAYOUT);
    const amountPaise = due.reduce((s, d) => s + (d.data().netPaise || 0), 0);
    if (!due.length || amountPaise <= 0) {
      throw new LedgerError(amountPaise < 0
        ? 'This vendor owes more than they have earned — nothing to pay out until new sales cover it'
        : 'Nothing is available to pay out yet');
    }

    const vendor = vendorSnap.data();
    const payoutRef = db.collection('vendorPayouts').doc();
    const at = new Date(now).toISOString();
    tx.set(payoutRef, {
      vendorId: String(vendorId),
      vendorName: vendor.name || '',
      amountPaise,
      entryIds: due.map((d) => d.id),
      entryCount: due.length,
      method: vendor.payout?.method || null,
      destination: maskPayoutDestination(vendor.payout),
      reference: String(reference).trim(),
      note: String(note || ''),
      batchId,
      status: 'settled',
      createdBy: createdBy || null,
      createdAt: at,
    });
    for (const d of due) tx.update(d.ref, { status: 'settled', payoutId: payoutRef.id, settledAt: at });
    return { payoutId: payoutRef.id, amountPaise, entryCount: due.length };
  });
}
