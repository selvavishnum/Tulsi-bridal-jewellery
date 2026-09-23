/* ─────────────────────────────────────────────
   Access model — 4 strict tiers, least privilege, deny by default.

     SUPER_ADMIN              Everything: ledgers, payouts, supplier costs,
                              settings, staff. Granted by ADMIN_EMAILS, or
                              by a staff record that only a SUPER_ADMIN can
                              create or edit.
     ORDER_FULFILLMENT_STAFF  Orders to pack and ship: view, print, mark
                              Packed / Shipped, book the courier. Nothing
                              about costs, margins, payouts or settings.
     CATALOG_STAFF            Product media, descriptions, categories and
                              stock counts. No prices, costs, orders or
                              customer data. New products start as drafts
                              until a SUPER_ADMIN prices and publishes them.
     VENDOR                   Their own products and orders, retail sales
                              and net payout balance only (/vendor portal).

   The tier is resolved from its source (ADMIN_EMAILS or the staff record)
   on every API request — see requireRole.js — never trusted from the
   session token alone. Pure module: no Next.js or '@/…' imports, so the
   edge middleware and `node --test` can both use it.
   ───────────────────────────────────────────── */
import { PLATFORM_VENDOR_ID } from './data/scopedDb.js';

export const ROLES = Object.freeze({
  SUPER_ADMIN: 'SUPER_ADMIN',
  ORDER_FULFILLMENT_STAFF: 'ORDER_FULFILLMENT_STAFF',
  CATALOG_STAFF: 'CATALOG_STAFF',
  VENDOR: 'VENDOR',
});
const { SUPER_ADMIN, ORDER_FULFILLMENT_STAFF, CATALOG_STAFF, VENDOR } = ROLES;

/* Roles a SUPER_ADMIN can give a platform staff member on the Staff page.
   Vendor logins are created on the Vendors page instead. */
export const ASSIGNABLE_STAFF_ROLES = Object.freeze([SUPER_ADMIN, ORDER_FULFILLMENT_STAFF, CATALOG_STAFF]);

export const ROLE_LABELS = Object.freeze({
  [SUPER_ADMIN]: 'Super Admin',
  [ORDER_FULFILLMENT_STAFF]: 'Order Fulfillment',
  [CATALOG_STAFF]: 'Catalog',
  [VENDOR]: 'Vendor',
});

/* Staff records written before the 4-tier model. Two legacy roles map to
   nothing (no admin access until a SUPER_ADMIN assigns a role):
     SuperAdmin      — before this model any staff member could write any
                       staff role, including their own, so an old
                       "SuperAdmin" proves nothing; promoting it to the tier
                       that moves money would reward exactly that.
     BusinessManager — reports and finance have no home below SUPER_ADMIN.
   Migration 004 rewrites the rest to the new names. */
const LEGACY_STAFF_ROLES = Object.freeze({
  OrderManager: ORDER_FULFILLMENT_STAFF,
  SalesStaff: ORDER_FULFILLMENT_STAFF,
  ProductManager: CATALOG_STAFF,
  InventoryManager: CATALOG_STAFF,
  VendorAdmin: VENDOR,
});

export function normalizeStaffRole(raw) {
  if (Object.values(ROLES).includes(raw)) return raw;
  return LEGACY_STAFF_ROLES[raw] || null;
}

/**
 * Who is this, right now? Reads the sources of truth only.
 * @returns {Promise<{ tier: string|null, vendorId?: string, staffId?: string }>}
 */
export async function resolveAccess(db, email, adminEmails) {
  const lower = String(email || '').trim().toLowerCase();
  if (!lower) return { tier: null };
  if (adminEmails.includes(lower)) return { tier: SUPER_ADMIN };

  const snap = await db.collection('staff').where('email', '==', lower).limit(5).get();
  const active = snap.docs.filter((d) => d.data().status === 'Active');
  // Zero → not staff. More than one → ambiguous; refuse rather than guess.
  if (active.length !== 1) return { tier: null };

  const doc = active[0];
  const staff = doc.data();
  /* A login tied to an outside vendor is VENDOR and nothing else, whatever
     its role field says — the vendorId is what scopes it. */
  if (staff.vendorId && staff.vendorId !== PLATFORM_VENDOR_ID) {
    return { tier: VENDOR, vendorId: staff.vendorId, staffId: doc.id };
  }
  const tier = normalizeStaffRole(staff.role);
  if (!tier || tier === VENDOR) return { tier: null }; // a platform record can't be a vendor
  /* SUPER_ADMIN from a staff record only counts if a SUPER_ADMIN granted it
     through the validated staff API (which stamps roleGrantedBy). A literal
     "SUPER_ADMIN" written before that API existed — when any staff member
     could set any role — fails closed. */
  if (tier === SUPER_ADMIN && !staff.roleGrantedBy) return { tier: null };
  return { tier, staffId: doc.id };
}

