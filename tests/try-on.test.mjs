/* ─────────────────────────────────────────────
   Virtual try-on: placement and cutout rules, and the model-portrait
   APIs (session, Firestore, Cloudinary and Replicate are fakes).
   ───────────────────────────────────────────── */
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeFirestore } from './helpers/fakeFirestore.mjs';
import {
  tryOnKind, parseAnchors, anchorsFromLandmarks, placeJewellery, isPairShot, clampAdjust,
  knockOutBackground, trimBounds, hasTransparentCorners, portraitPrompt, SKIN_TONES, isolateJewellery,
} from '../src/lib/tryOn.js';

process.env.ADMIN_EMAILS = 'owner@tulsi.test';
delete process.env.NEXT_PUBLIC_ADMIN_BYPASS;

const src = (p) => pathToFileURL(path.resolve('src', p)).href;
let db;
let session = null;
const uploads = [];
let replicateCalls = 0;

mock.module('next-auth', { defaultExport: { getServerSession: async () => session }, namedExports: { getServerSession: async () => session } });
mock.module(src('app/api/auth/[...nextauth]/route.js'), { namedExports: { authOptions: {} } });
mock.module(src('lib/firebase.js'), {
  namedExports: {
    getDB: () => db, getBucket: () => null,
    FieldValue: { increment: (n) => n, serverTimestamp: () => new Date().toISOString() },
    Timestamp: class {}, docToObj: (d) => (d.exists ? { id: d.id, ...d.data() } : null),
    snapshotToArr: (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    toPublicProduct: (p) => p, paginate: async () => ({}), newId: () => 'x',
  },
});
mock.module(src('lib/cloudinary.js'), {
  namedExports: {
    uploadImage: async (url, folder) => { uploads.push([url, folder]); return { secure_url: `https://res.cloudinary.com/demo/image/upload/v1/${folder}/m${uploads.length}.png` }; },
    deleteImage: async () => {},
  },
  defaultExport: {},
});
globalThis.fetch = async (url, init) => {
  if (String(url).includes('api.replicate.com')) {
    replicateCalls += 1;
    assert.match(JSON.parse(init.body).input.prompt, /no jewellery/);
    return new Response(JSON.stringify({ status: 'succeeded', output: 'https://replicate.delivery/p/out.png' }), { status: 201 });
  }
  throw new Error(`unexpected fetch ${url}`);
};

const route = (p) => import(src(`app/api/${p}/route.js`));
const [pub, admin, gen] = await Promise.all([route('try-on/models'), route('admin/try-on-models'), route('admin/try-on-models/generate')]);

async function call(mod, method, body) {
  const req = new Request('http://tulsi.test/api/x', { method, headers: { 'content-type': 'application/json' }, ...(body && { body: JSON.stringify(body) }) });
  const res = await mod[method](req);
  return { status: res.status, json: await res.json() };
}

const ANCHORS = { earL: { x: 0.36, y: 0.34 }, earR: { x: 0.64, y: 0.34 }, chin: { x: 0.5, y: 0.5 }, faceW: 0.28, faceH: 0.3 };
const PORTRAIT = 'https://res.cloudinary.com/demo/image/upload/v1/tulsi-bridal/try-on-models/fair.png';

beforeEach(() => {
  session = null;
  uploads.length = 0;
  replicateCalls = 0;
  delete process.env.REPLICATE_API_TOKEN;
  db = fakeFirestore({ staff: { pm: { email: 'pm@tulsi.test', role: 'PRODUCT_MANAGER', status: 'Active' }, os: { email: 'os@tulsi.test', role: 'ORDER_MANAGER', status: 'Active' } } });
});

/* ── Rules ── */

test('kind comes from category or name; chokers get their own placement', () => {
  assert.equal(tryOnKind({ category: 'Earrings' }), 'earring');
  assert.equal(tryOnKind({ category: 'necklace', name: 'Kundan Choker' }), 'choker');
  assert.equal(tryOnKind({ category: 'Temple', name: 'Antique Haram' }), 'necklace');
  assert.equal(tryOnKind({ category: 'Bangles' }), null);
});

test('anchors: validated, ears ordered left→right, derived from Face Landmarker points', () => {
  assert.deepEqual(parseAnchors(ANCHORS), ANCHORS);
  assert.equal(parseAnchors({ ...ANCHORS, earL: { x: 1.4, y: 0.3 } }), null);
  assert.equal(parseAnchors({ ...ANCHORS, earL: ANCHORS.earR, earR: ANCHORS.earL }), null);
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  lm[234] = { x: 0.7, y: 0.4 }; lm[454] = { x: 0.3, y: 0.41 }; lm[152] = { x: 0.5, y: 0.6 }; lm[10] = { x: 0.5, y: 0.2 };
  const a = anchorsFromLandmarks(lm);
  assert.equal(a.earL.x, 0.3);
  assert.equal(a.earR.x, 0.7);
  assert.equal(a.faceH, 0.4);
});

test('earrings: a pair photo is split, one half per ear, hanging below each ear', () => {
  assert.ok(isPairShot(400, 300));
  assert.ok(!isPairShot(150, 400));
  const [l, r] = placeJewellery('earring', ANCHORS, { W: 1000, H: 1000 }, { w: 400, h: 300 });
  assert.equal(l.sx, 0);
  assert.equal(r.sx, 200);
  assert.equal(l.sw, 200);
  assert.ok(Math.abs(l.dx + l.dw / 2 - 360) < 0.001, 'centred on the left ear');
  assert.ok(l.dy > 340, 'hangs from the lobe');
  const bigger = placeJewellery('earring', ANCHORS, { W: 1000, H: 1000 }, { w: 400, h: 300 }, { scale: 1.5 })[0];
  assert.ok(bigger.dh > l.dh);
});

test('necklace sits lower and wider than a choker; adjustments are clamped', () => {
  const [n] = placeJewellery('necklace', ANCHORS, { W: 1000, H: 1000 }, { w: 600, h: 400 });
  const [c] = placeJewellery('choker', ANCHORS, { W: 1000, H: 1000 }, { w: 600, h: 400 });
  assert.ok(n.dy > c.dy && n.dw > c.dw);
  assert.ok(Math.abs(n.dx + n.dw / 2 - 500) < 0.001, 'centred on the chin');
  assert.deepEqual(clampAdjust({ scale: 9, offset: -9 }), { scale: 1.8, offset: -0.3 });
});

test('cutouts: a plain studio background is removed, the piece kept, and padding trimmed', () => {
  const w = 20; const h = 20;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p += 1) data.set([250, 250, 248, 255], p * 4);
  for (let y = 6; y < 14; y += 1) for (let x = 5; x < 12; x += 1) data.set([200, 150, 40, 255], (y * w + x) * 4); // gold piece
  assert.ok(!hasTransparentCorners(data, w, h));
  knockOutBackground(data, w, h);
  assert.equal(data[3], 0, 'background cleared');
  assert.equal(data[(8 * w + 8) * 4 + 3], 255, 'jewellery untouched');
  assert.ok(hasTransparentCorners(data, w, h));
  assert.deepEqual(trimBounds(data, w, h), { x: 5, y: 6, w: 7, h: 8 });
});

