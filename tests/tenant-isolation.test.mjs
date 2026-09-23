/* Tenant-isolation tests for src/lib/data/scopedDb.js and src/lib/rbac.js.
   Run: npm run test:isolation   (node's built-in runner, no dependencies)
   Uses an in-memory stand-in for the slice of the Firestore Admin API
   those modules touch, so it never needs credentials or production data. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopedDb, TenantIsolationError } from '../src/lib/data/scopedDb.js';
import { resolveActor, can, ROLES } from '../src/lib/rbac.js';

function fakeDb(seed = {}) {
  const store = new Map(Object.entries(seed).map(([col, docs]) => [col, new Map(Object.entries(docs))]));
  let autoId = 0;
  const colMap = (col) => (store.has(col) ? store.get(col) : store.set(col, new Map()).get(col));

  function snapshot(col, id) {
    const data = colMap(col).get(id);
    return { id, exists: data !== undefined, data: () => (data === undefined ? undefined : { ...data }) };
  }

  function makeQuery(col, filters = [], max = Infinity) {
    return {
      where: (field, op, value) => {
        assert.equal(op, '==', 'fake only supports ==');
        return makeQuery(col, [...filters, [field, value]], max);
      },
      limit: (n) => makeQuery(col, filters, n),
      get: async () => ({
        docs: [...colMap(col).keys()]
          .filter((id) => filters.every(([f, v]) => colMap(col).get(id)[f] === v))
          .slice(0, max)
          .map((id) => snapshot(col, id)),
      }),
    };
  }

  return {
    store,
    collection(col) {
      return {
        ...makeQuery(col),
        doc(id = `auto${++autoId}`) {
          return {
            id,
            get: async () => snapshot(col, id),
            set: async (data) => { colMap(col).set(id, { ...data }); },
            update: async (data) => {
              if (!colMap(col).has(id)) throw new Error('NOT_FOUND');
              colMap(col).set(id, { ...colMap(col).get(id), ...data });
            },
            delete: async () => { colMap(col).delete(id); },
          };
        },
      };
    },
  };
}

const seed = () => fakeDb({
  products: {
    pA1: { name: 'A necklace', vendorId: 'A' },
    pA2: { name: 'A earrings', vendorId: 'A' },
    pB1: { name: 'B bangle', vendorId: 'B' },
  },
  users: { u1: { email: 'customer@example.com' } },
});

const vendorA = { role: 'vendor_admin', vendorId: 'A' };

test('a vendor query returns only that vendor’s documents', async () => {
  const db = seed();
  const snap = await scopedDb(vendorA, db).query('products').get();
  assert.deepEqual(snap.docs.map((d) => d.id).sort(), ['pA1', 'pA2']);
});

test('reading another vendor’s document by id returns null (indistinguishable from missing)', async () => {
  const db = seed();
  assert.equal(await scopedDb(vendorA, db).get('products', 'pB1'), null);
  assert.equal(await scopedDb(vendorA, db).get('products', 'does-not-exist'), null);
});

test('updating another vendor’s document is a no-op', async () => {
  const db = seed();
  assert.equal(await scopedDb(vendorA, db).update('products', 'pB1', { name: 'pwned' }), null);
  assert.equal(db.store.get('products').get('pB1').name, 'B bangle');
});

test('deleting another vendor’s document is a no-op', async () => {
  const db = seed();
  assert.equal(await scopedDb(vendorA, db).remove('products', 'pB1'), false);
  assert.ok(db.store.get('products').has('pB1'));
});

test('a vendor cannot create a document owned by another vendor', async () => {
  const db = seed();
  await assert.rejects(scopedDb(vendorA, db).create('products', { name: 'x', vendorId: 'B' }), TenantIsolationError);
});

test('create stamps the actor’s vendorId', async () => {
  const db = seed();
  const created = await scopedDb(vendorA, db).create('products', { name: 'new' });
  assert.equal(db.store.get('products').get(created.id).vendorId, 'A');
});

test('an update cannot move a document to another vendor', async () => {
  const db = seed();
  await scopedDb(vendorA, db).update('products', 'pA1', { name: 'renamed', vendorId: 'B' });
  assert.equal(db.store.get('products').get('pA1').vendorId, 'A');
  assert.equal(db.store.get('products').get('pA1').name, 'renamed');
});

test('platform-level collections cannot be reached through the vendor layer', async () => {
  const db = seed();
  assert.throws(() => scopedDb(vendorA, db).query('users'), TenantIsolationError);
  await assert.rejects(scopedDb(vendorA, db).get('users', 'u1'), TenantIsolationError);
});

test('a non-super-admin cannot widen scope via actingAsVendorId', async () => {
  const db = seed();
  const snap = await scopedDb({ ...vendorA, actingAsVendorId: 'B' }, db).query('products').get();
  assert.deepEqual(snap.docs.map((d) => d.id).sort(), ['pA1', 'pA2']);
});

test('a vendor actor with no vendorId fails closed', () => {
  assert.throws(() => scopedDb({ role: 'vendor_staff' }, seed()), TenantIsolationError);
});

test('super_admin platform view sees all vendors; creates must name a vendor', async () => {
  const db = seed();
  const sdb = scopedDb({ role: 'super_admin' }, db);
  assert.equal((await sdb.query('products').get()).docs.length, 3);
  await assert.rejects(sdb.create('products', { name: 'orphan' }), TenantIsolationError);
});

test('super_admin acting as a vendor is pinned to that vendor', async () => {
  const db = seed();
  const snap = await scopedDb({ role: 'super_admin', actingAsVendorId: 'B' }, db).query('products').get();
  assert.deepEqual(snap.docs.map((d) => d.id), ['pB1']);
});

/* ── RBAC ── */

