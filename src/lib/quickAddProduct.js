/* ─────────────────────────────────────────────
   Quick Add Product — the one schema the inventory modal and
   POST /api/admin/products/quick-add share.

   Prices follow the rest of the store: `price` is the MRP (shown struck
   through) and `discountPrice` the selling price when it's lower. The
   purchase cost is private — it becomes a FIFO stock lot, never shown to
   shoppers or to staff without pricing rights.

   Pure module (zod only) — runs in the browser for instant feedback and
   on the server as the authority.
   ───────────────────────────────────────────── */
import { z } from 'zod';

/* Quick picks, mapped to the category slugs the shop already uses. */
export const QUICK_CATEGORIES = Object.freeze([
  { slug: 'necklace', label: 'Necklace', code: 'NK' },
  { slug: 'earrings', label: 'Earrings', code: 'ER' },
  { slug: 'set', label: 'Bridal Set', code: 'BS' },
  { slug: 'chain', label: 'Chains', code: 'CH' },
  { slug: 'bangles', label: 'Bangles', code: 'BG' },
  { slug: 'ring', label: 'Rings', code: 'RG' },
]);
/* Every category a product may carry (inventory filter list + chain). */
export const ALL_CATEGORIES = Object.freeze([
  'necklace', 'earrings', 'set', 'chain', 'bangles', 'ring', 'bracelet', 'maang-tikka', 'nose-ring', 'anklet',
  'mala', 'haar', 'jhumka', 'kada', 'choker', 'pendant', 'mangalsutra', 'other',
]);
export const DESIGN_TYPES = Object.freeze(['Temple', 'Matte', 'Antique', 'Minimalist', 'Kundan', 'AD Stone', 'Oxidised', 'Polki']);

export const MAX_IMAGES = 3;
export const SKU_RE = /^[A-Z0-9][A-Z0-9-]{2,39}$/;

/** "TJ-NK-L8K2QX" — category code + a time-based suffix (unique per second). */
export function generateSku(category, now = Date.now()) {
  const code = QUICK_CATEGORIES.find((c) => c.slug === category)?.code
    || String(category || 'PR').replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase() || 'PR';
  return `TJ-${code}-${now.toString(36).toUpperCase().slice(-6)}`;
}

/** % off from MRP and selling price (0 when there's no real discount). */
export function discountPercent(mrp, sale) {
  const m = Number(mrp); const s = Number(sale);
  if (!(m > 0) || !(s > 0) || s >= m) return 0;
  return Math.round(((m - s) / m) * 100);
}

const text = (max, min = 0, msg = 'Required') => z.preprocess(
  (v) => (v === undefined || v === null ? '' : String(v)),
  z.string().trim().min(min, msg).max(max, `Up to ${max} characters`).refine((v) => !/[<>]/.test(v), 'Remove < and > characters'),
);
/* Money: blank → null; digits with optional paise; commas/₹ tolerated. */
const money = z.preprocess((v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}, z.number({ message: 'Enter a valid amount' }).min(0, 'Can’t be negative').max(10_000_000, 'Too large').nullable());
const count = (min, max, dflt) => z.preprocess(
  (v) => (v === undefined || v === null || v === '' ? dflt : Number(v)),
  z.number({ message: 'Enter a whole number' }).int('Enter a whole number').min(min, `At least ${min}`).max(max, `At most ${max}`),
);

export const quickAddSchema = z.object({
  name: text(120, 3, 'Enter the product name (3+ characters)'),
  category: z.enum(ALL_CATEGORIES, { message: 'Choose a category' }),
  designType: text(40),
  sku: z.preprocess((v) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '-'),
    z.string().refine((v) => v === '' || SKU_RE.test(v), 'SKU: 3–40 letters, numbers or dashes')),
  purchasePrice: money,
  mrp: money,
  salePrice: money,
  stock: count(1, 9999, 1),
  lowStockAt: count(0, 999, 2),
  images: z.array(z.string().regex(/^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//, 'Upload images through the form'))
    .max(MAX_IMAGES, `Up to ${MAX_IMAGES} images`).default([]),
}).superRefine((d, ctx) => {
  if (d.mrp !== null && d.salePrice !== null && d.salePrice > d.mrp) {
    ctx.addIssue({ code: 'custom', path: ['salePrice'], message: 'Selling price can’t be above the MRP' });
  }
});

/**
 * @param {object} input
 * @param {{ pricing: boolean }} opts  pricing = the user may set prices / cost
 * @returns {{ data: object } | { errors: Record<string, string> }}
 */
export function parseQuickAdd(input, { pricing = true } = {}) {
  const r = quickAddSchema.safeParse(input || {});
  const errors = {};
  if (!r.success) for (const i of r.error.issues) { const k = String(i.path[0] ?? 'form'); if (!errors[k]) errors[k] = i.message; }
  /* Show "enter a price" together with any other errors, not after them. */
  const num = (v) => Number(String(v ?? '').replace(/[₹,\s]/g, ''));
  if (pricing && !errors.salePrice && !(num(input?.salePrice) > 0) && !(num(input?.mrp) > 0)) errors.salePrice = 'Enter the selling price';
  if (Object.keys(errors).length) return { errors };
  const d = r.data;
  if (!pricing) return { data: { ...d, purchasePrice: null, mrp: null, salePrice: null } };
  /* MRP defaults to the selling price when left blank (no discount). */
  const mrp = d.mrp > 0 ? d.mrp : d.salePrice;
  const sale = d.salePrice > 0 ? d.salePrice : mrp;
  return { data: { ...d, mrp, salePrice: sale } };
}

/** Low-stock line for the inventory screen (older products default to 3). */
export function isLowStock(p) {
  const t = p?.lowStockAt;
  const threshold = t === undefined || t === null || t === '' || !Number.isFinite(Number(t)) ? 3 : Number(t);
  return (Number(p?.stock) || 0) <= threshold;
}
