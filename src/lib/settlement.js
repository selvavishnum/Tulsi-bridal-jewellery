/* ─────────────────────────────────────────────
   Single-gateway settlement: all customer money lands in the platform's
   Razorpay account and all parcels ship through the platform's Shiprocket
   account. Each delivered order is then settled per vendor:

     Vendor payout = Collected − Margin − Shipping − Platform fee

   Collected    = the vendor's items at the price charged, plus (unless the
                  vendor set their own shipping charge) that vendor's share
                  of any shipping fee the customer paid.
   Margin       = what the platform keeps per piece, either a fixed ₹ amount
                  or a percentage of the selling price (product.marginMode).
                  Stored in the `supplyCost` field — its old name — and
                  snapshotted per piece onto the order item when the order is
                  placed, so a later change never rewrites history.
   Shipping     = the vendor's own per-piece shipping charge when their
                  product sets one (item.vendorShipping, snapshotted too);
                  otherwise the actual courier charge for the parcel, split
                  across the vendors in it in proportion to their item value.
   Platform fee = vendor's fee rate (basis points, snapshotted at order time)
                  × the vendor's item value.

   Coupon and loyalty discounts are platform-funded: they are created and
   controlled by the platform, so they don't reduce a vendor's collected
   amount. Change that here, in one place, if the policy changes.

   All money is integer paise so sums reconcile exactly. Pure module — no
   '@/…' imports — so `node --test` can exercise it directly.
   ───────────────────────────────────────────── */
import { PLATFORM_VENDOR_ID } from './data/scopedDb.js';

export { PLATFORM_VENDOR_ID };

/* Settled money is held until the return window has passed, so a refund
   can't arrive after the vendor has already been paid for the sale. */
export const RETURN_WINDOW_DAYS = 7;

export function toPaise(rupees) {
  const n = Number(rupees);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function vendorOf(item) {
  return item?.vendorId || PLATFORM_VENDOR_ID;
}

/* Splits a non-negative integer across weights so the parts are integers
   that sum exactly to the total (largest-remainder method). */
export function allocate(total, weights) {
  if (!weights.length) return [];
  if (!total) return weights.map(() => 0);
  const w = weights.map((x) => Math.max(0, x));
  let sum = w.reduce((a, b) => a + b, 0);
  const basis = sum > 0 ? w : w.map(() => 1);
  if (sum <= 0) sum = basis.length;
  const raw = basis.map((x) => (total * x) / sum);
  const parts = raw.map(Math.floor);
  let remainder = total - parts.reduce((a, b) => a + b, 0);
  const byFraction = raw
    .map((x, i) => ({ i, f: x - Math.floor(x) }))
    .sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; remainder > 0; k = (k + 1) % byFraction.length, remainder--) {
    parts[byFraction[k].i] += 1;
  }
  return parts;
}

/**
 * One settlement per non-platform vendor in the order.
 * @param {object} order  stored order document
 * @returns {Array<object>}
 */