/* A 120×120 photo: studio white, a pale pink round card, and a faint
   1-px silver chain (a V) with a small pendant — like a real listing photo. */
function chainOnCard({ transparentOutside = false } = {}) {
  const w = 120; const h = 120;
  const data = new Uint8ClampedArray(w * h * 4);
  const noise = (x, y) => ((x * 7 + y * 13) % 5) - 2; // paper texture
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const inCard = (x - 60) ** 2 + (y - 60) ** 2 <= 52 ** 2;
      if (inCard) data.set([236 + noise(x, y), 226 + noise(x, y), 230 + noise(x, y), 255], i);
      else data.set(transparentOutside ? [0, 0, 0, 0] : [255, 255, 255, 255], i);
    }
  }
  const chain = [];
  for (let y = 20; y <= 80; y += 1) {
    const dx = Math.round((y - 20) * 0.35);
    chain.push([45 + dx, y], [75 - dx, y]);
  }
  for (const [x, y] of chain) data.set([205, 200, 206, 255], (y * w + x) * 4);
  for (let y = 80; y < 88; y += 1) for (let x = 57; x < 64; x += 1) data.set([190, 190, 200, 255], (y * w + x) * 4);
  return { data, w, h, chain };
}
const alphaAt = (d, w, x, y) => d[(y * w + x) * 4 + 3];

