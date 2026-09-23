/* Unit tests for the 4-tier access model (src/lib/access.js). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeFirestore } from './helpers/fakeFirestore.mjs';
import {
  ROLES, resolveAccess, normalizeStaffRole, canViewAdminPath, adminHomeFor,
  catalogProductViolations, toFulfillmentOrder, stripCostFields, sessionRoleFor,
} from '../src/lib/access.js';

const OWNERS = ['owner@tulsi.test'];
const staffDb = () => fakeFirestore({
  staff: {
    s1: { email: 'ofs@tulsi.test', role: 'ORDER_MANAGER', status: 'Active' },
    s2: { email: 'cat@tulsi.test', role: 'PRODUCT_MANAGER', status: 'Active' },
    s14: { email: 'inv@tulsi.test', role: 'INVENTORY_MANAGER', status: 'Active' },
    s15: { email: 'sales@tulsi.test', role: 'SalesStaff', status: 'Active' },
    s16: { email: 'old4tier@tulsi.test', role: 'CATALOG_STAFF', status: 'Active' },
    s3: { email: 'sa@tulsi.test', role: 'SUPER_ADMIN', status: 'Active', roleGrantedBy: 'owner@tulsi.test' },
    s12: { email: 'selfmade@tulsi.test', role: 'SUPER_ADMIN', status: 'Active' },   // no provenance
    s13: { email: 'oldsuper@tulsi.test', role: 'SuperAdmin', status: 'Active' },    // legacy, self-assignable
    s4: { email: 'legacy@tulsi.test', role: 'OrderManager', status: 'Active' },
    s5: { email: 'bm@tulsi.test', role: 'BusinessManager', status: 'Active' },
    s6: { email: 'gone@tulsi.test', role: 'SUPER_ADMIN', status: 'Inactive' },
    s7: { email: 'va@vendor.test', role: 'SUPER_ADMIN', status: 'Active', vendorId: 'vA' }, // role field ignored for vendor logins
    s8: { email: 'odd@tulsi.test', role: 'VENDOR', status: 'Active' },                   // platform record claiming VENDOR
    s9: { email: 'owner-claim@tulsi.test', role: 'Owner', status: 'Active' },
    s10: { email: 'twice@tulsi.test', role: 'PRODUCT_MANAGER', status: 'Active' },
    s11: { email: 'twice@tulsi.test', role: 'SUPER_ADMIN', status: 'Active' },
  },
});
const tierOf = async (email) => (await resolveAccess(staffDb(), email, OWNERS)).tier;

test('ADMIN_EMAILS resolve to SUPER_ADMIN, case-insensitively', async () => {
  assert.equal(await tierOf('Owner@Tulsi.test'), ROLES.SUPER_ADMIN);
});

test('staff records resolve to their role; old names map; legacy SuperAdmin gets nothing', async () => {
  assert.equal(await tierOf('ofs@tulsi.test'), ROLES.ORDER_MANAGER);
  assert.equal(await tierOf('cat@tulsi.test'), ROLES.PRODUCT_MANAGER);
  assert.equal(await tierOf('inv@tulsi.test'), ROLES.INVENTORY_MANAGER);
  assert.equal(await tierOf('sales@tulsi.test'), ROLES.SALES_STAFF);
  assert.equal(await tierOf('sa@tulsi.test'), ROLES.SUPER_ADMIN);
  assert.equal(await tierOf('legacy@tulsi.test'), ROLES.ORDER_MANAGER);
  assert.equal(await tierOf('bm@tulsi.test'), ROLES.BUSINESS_MANAGER);
  assert.equal(await tierOf('old4tier@tulsi.test'), ROLES.PRODUCT_MANAGER);
  assert.equal(normalizeStaffRole('InventoryManager'), ROLES.INVENTORY_MANAGER);
  assert.equal(normalizeStaffRole('ORDER_FULFILLMENT_STAFF'), ROLES.ORDER_MANAGER);
  assert.equal(normalizeStaffRole('SuperAdmin'), null);
});

test('fails closed: inactive, unknown, self-styled "Owner", duplicates, platform record claiming VENDOR, unproven or legacy Super Admin', async () => {
  for (const email of ['gone@tulsi.test', 'nobody@tulsi.test', 'owner-claim@tulsi.test', 'twice@tulsi.test', 'odd@tulsi.test', 'selfmade@tulsi.test', 'oldsuper@tulsi.test', '']) {
    assert.equal(await tierOf(email), null, email);
  }
});

test('a vendor login is VENDOR whatever its role field says, and carries its vendorId', async () => {
  assert.deepEqual(await resolveAccess(staffDb(), 'va@vendor.test', OWNERS), { tier: ROLES.VENDOR, vendorId: 'vA', staffId: 's7' });
  assert.equal(sessionRoleFor(ROLES.VENDOR), 'vendor');
  for (const r of ['PRODUCT_MANAGER', 'INVENTORY_MANAGER', 'BUSINESS_MANAGER', 'ORDER_MANAGER', 'SALES_STAFF']) assert.equal(sessionRoleFor(r), 'admin', r);
  assert.equal(sessionRoleFor(null), 'customer');
});

test('page policy: each role reaches only its screens; everything unlisted is SUPER_ADMIN', () => {
  const { SUPER_ADMIN: SA, PRODUCT_MANAGER: PM, INVENTORY_MANAGER: IM, BUSINESS_MANAGER: BM, ORDER_MANAGER: OM, SALES_STAFF: SS, VENDOR } = ROLES;
  const table = {
    '/admin': [SA],
    '/admin/orders': [SA, OM, SS, BM],
    '/admin/customers': [SA, SS, BM],
    '/admin/products': [SA, PM],
    '/admin/categories': [SA, PM],
    '/admin/inventory': [SA, PM, IM],
    '/admin/barcodes': [SA, PM, IM],
    '/admin/inventory/lots': [SA],
    '/admin/reports': [SA, BM],
    '/admin/sales': [SA, BM],
    '/admin/analytics': [SA, BM],
    '/admin/vendors': [SA],
    '/admin/settings': [SA],
    '/admin/accounting': [SA],
    '/admin/staff': [SA],
    '/admin/orders-archive-lookalike': [SA],
  };
  for (const [path, allowed] of Object.entries(table)) {
    for (const tier of [SA, PM, IM, BM, OM, SS, VENDOR, null]) {
      assert.equal(canViewAdminPath(tier, path), allowed.includes(tier), `${tier} → ${path}`);
    }
  }
  // Every staff role lands on a page it may open
  for (const tier of [SA, PM, IM, BM, OM, SS]) assert.ok(canViewAdminPath(tier, adminHomeFor(tier)), tier);
});

test('catalog writes: unchanged round-tripped fields pass, any change to price/cost/vendor/publishing is caught', () => {
  const current = { name: 'Set', price: 5000, discountPrice: 4500, supplyCost: 3000, vendorId: 'vA', isActive: true };
  assert.deepEqual(catalogProductViolations({ ...current, name: 'Bridal set', stock: 3 }, current), []);
  assert.deepEqual(catalogProductViolations({ ...current, price: 1 }, current), ['price']);
  assert.deepEqual(catalogProductViolations({ supplyCost: 0, vendorId: 'vB', isActive: false }, current).sort(), ['isActive', 'supplyCost', 'vendorId']);
  assert.deepEqual(catalogProductViolations({ name: 'New', price: '', stock: 2 }, null), []);
  assert.deepEqual(catalogProductViolations({ name: 'New', price: 999 }, null), ['price']);
});

test('fulfilment and catalog views drop every cost field', () => {
  const order = {
    orderNumber: 'TBJ1', total: 1000, shippingAddress: { name: 'Priya', phone: '9876543210' },
    items: [{ name: 'Jhumka', price: 1000, quantity: 1, supplyCost: 600, vendorId: 'vA' }],
    vendorFees: { vA: 500 }, shippingCostActual: 80, payment: { method: 'razorpay', razorpaySignature: 'sig', amountDue: 100000 },
  };
  const f = JSON.stringify(toFulfillmentOrder(order));
  for (const leak of ['supplyCost', 'vendorFees', 'shippingCostActual', 'razorpaySignature', 'amountDue']) assert.ok(!f.includes(leak), leak);
  assert.ok(f.includes('9876543210'), 'fulfilment still gets the shipping phone');
  assert.ok(!JSON.stringify(stripCostFields({ name: 'x', supplyCost: 1, purchasePrice: 2, costPrice: 3, vendorId: 'vA', warehouseId: 'w1', internalNotes: 'n' })).match(/supplyCost|purchasePrice|costPrice|vendorId|warehouseId|internalNotes/));
});