export function computeVendorSettlements(order) {
  const items = (order?.items || []).filter((i) => i && i.product);
  const groups = new Map();
  for (const item of items) {
    const vid = vendorOf(item);
    if (!groups.has(vid)) groups.set(vid, []);
    groups.get(vid).push(item);
  }
  if (!groups.size) return [];

  const vendorIds = [...groups.keys()];
  const itemsPaiseByVendor = vendorIds.map((vid) =>
    groups.get(vid).reduce((s, i) => s + toPaise(i.price) * (Number(i.quantity) || 0), 0));

  const customerShippingPaise = toPaise(order.shippingCost);
  const hasActual = order.shippingCostActual !== undefined && order.shippingCostActual !== null && order.shippingCostActual !== '';
  const actualShippingPaise = hasActual ? Math.max(0, toPaise(order.shippingCostActual)) : customerShippingPaise;
  const shippingSource = hasActual ? 'actual' : 'estimate';

  const customerShares = allocate(customerShippingPaise, itemsPaiseByVendor);
  const actualShares = allocate(actualShippingPaise, itemsPaiseByVendor);

  const out = [];
  vendorIds.forEach((vid, idx) => {
    if (vid === PLATFORM_VENDOR_ID) return; // the platform's own sales need no settlement
    const vendorItems = groups.get(vid);
    const itemsPaise = itemsPaiseByVendor[idx];
    const supplyCostPaise = vendorItems.reduce((s, i) => s + toPaise(i.supplyCost) * (Number(i.quantity) || 0), 0);
    const platformFeeBps = Math.max(0, Math.floor(Number(order.vendorFees?.[vid]) || 0));
    const platformFeePaise = Math.round((itemsPaise * platformFeeBps) / 10000);
    /* Vendor-set shipping: the vendor pays the per-piece charge they set,
       and the shipping fee the customer paid stays with the platform (which
       books and pays the courier). Only when every one of the vendor's lines
       carries that snapshot — older orders fall back to the courier split. */
    const vendorSet = vendorItems.every((i) => typeof i.vendorShipping === 'number');
    const customerShippingPaise = vendorSet ? 0 : customerShares[idx];
    const grossPaise = itemsPaise + customerShippingPaise;
    /* Split shipments: the courier cost of the vendor's own parcel(s),
       worked out per vendor at dispatch (shipmentDispatch.vendorFreight). */
    const perVendor = order.vendorShippingActual?.[vid];
    const hasPerVendor = !vendorSet && typeof perVendor === 'number' && perVendor >= 0;
    const shippingPaise = vendorSet
      ? vendorItems.reduce((s, i) => s + Math.max(0, toPaise(i.vendorShipping)) * (Number(i.quantity) || 0), 0)
      : hasPerVendor ? toPaise(perVendor) : actualShares[idx];
    out.push({
      vendorId: vid,
      itemsPaise,
      customerShippingPaise,
      grossPaise,
      supplyCostPaise,
      shippingPaise,
      shippingSource: vendorSet ? 'vendor_set' : hasPerVendor ? 'actual' : shippingSource,
      platformFeeBps,
      platformFeePaise,
      netPaise: grossPaise - supplyCostPaise - shippingPaise - platformFeePaise,
      items: vendorItems.map((i) => ({
        product: i.product,
        name: i.name || '',
        quantity: Number(i.quantity) || 0,
        pricePaise: toPaise(i.price),
        supplyCostPaise: toPaise(i.supplyCost),
      })),
    });
  });
  return out;
}

/* Item value of a ledger entry. Reversal entries written before itemsPaise
   was recorded fall back to gross minus the customer-shipping share (or
   gross when that isn't recorded either). */
export function retailSalesOf(e) {
  if (typeof e?.itemsPaise === 'number') return e.itemsPaise;
  return (e?.grossPaise || 0) - (e?.customerShippingPaise || 0);
}

/** Wallet totals from a vendor's ledger entries. */
export function summarizeLedger(entries, now = Date.now()) {
  const s = {
    itemsPaise: 0, grossPaise: 0, supplyCostPaise: 0, shippingPaise: 0, platformFeePaise: 0, netPaise: 0,
    paidOutPaise: 0, availablePaise: 0, pendingPaise: 0,
    unsettledCount: 0, estimatedShippingCount: 0,
  };
  for (const e of entries) {
    if (!e || e.status === 'reversed') continue;
    s.itemsPaise += retailSalesOf(e);
    s.grossPaise += e.grossPaise || 0;
    s.supplyCostPaise += e.supplyCostPaise || 0;
    s.shippingPaise += e.shippingPaise || 0;
    s.platformFeePaise += e.platformFeePaise || 0;
    s.netPaise += e.netPaise || 0;
    if (e.status === 'settled') {
      s.paidOutPaise += e.netPaise || 0;
    } else {
      s.unsettledCount += 1;
      if (e.shippingSource === 'estimate') s.estimatedShippingCount += 1;
      if (new Date(e.availableAt).getTime() <= now) s.availablePaise += e.netPaise || 0;
      else s.pendingPaise += e.netPaise || 0;
    }
  }
  return s;
}

/* What a vendor may see of an order: only their own lines at retail price,
   no supply cost, no customer contact details, and nothing about other
   vendors in the same parcel (not their items, not the order total).
   Returns null if the vendor has nothing in the order. */
