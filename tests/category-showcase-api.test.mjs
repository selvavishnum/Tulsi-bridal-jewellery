/* ─────────────────────────────────────────────
   Homepage category showcase — the REAL route handlers:
     GET   /api/admin/category-showcase   (admin manager)
     PATCH /api/admin/category-showcase   (partial, transactional)
     POST  /api/admin/settings            (full-page Save must not clobber it)
     GET   /api/admin/settings            (public: what the storefront reads)

   Only the edges are swapped out (as in api-rbac.test.mjs): the NextAuth
   session, the nextauth route's authOptions, and Firestore (in-memory fake).
   requireAdmin → requireRole → the tier from ADMIN_EMAILS / the staff
   collection is the production code path.

   Run: npm test
   ───────────────────────────────────────────── */
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeFirestore } from './helpers/fakeFirestore.mjs';

process.env.ADMIN_EMAILS = 'owner@tulsi.test';
delete process.env.NEXT_PUBLIC_ADMIN_BYPASS;

const src = (p) => pathToFileURL(path.resolve('src', p)).href;
let db;
let session = null;
const signInAs = (email) => { session = email ? { user: { id: `uid-${email}`, email } } : null; };
const getServerSession = async () => session;

mock.module('next-auth', { defaultExport: { getServerSession }, namedExports: { getServerSession } });
mock.module(src('app/api/auth/[...nextauth]/route.js'), { namedExports: { authOptions: {} } });
mock.module(src('lib/firebase.js'), {
  namedExports: {
    getDB: () => db,
    FieldValue: { increment: (n) => n, serverTimestamp: () => new Date().toISOString() },
    docToObj: (d) => (d.exists ? { id: d.id, ...d.data() } : null),
    snapshotToArr: (snap) => snap.docs.map((d) => ({ id: d.id, _id: d.id, ...d.data() })),
  },
});

const showcaseRoute = await import(src('app/api/admin/category-showcase/route.js'));
const settingsRoute = await import(src('app/api/admin/settings/route.js'));
const { SHOWCASE_CARDS, DEFAULT_LAYOUT, DEFAULT_FOCUS, normalizeShowcase, toStored, visibleItems } = await import(src('lib/categoryShowcase.js'));

const KEYS = SHOWCASE_CARDS.map((c) => c.key);
const OWNER = 'owner@tulsi.test';
const CLD = (name) => `https://res.cloudinary.com/tulsi/image/upload/v17/tulsi-bridal/categories/${name}.jpg`;
const HERO = [{ id: '1', title: 'You Are\nThe Occasion', imageUrl: CLD('hero') }];
const LEGACY = {
  phone: '+91 76958 68787',
  heroSlides: HERO,
  categoryShape: 'square',
  categorySize: 'medium',
  categoryImages: { necklace: CLD('necklace'), set: CLD('set') },
};

beforeEach(() => {
  session = null;
  db = fakeFirestore({
    staff: {
      biz: { email: 'biz@tulsi.test', role: 'BUSINESS_MANAGER', status: 'Active', roleGrantedBy: OWNER },
      cat: { email: 'cat@tulsi.test', role: 'CATALOG_STAFF', status: 'Active' },
      pm: { email: 'pm@tulsi.test', role: 'PRODUCT_MANAGER', status: 'Active' },
      ofs: { email: 'ofs@tulsi.test', role: 'ORDER_FULFILLMENT_STAFF', status: 'Active' },
      vA: { email: 'vendor-a@vendor.test', role: 'VENDOR', vendorId: 'vA', status: 'Active' },
      sa: { email: 'super@tulsi.test', role: 'SUPER_ADMIN', status: 'Active', roleGrantedBy: OWNER },
      saOld: { email: 'oldsuper@tulsi.test', role: 'SUPER_ADMIN', status: 'Active' },
      saGone: { email: 'gone@tulsi.test', role: 'SUPER_ADMIN', status: 'Inactive', roleGrantedBy: OWNER },
    },
    settings: { site: structuredClone(LEGACY) },
  });
});

