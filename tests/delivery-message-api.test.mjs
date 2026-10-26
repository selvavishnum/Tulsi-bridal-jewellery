/* ─────────────────────────────────────────────
   The delivery message through the REAL settings route handlers:
     POST /api/admin/settings   (the page's Save: only validated fields are stored)
     GET  /api/admin/settings   (public: what the storefront reads)

   Only the edges are swapped out (as in category-showcase-api.test.mjs): the
   NextAuth session, the nextauth route's authOptions, and Firestore (in-memory
   fake). requireAdmin → requireRole is the production code path.

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

const settingsRoute = await import(src('app/api/admin/settings/route.js'));
const { DEFAULT_DELIVERY_MESSAGE, normalizeDeliveryMessage, pickDeliveryMessage, deliveryMessageFor } = await import(src('lib/deliveryMessage.js'));

const OWNER = 'owner@tulsi.test';
const clone = (v) => JSON.parse(JSON.stringify(v));

beforeEach(() => {
  session = null;
  db = fakeFirestore({
    staff: { biz: { email: 'biz@tulsi.test', role: 'BUSINESS_MANAGER', status: 'Active', roleGrantedBy: OWNER } },
    settings: { site: { phone: '+91 76958 68787', heroSlides: [{ id: '1', imageUrl: 'https://res.cloudinary.com/tulsi/image/upload/v1/hero.jpg' }] } },
  });
});

const site = () => db.store.get('settings')?.get('site');
async function post({ body, raw } = {}) {
  const request = new Request('http://tulsi.test/api/admin/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw !== undefined ? raw : JSON.stringify(body),
  });
  const res = await settingsRoute.POST(request);
  return { status: res.status, json: await res.json() };
}
const publicGet = async () => {
  const res = await settingsRoute.GET();
  return { status: res.status, json: await res.json() };
};

const VALID = {
  enabled: true,
  mode: 'always',
  barText: 'Free delivery above ₹999',
  badgeText: 'Free shipping over ₹999',
  icon: '🎁',
  style: {
    font: 'classic', weight: 'semibold', size: 'lg', tracking: 'wide', italic: true, uppercase: true,
    model: 'pill', tone: 'custom', colors: { text: '#ffffff', bg: '#8b1a4a' },
  },
};

test('a valid configuration is stored exactly as sent, alongside the other fields', async () => {
  signInAs(OWNER);
  const res = await post({ body: { phone: '+91 90000 00000', deliveryMessage: VALID } });
  assert.equal(res.status, 200);
  assert.equal(res.json.success, true);
  assert.deepEqual(site().deliveryMessage, VALID);
  assert.equal(site().phone, '+91 90000 00000');
  assert.deepEqual(site().heroSlides.length, 1, 'merge: the other fields are kept');
});

test('what is stored is always the full, normalized configuration: partial input is completed, junk is dropped', async () => {
  signInAs(OWNER);
  const sent = { enabled: false, barText: '  Free   shipping  ', icon: 'NOPE', style: { model: 'outline', weight: 'heavy' }, junk: { x: 1 }, constructor: 'x' };
  assert.equal((await post({ body: { deliveryMessage: sent } })).status, 200);
  const stored = site().deliveryMessage;
  assert.deepEqual(stored, normalizeDeliveryMessage(sent));
  assert.equal(stored.enabled, false);
  assert.equal(stored.barText, 'Free shipping');
  assert.equal(stored.icon, '🚚');
  assert.equal(stored.style.model, 'outline');
  assert.equal(stored.style.weight, 'normal');
  assert.ok(!('junk' in stored));
  assert.deepEqual(Object.keys(stored), Object.keys(DEFAULT_DELIVERY_MESSAGE));
  assert.deepEqual(Object.keys(stored.style), Object.keys(DEFAULT_DELIVERY_MESSAGE.style));
});

test('texts are stored without markup and at most 60 characters; empty becomes the default words', async () => {
  signInAs(OWNER);
  await post({ body: { deliveryMessage: { barText: '<script>alert(1)</script> Free', badgeText: `${'a'.repeat(100)}` } } });
  assert.equal(site().deliveryMessage.barText, 'scriptalert(1)/script Free');
  assert.equal(site().deliveryMessage.badgeText, 'a'.repeat(60));
  await post({ body: { deliveryMessage: { barText: '   ', badgeText: '<<>>' } } });
  assert.equal(site().deliveryMessage.barText, 'Free Delivery across India');
  assert.equal(site().deliveryMessage.badgeText, 'Free Nationwide Shipping');
});

test('colours are stored as lower-case #rrggbb only; anything that is not goes back to the default colour', async () => {
  signInAs(OWNER);
  await post({ body: { deliveryMessage: { style: { tone: 'custom', model: 'solid', colors: { text: '#FFFFFF', bg: '#8B1A4A' } } } } });
  assert.deepEqual(site().deliveryMessage.style.colors, { text: '#ffffff', bg: '#8b1a4a' });
  await post({ body: { deliveryMessage: { style: { tone: 'custom', model: 'solid', colors: { text: 'red;background:url(//evil/x)', bg: '"><script>alert(1)</script>' } } } } });
  assert.deepEqual(site().deliveryMessage.style.colors, DEFAULT_DELIVERY_MESSAGE.style.colors);
  assert.ok(!JSON.stringify(site().deliveryMessage).match(/evil|script|url\(/));
});

test('a custom tone whose colours cannot be read (under 3:1) is stored as "auto"; the colours themselves are kept', async () => {
  signInAs(OWNER);
  await post({ body: { deliveryMessage: { style: { tone: 'custom', model: 'pill', colors: { text: '#ffffff', bg: '#fefefe' } } } } });
  assert.equal(site().deliveryMessage.style.tone, 'auto');
  assert.deepEqual(site().deliveryMessage.style.colors, { text: '#ffffff', bg: '#fefefe' });
  await post({ body: { deliveryMessage: { style: { tone: 'custom', model: 'pill', colors: { text: '#ffffff', bg: '#8b1a4a' } } } } });
  assert.equal(site().deliveryMessage.style.tone, 'custom');
});

test('a body that is not a plain object for deliveryMessage is stored as the defaults, never as sent', async () => {
  signInAs(OWNER);
  for (const bad of [null, '', 'x', '<script>', 7, true, false, [], [{ enabled: false }], ['x']]) {
    await post({ body: { deliveryMessage: VALID } });
    assert.deepEqual(site().deliveryMessage, VALID);
    const res = await post({ body: { deliveryMessage: bad } });
    assert.equal(res.status, 200, JSON.stringify(bad));
    assert.deepEqual(site().deliveryMessage, DEFAULT_DELIVERY_MESSAGE, JSON.stringify(bad));
  }
});

test('a full-page Save from a page that has no delivery message leaves the stored one alone', async () => {
  signInAs(OWNER);
  await post({ body: { deliveryMessage: VALID } });
  const res = await post({ body: { whatsapp: '917000000000' } });
  assert.equal(res.status, 200);
  assert.deepEqual(site().deliveryMessage, VALID);
  assert.equal(site().whatsapp, '917000000000');
});

test('a later save replaces the whole message (no stale field survives the merge)', async () => {
  signInAs(OWNER);
  await post({ body: { deliveryMessage: VALID } });
  await post({ body: { deliveryMessage: { enabled: false } } });
  assert.deepEqual(site().deliveryMessage, normalizeDeliveryMessage({ enabled: false }));
  assert.equal(site().deliveryMessage.style.model, 'text');
  assert.equal(site().deliveryMessage.barText, 'Free Delivery across India');
});

test('prototype-pollution-shaped JSON stores nothing it should not, and pollutes nothing', async () => {
  signInAs(OWNER);
  const raw = '{"deliveryMessage":{"__proto__":{"enabled":false,"polluted":true},"constructor":{"prototype":{"polluted":true}},"mode":"always","style":{"__proto__":{"model":"solid"},"model":"outline","colors":{"__proto__":{"text":"#000000"},"text":"#112233"}}}}';
  const res = await post({ raw });
  assert.equal(res.status, 200);
  const stored = site().deliveryMessage;
  assert.equal(stored.enabled, true, 'an inherited value is never read');
  assert.equal(stored.mode, 'always');
  assert.equal(stored.style.model, 'outline');
  assert.equal(stored.style.colors.text, '#112233');
  assert.ok(!JSON.stringify(stored).includes('polluted'));
  assert.equal({}.polluted, undefined);
  assert.deepEqual(Object.keys(stored), Object.keys(DEFAULT_DELIVERY_MESSAGE));
});

test('the stored message is plain JSON (it crosses the server → client boundary and Firestore)', async () => {
  signInAs(OWNER);
  await post({ body: { deliveryMessage: VALID } });
  assert.deepEqual(clone(site().deliveryMessage), site().deliveryMessage);
  assert.equal(Object.getPrototypeOf(site().deliveryMessage), Object.prototype);
});

test('only a SUPER_ADMIN can change it, and credentials are still refused', async () => {
  signInAs(null);
  assert.equal((await post({ body: { deliveryMessage: VALID } })).status, 403);
  signInAs('shopper@x.test');
  assert.equal((await post({ body: { deliveryMessage: VALID } })).status, 403);
  signInAs('biz@tulsi.test');
  assert.equal((await post({ body: { deliveryMessage: VALID } })).status, 403);
  assert.ok(!('deliveryMessage' in site()), 'nothing stored by anyone else');
  signInAs(OWNER);
  const secret = await post({ body: { razorpaySecret: 'x', deliveryMessage: VALID } });
  assert.equal(secret.status, 400);
  assert.ok(!('deliveryMessage' in site()), 'a refused save stores nothing');
  assert.ok(!('razorpaySecret' in site()));
});

test('the invalid-JSON and no-body cases still answer an error (no behaviour change)', async () => {
  signInAs(OWNER);
  const bad = await post({ raw: '{not json' });
  assert.equal(bad.status, 500);
  assert.equal(bad.json.success, false);
  const empty = await post({ body: {} });
  assert.equal(empty.status, 200);
  assert.ok(!('deliveryMessage' in site()));
});

test('public GET → what the storefront reads is what the owner saved: the same words, shown only while shipping really is free', async () => {
  signInAs(OWNER);
  await post({ body: { deliveryMessage: { barText: 'Free shipping, always', badgeText: '100% free delivery', style: { model: 'underline' } } } });
  signInAs(null);
  const pub = await publicGet();
  assert.equal(pub.status, 200);
  const config = pickDeliveryMessage(pub.json.data);
  assert.deepEqual(config, site().deliveryMessage, 'what is stored is already normalized, so reading it back changes nothing');
  assert.equal(config.style.model, 'underline');
  const free = { enable_shipping_fee: false };
  assert.equal(deliveryMessageFor(config, free, 'bar'), 'Free shipping, always');
  assert.equal(deliveryMessageFor(config, free, 'badge'), '100% free delivery');
  assert.equal(deliveryMessageFor(config, undefined, 'bar'), '', 'Smart mode: nothing while the shop charges for delivery');
});