export function toVendorOrderView(order, vendorId) {
  const own = (order?.items || []).filter((i) => i && vendorOf(i) === vendorId);
  if (!own.length || vendorId === PLATFORM_VENDOR_ID) return null;
  const addr = order.shippingAddress || {};
  const firstName = String(addr.name || addr.fullName || '').trim().split(/\s+/)[0] || '';
  const tracking = order.trackingNumber || null;
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    status: order.status,
    shippedAt: order.shippedAt || null,
    deliveredAt: order.deliveredAt || null,
    paymentMethod: order.payment?.method || null,
    customer: { firstName, city: addr.city || '', state: addr.state || '' },
    items: own.map((i) => ({
      name: i.name || '',
      image: i.image || null,
      quantity: Number(i.quantity) || 0,
      price: Number(i.price) || 0,
    })),
    itemsTotal: own.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0),
    courierName: order.courierName || null,
    trackingNumber: tracking,
    trackingUrl: tracking && order.shiprocketOrderId ? `https://shiprocket.co/tracking/${encodeURIComponent(tracking)}` : null,
  };
}

const CUSTOMER_HIDDEN_ORDER_FIELDS = ['vendorIds', 'vendorFees', 'shippingCostActual', 'shippingCostSource', 'vendorSettlementPostedAt'];
const CUSTOMER_HIDDEN_ITEM_FIELDS = ['supplyCost', 'vendorId', 'vendorShipping'];

/* Margin (supplyCost) and vendor shipping are internal — never let them reach a shopper. */
export function toCustomerOrder(order) {
  if (!order) return order;
  const out = { ...order };
  for (const f of CUSTOMER_HIDDEN_ORDER_FIELDS) delete out[f];
  if (Array.isArray(order.items)) {
    out.items = order.items.map((i) => {
      const copy = { ...i };
      for (const f of CUSTOMER_HIDDEN_ITEM_FIELDS) delete copy[f];
      return copy;
    });
  }
  return out;
}

export const MARGIN_MODES = Object.freeze(['fixed', 'percent']);

/* What a customer pays for one piece. */
export function sellingPriceOf(product) {
  return Number(product?.discountPrice) || Number(product?.price) || 0;
}

/* The platform's margin on one piece, in rupees (2 dp): a percentage of
   the selling price, or the fixed amount stored in supplyCost. */
export function marginFor(product, sellingPrice = sellingPriceOf(product)) {
  if (product?.marginMode === 'percent') {
    const pct = Number(product.marginPercent) || 0;
    return Math.round(sellingPrice * pct) / 100;
  }
  return Number(product?.supplyCost) || 0;
}

/* The vendor's own per-piece shipping charge, or null when they haven't
   set one (then the actual courier cost is deducted instead). */
export function vendorShippingOf(product) {
  const v = product?.vendorShipping;
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/* A vendor-owned product must carry a margin, and its selling price must
   cover that margin plus the vendor's shipping charge — otherwise the
   platform ships the piece and keeps nothing (or the vendor owes money). */
export function validateVendorPricing(product) {
  const vid = product?.vendorId;
  if (!vid || vid === PLATFORM_VENDOR_ID) return null;
  if (product.marginMode === 'percent') {
    const pct = Number(product.marginPercent);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return 'Margin percentage must be more than 0 and less than 100.';
  } else {
    const fixed = Number(product.supplyCost);
    if (!Number.isFinite(fixed) || fixed <= 0) return 'Vendor products need a margin greater than ₹0.';
  }
  const raw = product.vendorShipping;
  if (raw !== null && raw !== undefined && raw !== '' && vendorShippingOf(product) === null) return 'Vendor shipping charge must be ₹0 or more.';
  const selling = sellingPriceOf(product);
  const margin = marginFor(product, selling);
  const ship = vendorShippingOf(product) || 0;
  if (selling < margin + ship) {
    return `Selling price (₹${selling}) doesn't cover the margin (₹${margin})${ship ? ` and vendor shipping (₹${ship})` : ''}.`;
  }
  return null;
}
