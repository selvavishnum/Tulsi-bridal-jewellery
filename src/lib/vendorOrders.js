/* ─────────────────────────────────────────────
   Vendor order suite — what a vendor sees of an order and what they may
   do to it.

   Two kinds of order reach a vendor:
     • Self-fulfilled: every piece in it is theirs AND Tulsi has switched
       on "vendor ships their own orders" for them. They pack and ship it,
       so they get the delivery address and phone, and may move its status.
     • Everything else (Tulsi ships, or the order mixes several sellers):
       they see only their own lines — never another seller's items or
       totals — with the customer reduced to first name and city, read-only.

   Never included: the margin Tulsi keeps per piece, the fee rate, other
   sellers' lines, payment-gateway ids or signatures.

   Pure module — no '@/…' imports — so `node --test` can exercise it.
   ───────────────────────────────────────────── */
import { computeVendorSettlements, vendorOf, PLATFORM_VENDOR_ID } from './settlement.js';

export const VENDOR_ORDER_STATUSES = Object.freeze(['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled']);
export const STATUS_LABEL = Object.freeze({
  pending: 'Pending', confirmed: 'Confirmed', processing: 'Packed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled',
});

/* Same buckets and rules as the admin Orders page. */
export const VENDOR_ORDER_TABS = Object.freeze([
  { id: 'dashboard', label: 'Overview', filter: null },
  { id: 'new', label: 'New Orders', filter: 'pending' },
  { id: 'confirmed', label: 'Confirmed', filter: 'confirmed' },
  { id: 'processing', label: 'Packed', filter: 'processing' },
  { id: 'shipped', label: 'Shipped', filter: 'shipped' },
  { id: 'delivered', label: 'Delivered', filter: 'delivered' },
  { id: 'cod', label: 'COD Pending', filter: '__cod__' },
  { id: 'action', label: 'Action Needed', filter: '__action__' },
  { id: 'cancelled', label: 'Cancelled', filter: 'cancelled' },
  { id: 'all', label: 'All Orders', filter: '__all__' },
]);

const HOUR = 3600000;

export function matchesTab(order, filter, now = Date.now()) {
  if (!filter) return false;
  if (filter === '__all__') return true;
  if (filter === '__cod__') return order.paymentMethod === 'cod' && order.paymentStatus !== 'paid' && order.status !== 'cancelled';
  if (filter === '__action__') {
    if (order.status === 'cancelled' || order.status === 'delivered') return false;
    const hrs = (now - new Date(order.createdAt).getTime()) / HOUR;
    return (order.status === 'pending' && hrs > 24) || (order.status === 'processing' && hrs > 48);
  }
  return order.status === filter;
}

/** Badge counts for every tab, from the vendor's own orders only. */
export function vendorTabCounts(orders, now = Date.now()) {
  return Object.fromEntries(VENDOR_ORDER_TABS.filter((t) => t.filter)
    .map((t) => [t.id, orders.filter((o) => matchesTab(o, t.filter, now)).length]));
}

/** Search by order number, customer name or phone (digits only for phone). */
export function searchOrders(orders, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return orders;
  const digits = q.replace(/\D/g, '');
  return orders.filter((o) => String(o.orderNumber || '').toLowerCase().includes(q)
    || String(o.customer?.name || '').toLowerCase().includes(q)
    || (digits.length >= 3 && String(o.customer?.phone || '').replace(/\D/g, '').includes(digits)));
}

export function filterVendorOrders(orders, tabId, query, now = Date.now()) {
  const tab = VENDOR_ORDER_TABS.find((t) => t.id === tabId);
  const inTab = tab?.filter ? orders.filter((o) => matchesTab(o, tab.filter, now)) : orders;
  return searchOrders(inTab, query);
}

/** Every piece in the order belongs to this vendor. */
export function isVendorOnlyOrder(order, vendorId) {
  const items = (order?.items || []).filter(Boolean);
  return !!vendorId && vendorId !== PLATFORM_VENDOR_ID && items.length > 0 && items.every((i) => vendorOf(i) === vendorId);
}

/** The vendor packs and ships this order themselves. */
export function vendorFulfils(order, vendorId, vendor) {
  return vendor?.selfFulfil === true && isVendorOnlyOrder(order, vendorId);
}

/* ── Status rules for vendors ──
   Forward only, one lane:
     pending → confirmed (COD only: an unpaid online order isn't an order yet)
     confirmed → packed → shipped (needs a tracking number) → delivered
   Cancel before dispatch, COD only — a prepaid order needs a refund,
   which Tulsi handles. Delivered and cancelled are final. */
const FORWARD = { pending: ['confirmed'], confirmed: ['processing', 'shipped'], processing: ['shipped'], shipped: ['delivered'] };