test('cutout: a pale chain on a coloured card keeps the chain and drops the card and its outline', () => {
  for (const transparentOutside of [false, true]) {
    const { data, w, h, chain } = chainOnCard({ transparentOutside });
    isolateJewellery(data, w, h);
    const kept = chain.filter(([x, y]) => alphaAt(data, w, x, y) > 128).length;
    assert.ok(kept / chain.length > 0.9, `chain kept (${kept}/${chain.length}), transparentOutside=${transparentOutside}`);
    assert.equal(alphaAt(data, w, 60, 100), 0, 'card cleared');
    assert.equal(alphaAt(data, w, 60, 8), 0, 'card outline cleared');
    assert.equal(alphaAt(data, w, 60, 84), 255, 'pendant kept');
    const box = trimBounds(data, w, h);
    assert.ok(box.w < 45 && box.h < 75, `cropped to the chain, got ${JSON.stringify(box)}`);
  }
});

test('cutout: a flat matte piece on transparent is never mistaken for a backdrop', () => {
  const w = 60; const h = 60;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 10; y < 50; y += 1) for (let x = 10; x < 50; x += 1) data.set([201, 160, 72, 255], (y * w + x) * 4);
  const before = data.slice();
  assert.equal(isolateJewellery(data, w, h).changed, false);
  assert.deepEqual(data, before);
});

test('portrait prompts: one per tone, always without jewellery', () => {
  for (const t of SKIN_TONES) assert.match(portraitPrompt(t.id), /no jewellery/);
  assert.equal(portraitPrompt('purple'), null);
});

/* ── APIs ── */

test('storefront only gets tones with a portrait and valid anchors, in swatch order', async () => {
  db.store.set('settings', new Map([['tryon_models', { tones: {
    dusky: { portrait: PORTRAIT, anchors: ANCHORS }, fair: { portrait: PORTRAIT, anchors: ANCHORS }, bronze: { portrait: PORTRAIT, anchors: { bad: 1 } },
  } }]]));
  const r = await call(pub, 'GET');
  assert.deepEqual(r.json.data.map((t) => t.id), ['fair', 'dusky']);
});

test('only catalogue staff can set portraits; foreign URLs and bad anchors are refused', async () => {
  assert.equal((await call(admin, 'PUT', { tone: 'fair', portrait: PORTRAIT, anchors: ANCHORS })).status, 401);
  session = { user: { email: 'os@tulsi.test' } };
  assert.equal((await call(admin, 'PUT', { tone: 'fair', portrait: PORTRAIT, anchors: ANCHORS })).status, 403);
  session = { user: { email: 'pm@tulsi.test' } };
  assert.equal((await call(admin, 'PUT', { tone: 'fair', portrait: 'https://evil.test/a.png', anchors: ANCHORS })).status, 400);
  assert.equal((await call(admin, 'PUT', { tone: 'fair', portrait: PORTRAIT, anchors: {} })).status, 400);
  assert.equal((await call(admin, 'PUT', { tone: 'fair', portrait: PORTRAIT, anchors: ANCHORS })).status, 200);
  assert.equal((await call(pub, 'GET')).json.data.length, 1);
  assert.equal((await call(admin, 'PUT', { tone: 'fair', remove: true })).status, 200);
  assert.equal((await call(pub, 'GET')).json.data.length, 0);
});

test('AI portrait generation: needs the token, stores in Cloudinary, and is cached per prompt', async () => {
  session = { user: { email: 'pm@tulsi.test' } };
  assert.equal((await call(gen, 'POST', { tone: 'fair' })).status, 503);
  process.env.REPLICATE_API_TOKEN = 'r8_test';
  const first = await call(gen, 'POST', { tone: 'fair' });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.data.cached, false);
  assert.deepEqual(uploads[0], ['https://replicate.delivery/p/out.png', 'tulsi-bridal/try-on-models']);
  const again = await call(gen, 'POST', { tone: 'fair' });
  assert.equal(again.json.data.cached, true);
  assert.equal(again.json.data.url, first.json.data.url);
  assert.equal(replicateCalls, 1, 'no second API cost');
  await call(gen, 'POST', { tone: 'fair', force: true });
  assert.equal(replicateCalls, 2);
});