const site = () => db.store.get('settings')?.get('site');
const quietly = async (fn) => {
  const orig = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = orig; }
};
async function call(mod, method, { body, raw } = {}) {
  const request = new Request('http://tulsi.test/api/admin/category-showcase', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const res = method === 'GET' && mod === showcaseRoute ? await mod.GET() : await mod[method](request);
  return { status: res.status, headers: res.headers, json: await res.json() };
}
const getShowcase = () => call(showcaseRoute, 'GET');
const patch = (body, opts) => call(showcaseRoute, 'PATCH', { body, ...opts });
const keysOf = (s) => s.items.map((it) => it.key);
const byKey = (s) => Object.fromEntries(s.items.map((it) => [it.key, it]));

/* ── Access: SUPER_ADMIN only ── */

const DENIED = [
  [null, 'signed out'],
  ['shopper@x.test', 'a customer (no staff record)'],
  ['biz@tulsi.test', 'BUSINESS_MANAGER'],
  ['cat@tulsi.test', 'legacy CATALOG_STAFF (→ PRODUCT_MANAGER)'],
  ['pm@tulsi.test', 'PRODUCT_MANAGER'],
  ['ofs@tulsi.test', 'legacy fulfilment staff'],
  ['vendor-a@vendor.test', 'a vendor'],
  ['oldsuper@tulsi.test', 'SUPER_ADMIN record never granted through the staff API'],
  ['gone@tulsi.test', 'deactivated SUPER_ADMIN'],
];

test('GET and PATCH → 403 for everyone but a SUPER_ADMIN, and nothing is written', async () => {
  const before = structuredClone(site());
  for (const [email, who] of DENIED) {
    signInAs(email);
    const g = await getShowcase();
    assert.equal(g.status, 403, `GET ${who}`);
    assert.deepEqual(g.json, { success: false, message: 'Forbidden' });
    assert.ok(!('data' in g.json), `GET ${who}: no data leaks`);
    const p = await patch({ items: [{ key: 'earrings', isActive: false }] });
    assert.equal(p.status, 403, `PATCH ${who}`);
    assert.equal(p.json.success, false);
  }
  assert.deepEqual(site(), before, 'settings untouched');
});

test('GET and PATCH → 200 for the owner (ADMIN_EMAILS, any case) and a granted SUPER_ADMIN staff record', async () => {
  for (const email of [OWNER, 'Owner@Tulsi.TEST', 'super@tulsi.test']) {
    signInAs(email);
    const g = await getShowcase();
    assert.equal(g.status, 200, `GET ${email}`);
    assert.equal(g.json.success, true);
    const p = await patch({ layout: { size: 'small' } });
    assert.equal(p.status, 200, `PATCH ${email}`);
    assert.equal(p.json.success, true);
  }
});

/* ── GET ── */

test('GET: legacy settings come back as the normalized showcase (no-store)', async () => {
  signInAs(OWNER);
  const { status, headers, json } = await getShowcase();
  assert.equal(status, 200);
  assert.match(headers.get('cache-control') || '', /no-store/);
  assert.deepEqual(json.data, normalizeShowcase(LEGACY));
  assert.deepEqual(json.data.layout, { layoutVariant: 'king_size', displayMode: 'grid', size: 'medium' }, 'square + medium → King Size');
  assert.deepEqual(keysOf(json.data), KEYS);
  assert.equal(byKey(json.data).necklace.image, CLD('necklace'));
  assert.equal(byKey(json.data).set.image, CLD('set'));
  assert.equal(byKey(json.data).necklace.label, 'Necklaces', 'card label/link included for the manager');
  assert.equal(site().categoryShowcase, undefined, 'a GET never writes');
});

test('GET: no settings doc yet → the defaults', async () => {
  db.store.get('settings').delete('site');
  signInAs(OWNER);
  const { status, json } = await getShowcase();
  assert.equal(status, 200);
  assert.deepEqual(json.data, normalizeShowcase({}));
  assert.deepEqual(json.data.layout, { ...DEFAULT_LAYOUT });
  assert.ok(json.data.items.every((it) => it.isActive && it.image === ''));
});

test('GET: a database failure → 500 with a plain message', async () => {
  signInAs(OWNER);
  const real = db;
  const settingsDoc = { get: async () => { throw new Error('UNAVAILABLE: firestore down'); } };
  const staffCol = real.collection('staff');
  db = { collection: (c) => (c === 'settings' ? { doc: () => settingsDoc } : c === 'staff' ? staffCol : real.collection(c)) };
  const { status, json } = await quietly(getShowcase);
  assert.equal(status, 500);
  assert.equal(json.success, false);
  assert.doesNotMatch(json.message, /firestore down/, 'internal error text not leaked');
});

/* ── PATCH ── */

test('PATCH: writes only settings/site.categoryShowcase (stored form) and returns the normalized showcase', async () => {
  signInAs(OWNER);
  const { status, json } = await patch({ items: [{ key: 'earrings', isActive: false }] });
  assert.equal(status, 200);
  assert.equal(json.success, true);

  const doc = site();
  /* Everything else on the doc is exactly as it was. */
  for (const [k, v] of Object.entries(LEGACY)) assert.deepEqual(doc[k], v, `${k} untouched`);
  assert.deepEqual(Object.keys(doc).sort(), [...Object.keys(LEGACY), 'categoryShowcase', 'updatedAt'].sort());
  assert.ok(!Number.isNaN(Date.parse(doc.updatedAt)));

  /* Stored form: no label / link / emoji / colour. */
  assert.deepEqual(doc.categoryShowcase, toStored(json.data));
  for (const it of doc.categoryShowcase.items) {
    assert.deepEqual(Object.keys(it).sort(), ['displayOrder', 'focus', 'image', 'isActive', 'isFeatured', 'key']);
  }
  /* The response is what any reader of the doc now sees. */
  assert.deepEqual(json.data, normalizeShowcase(doc));
  assert.equal(byKey(json.data).earrings.isActive, false);
  assert.equal(byKey(json.data).earrings.label, 'Earrings');
  assert.deepEqual(visibleItems(json.data).map((it) => it.key), KEYS.filter((k) => k !== 'earrings'));
  const g = await getShowcase();
  assert.deepEqual(g.json.data, json.data, 'GET agrees');
});

test('PATCH: the first save migrates the legacy photos and layout into the stored showcase', async () => {
  signInAs(OWNER);
  const { json } = await patch({ items: [{ key: 'rentals', isFeatured: true }] });
  const stored = site().categoryShowcase;
  const it = Object.fromEntries(stored.items.map((x) => [x.key, x]));
  assert.equal(it.necklace.image, CLD('necklace'));
  assert.equal(it.set.image, CLD('set'));
  assert.equal(it.earrings.image, '');
  assert.equal(it.rentals.isFeatured, true);
  assert.deepEqual(stored.layout, { layoutVariant: 'king_size', displayMode: 'grid', size: 'medium' });
  assert.deepEqual(json.data.layout, stored.layout);

  /* From now on the stored showcase is the source of truth: a later legacy
     edit (the old settings field) no longer changes the homepage. */
  db.store.get('settings').get('site').categoryImages = { necklace: CLD('changed-later'), earrings: CLD('earrings') };
  const g = await getShowcase();
  assert.equal(byKey(g.json.data).necklace.image, CLD('necklace'));
  assert.equal(byKey(g.json.data).earrings.image, '');
});

test('PATCH: sequential changes to different fields all survive', async () => {
  signInAs(OWNER);
  const order = ['set', 'necklace', 'rentals', 'earrings', 'bangles', 'maang-tikka'];
  const steps = [
    { items: [{ key: 'earrings', isActive: false }] },
    { items: [{ key: 'set', isFeatured: true }] },
    { layout: { layoutVariant: 'circle' } },
    { layout: { displayMode: 'slider' } },
    { order },
    { items: [{ key: 'necklace', focus: { gravity: 'custom', x: 30 } }] },
    { items: [{ key: 'necklace', focus: { y: 70, zoom: 1.5 } }] },
    { items: [{ key: 'bangles', image: CLD('bangles') }] },
    { items: [{ key: 'set', image: '' }] },
  ];
  let last;
  for (const body of steps) {
    const r = await patch(body);
    assert.equal(r.status, 200, JSON.stringify(body));
    last = r.json.data;
  }
  const s = normalizeShowcase(site());
  assert.deepEqual(s, last);
  assert.deepEqual(s.layout, { layoutVariant: 'circle', displayMode: 'slider', size: 'medium' });
  assert.deepEqual(keysOf(s), order);
  const it = byKey(s);
  assert.equal(it.earrings.isActive, false);
  assert.equal(it.set.isFeatured, true);
  assert.equal(it.set.image, '', 'removed on purpose; the legacy photo does not come back');
  assert.equal(it.bangles.image, CLD('bangles'));
  assert.equal(it.necklace.image, CLD('necklace'));
  assert.deepEqual(it.necklace.focus, { gravity: 'custom', x: 30, y: 70, zoom: 1.5 });
  assert.deepEqual(it.rentals.focus, { ...DEFAULT_FOCUS });
  assert.deepEqual(site().heroSlides, HERO);
  assert.equal(site().phone, LEGACY.phone);
});

test('PATCH: invalid JSON or an invalid change → 400 with a message, nothing written', async () => {
  signInAs(OWNER);
  const before = structuredClone(site());
  const bad = [
    { raw: 'not json' },
    { raw: '' },
    { raw: 'null' },
    { body: {} },
    { body: { items: [] } },
    { body: [{ key: 'set', isActive: false }] },
    { body: { foo: 1 } },
    { body: { categoryShowcase: { items: [] } } },
    { body: { phone: '0000' } },
    { body: { layout: { layoutVariant: 'hexagon' } } },
    { body: { items: [{ key: 'ring', isActive: false }] } },
    { body: { items: [{ key: 'set', href: 'https://evil.test' }] } },
    { body: { items: [{ key: 'set', label: 'Hacked' }] } },
    { body: { items: [{ key: 'set', image: 'javascript:alert(1)' }] } },
    { body: { items: [{ key: 'set', image: 'http://res.cloudinary.com/x/image/upload/a.jpg' }] } },
    { body: { items: [{ key: 'set', focus: { zoom: 9 } }] } },
    { body: { items: [{ key: 'set', focus: { x: 101 } }] } },
    { body: { items: [{ key: 'set', focus: { gravity: 'g_face' } }] } },
    { body: { order: KEYS.slice(1) } },
    { body: { order: ['set', 'set', 'necklace', 'earrings', 'bangles', 'rentals'] } },
  ];
  for (const opts of bad) {
    const { status, json } = await patch(undefined, opts);
    assert.equal(status, 400, JSON.stringify(opts));
    assert.equal(json.success, false);
    assert.equal(typeof json.message, 'string');
    assert.ok(json.message.length > 0, `message for ${JSON.stringify(opts)}`);
    assert.ok(!('data' in json));
  }
  assert.equal((await patch({})).json.message, 'nothing to change');
  assert.deepEqual(site(), before, 'nothing written');
});

test('PATCH: no settings doc yet → created with just the showcase', async () => {
  db.store.get('settings').delete('site');
  signInAs(OWNER);
  const { status, json } = await patch({ items: [{ key: 'necklace', image: CLD('first') }] });
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(site()).sort(), ['categoryShowcase', 'updatedAt']);
  assert.equal(byKey(json.data).necklace.image, CLD('first'));
  assert.deepEqual(json.data.layout, { ...DEFAULT_LAYOUT });
});

