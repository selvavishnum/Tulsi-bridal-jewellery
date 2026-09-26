/* ─────────────────────────────────────────────
   Shipping & COD charges — one rule, used by the server (the authority),
   the cart, the checkout summary and the admin screen.

   Stored in Firestore `settings/store_settings`:
     enable_shipping_fee      boolean   default true
     shipping_fee_amount      ₹         default 99
     free_shipping_threshold  ₹         default 2000  (0 / blank = never free)
     enable_cod_fee           boolean   default true
     cod_fee_amount           ₹         default 49
     cod_fee_waive_above      ₹ | null  default 500 — no COD fee on orders of
                                        this subtotal or more (keeps the
                                        store's existing rule; blank = always)

   Pure module — no '@/…' imports — safe in the browser and in tests.
   ───────────────────────────────────────────── */

export const DEFAULT_CHARGES = Object.freeze({
  enable_shipping_fee: true,
  shipping_fee_amount: 99,
  free_shipping_threshold: 2000,
  enable_cod_fee: true,
  cod_fee_amount: 49,
  cod_fee_waive_above: 500,
});

const MAX_FEE = 100000;
const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

/** Stored document (possibly partial or missing) → complete, safe settings. */
export function normalizeCharges(doc) {
  const d = doc || {};
  const money = (v, fallback) => {
    const n = num(v);
    return n === null || !Number.isFinite(n) || n < 0 ? fallback : Math.round(n * 100) / 100;
  };
  return {
    enable_shipping_fee: typeof d.enable_shipping_fee === 'boolean' ? d.enable_shipping_fee : DEFAULT_CHARGES.enable_shipping_fee,
    shipping_fee_amount: money(d.shipping_fee_amount, DEFAULT_CHARGES.shipping_fee_amount),
    free_shipping_threshold: money(d.free_shipping_threshold, DEFAULT_CHARGES.free_shipping_threshold),
    enable_cod_fee: typeof d.enable_cod_fee === 'boolean' ? d.enable_cod_fee : DEFAULT_CHARGES.enable_cod_fee,
    cod_fee_amount: money(d.cod_fee_amount, DEFAULT_CHARGES.cod_fee_amount),
    cod_fee_waive_above: d.cod_fee_waive_above === null ? null : money(d.cod_fee_waive_above, DEFAULT_CHARGES.cod_fee_waive_above),
    updatedAt: d.updatedAt || null,
  };
}

/**
 * Admin input → settings to store, or an error for the form.
 * @returns {{ data: object } | { error: string }}
 */
export function parseChargesInput(body) {
  const b = body || {};
  const allowed = Object.keys(DEFAULT_CHARGES);
  const unknown = Object.keys(b).filter((k) => !allowed.includes(k));
  if (unknown.length) return { error: `Unknown setting: ${unknown.join(', ')}` };
  const out = {};
  for (const key of ['enable_shipping_fee', 'enable_cod_fee']) {
    if (b[key] === undefined) continue;
    if (typeof b[key] !== 'boolean') return { error: `${key} must be on or off.` };
    out[key] = b[key];
  }
  const labels = {
    shipping_fee_amount: 'Standard shipping amount',
    free_shipping_threshold: 'Free shipping above',
    cod_fee_amount: 'COD handling fee',
    cod_fee_waive_above: 'No COD fee above',
  };
  for (const [key, label] of Object.entries(labels)) {
    if (b[key] === undefined) continue;
    const n = num(b[key]);
    if (n === null) {
      if (key === 'cod_fee_waive_above' || key === 'free_shipping_threshold') { out[key] = key === 'cod_fee_waive_above' ? null : 0; continue; }
      return { error: `${label} is required.` };
    }
    if (!Number.isFinite(n)) return { error: `${label} must be a number.` };
    if (n < 0) return { error: `${label} can’t be negative.` };
    if (n > MAX_FEE) return { error: `${label} looks too large.` };
    out[key] = Math.round(n * 100) / 100;
  }
  if (out.enable_shipping_fee === true && out.shipping_fee_amount === 0) return { error: 'Shipping fee is on but the amount is ₹0 — switch it off instead.' };
  if (out.enable_cod_fee === true && out.cod_fee_amount === 0) return { error: 'COD fee is on but the amount is ₹0 — switch it off instead.' };
  return { data: out };
}

/**
 * The charges for one order.
 * @param {{ subtotal: number, paymentMethod: 'cod'|'razorpay'|string, charges: object }} p
 * @returns {{ shipping: number, codFee: number, freeShipping: boolean }}
 */
export function computeCharges({ subtotal, paymentMethod, charges }) {
  const c = normalizeCharges(charges);
  const sub = Math.max(0, Number(subtotal) || 0);
  const freeShipping = !c.enable_shipping_fee || (c.free_shipping_threshold > 0 && sub >= c.free_shipping_threshold);
  const shipping = freeShipping ? 0 : c.shipping_fee_amount;
  const codWaived = c.cod_fee_waive_above !== null && c.cod_fee_waive_above > 0 && sub >= c.cod_fee_waive_above;
  const codFee = paymentMethod === 'cod' && c.enable_cod_fee && !codWaived ? c.cod_fee_amount : 0;
  return { shipping, codFee, freeShipping };
}

/* The line for banners and product pages ("Free delivery above ₹2000"). */
export function freeShippingLine(charges) {
  const c = normalizeCharges(charges);
  if (!c.enable_shipping_fee) return 'Free delivery on every order';
  if (c.free_shipping_threshold > 0) return `Free delivery above ₹${c.free_shipping_threshold.toLocaleString('en-IN')}`;
  return `Delivery ₹${c.shipping_fee_amount}`;
}
