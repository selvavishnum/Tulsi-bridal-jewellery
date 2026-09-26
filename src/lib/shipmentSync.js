/* ─────────────────────────────────────────────
   Applies courier tracking updates to orders — from the Shiprocket
   webhook, and from the daily catch-up job for anything it missed.

   Finds the order by AWB, records the parcel's stage (and the last few
   scans), then moves the order through the SAME status path staff use
   (applyOrderUpdate) — so delivery credits vendor earnings and awards
   points, a return restocks and reverses them, and the customer gets
   the usual email/WhatsApp. Replayed or out-of-order updates are ignored.
   ───────────────────────────────────────────── */
import { stageOf, decideOrderStatus, STAGE_LABEL } from '@/lib/shipmentStatus';
import { applyOrderUpdate, OrderStateError } from '@/lib/orderStatus';

const MAX_SCANS = 15;

/* Order + parcel key for an AWB. New bookings keep `awbs` for this lookup;
   older single-parcel orders are found by trackingNumber. */
export async function findParcel(db, awb) {
  const a = String(awb || '').trim();
  if (!a) return null;
  let snap = await db.collection('orders').where('awbs', 'array-contains', a).limit(1).get();
  if (snap.empty) snap = await db.collection('orders').where('trackingNumber', '==', a).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const order = { id: doc.id, ...doc.data() };
  const key = Object.entries(order.shipments || {}).find(([, s]) => s.awb === a)?.[0] || 'tulsi';
  return { order, key };
}

/**
 * @param {object} db
 * @param {object} ev  { awb, status, statusId, at, etd, scans?, source }
 * @returns {{ ok: boolean, reason?: string, stage?: string, orderStatus?: string|null, issue?: string|null }}
 */
export async function applyTrackingEvent(db, ev) {
  const found = await findParcel(db, ev.awb);
  if (!found) return { ok: false, reason: 'unknown awb' };
  const { order, key } = found;
  const stage = stageOf(ev);
  const at = ev.at && !Number.isNaN(new Date(ev.at).getTime()) ? new Date(ev.at).toISOString() : new Date().toISOString();

  const parcel = order.shipments?.[key] || { key, awb: ev.awb };
  const last = parcel.tracking;
  /* Out-of-order or replayed delivery of the same update: ignore. */
  if (last && (new Date(last.at) > new Date(at) || (last.at === at && last.stage === stage))) {
    return { ok: true, reason: 'stale', stage: last.stage };
  }

  const scans = Array.isArray(ev.scans) ? ev.scans.slice(-MAX_SCANS).map((s) => ({
    date: s.date || s.sr_status_date || null, activity: String(s.activity || s.status || '').slice(0, 200), location: String(s.location || '').slice(0, 100),
  })) : parcel.scans || [];
  const tracking = { stage, text: String(ev.status || STAGE_LABEL[stage]).slice(0, 80), at, etd: ev.etd || parcel.tracking?.etd || null, source: ev.source || 'webhook' };

  const shipments = { ...(order.shipments || {}), [key]: { ...parcel, tracking, scans } };
  const ref = db.collection('orders').doc(order.id);
  await ref.update({ [`shipments.${key}`]: shipments[key], updatedAt: new Date().toISOString() });

  const booked = Object.values(shipments).filter((s) => s.awb);
  const stages = booked.map((s) => s.tracking?.stage || 'booked');
  const decision = decideOrderStatus(order, stages);
  const flags = {
    deliveryIssue: decision.issue,
    deliveryIssueAt: decision.issue ? at : null,
    ...(decision.refundDue && { refundDue: true }),
  };

  if (decision.status && decision.status !== order.status) {
    try {
      await applyOrderUpdate(db, order.id,
        { status: decision.status, extra: { ...flags, statusUpdatedBy: 'courier' } },
        {
          /* Delivered through Tulsi's Shiprocket: the courier collected any
             COD cash for Tulsi (remitted by Shiprocket), so it counts as paid. */
          codPaidOnDelivery: true,
          check(fresh) {
            if (fresh.status === 'cancelled') throw new OrderStateError('already cancelled');
            if (fresh.status === decision.status) throw new OrderStateError('already there');
          },
        });
    } catch (e) {
      if (!(e instanceof OrderStateError)) throw e;
    }
  } else if ((order.deliveryIssue || null) !== decision.issue) {
    await ref.update(flags);
  }
  return { ok: true, stage, orderStatus: decision.status, issue: decision.issue };
}
