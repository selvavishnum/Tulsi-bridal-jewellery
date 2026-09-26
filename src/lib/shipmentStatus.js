/* ─────────────────────────────────────────────
   Courier status → order status.

   Shiprocket reports each parcel's progress as free text ("RTO IN
   TRANSIT", "Out For Delivery", …) plus a numeric status id. We fold both
   into a few stages, then decide what the ORDER should become from all
   of its parcels together (split orders ship as several parcels):
     • every parcel moving  → Shipped
     • every parcel delivered → Delivered
     • every parcel returned to the seller (RTO delivered) → Cancelled,
       with a refund flag if the customer had paid
     • anything else wrong (undelivered attempt, RTO started, lost, one
       parcel of several returned) → flagged for staff, status unchanged

   Pure module — no '@/…' imports.
   ───────────────────────────────────────────── */

export const STAGES = Object.freeze([
  'booked', 'in_transit', 'out_for_delivery', 'delivered', 'undelivered', 'rto_initiated', 'rto_delivered', 'cancelled', 'lost', 'unknown',
]);

export const STAGE_LABEL = Object.freeze({
  booked: 'Waiting for pickup', in_transit: 'In transit', out_for_delivery: 'Out for delivery', delivered: 'Delivered',
  undelivered: 'Delivery attempt failed', rto_initiated: 'Returning to seller', rto_delivered: 'Returned to seller',
  cancelled: 'Shipment cancelled', lost: 'Lost / damaged', unknown: 'Update from courier',
});

/* Shiprocket shipment status ids (fallback when the text is missing). */
const BY_ID = {
  6: 'in_transit', 7: 'delivered', 8: 'cancelled', 9: 'rto_initiated', 10: 'rto_delivered', 12: 'lost',
  13: 'booked', 15: 'booked', 17: 'out_for_delivery', 18: 'in_transit', 19: 'booked', 20: 'booked',
  21: 'undelivered', 22: 'in_transit', 38: 'in_transit', 42: 'in_transit', 45: 'cancelled', 46: 'rto_initiated',
};

/** One courier update → one stage. */
export function stageOf({ status, statusId } = {}) {
  const t = String(status || '').toUpperCase().replace(/[_-]/g, ' ').trim();
  if (t) {
    if (/\bRTO\b|RETURN/.test(t)) return /DELIVERED/.test(t) ? 'rto_delivered' : 'rto_initiated';
    if (/UNDELIVERED|NOT DELIVERED|DELIVERY FAILED|FAILED DELIVERY/.test(t)) return 'undelivered';
    if (/OUT FOR DELIVERY/.test(t)) return 'out_for_delivery';
    if (/DELIVERED/.test(t)) return 'delivered';
    if (/CANCEL/.test(t)) return 'cancelled';
    if (/LOST|DAMAGE|DESTROY/.test(t)) return 'lost';
    if (/PICKUP|PICK UP SCHEDULED|OUT FOR PICKUP|AWB ASSIGNED|MANIFEST|LABEL|NEW/.test(t) && !/PICKED/.test(t)) return 'booked';
    if (/PICKED|TRANSIT|SHIPPED|DISPATCH|REACHED|HUB|MISROUTED|CONNECTED|IN FLIGHT/.test(t)) return 'in_transit';
  }
  const id = Number(statusId);
  return BY_ID[id] || 'unknown';
}

const MOVING = new Set(['in_transit', 'out_for_delivery', 'delivered', 'undelivered', 'rto_initiated', 'rto_delivered']);
const ISSUES = new Set(['undelivered', 'rto_initiated', 'rto_delivered', 'lost', 'cancelled']);

/**
 * What the order should become, given every booked parcel's latest stage.
 * @param {object} order
 * @param {string[]} stages  latest stage of each booked parcel
 * @returns {{ status: string|null, issue: string|null, refundDue: boolean }}
 */
export function decideOrderStatus(order, stages) {
  const out = { status: null, issue: null, refundDue: false };
  if (!stages.length || order.status === 'cancelled') return out;
  const all = (pred) => stages.every(pred);

  if (all((s) => s === 'delivered')) {
    if (order.status !== 'delivered') out.status = 'delivered';
    return out;
  }
  if (all((s) => s === 'rto_delivered')) {
    out.status = 'cancelled';
    out.issue = 'returned_to_seller';
    out.refundDue = order.payment?.status === 'paid';
    return out;
  }
  const problem = stages.find((s) => ISSUES.has(s));
  if (problem) out.issue = problem;
  if (all((s) => MOVING.has(s)) && ['confirmed', 'processing'].includes(order.status)) out.status = 'shipped';
  return out;
}

/* Shiprocket timestamps look like "23 05 2026 11:43:52" (dd mm yyyy, IST). */
export function parseShiprocketTime(v) {
  if (!v) return null;
  const m = String(v).match(/^(\d{1,2})[ /-](\d{1,2})[ /-](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const [, d, mo, y, h, mi, s] = m;
    return new Date(`${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi}:${s || '00'}+05:30`).toISOString();
  }
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}
