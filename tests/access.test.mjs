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
    s1: { email: 'ofs@tulsi.test', role: 'ORDER_FULFILLMENT_STAFF', status: 'Active' },
    s2: { email: 'cat@tulsi.test', role: 'CATALOG_STAFF', status: 'Active' },
    s3: { email: 'sa@tulsi.test', role: 'SUPER_ADMIN', status: 'Active' },
    s4: { email: 'legacy@tulsi.test', role: 'OrderManager', status: 'Active' },
    s5: { email: 'bm@tulsi.test', role: 'BusinessManager', status: 'Active' },
    s6: { email: 'gone@tulsi.test', role: 'SUPER_ADMIN', status: 'Inactive' },
    s7: { email: 'va@vendor.test', role: 'SUPER_ADMIN', status: 'Active', vendorId: 'vA' }, // role field ignored for vendor logins
    s8: { email: 'odd@tulsi.test', role: 'VENDOR', status: 'Active' },                   // platform record claiming VENDOR
    s9: { email: 'owner-claim@tulsi.test', role: 'Owner', status: 'Active' },
    s10: { email: 'twice@tulsi.test', role: 'CATALOG_STAFF', status: 'Active' },
    s11: { email: 'twice@tulsi.test', role: 'SUPER_ADMIN', status: 'Active' },
  },
});
const tierOf = async (email) => (await resolveAccess(staffDb(), email, OWNERS)).tier;

test('ADMIN_EMAILS resolve to SUPER_ADMIN, case-insensitively', async () => {
  assert.equal(await tierOf('Owner@Tulsi.test'), ROLES.SUPER_ADMIN);
});

test('staff records resolve to their tier; legacy roles map; unmapped ones get nothing', async () => {
  assert.equal(await tierOf('ofs@tulsi.test'), ROLES.ORDER_FULFILLMENT_STAFF);
  assert.equal(await tierOf('cat@tulsi.test'), ROLES.CATALOG_STAFF);
  assert.equal(await tierOf('sa@tulsi.test'), ROLES.SUPER_ADMIN);
  assert.equal(await tierOf('legacy@tulsi.test'), ROLES.ORDER_FULFILLMENT_STAFF);
  assert.equal(await tierOf('bm@tulsi.test'), null);
  assert.equal(normalizeStaffRole('ProductManager'), ROLES.CATALOG_STAFF);
});

test('fails closed: inactive, unknown, self-styled "Owner", duplicates, platform record claiming VENDOR', async () => {
  for (const email of ['gone@tulsi.test', 'nobody@tulsi.test', 'owner-claim@tulsi.test', 'twice@tulsi.test', 'odd@tulsi.test', '']) {
    assert.equal(await tierOf(email), null, email);
  }
});

test('a vendor login is VENDOR whatever its role field says, and carries its vendorId', async () => {
  assert.deepEqual(await resolveAccess(staffDb(), 'va@vendor.test', OWNERS), { tier: ROLES.VENDOR, vendorId: 'vA', staffId: 's7' });
  assert.equal(sessionRoleFor(ROLES.VENDOR), 'vendor');
  assert.equal(sessionRoleFor(ROLES.CATALOG_STAFF), 'admin');
  assert.equal(sessionRoleFor(null), 'customer');
});

test('page policy: each tier reaches only its screens; everything unlisted is SUPER_ADMIN', () => {
  const { SUPER_ADMIN: SA, ORDER_FULFILLMENT_STAFF: OFS, CATALOG_STAFF: CAT, VENDOR } = ROLES;
  const table = {
    '/admin': [SA],
    '/admin/orders': [SA, OFS],
    '/admin/products': [SA, CAT],
    '/admin/inventory': [SA, CAT],
    '/admin/inventory/lots': [SA],
    '/admin/vendors': [SA],
    '/admin/settings': [SA],
    '/admin/analytics': [SA],
    '/admin/staff': [SA],
    '/admin/customers': [SA],
    '/admin/orders-archive-lookalike': [SA],
  };
  for (const [path, allowed] of Object.entries(table)) {
    for (const tier of [SA, OFS, CAT, VENDOR, null]) {
      assert.equal(canViewAdminPath(tier, path), allowed.includes(tier), `${tier} → ${path}`);
    }
  }
  assert.equal(adminHomeFor(OFS), '/admin/orders');
  assert.equal(adminHomeFor(CAT), '/admin/products');
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
  assert.ok(!JSON.stringify(stripCostFields({ name: 'x', supplyCost: 1, purchasePrice: 2, costPrice: 3 })).match(/supplyCost|purchasePrice|costPrice/));
});