/* The coarse session role the rest of the app has always used. */
export function sessionRoleFor(tier) {
  if (tier === VENDOR) return 'vendor';
  if (ASSIGNABLE_STAFF_ROLES.includes(tier)) return 'admin';
  return 'customer';
}

/* ── Admin pages: first matching prefix wins; anything under /admin not
   listed is SUPER_ADMIN only. ── */
const PAGE_RULES = [
  ['/admin/inventory/lots', [SUPER_ADMIN]], // stock-lot costs
  ['/admin/orders', [SUPER_ADMIN, ORDER_FULFILLMENT_STAFF]],
  ['/admin/products', [SUPER_ADMIN, CATALOG_STAFF]],
  ['/admin/categories', [SUPER_ADMIN, CATALOG_STAFF]],
  ['/admin/variants', [SUPER_ADMIN, CATALOG_STAFF]],
  ['/admin/inventory', [SUPER_ADMIN, CATALOG_STAFF]],
  ['/admin/barcodes', [SUPER_ADMIN, CATALOG_STAFF]],
  ['/admin/photo-editor', [SUPER_ADMIN, CATALOG_STAFF]],
  ['/admin', [SUPER_ADMIN]],
];

export function canViewAdminPath(tier, pathname) {
  const rule = PAGE_RULES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return !!rule && rule[1].includes(tier);
}

export function adminHomeFor(tier) {
  if (tier === SUPER_ADMIN) return '/admin';
  if (tier === ORDER_FULFILLMENT_STAFF) return '/admin/orders';
  if (tier === CATALOG_STAFF) return '/admin/products';
  return null;
}

/* ── Order fulfilment ── */
/* 'processing' is shown as "Packed". Delivered, cancelled and confirmed
   move money or stock, so they stay with SUPER_ADMIN. */
export const FULFILLMENT_STATUSES = Object.freeze(['processing', 'shipped']);

/* What packing and shipping needs, minus anything about cost or margin. */
export function toFulfillmentOrder(order) {
  if (!order) return order;
  const {
    vendorIds: _vi, vendorFees: _vf, shippingCostActual: _sca, shippingCostSource: _scs,
    vendorSettlementPostedAt: _vsp, vendorRefundedAt: _vr, oversoldItems: _o, ...rest
  } = order;
  const out = { ...rest };
  if (Array.isArray(order.items)) {
    out.items = order.items.map(({ supplyCost: _s, vendorId: _v, ...i }) => i);
  }
  if (order.payment) {
    const { razorpaySignature: _sig, amountDue: _ad, ...payment } = order.payment;
    out.payment = payment;
  }
  return out;
}

/* ── Catalog ── */
export const CATALOG_EDITABLE_PRODUCT_FIELDS = Object.freeze([
  'name', 'slug', 'sku', 'description', 'shortDescription', 'images', 'tryOnImage',
  'category', 'subCategory', 'material', 'occasion', 'tags', 'weight', 'purity',
  'metalType', 'stoneType', 'color', 'usageInstructions', 'featured', 'isNew',
  'stock', 'rentalStock',
]);

/* Everything the public product view hides (see PRODUCT_PRIVATE_FIELDS in
   firebase.js) plus vendor assignment — catalog staff never see more
   commercial data than an anonymous shopper does. */
const COST_FIELDS = [
  'supplyCost', 'purchasePrice', 'costPrice', 'cost', 'margin', 'supplier', 'supplierId',
  'lots', 'stockLots', 'warehouse', 'warehouseId', 'internalNotes', 'vendorId',
];

/* Product as catalog staff may see it: no cost, supplier or vendor data. */
export function stripCostFields(product) {
  if (!product) return product;
  const out = { ...product };
  for (const f of COST_FIELDS) delete out[f];
  return out;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const blank = (v) => v === undefined || v === null || v === '' || v === 0 || v === false;

/**
 * Fields a catalog-staff write tries to change that they may not.
 * For an edit, a restricted field sent back unchanged (the form round-trips
 * the whole product) is fine; any change is a violation. For a create
 * (`current` null), any restricted field with a real value is a violation.
 */
export function catalogProductViolations(body, current) {
  const ignored = new Set(['id', '_id', 'createdAt', 'updatedAt']);
  return Object.keys(body || {}).filter((k) => {
    if (ignored.has(k) || CATALOG_EDITABLE_PRODUCT_FIELDS.includes(k)) return false;
    return current ? !same(body[k], current[k]) : !blank(body[k]);
  });
}