test('PATCH: a junk stored showcase is repaired on the next save (only known cards, valid values)', async () => {
  db.store.get('settings').get('site').categoryShowcase = {
    version: 1,
    layout: { layoutVariant: 'hexagon', displayMode: 'slider', size: 'xl' },
    items: [
      { key: 'ring', isActive: false },
      { key: 'set', isActive: false, label: 'Hacked', href: 'https://evil.test', image: 'javascript:alert(1)', focus: { x: 900 } },
    ],
  };
  signInAs(OWNER);
  const { status } = await patch({ items: [{ key: 'rentals', isActive: false }] });
  assert.equal(status, 200);
  const stored = site().categoryShowcase;
  assert.deepEqual(stored.layout, { layoutVariant: 'king_size', displayMode: 'slider', size: 'large' });
  assert.deepEqual(stored.items.map((x) => x.key).sort(), [...KEYS].sort());
  const set = stored.items.find((x) => x.key === 'set');
  assert.deepEqual(set, { key: 'set', isActive: false, displayOrder: set.displayOrder, isFeatured: false, image: '', focus: { gravity: 'auto', x: 100, y: 50, zoom: 1 } });
  assert.ok(!JSON.stringify(stored).includes('evil.test'));
});

test('PATCH: a database failure → 500, and nothing is half-written', async () => {
  signInAs(OWNER);
  const before = structuredClone(site());
  const real = db;
  db = { ...real, collection: real.collection, runTransaction: async () => { throw new Error('ABORTED: contention'); } };
  const { status, json } = await quietly(() => patch({ items: [{ key: 'set', isActive: false }] }));
  assert.equal(status, 500);
  assert.equal(json.success, false);
  assert.doesNotMatch(json.message, /contention/);
  db = real;
  assert.deepEqual(site(), before);
});

