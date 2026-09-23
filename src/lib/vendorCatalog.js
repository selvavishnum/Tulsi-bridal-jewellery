/* ─────────────────────────────────────────────
   Vendor self-service catalogue rules — what a vendor may write to their
   own products, and what they may read back.

   Whitelist, not blacklist: a vendor write may only carry the fields in
   VENDOR_EDITABLE_FIELDS. Anything else (supplyCost, vendorId, isActive,
   showMe, featured, reviewStatus, …) is refused with 403 rather than
   silently dropped, so tampering is visible. Ownership (vendorId) is
   enforced one layer down, by scopedDb.

   Pure module — no '@/…' imports — so `node --test` can exercise it.
   ───────────────────────────────────────────── */

export const PRODUCT_CATEGORIES = Object.freeze(['necklace', 'earrings', 'bangles', 'bracelet', 'ring', 'maang-tikka', 'nose-ring', 'anklet', 'set', 'other']);
export const PRODUCT_MATERIALS = Object.freeze(['gold', 'silver', 'gold-plated', 'silver-plated', 'kundan', 'meenakari', 'polki', 'other']);

export const VENDOR_EDITABLE_FIELDS = Object.freeze([
  'name', 'sku', 'category', 'material', 'description', 'shortDescription', 'images',
  'price', 'discountPrice', 'stock',
  'weight', 'color', 'occasion', 'purity', 'metalType', 'stoneType', 'usageInstructions', 'tags',
]);

const TEXT_LIMITS = {
  name: 120, sku: 40, description: 5000, shortDescription: 300, weight: 40, color: 40,
  occasion: 60, purity: 40, metalType: 60, stoneType: 60, usageInstructions: 1000,
};
const MAX_IMAGES = 8;
const MAX_PRICE = 10_000_000; // ₹1 crore — a typo guard, not a business rule
const SKU = /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/;
const IMAGE_HOST = 'https://res.cloudinary.com/';

const fail = (error, status = 400) => ({ error, status });

/**
 * Validates a vendor's create (current = null) or edit of their product.
 * @returns {{ data: object } | { error: string, status: number }}
 */
export function parseVendorProduct(body, current = null) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('Invalid request');
  const ignored = new Set(['id', '_id']);
  const denied = Object.keys(body).filter((k) => !ignored.has(k) && !VENDOR_EDITABLE_FIELDS.includes(k));
  if (denied.length) return fail(`These fields are managed by Tulsi: ${denied.join(', ')}`, 403);

  const data = {};
  for (const [field, max] of Object.entries(TEXT_LIMITS)) {
    if (body[field] === undefined) continue;
    const v = String(body[field] ?? '').trim();
    if (v.length > max) return fail(`${field} must be at most ${max} characters.`);
    data[field] = v;
  }
  if (!current && !data.name) return fail('Product title is required.');
  if (current && body.name !== undefined && !data.name) return fail('Product title is required.');
  if (data.sku !== undefined && data.sku !== '' && !SKU.test(data.sku)) {
    return fail('SKU may use letters, numbers, - and _ (2–40 characters).');
  }

  if (body.category !== undefined) {
    if (!PRODUCT_CATEGORIES.includes(body.category)) return fail('Choose a valid category.');
    data.category = body.category;
  } else if (!current) {
    return fail('Category is required.');
  }
  if (body.material !== undefined) {
    if (body.material !== '' && !PRODUCT_MATERIALS.includes(body.material)) return fail('Choose a valid material.');
    data.material = body.material;
  }

  if (body.price !== undefined) {
    const n = Number(body.price);
    if (!Number.isFinite(n) || n <= 0 || n > MAX_PRICE) return fail('Retail price must be more than ₹0.');
    data.price = Math.round(n * 100) / 100;
  } else if (!current) {
    return fail('Retail price is required.');
  }
  if (body.discountPrice !== undefined) {
    const n = body.discountPrice === '' || body.discountPrice === null ? 0 : Number(body.discountPrice);
    if (!Number.isFinite(n) || n < 0) return fail('Offer price must be ₹0 (no offer) or more.');
    data.discountPrice = Math.round(n * 100) / 100;
  }
  const price = data.price ?? (Number(current?.price) || 0);
  const offer = data.discountPrice ?? (Number(current?.discountPrice) || 0);
  if (offer > 0 && offer >= price) return fail('Offer price must be lower than the retail price.');

  if (body.stock !== undefined) {
    const n = Number(body.stock);
    if (!Number.isInteger(n) || n < 0 || n > 100000) return fail('Stock must be a whole number from 0 to 100000.');
    data.stock = n;
  }

  if (body.images !== undefined) {
    if (!Array.isArray(body.images) || body.images.length > MAX_IMAGES) return fail(`Add up to ${MAX_IMAGES} images.`);
    const existing = new Set(current?.images || []);
    for (const url of body.images) {
      /* New images must be ones uploaded through the portal (our Cloudinary);
         images already on the product may stay whatever their host. */
      if (typeof url !== 'string' || (!existing.has(url) && !url.startsWith(IMAGE_HOST))) {
        return fail('Upload images through the portal.');
      }
    }
    data.images = body.images;
  }

  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.length > 20) return fail('Up to 20 tags.');
    data.tags = body.tags.map((t) => String(t).trim().slice(0, 30)).filter(Boolean);
  }
  return { data };
}

