/* ─────────────────────────────────────────────
   Books an order's parcels on Tulsi's Shiprocket account — one Shiprocket
   order per pickup warehouse (see shipmentPlan.js), each with its own AWB,
   label and tracking. Results live on the order under `shipments.<key>`.

   Idempotent per parcel: a parcel that already has an AWB is left alone;
   one that was created but got no courier is retried on its existing
   Shiprocket shipment (never created twice). One parcel failing doesn't
   stop the others; each result says what happened.
   ───────────────────────────────────────────── */
import {
  createAdhocOrder, assignAwb, requestPickup, getFreightQuote, isConfigured, ShiprocketError,
} from '@/lib/shiprocket';
import { planShipments, summarizeShipments, TULSI_KEY } from '@/lib/shipmentPlan';
import { allocate, toPaise, vendorOf, PLATFORM_VENDOR_ID } from '@/lib/settlement';

export class DispatchError extends Error {}

export function tulsiPickup() {
  return { pickupLocation: process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary', pickupPincode: process.env.SHIPROCKET_PICKUP_PINCODE || null };
}

export async function loadVendors(db, vendorIds = []) {
  const ids = [...new Set(vendorIds)].filter((v) => v && v !== PLATFORM_VENDOR_ID);
  const snaps = await Promise.all(ids.map((id) => db.collection('vendors').doc(id).get()));
  return Object.fromEntries(snaps.filter((s) => s.exists).map((s) => [s.id, s.data()]));
}

/* Courier cost per vendor for settlement: a vendor's own parcel is theirs
   in full; Tulsi's parcel is shared among the vendors in it by item value
   (Tulsi's own items bear their share). */
export function vendorFreight(order, plan, shipments) {
  const out = {};
  for (const p of plan) {
    const freight = shipments[p.key]?.freight;
    if (typeof freight !== 'number') continue;
    if (p.key !== TULSI_KEY) { out[p.key] = (out[p.key] || 0) + freight; continue; }
    const byVendor = new Map();
    for (const i of p.items) {
      const vid = vendorOf((order.items || []).find((x) => x.product === i.product) || {});
      byVendor.set(vid, (byVendor.get(vid) || 0) + toPaise(i.price) * i.quantity);
    }
    const vids = [...byVendor.keys()];
    const parts = allocate(toPaise(freight), vids.map((v) => byVendor.get(v)));
    vids.forEach((v, idx) => { if (v !== PLATFORM_VENDOR_ID) out[v] = (out[v] || 0) + parts[idx] / 100; });
  }
  return out;
}

/**
 * @param {object} db
 * @param {string} orderId
 * @param {object} opts  { onlyKey?: parcel key to book (a vendor's id), courierId? }
 * @returns {{ plan, results: Array<{ key, ok, awb?, courierName?, error?, already? }>, summary }}
 */
export async function dispatchOrder(db, orderId, { onlyKey = null, courierId = null } = {}) {
  if (!isConfigured()) throw new DispatchError('Shiprocket isn’t set up — enter the courier’s tracking number instead.');
  const ref = db.collection('orders').doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) throw new DispatchError('Order not found');
  const order = { id: snap.id, ...snap.data() };
  if (order.status === 'cancelled') throw new DispatchError('This order is cancelled.');
  if (!['confirmed', 'processing', 'shipped'].includes(order.status)) throw new DispatchError('Confirm the order before booking a courier.');

  const vendors = await loadVendors(db, order.vendorIds || []);
  const plan = planShipments(order, vendors, tulsiPickup());
  const targets = plan.filter((p) => !onlyKey || p.key === onlyKey);
  if (!targets.length) throw new DispatchError('Nothing to ship from this warehouse in this order.');

  const shipments = { ...(order.shipments || {}) };
  /* Orders shipped through the old single-parcel flow keep their booking. */
  if (!shipments[TULSI_KEY] && order.shiprocketShipmentId && plan.length === 1 && plan[0].key === TULSI_KEY) {
    shipments[TULSI_KEY] = { shipmentId: order.shiprocketShipmentId, srOrderId: order.shiprocketOrderId, awb: order.trackingNumber || null, courierName: order.courierName || null };
  }
  const save = async (key, rec) => {
    shipments[key] = rec;
    await ref.update({ [`shipments.${key}`]: rec, updatedAt: new Date().toISOString() });
  };

  const results = [];
  for (const p of targets) {
    let rec = { ...(shipments[p.key] || {}) };
    if (rec.awb) { results.push({ key: p.key, ok: true, already: true, awb: rec.awb, courierName: rec.courierName }); continue; }
    try {
      if (!rec.shipmentId) {
        const created = await createAdhocOrder({
          subOrderId: rec.subOrderId || p.subOrderId, order, items: p.items,
          pickupLocation: p.pickupLocation, subTotal: p.subTotal, cod: p.cod,
        });
        rec = {
          key: p.key, vendorId: p.vendorId, pickupLocation: p.pickupLocation,
          subOrderId: rec.subOrderId || p.subOrderId,
          items: p.items.map((i) => ({ product: i.product, name: i.name, quantity: i.quantity })),
          ...created, createdAt: new Date().toISOString(),
        };
        await save(p.key, rec);
      }
      const awb = await assignAwb(rec.shipmentId, courierId);
      if (!awb.awb) {
        await save(p.key, { ...rec, lastError: awb.awbError, lastErrorAt: new Date().toISOString() });
        results.push({ key: p.key, ok: false, error: awb.awbError });
        continue;
      }
      const freight = await getFreightQuote({ pickupPincode: p.pickupPincode, pincode: order.shippingAddress?.pincode, cod: p.cod, courierId: awb.courierId }).catch(() => null);
      const pickupRequested = await requestPickup(rec.shipmentId).then(() => true).catch(() => false);
      rec = {
        ...rec, awb: awb.awb, courierName: awb.courierName, courierId: awb.courierId,
        ...(freight !== null && { freight }),
        trackingUrl: `https://shiprocket.co/tracking/${encodeURIComponent(awb.awb)}`,
        pickupRequested, bookedAt: new Date().toISOString(), lastError: null,
      };
      await save(p.key, rec);
      results.push({ key: p.key, ok: true, awb: awb.awb, courierName: awb.courierName });
    } catch (e) {
      const message = e instanceof ShiprocketError ? e.message : `Shiprocket: ${e.message}`;
      await save(p.key, { key: p.key, vendorId: p.vendorId, pickupLocation: p.pickupLocation, ...rec, lastError: message, lastErrorAt: new Date().toISOString() }).catch(() => {});
      results.push({ key: p.key, ok: false, error: message });
    }
  }

  /* Order-level fields other screens and customer emails read. */
  const summary = summarizeShipments(shipments, plan);
  const patch = { updatedAt: new Date().toISOString() };
  if (summary.trackingNumber) patch.trackingNumber = summary.trackingNumber;
  if (summary.courierName) patch.courierName = summary.courierName;
  const first = plan.map((p) => shipments[p.key]).find((s) => s?.srOrderId);
  if (first) patch.shiprocketOrderId = first.srOrderId; // marks the order as Shiprocket-tracked
  if (summary.allBooked && order.shippingCostSource !== 'manual') {
    if (summary.shippingCost !== null) { patch.shippingCostActual = summary.shippingCost; patch.shippingCostSource = 'shiprocket_quote'; }
    patch.vendorShippingActual = vendorFreight(order, plan, shipments);
  }
  await ref.update(patch);
  return { plan, results, summary };
}

export { parcelsFor } from '@/lib/shipmentPlan';

/**
 * Books the order's parcels as soon as it's marked Packed — when Shiprocket
 * is set up and the admin hasn't switched auto-booking off (site setting
 * `shiprocketAutoDispatch: false`). Never throws: the status change has
 * already happened; the result tells the screen what (not) got booked.
 */
export async function autoDispatchOnPacked(db, orderId, { onlyKey = null } = {}) {
  try {
    if (!isConfigured()) return null;
    const site = (await db.collection('settings').doc('site').get()).data() || {};
    if (site.shiprocketAutoDispatch === false) return null;
    const { results, summary } = await dispatchOrder(db, orderId, { onlyKey });
    return { results, awb: summary.trackingNumber, allBooked: summary.allBooked };
  } catch (e) {
    return { results: [{ key: onlyKey || 'order', ok: false, error: e.message }] };
  }
}