/* ── POST /api/admin/settings (full-page Save) ── */

test('settings POST as owner: categoryShowcase in the body is ignored, the other fields still save', async () => {
  signInAs(OWNER);
  await patch({ items: [{ key: 'earrings', isActive: false }, { key: 'set', isFeatured: true }], layout: { layoutVariant: 'circle' } });
  const showcaseBefore = structuredClone(site().categoryShowcase);

  /* A settings page loaded before those toggles sends its stale copy back. */
  const stale = toStored(normalizeShowcase({}));
  const res = await call(settingsRoute, 'POST', { body: { phone: '+91 90000 00000', email: 'hello@tulsi.test', categoryShowcase: stale } });
  assert.equal(res.status, 200);
  assert.equal(res.json.success, true);
  assert.deepEqual(site().categoryShowcase, showcaseBefore, 'showcase untouched');
  assert.equal(site().phone, '+91 90000 00000');
  assert.equal(site().email, 'hello@tulsi.test');
  assert.deepEqual(site().heroSlides, HERO, 'merge: fields not sent are kept');

  const g = await getShowcase();
  assert.equal(byKey(g.json.data).earrings.isActive, false);
  assert.equal(byKey(g.json.data).set.isFeatured, true);
  assert.equal(g.json.data.layout.layoutVariant, 'circle');
});