const staffDb = () => fakeDb({
  staff: {
    s1: { email: 'owner@a.com', role: 'SuperAdmin', status: 'Active', vendorId: 'A' },
    s2: { email: 'orders@a.com', role: 'OrderManager', status: 'Active', vendorId: 'A' },
    s3: { email: 'gone@a.com', role: 'OrderManager', status: 'Inactive', vendorId: 'A' },
    s4: { email: 'legacy@a.com', role: 'OrderManager', status: 'Active' },
    s5: { email: 'both@x.com', role: 'OrderManager', status: 'Active', vendorId: 'A' },
    s6: { email: 'both@x.com', role: 'OrderManager', status: 'Active', vendorId: 'B' },
    s7: { email: 'odd@a.com', role: 'Astrologer', status: 'Active', vendorId: 'A' },
  },
});
const actorFor = (email) => resolveActor({ user: { email } }, staffDb(), ['boss@tulsijewels.in']);

test('ADMIN_EMAILS is the only path to super_admin', async () => {
  assert.equal((await actorFor('Boss@TulsiJewels.in')).role, ROLES.SUPER_ADMIN);
});

test('a staff "SuperAdmin" is admin of their own vendor, not the platform', async () => {
  const actor = await actorFor('owner@a.com');
  assert.equal(actor.role, ROLES.VENDOR_ADMIN);
  assert.equal(actor.vendorId, 'A');
});

test('staff permissions follow their role', async () => {
  const actor = await actorFor('orders@a.com');
  assert.equal(can(actor, 'orders:fulfil'), true);
  assert.equal(can(actor, 'catalog:write'), false);
  assert.equal(can(actor, 'finance:read'), false);
});

test('inactive staff, staff without a vendor, and ambiguous memberships are denied', async () => {
  assert.equal(await actorFor('gone@a.com'), null);
  assert.equal(await actorFor('legacy@a.com'), null);
  assert.equal(await actorFor('both@x.com'), null);
  assert.equal(await actorFor('stranger@x.com'), null);
});

test('an unknown staff role gets no permissions', async () => {
  const actor = await actorFor('odd@a.com');
  assert.equal(actor.permissions.size, 0);
  assert.equal(can(actor, 'catalog:read'), false);
});
