/* ─────────────────────────────────────────────
   Access model — six staff roles plus vendors, least privilege, deny by
   default.

     SUPER_ADMIN        Everything: ledgers, payouts, supplier costs,
                        settings, staff. Granted by ADMIN_EMAILS, or by a
                        staff record that only a SUPER_ADMIN can create or
                        edit.
     ORDER_MANAGER      Orders to pack and ship: view, print, mark Packed /
                        Shipped, book the courier. No costs, margins,
                        payouts or settings.
     SALES_STAFF        Look up orders and customers to answer buyers.
                        Read-only: no status changes, no courier booking.
     PRODUCT_MANAGER    Products, categories, variants, photos and stock.
                        No prices, costs, orders or customer data. New
                        products start as drafts until a SUPER_ADMIN
                        prices and publishes them.
     INVENTORY_MANAGER  Stock counts and barcodes only. Can't create or
                        rename products, or touch prices.
     BUSINESS_MANAGER   Runs the business day to day:
                          Operation  — dashboard, orders (full control),
                                       customer messages
                          CRM        — customers, coupons, feedback,
                                       returns & refunds
                          Product    — everything in the product menu,
                                       including prices, margins, stock
                                       lots and purchases
                          Reports    — reports, sales, visitor analytics
                          Management — warehouses, suppliers, employees,
                                       accounting
                        Not: vendor payouts and bank details, staff &
                        access, settings / payment-gateway keys, rentals.
     VENDOR             Their own products and orders, retail sales and net
                        payout balance only (/vendor portal).

   The role is resolved from its source (ADMIN_EMAILS or the staff record)
   on every API request — see requireRole.js — never trusted from the
   session token alone. Pure module: no Next.js or '@/…' imports, so the
   edge middleware and `node --test` can both use it.
   ───────────────────────────────────────────── */
import { PLATFORM_VENDOR_ID } from './data/scopedDb.js';

export const ROLES = Object.freeze({
  SUPER_ADMIN: 'SUPER_ADMIN',
  PRODUCT_MANAGER: 'PRODUCT_MANAGER',
  INVENTORY_MANAGER: 'INVENTORY_MANAGER',
  BUSINESS_MANAGER: 'BUSINESS_MANAGER',
  ORDER_MANAGER: 'ORDER_MANAGER',
  SALES_STAFF: 'SALES_STAFF',
  VENDOR: 'VENDOR',
});
const { SUPER_ADMIN, PRODUCT_MANAGER, INVENTORY_MANAGER, BUSINESS_MANAGER, ORDER_MANAGER, SALES_STAFF, VENDOR } = ROLES;

/* Roles a SUPER_ADMIN can give a platform staff member on the Staff page,
   in the order the dropdown shows them. Vendor logins are created on the
   Vendors page instead. */
export const ASSIGNABLE_STAFF_ROLES = Object.freeze([
  SUPER_ADMIN, PRODUCT_MANAGER, INVENTORY_MANAGER, BUSINESS_MANAGER, ORDER_MANAGER, SALES_STAFF,
]);

export const ROLE_LABELS = Object.freeze({
  [SUPER_ADMIN]: 'Super Admin',
  [PRODUCT_MANAGER]: 'Product Manager',
  [INVENTORY_MANAGER]: 'Inventory Manager',
  [BUSINESS_MANAGER]: 'Business Manager',
  [ORDER_MANAGER]: 'Order Manager',
  [SALES_STAFF]: 'Sales Staff',
  [VENDOR]: 'Vendor',
});

/* Who may do what. API routes and pages check these groups, so adding a
   role means deciding its place here, once. SUPER_ADMIN is in every group. */
export const CAN = Object.freeze({
  /* Read every order. Below manageOrders, the cost-free fulfilment view. */
  viewOrders: Object.freeze([SUPER_ADMIN, ORDER_MANAGER, SALES_STAFF, BUSINESS_MANAGER]),
  /* Mark Packed / Shipped, add tracking, book the courier. */
  fulfilOrders: Object.freeze([SUPER_ADMIN, ORDER_MANAGER, BUSINESS_MANAGER]),
  /* Full order control: every status, courier charge, cost fields, emails. */
  manageOrders: Object.freeze([SUPER_ADMIN, BUSINESS_MANAGER]),
  /* Admin dashboard and customer messages. */
  manageOperations: Object.freeze([SUPER_ADMIN, BUSINESS_MANAGER]),
  /* Customer list and profiles. */
  viewCustomers: Object.freeze([SUPER_ADMIN, SALES_STAFF, BUSINESS_MANAGER]),
  /* Coupons, feedback, returns & refunds, complaints. */
  manageCRM: Object.freeze([SUPER_ADMIN, BUSINESS_MANAGER]),
  /* Create and edit products, categories, variants and photos. */
  editCatalog: Object.freeze([SUPER_ADMIN, PRODUCT_MANAGER, BUSINESS_MANAGER]),
  /* Everything about a product, including price, margin, seller, stock
     lots and purchases (editCatalog below this sees no prices or costs). */
  manageCatalog: Object.freeze([SUPER_ADMIN, BUSINESS_MANAGER]),
  /* See the product list and set stock counts. */
  editStock: Object.freeze([SUPER_ADMIN, PRODUCT_MANAGER, INVENTORY_MANAGER, BUSINESS_MANAGER]),
  /* Sales reports and visitor analytics. */
  viewReports: Object.freeze([SUPER_ADMIN, BUSINESS_MANAGER]),
  /* Warehouses, suppliers, employees, accounting. */
  manageBackOffice: Object.freeze([SUPER_ADMIN, BUSINESS_MANAGER]),
});