test('settings POST: cannot create a showcase either, and an emptied/nulled one is ignored too', async () => {
  signInAs(OWNER);
  for (const categoryShowcase of [{ layout: { layoutVariant: 'wide' }, items: [] }, null, '']) {
    const res = await call(settingsRoute, 'POST', { body: { whatsapp: '917000000000', categoryShowcase } });
    assert.equal(res.status, 200);
    assert.ok(!('categoryShowcase' in site()), JSON.stringify(categoryShowcase));
  }
  assert.equal(site().whatsapp, '917000000000');
  assert.deepEqual((await getShowcase()).json.data, normalizeShowcase(LEGACY), 'legacy-derived showcase unchanged');
});

test('settings POST: still SUPER_ADMIN only, and still refuses credentials', async () => {
  signInAs('biz@tulsi.test');
  const denied = await call(settingsRoute, 'POST', { body: { phone: '1' } });
  assert.equal(denied.status, 403);
  assert.equal(site().phone, LEGACY.phone);
  signInAs(OWNER);
  const secret = await call(settingsRoute, 'POST', { body: { razorpaySecret: 'x', categoryShowcase: {} } });
  assert.equal(secret.status, 400);
  assert.ok(!('razorpaySecret' in site()));
});

/* ── What the storefront reads ── */

test('public settings GET → normalizeShowcase gives the same showcase the admin saved; hidden cards are not visible', async () => {
  signInAs(OWNER);
  const order = ['rentals', 'set', 'necklace', 'earrings', 'bangles', 'maang-tikka'];
  await patch({ order, items: [{ key: 'bangles', isActive: false }, { key: 'maang-tikka', isActive: false }, { key: 'set', isFeatured: true }], layout: { layoutVariant: 'square', displayMode: 'slider' } });
  const adminView = (await getShowcase()).json.data;

  signInAs(null);
  const pub = await call(settingsRoute, 'GET');
  assert.equal(pub.status, 200);
  const showcase = normalizeShowcase(pub.json.data);
  assert.deepEqual(showcase, adminView);
  assert.deepEqual(visibleItems(showcase).map((it) => it.key), ['rentals', 'set', 'necklace', 'earrings']);
  assert.deepEqual(showcase.layout, { layoutVariant: 'square', displayMode: 'slider', size: 'medium' });
  assert.equal(byKey(showcase).set.isFeatured, true);
});