/* A vendor's selling price may not fall below the supply cost Tulsi
   retains — otherwise the platform ships the piece and keeps nothing.
   The message deliberately doesn't say what that floor is. */
export function vendorPriceFloorError(merged) {
  const supply = Number(merged?.supplyCost) || 0;
  if (supply <= 0) return null; // draft: Tulsi hasn't set it yet
  const selling = Number(merged.discountPrice) || Number(merged.price) || 0;
  if (selling < supply) {
    return 'That price is below the minimum agreed with Tulsi for this piece. Contact Tulsi to change it.';
  }
  return null;
}

/* Where a vendor's product stands, in their words. */
export function vendorProductStatus(p) {
  if (p.reviewStatus === 'pending' && p.isActive === false) return 'in_review';
  if (p.isActive === false || p.showMe === false) return 'hidden';
  if (!(Number(p.stock) > 0)) return 'out_of_stock';
  return 'live';
}

/* A product as its vendor sees it: their own listing fields only — no
   supply cost, no platform flags, no stock-lot or warehouse data. */
export function toVendorProduct(id, p) {
  return {
    id,
    name: p.name || '',
    sku: p.sku || '',
    category: p.category || '',
    material: p.material || '',
    description: p.description || '',
    shortDescription: p.shortDescription || '',
    images: Array.isArray(p.images) ? p.images : [],
    price: Number(p.price) || 0,
    discountPrice: Number(p.discountPrice) || 0,
    stock: Number(p.stock) || 0,
    weight: p.weight || '',
    color: p.color || '',
    occasion: p.occasion || '',
    purity: p.purity || '',
    metalType: p.metalType || '',
    stoneType: p.stoneType || '',
    usageInstructions: p.usageInstructions || '',
    tags: Array.isArray(p.tags) ? p.tags : [],
    status: vendorProductStatus(p),
    updatedAt: p.updatedAt || null,
  };
}

/* ── Store profile ── */
const PINCODE = /^[1-9]\d{5}$/;
const PHONE = /^[6-9]\d{9}$/;
const EMAIL = /^\S+@\S+\.\S+$/;
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;

/**
 * Validates the store profile a vendor may edit about themselves. Payout
 * details are handled separately (they need Super Admin approval).
 * @returns {{ data: object } | { error: string, status: number }}
 */
export function parseVendorProfile(body) {
  if (!body || typeof body !== 'object') return fail('Invalid request');
  const allowed = ['name', 'contactName', 'phone', 'contactEmail', 'gstin', 'pickupAddress'];
  const denied = Object.keys(body).filter((k) => !allowed.includes(k));
  if (denied.length) return fail(`These fields are managed by Tulsi: ${denied.join(', ')}`, 403);

  const data = {};
  if (body.name !== undefined) {
    const v = String(body.name).trim();
    if (!v || v.length > 80) return fail('Store name is required (up to 80 characters).');
    data.name = v;
  }
  if (body.contactName !== undefined) data.contactName = String(body.contactName).trim().slice(0, 80);
  if (body.phone !== undefined) {
    const v = String(body.phone).replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
    if (v && !PHONE.test(v)) return fail('Enter a 10-digit mobile number.');
    data.phone = v;
  }
  if (body.contactEmail !== undefined) {
    const v = String(body.contactEmail).trim().toLowerCase();
    if (v && !EMAIL.test(v)) return fail('Enter a valid email.');
    data.contactEmail = v;
  }
  if (body.gstin !== undefined) {
    const v = String(body.gstin).trim().toUpperCase();
    if (v && !GSTIN.test(v)) return fail('Enter a valid 15-character GSTIN, or leave it blank.');
    data.gstin = v;
  }
  if (body.pickupAddress !== undefined) {
    const a = body.pickupAddress || {};
    const addr = {
      line1: String(a.line1 || '').trim().slice(0, 120),
      line2: String(a.line2 || '').trim().slice(0, 120),
      city: String(a.city || '').trim().slice(0, 60),
      state: String(a.state || '').trim().slice(0, 60),
      pincode: String(a.pincode || '').trim(),
    };
    if (!addr.line1 || !addr.city || !addr.state) return fail('Pickup address needs a street, city and state.');
    if (!PINCODE.test(addr.pincode)) return fail('Enter a valid 6-digit pincode.');
    data.pickupAddress = addr;
  }
  return { data };
}