export function vendorTransitionError(order, to, { trackingNumber } = {}) {
  const from = order.status;
  if (!VENDOR_ORDER_STATUSES.includes(to)) return 'Unknown status.';
  if (to === from) return `This order is already ${STATUS_LABEL[to]}.`;
  if (from === 'delivered' || from === 'cancelled') return `A ${STATUS_LABEL[from].toLowerCase()} order can't be changed. Contact Tulsi if something is wrong.`;
  const cod = order.payment?.method === 'cod';
  if (to === 'cancelled') {
    if (!['pending', 'confirmed', 'processing'].includes(from)) return 'Shipped orders can’t be cancelled — contact Tulsi to arrange a return.';
    if (!cod || order.payment?.status === 'paid') return 'This order is prepaid — Tulsi cancels it so the customer gets a refund. Contact Tulsi.';
    return null;
  }
  if (!(FORWARD[from] || []).includes(to)) return `Can’t move an order from ${STATUS_LABEL[from]} to ${STATUS_LABEL[to]}.`;
  if (to === 'confirmed' && !cod && order.payment?.status !== 'paid') return 'This online order hasn’t been paid yet — it confirms itself when payment arrives.';
  if (to === 'shipped' && !String(trackingNumber || order.trackingNumber || '').trim()) return 'Add the tracking number before marking it shipped.';
  return null;
}

/** The statuses a vendor could move this order to next (for the modal). */
export function nextVendorStatuses(order) {
  return VENDOR_ORDER_STATUSES.filter((s) => s !== order.status && !vendorTransitionError(order, s, { trackingNumber: 'x' }));
}

const rupees = (paise) => Math.round(paise) / 100;

/**
 * An order as this vendor may see it (null when none of it is theirs).
 * @param {object} order   stored order, with id
 * @param {string} vendorId
 * @param {object} vendor  the vendors document (for selfFulfil)
 */
export function toVendorOrderDetail(order, vendorId, vendor) {
  if (!order || !vendorId || vendorId === PLATFORM_VENDOR_ID) return null;
  const own = (order.items || []).filter((i) => i && vendorOf(i) === vendorId);
  if (!own.length) return null;
  const fulfils = vendorFulfils(order, vendorId, vendor);
  const addr = order.shippingAddress || {};
  const fullName = String(addr.name || addr.fullName || '').trim();

  const s = computeVendorSettlements(order).find((x) => x.vendorId === vendorId);
  const earnings = s ? {
    itemsTotal: rupees(s.itemsPaise),
    customerShipping: rupees(s.customerShippingPaise),
    shipping: rupees(s.shippingPaise),
    shippingIsEstimate: s.shippingSource === 'estimate',
    tulsiCharges: rupees(s.supplyCostPaise + s.platformFeePaise), // margin + fee, combined — never per piece
    net: rupees(s.netPaise),
  } : null;

  const tracking = order.trackingNumber || null;
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt || null,
    status: order.status,
    shippedAt: order.shippedAt || null,
    deliveredAt: order.deliveredAt || null,
    paymentMethod: order.payment?.method || null,
    paymentStatus: order.payment?.status || null,
    fulfilledBy: fulfils ? 'vendor' : 'tulsi',
    mixedSellers: !isVendorOnlyOrder(order, vendorId),
    customer: fulfils
      ? {
        name: fullName,
        phone: addr.phone || '',
        street: addr.street || addr.address || '',
        city: addr.city || '',
        state: addr.state || '',
        pincode: addr.pincode || '',
      }
      : { name: fullName.split(/\s+/)[0] || '', city: addr.city || '', state: addr.state || '' },
    items: own.map((i) => ({
      product: i.product,
      name: i.name || '',
      image: i.image || null,
      sku: i.sku || '',
      variant: i.variant || i.size || null,
      quantity: Number(i.quantity) || 0,
      price: Number(i.price) || 0,
    })),
    itemsTotal: own.reduce((t, i) => t + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0),
    /* What the customer paid on top — shown only when the whole order is
       this vendor's (on a mixed order these belong to several sellers). */
    charges: isVendorOnlyOrder(order, vendorId)
      ? { shipping: Number(order.shippingCost) || 0, codFee: Number(order.codFee) || 0, discount: Number(order.discount) || 0, total: Number(order.total) || 0 }
      : null,
    earnings,
    courierName: order.courierName || null,
    trackingNumber: tracking,
    trackingUrl: tracking && order.shiprocketOrderId ? `https://shiprocket.co/tracking/${encodeURIComponent(tracking)}` : null,
    nextStatuses: fulfils ? nextVendorStatuses(order) : [],
  };
}