/* Roles that only count when a SUPER_ADMIN granted them on the Staff page. */
export const GRANT_REQUIRED = Object.freeze([SUPER_ADMIN, BUSINESS_MANAGER]);

/* Staff records written under earlier role names. Legacy "SuperAdmin"
   maps to nothing: before roles were validated any staff member could
   write any role, including their own, so it proves nothing — a SUPER_ADMIN
   re-grants it on the Staff page (which records who granted it). */
const LEGACY_STAFF_ROLES = Object.freeze({
  ProductManager: PRODUCT_MANAGER,
  InventoryManager: INVENTORY_MANAGER,
  BusinessManager: BUSINESS_MANAGER,
  OrderManager: ORDER_MANAGER,
  SalesStaff: SALES_STAFF,
  VendorAdmin: VENDOR,
  // The short-lived 4-tier names
  ORDER_FULFILLMENT_STAFF: ORDER_MANAGER,
  CATALOG_STAFF: PRODUCT_MANAGER,
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
  /* SUPER_ADMIN and BUSINESS_MANAGER (orders, accounting, prices and
     margins) from a staff record only count if a SUPER_ADMIN granted them
     through the validated staff API (which stamps roleGrantedBy). One
     written before that API existed — when any staff member could set any
     role — fails closed until re-granted on the Staff page. */
  if (GRANT_REQUIRED.includes(tier) && !staff.roleGrantedBy) return { tier: null };
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
  // Operation
  ['=/admin', CAN.manageOperations], // the dashboard itself (exact path)
  ['/admin/orders', CAN.viewOrders],
  ['/admin/messages', CAN.manageOperations],
  // CRM
  ['/admin/customers', CAN.viewCustomers],
  ['/admin/coupons', CAN.manageCRM],
  ['/admin/crm', CAN.manageCRM],
  // Product
  ['/admin/inventory/lots', CAN.manageCatalog], // stock-lot costs
  ['/admin/purchase', CAN.manageCatalog],
  ['/admin/products', CAN.editCatalog],
  ['/admin/categories', CAN.editCatalog],
  ['/admin/variants', CAN.editCatalog],
  ['/admin/photo-editor', CAN.editCatalog],
  ['/admin/inventory', CAN.editStock],
  ['/admin/barcodes', CAN.editStock],
  // Reports
  ['/admin/analytics', CAN.viewReports],
  ['/admin/reports', CAN.viewReports],
  ['/admin/sales', CAN.viewReports],
  // Management
  ['/admin/warehouses', CAN.manageBackOffice],
  ['/admin/suppliers', CAN.manageBackOffice],
  ['/admin/employees', CAN.manageBackOffice],
  ['/admin/accounting', CAN.manageBackOffice],
  // Everything else — vendors & payouts, staff, settings, rentals, …
  ['/admin', [SUPER_ADMIN]],
];

export function canViewAdminPath(tier, pathname) {
  const rule = PAGE_RULES.find(([prefix]) => (prefix.startsWith('=')
    ? pathname === prefix.slice(1)
    : pathname === prefix || pathname.startsWith(`${prefix}/`)));
  return !!rule && rule[1].includes(tier);
}

const HOME = {
  [SUPER_ADMIN]: '/admin',
  [PRODUCT_MANAGER]: '/admin/products',
  [INVENTORY_MANAGER]: '/admin/inventory',
  [BUSINESS_MANAGER]: '/admin',
  [ORDER_MANAGER]: '/admin/orders',
  [SALES_STAFF]: '/admin/orders',
};
export function adminHomeFor(tier) {
  return HOME[tier] || null;
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
    out.items = order.items.map(({ supplyCost: _s, vendorId: _v, vendorShipping: _vs, ...i }) => i);
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
  'marginMode', 'marginPercent', 'vendorShipping',
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
