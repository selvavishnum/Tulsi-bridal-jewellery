/* ─────────────────────────────────────────────
   Split-shipment planning.

   An order becomes one parcel per pickup warehouse:
     • each vendor who ships their own orders AND has a pickup address
       registered in Shiprocket gets their own parcel, from their
       warehouse, with their own AWB and label;
     • everything else (Tulsi's stock, and vendors whose stock Tulsi
       holds) ships together from Tulsi's warehouse.
   On COD, each parcel's courier collects that parcel's share of the
   order total (split by item value, to the paisa).

   Pure module — no '@/…' imports.
   ───────────────────────────────────────────── */
import { vendorOf, allocate, toPaise, PLATFORM_VENDOR_ID } from './settlement.js';

export const TULSI_KEY = 'tulsi';

/** Nickname for a vendor's pickup location; a changed address gets a new version. */
export function pickupNickname(vendorId, version = 1) {
  return version > 1 ? `VENDOR_${vendorId}_${version}` : `VENDOR_${vendorId}`;
}

/* The vendor ships from their own warehouse through Tulsi's Shiprocket. */
export function vendorHasPickup(vendor) {
  return vendor?.selfFulfil === true && !!vendor?.shiprocketPickupLocation && vendor?.shiprocketPickup?.status !== 'error';
}

/**
 * @param {object} order
 * @param {Record<string, object>} vendorsById  vendors documents by id
 * @param {object} tulsi  { pickupLocation, pickupPincode }
 * @returns {Array<{ key, vendorId, pickupLocation, pickupPincode, items, subTotal, cod, subOrderId }>}
 */
export function planShipments(order, vendorsById = {}, tulsi = {}) {
  const groups = new Map();
  for (const item of (order?.items || []).filter((i) => i && i.product)) {
    const vid = vendorOf(item);
    const key = vid !== PLATFORM_VENDOR_ID && vendorHasPickup(vendorsById[vid]) ? vid : TULSI_KEY;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  // Stable order: Tulsi's parcel first, then vendors by id — so a retry
  // produces the same sub-order ids.
  const keys = [...groups.keys()].sort((a, b) => (a === TULSI_KEY ? -1 : b === TULSI_KEY ? 1 : a.localeCompare(b)));
  const itemPaise = keys.map((k) => groups.get(k).reduce((s, i) => s + toPaise(i.price) * (Number(i.quantity) || 0), 0));
  const shares = allocate(Math.max(0, toPaise(order?.total)), itemPaise);
  const cod = order?.payment?.method === 'cod' && order?.payment?.status !== 'paid';

  return keys.map((key, idx) => {
    const vendor = key === TULSI_KEY ? null : vendorsById[key];
    return {
      key,
      vendorId: key === TULSI_KEY ? null : key,
      pickupLocation: key === TULSI_KEY ? tulsi.pickupLocation || 'Primary' : vendor.shiprocketPickupLocation,
      pickupPincode: key === TULSI_KEY ? tulsi.pickupPincode || null : vendor.pickupAddress?.pincode || null,
      items: groups.get(key).map((i) => ({ product: i.product, name: i.name, sku: i.sku, quantity: Number(i.quantity) || 0, price: Number(i.price) || 0 })),
      subTotal: shares[idx] / 100,
      cod,
      subOrderId: keys.length === 1 ? String(order.orderNumber) : `${order.orderNumber}-${idx + 1}`,
    };
  });
}

/**
 * What the order shows once parcels are booked: every parcel's AWB, and
 * whether all of them are booked (then the order can be marked Shipped).
 * @param {Record<string, object>} shipments  order.shipments by key
 * @param {Array} plan  planShipments(...)
 */
export function summarizeShipments(shipments = {}, plan = []) {
  const booked = plan.filter((p) => shipments[p.key]?.awb);
  return {
    allBooked: plan.length > 0 && booked.length === plan.length,
    trackingNumber: booked.map((p) => shipments[p.key].awb).join(', ') || null,
    courierName: [...new Set(booked.map((p) => shipments[p.key].courierName).filter(Boolean))].join(', ') || null,
    shippingCost: booked.every((p) => typeof shipments[p.key].freight === 'number')
      ? booked.reduce((s, p) => s + shipments[p.key].freight, 0)
      : null,
  };
}

/* Shiprocket validates pickup addresses strictly; check the obvious
   before calling so the vendor gets an instant, specific message. */
export function pickupAddressProblem({ line1, city, state, pincode, phone, name }) {
  if (!name) return 'Add a contact name for pickups.';
  if (!/^[6-9]\d{9}$/.test(String(phone || ''))) return 'Add a 10-digit mobile number for the courier to call.';
  if (!line1 || String(line1).trim().length < 10) return 'Address line 1 must be at least 10 characters.';
  if (!/\d/.test(String(line1))) return 'Address line 1 must include a house, flat, shop or road number (Shiprocket requires it).';
  if (!city || !state) return 'Add the city and state.';
  if (!/^[1-9]\d{5}$/.test(String(pincode || ''))) return 'Enter a valid 6-digit pincode.';
  return null;
}

/** Parcels on an order — a vendor's own only, or all of them for staff. */
export function parcelsFor(order, vendorId = null) {
  return Object.values(order.shipments || {})
    .filter((s) => !vendorId || s.vendorId === vendorId)
    .map((s) => ({
      key: s.key, vendorId: s.vendorId || null, awb: s.awb || null, courierName: s.courierName || null,
      trackingUrl: s.trackingUrl || null, booked: !!s.awb, pickupRequested: !!s.pickupRequested,
      error: s.awb ? null : s.lastError || null, items: s.items || [],
    }));
}
