/* ─────────────────────────────────────────────
   Homepage hero = the LCP element. It has to be in the first HTML (not
   discovered after JS + a settings fetch), preloaded from <head>, light on a
   phone, and the same before and after the browser's own settings refresh.

   The hero is one static, split-screen section: pill, headline, line, ONE
   button and three trust badges on the left, one 4:5 editorial photo (the
   first slide's, from Admin → Settings → Hero) on the right — on top, centred,
   on a phone. No slider, no timer, no particles, no rental button.

   - src/lib/heroSlides.js: which fields travel to the browser; "same hero"
     (nothing to re-render) vs "changed"; which photo; the shipping rule behind
     the first badge; which reviews can be shown
   - src/app/page.js: the server reads the slides and the shipping rule,
     survives Firestore being down, and never lets a failed rebuild replace the
     last good page
   - src/app/HomeClient.js: the hero rendered with the real React and the real
     CloudinaryPicture — what the browser receives in the first HTML
   - src/app/api/admin/settings/route.js: a save drops the cached homepage

   The two .js/.jsx pages can't be loaded by Node, so they are transpiled here
   with sucrase (already in node_modules via tailwindcss) and their imports
   wired by hand. If sucrase is ever missing those tests are skipped with that
   reason, never silently green.

   Run: npm test
   ───────────────────────────────────────────── */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { fakeFirestore } from './helpers/fakeFirestore.mjs';
import * as heroLib from '../src/lib/heroSlides.js';
import * as imageLib from '../src/lib/cloudinaryImage.js';
import * as showcaseLib from '../src/lib/categoryShowcase.js';
import * as catalogLib from '../src/lib/catalogImages.js';
import * as chargesLib from '../src/lib/storeCharges.js';
import * as chargesServerLib from '../src/lib/storeChargesServer.js';
import { absoluteUrl } from '../src/lib/seoSchema.js';

const { HERO_SLIDE_FIELDS, pickHeroSlides, sameHeroSlides, nextHeroSlides, heroPhotoUrl, isImageLink, pickShipping, currentShipping, shippingBadge, pickTestimonials } = heroLib;
const { DEFAULT_CHARGES, deliveryFreeForAll } = chargesLib;
const require = createRequire(import.meta.url);
const read = (rel) => readFileSync(path.resolve(rel), 'utf8');

const CLD = 'https://res.cloudinary.com/djolb5idc/image/upload/v1712345678/tulsi-bridal/hero';
const ONE = `${CLD}/hero-one.jpg`;
const TWO = `${CLD}/hero-two.jpg`;
/* A slide as an older admin saved it: the home page used to draw all of this. */
const slide = (over = {}) => ({
  id: '1', imageUrl: ONE, tag: 'New Bridal Collection', title: 'Temple Bride', subtitle: 'Jewellery Crafted for Brides',
  ctaText: 'Shop Collection', ctaLink: '/shop', cta2Text: 'Book Rental', cta2Link: '/rentals', ...over,
});
/* What the home page keeps of it. */
const photo = (over = {}) => ({ id: '1', imageUrl: ONE, ...over });
const FREE = { enable_shipping_fee: false, shipping_fee_amount: 99, free_shipping_threshold: 2000 };

/* ── src/lib/heroSlides.js ── */

test('pickHeroSlides: only what the hero reads (id and photo), all strings, junk dropped — the old slider fields stay out of the HTML', () => {
  assert.deepEqual([...HERO_SLIDE_FIELDS], ['id', 'imageUrl']);
  const picked = pickHeroSlides([
    { ...slide(), internalNote: 'do not ship', createdAt: { seconds: 1 }, bg: 'from-red-500' },
    null, 'oops', 7,
    { imageUrl: 42, id: 'x' },
  ]);
  assert.equal(picked.length, 2);
  assert.deepEqual(picked[0], photo());
  assert.deepEqual(Object.keys(picked[0]), HERO_SLIDE_FIELDS.slice(), 'a fixed key order, so two lists compare equal as text');
  assert.deepEqual(picked[1], { id: 'x', imageUrl: '' }, 'a non-string is "not set", not a crash later');
  for (const notAList of [undefined, null, 'x', {}, 3]) assert.deepEqual(pickHeroSlides(notAList), []);
  assert.deepEqual(JSON.parse(JSON.stringify(picked)), picked, 'survives the server → browser boundary');
  assert.doesNotMatch(JSON.stringify(picked), /Rental|rentals|Bridal|Bride/, 'a slide an admin saved long ago does not carry its rental button into the page');
});

test('sameHeroSlides: a change to a field the home page no longer draws does not count; the photo, the order and the length do', () => {
  const a = [slide(), slide({ id: '2', imageUrl: TWO })];
  assert.equal(sameHeroSlides(a, a.map((s) => ({ ...s, updatedBy: 'admin' }))), true);
  assert.equal(sameHeroSlides(a, [slide({ title: 'Other', cta2Text: '' }), a[1]]), true, 'an edited title is not a different hero');
  assert.equal(sameHeroSlides(a, [...a].reverse()), false, 'order');
  assert.equal(sameHeroSlides(a, a.slice(0, 1)), false, 'length');
  assert.equal(sameHeroSlides(a, [slide({ imageUrl: TWO }), a[1]]), false, 'photo');
  assert.equal(sameHeroSlides([], undefined), true);
});

test('nextHeroSlides: an equal refresh keeps the very same state, so React renders nothing and the photo is untouched', () => {
  const seeded = pickHeroSlides([slide(), slide({ id: '2', imageUrl: TWO })]);
  const fetched = [slide({ createdAt: 'x', title: 'Edited' }), slide({ id: '2', imageUrl: TWO })]; // same hero, other stored fields
  assert.equal(nextHeroSlides(seeded, fetched), seeded, 'identical reference → setState bails out');
  const none = [];
  assert.equal(nextHeroSlides(none, []), none, 'and for "no slides"');
});

test('nextHeroSlides: a changed list replaces the state (trimmed); a missing list changes nothing', () => {
  const seeded = pickHeroSlides([slide()]);
  const changed = nextHeroSlides(seeded, [slide({ imageUrl: TWO, internalNote: 'x' })]);
  assert.notEqual(changed, seeded);
  assert.deepEqual(changed, [photo({ imageUrl: TWO })]);
  assert.deepEqual(nextHeroSlides(seeded, []), [], 'the admin removed every slide');
  for (const noList of [undefined, null, 'x', {}]) assert.equal(nextHeroSlides(seeded, noList), seeded);
});

test('nextHeroSlides: the browser\'s stored copy never replaces slides the server already rendered', () => {
  const seeded = pickHeroSlides([slide({ imageUrl: ONE })]);
  const oldCopy = [slide({ imageUrl: TWO })];
  assert.equal(nextHeroSlides(seeded, oldCopy, { stale: true }), seeded, 'no flash of an older hero');
  assert.deepEqual(nextHeroSlides(seeded, oldCopy, { stale: false }), [photo({ imageUrl: TWO })], 'the fetch, which is fresh, still can');
});

test('isImageLink / heroPhotoUrl: the hero photo is the first slide with a link a browser can load — https or a path on this site', () => {
  for (const ok of [ONE, 'https://images.unsplash.com/photo-1?w=1600', '/images/hero.jpg', `  ${ONE}  `]) assert.equal(isImageLink(ok), true, ok);
  for (const bad of ['', '   ', 'abc', 'res.cloudinary.com/x.jpg', 'http://insecure.example/x.jpg', '//cdn.example/x.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA', undefined, null, 42, {}]) assert.equal(isImageLink(bad), false, String(bad));
  assert.equal(heroPhotoUrl([photo({ imageUrl: '' }), photo({ id: '2', imageUrl: 'abc' }), photo({ id: '3', imageUrl: TWO }), photo({ id: '4', imageUrl: ONE })]), TWO, 'the first usable one, not the first slide');
  assert.equal(heroPhotoUrl([photo({ imageUrl: `  ${ONE} ` })]), ONE, 'trimmed');
  for (const none of [[], [photo({ imageUrl: '' })], [photo({ imageUrl: 'abc' })], null, undefined, 'x']) assert.equal(heroPhotoUrl(none), '', 'no photo → the hero draws its illustration');
});

test('shippingBadge: "Free Nationwide Shipping" exactly when every order ships free (storeCharges.deliveryFreeForAll), otherwise no shipping claim at all', () => {
  assert.equal(shippingBadge(FREE), 'Free Nationwide Shipping');
  assert.equal(shippingBadge({ enable_shipping_fee: true, free_shipping_threshold: 2000 }), '', 'a "free above ₹N" condition is not advertised');
  assert.equal(shippingBadge({ enable_shipping_fee: true, free_shipping_threshold: 12500 }), '');
  assert.equal(shippingBadge({ enable_shipping_fee: true, free_shipping_threshold: 0, shipping_fee_amount: 99 }), '', 'a flat fee is not a claim either');
  assert.equal(shippingBadge(null), '', 'nothing configured = the defaults the checkout uses (a fee below ₹2,000): no claim');
  /* One rule, every surface: whatever the settings, the badge appears exactly when the checkout really charges no shipping. */
  for (const enable_shipping_fee of [true, false]) {
    for (const free_shipping_threshold of [0, 500, 2000, 12500]) {
      for (const shipping_fee_amount of [0, 49, 99]) {
        const c = { enable_shipping_fee, free_shipping_threshold, shipping_fee_amount };
        assert.equal(shippingBadge(c), deliveryFreeForAll(c) ? 'Free Nationwide Shipping' : '', JSON.stringify(c));
        assert.equal(deliveryFreeForAll(c), chargesLib.computeCharges({ subtotal: 1, paymentMethod: 'razorpay', charges: c }).shipping === 0, JSON.stringify(c));
      }
    }
  }
});

test('pickShipping / currentShipping: the server\'s rule is plain JSON; the live charges win as soon as the browser has them', () => {
  const stored = chargesLib.normalizeCharges({ enable_shipping_fee: false, updatedAt: { seconds: 5, toDate() {} }, cod_fee_amount: 49 });
  const picked = pickShipping(stored);
  assert.deepEqual(Object.keys(picked), ['enable_shipping_fee', 'shipping_fee_amount', 'free_shipping_threshold'], 'only the shipping rule, no Firestore timestamp');
  assert.deepEqual(JSON.parse(JSON.stringify(picked)), picked);
  assert.equal(picked.enable_shipping_fee, false);
  /* CartContext starts on DEFAULT_CHARGES itself, then swaps in the fetched object. */
  assert.equal(currentShipping(DEFAULT_CHARGES, picked), picked, 'not fetched yet → what the server rendered');
  const live = { ...DEFAULT_CHARGES, free_shipping_threshold: 3000 };
  assert.equal(currentShipping(live, picked), live, 'fetched → the live charges, even if the page was built before the admin changed them');
  assert.equal(currentShipping(DEFAULT_CHARGES, null), DEFAULT_CHARGES, 'the server could not read it → the defaults, as before');
  assert.equal(currentShipping(live, null), live);
  assert.match(read('src/context/CartContext.js'), /useState\(DEFAULT_CHARGES\)/, 'CartContext still starts on DEFAULT_CHARGES — currentShipping relies on it');
});

test('pickTestimonials: only reviews an admin actually wrote; nothing is invented', () => {
  assert.deepEqual(pickTestimonials(undefined), []);
  assert.deepEqual(pickTestimonials('x'), []);
  assert.deepEqual(pickTestimonials([null, 'x', {}, { name: 'No text' }, { name: 'Blank', review: '   ' }]), []);
  assert.deepEqual(pickTestimonials([
    { name: ' Asha ', location: 'Madurai', rating: 4, review: ' Light and pretty ', photo: ' https://x/y.jpg ', extra: 1 },
    { name: 'Old shape', text: 'Uses the text field' },
    { name: 'Odd rating', review: 'ok', rating: 9 },
    { name: 'Zero rating', review: 'ok', rating: 0 },
  ]), [
    { name: 'Asha', location: 'Madurai', rating: 4, review: 'Light and pretty', photo: 'https://x/y.jpg' },
    { name: 'Old shape', location: '', rating: 5, review: 'Uses the text field', photo: '' },
    { name: 'Odd rating', location: '', rating: 5, review: 'ok', photo: '' },
    { name: 'Zero rating', location: '', rating: 5, review: 'ok', photo: '' },
  ]);
});

/* ── Transpiling the pages ── */

let sucrase = null;
try { sucrase = require('sucrase'); } catch { /* skipped below */ }
const skip = sucrase ? false : 'sucrase is not installed, so page.js / HomeClient.js cannot be transpiled for node --test';
const React = require('react');
const ReactDOM = require('react-dom');
const { renderToString } = require('react-dom/server');

function loadJsx(rel, deps) {
  const file = path.resolve(rel);
  const { code } = sucrase.transform(readFileSync(file, 'utf8'), {
    transforms: ['jsx', 'imports'], jsxRuntime: 'automatic', production: true, filePath: file,
  });
  const all = { react: React, 'react/jsx-runtime': require('react/jsx-runtime'), ...deps };
  const req = (id) => {
    if (!Object.hasOwn(all, id)) throw new Error(`${rel} imports ${id}: add a stub for it in this test`);
    return all[id];
  };
  const mod = { exports: {} };
  vm.runInThisContext(`(function (exports, require, module) {${code}\n})`, { filename: file })(mod.exports, req, mod);
  return mod.exports;
}

/* ── src/app/page.js (the server side) ── */

let db;
let dbDown = null; // an Error → the Firestore read fails with it
const docToObj = (d) => (d.exists ? { id: d.id, ...d.data() } : null);
const HomeClientStub = function HomeClient() { return null; };
const page = sucrase ? loadJsx('src/app/page.js', {
  './HomeClient': { __esModule: true, default: HomeClientStub },
  '@/lib/seo': { absoluteUrl },
  '@/lib/firebase': {
    getDB: () => {
      if (dbDown) throw dbDown;
      return db;
    },
    docToObj,
  },
  '@/lib/heroSlides': heroLib,
  '@/lib/categoryShowcase': showcaseLib,
  '@/lib/storeChargesServer': chargesServerLib,
}) : null;

/* Run `fn` as Next would: during `next build`, in `next dev`, or on the server after the build. */
const ENVS = {
  build: { NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' },
  dev: { NODE_ENV: 'development', NEXT_PHASE: undefined },
  production: { NODE_ENV: 'production', NEXT_PHASE: undefined },
};
async function inEnv(name, fn) {
  const saved = { NODE_ENV: process.env.NODE_ENV, NEXT_PHASE: process.env.NEXT_PHASE };
  for (const [k, v] of Object.entries(ENVS[name])) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

beforeEach(() => {
  dbDown = null;
  db = fakeFirestore({ settings: { site: { phone: '+91 76958 68787' } } });
});

test('page.js: rebuilt in the background every 5 minutes, with its own canonical', { skip }, () => {
  assert.equal(page.revalidate, 300);
  assert.equal(page.metadata.alternates.canonical, absoluteUrl('/'));
  assert.equal(page.metadata.openGraph.url, absoluteUrl('/'));
});

test('page.js: passes the configured hero photo to HomeClient — only the fields the hero reads, nothing of the old slider', { skip }, async () => {
  db = fakeFirestore({ settings: { site: {
    phone: '+91 76958 68787',
    testimonials: [{ name: 'A', review: 'long text '.repeat(50) }],
    heroSlides: [{ ...slide(), internalNote: 'x' }, slide({ id: '2', imageUrl: TWO })],
  } } });
  const el = await page.default();
  assert.equal(el.type, HomeClientStub);
  assert.deepEqual(Object.keys(el.props), ['heroSlides', 'showcase', 'shipping'], 'no other setting is put into the page');
  assert.deepEqual(el.props.heroSlides, [photo(), photo({ id: '2', imageUrl: TWO })]);
  assert.deepEqual(JSON.parse(JSON.stringify(el.props)), el.props, 'plain JSON');
  assert.doesNotMatch(JSON.stringify(el.props.heroSlides), /Rental|rentals|Bridal|Bride/, 'no rental button in the page payload');
  assert.doesNotMatch(JSON.stringify(el.props), /long text/, 'no reviews either');
});

test('page.js: the shipping rule behind the hero badge is read on the server too, as plain data (so the badge is true at first paint)', { skip }, async () => {
  assert.deepEqual((await page.default()).props.shipping, pickShipping(DEFAULT_CHARGES), 'no store_settings document: the defaults the checkout uses');
  db = fakeFirestore({ settings: { site: { phone: '1' }, store_settings: { enable_shipping_fee: false, shipping_fee_amount: 120, updatedAt: { seconds: 9, nanoseconds: 0 } } } });
  const { shipping } = (await page.default()).props;
  assert.deepEqual(shipping, { enable_shipping_fee: false, shipping_fee_amount: 120, free_shipping_threshold: 2000 });
  assert.equal(shippingBadge(shipping), 'Free Nationwide Shipping');
  assert.deepEqual(JSON.parse(JSON.stringify(shipping)), shipping, 'no Firestore timestamp can reach a client component');
});

test('page.js: the category showcase is drawn on the server too, as plain data (so it cannot pop in and push the page down)', { skip }, async () => {
  db = fakeFirestore({ settings: { site: { phone: '1', categoryShowcase: { version: 1, layout: { layoutVariant: 'circle', displayMode: 'grid', size: 'small' }, items: [{ key: 'necklace', isActive: false }] } } } });
  const el = await page.default();
  assert.deepEqual(el.props.showcase, showcaseLib.normalizeShowcase(db.store.get('settings').get('site')));
  assert.equal(el.props.showcase.items.find((it) => it.key === 'necklace').isActive, false, 'a hidden category is not in the first HTML');
  assert.deepEqual(JSON.parse(JSON.stringify(el.props.showcase)), el.props.showcase, 'plain JSON');
  db = fakeFirestore({ settings: {} });
  assert.deepEqual((await page.default()).props.showcase, showcaseLib.normalizeShowcase({}), 'no settings document: the default showcase');
});

test('page.js: when the settings cannot be read, neither the slides, the showcase nor the shipping rule are guessed', { skip }, async () => {
  dbDown = new Error('Firestore is down');
  try {
    const el = await inEnv('dev', () => page.default());
    assert.equal(el.props.heroSlides, null);
    assert.equal(el.props.showcase, null);
    assert.equal(el.props.shipping, null);
  } finally { dbDown = null; }
});

test('nextShowcase: the same object when nothing changed, the new one when it did, never a guess', () => {
  const a = showcaseLib.normalizeShowcase({});
  assert.equal(heroLib.nextShowcase(a, showcaseLib.normalizeShowcase({})), a, 'equal → the very same reference (no re-render, no tile reload)');
  const changed = showcaseLib.normalizeShowcase({ categoryShowcase: { version: 1, layout: { layoutVariant: 'circle', displayMode: 'grid', size: 'small' } } });
  assert.equal(heroLib.nextShowcase(a, changed), changed);
  assert.equal(heroLib.nextShowcase(null, a), a, 'nothing seeded: take what arrives');
  assert.equal(heroLib.nextShowcase(a, null), a);
});

test('page.js: nothing configured is [] ("read, no slides"), which is not the same as null ("could not read")', { skip }, async () => {
  assert.deepEqual((await page.default()).props.heroSlides, [], 'settings without heroSlides');
  db = fakeFirestore({});
  assert.deepEqual((await page.default()).props.heroSlides, [], 'no settings document at all');
  db = fakeFirestore({ settings: { site: { heroSlides: 'not a list' } } });
  assert.deepEqual((await page.default()).props.heroSlides, []);
});

test('page.js: Firestore down while building (or in dev) still renders the page — the browser decides', { skip }, async () => {
  for (const env of ['build', 'dev']) {
    for (const failure of ['init', 'read', 'charges']) {
      if (failure === 'init') dbDown = new Error('FIREBASE_PROJECT_ID is missing');
      else {
        dbDown = null;
        const down = { get: async () => { throw new Error('UNAVAILABLE: no connection'); } };
        const ok = fakeFirestore({ settings: { site: { heroSlides: [slide()] } } });
        db = failure === 'read'
          ? { collection: () => ({ doc: () => down }) }
          : { collection: (name) => ({ doc: (id) => (id === 'store_settings' ? down : ok.collection(name).doc(id)) }) };
      }
      const el = await inEnv(env, () => page.default());
      assert.equal(el.type, HomeClientStub, `${env}/${failure}`);
      assert.equal(el.props.heroSlides, null, `${env}/${failure}: null = unknown, never a fake "no slides"`);
      assert.equal(el.props.shipping, null, `${env}/${failure}`);
    }
  }
});

test('page.js: a failed rebuild on the running server throws, so Next keeps the last good page', { skip }, async () => {
  /* Next re-sets the previous HTML and retries (within 30 s) when a background
     rebuild throws. A render that "succeeded" with no photo would replace the
     good page with the illustration for the next 5 minutes. */
  dbDown = new Error('FIREBASE_PROJECT_ID is missing');
  await assert.rejects(inEnv('production', () => page.default()), /FIREBASE_PROJECT_ID is missing/);
  dbDown = null;
  db = { collection: () => ({ doc: () => ({ get: async () => { throw new Error('UNAVAILABLE: no connection'); } }) }) };
  await assert.rejects(inEnv('production', () => page.default()), /UNAVAILABLE/);
  /* ...the shipping rule failing on its own counts too... */
  const ok = fakeFirestore({ settings: { site: { heroSlides: [slide()] } } });
  db = { collection: (name) => ({ doc: (id) => (id === 'store_settings' ? { get: async () => { throw new Error('UNAVAILABLE: charges'); } } : ok.collection(name).doc(id)) }) };
  await assert.rejects(inEnv('production', () => page.default()), /UNAVAILABLE: charges/);
  /* ...and a healthy read on the same server is fine. */
  db = fakeFirestore({ settings: { site: { heroSlides: [slide()] } } });
  assert.deepEqual((await inEnv('production', () => page.default())).props.heroSlides, [photo()]);
});

/* ── src/app/HomeClient.js (what the browser receives in the first HTML) ── */

const cached = new Map();
const icon = (name) => {
  if (!cached.has(name)) {
    const Icon = (props) => React.createElement('svg', { 'data-icon': name, ...props });
    Icon.displayName = name;
    cached.set(name, Icon);
  }
  return cached.get(name);
};
const Link = ({ href, children, prefetch: _prefetch, ...rest }) => React.createElement('a', { href, ...rest }, children);
const Nothing = () => null;

/* What useCart() answers: CartContext starts on DEFAULT_CHARGES, then swaps in the fetched charges. */
const cart = { charges: FREE };

/* A render that also records what the components do after it: every useState
   (its value and each later change) and every useEffect callback, so the
   settings effect of HomeClient — which only runs in a browser — can be run by
   hand against a stubbed cache and fetch. */
let recorded = { states: [], effects: [] };
const recordingReact = {
  ...React,
  useState: (initial) => {
    const entry = { initial: typeof initial === 'function' ? initial() : initial, history: [] };
    entry.value = entry.initial;
    recorded.states.push(entry);
    return [entry.value, (change) => {
      entry.value = typeof change === 'function' ? change(entry.value) : change;
      entry.history.push(entry.value);
    }];
  },
  useEffect: (fn, deps) => { recorded.effects.push({ fn, deps }); },
};
let storedSettings = null; // what the browser's localStorage copy holds
const cacheStub = { cacheGet: () => storedSettings, cacheSet: () => {} };

let CloudinaryPicture = null;
let HomeClient = null;
let HomeClientRecorded = null;
let HeroSection = null;
let HeroIllustration = null;
let CustomerReviews = null;
let HERO_PHOTO = null;
let HeroArtStateful = null;
/* A React whose state outlives a render, so "the image failed → draw the illustration" can be followed across two renders. */
const hooks = { slots: [], at: 0 };
const statefulReact = {
  ...React,
  useState: (initial) => {
    const k = hooks.at++;
    if (!(k in hooks.slots)) hooks.slots[k] = initial;
    return [hooks.slots[k], (value) => { hooks.slots[k] = typeof value === 'function' ? value(hooks.slots[k]) : value; }];
  },
  useCallback: (fn) => fn,
};
let pictureProps = null; // what HeroArt handed the picture on its last render
const PictureSpy = (props) => { pictureProps = props; return React.createElement('i', { 'data-picture': props.src }); };
if (sucrase) {
  CloudinaryPicture = loadJsx('src/components/ui/CloudinaryPicture.jsx', { 'react-dom': ReactDOM, '@/lib/cloudinaryImage': imageLib }).default;
  const homeDeps = {
    'next/link': { __esModule: true, default: Link },
    'next/image': { __esModule: true, default: (props) => React.createElement('img', { 'data-next-image': 'true', alt: props.alt }) },
    'react-icons/fi': new Proxy({}, { get: (_, name) => (typeof name === 'string' && name.startsWith('Fi') ? icon(name) : undefined) }),
    '@/context/CartContext': { useCart: () => ({ charges: cart.charges }) },
    '@/lib/clientCache': { cacheGet: () => null, cacheSet: () => {} },
    '@/components/shop/ProductCard': { __esModule: true, default: Nothing },
    '@/components/home/CategoryShowcase': { __esModule: true, default: ({ showcase }) => React.createElement('i', { 'data-showcase': showcase.items.length }) },
    '@/components/ui/CustomerAvatar': { __esModule: true, default: ({ name }) => React.createElement('b', { 'data-avatar': name }) },
    '@/components/ui/CloudinaryPicture': { __esModule: true, default: CloudinaryPicture },
    '@/components/ui/CatalogImage': { __esModule: true, default: Nothing },
    '@/lib/catalogImages': catalogLib,
    '@/lib/cloudinaryImage': imageLib,
    '@/lib/categoryShowcase': showcaseLib,
    '@/lib/heroSlides': heroLib,
  };
  const home = loadJsx('src/app/HomeClient.js', homeDeps);
  HomeClient = home.default;
  HeroSection = home.HeroSection;
  HeroIllustration = home.HeroIllustration;
  CustomerReviews = home.CustomerReviews;
  HERO_PHOTO = home.HERO_PHOTO;
  HomeClientRecorded = loadJsx('src/app/HomeClient.js', { ...homeDeps, react: recordingReact, '@/lib/clientCache': cacheStub }).default;
  HeroArtStateful = loadJsx('src/app/HomeClient.js', { ...homeDeps, react: statefulReact, '@/components/ui/CloudinaryPicture': { __esModule: true, default: PictureSpy } }).HeroArt;
}

/* Render, failing on any React warning (bad DOM props, missing keys …). */
function render(Component, props) {
  const warnings = [];
  const orig = console.error;
  console.error = (...a) => { warnings.push(a.map(String).join(' ')); };
  let html;
  try { html = renderToString(React.createElement(Component, props)); } finally { console.error = orig; }
  assert.deepEqual(warnings, [], 'React warned while rendering');
  return html;
}
const links = (html, rel) => [...html.matchAll(new RegExp(`<link rel="${rel}"[^>]*>`, 'g'))].map((m) => m[0]);
const sourcesOf = (html) => [...html.matchAll(/<source [^>]*>/g)].map((m) => m[0]);
const imgs = (html) => [...html.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
const attr = (tag, name) => tag.match(new RegExp(` ${name}="([^"]*)"`))?.[1];
const widthsIn = (srcset) => [...srcset.matchAll(/ (\d+)w(?:,|$)/g)].map((m) => Number(m[1]));
const textOf = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
/* The hero section and nothing else (it has no nested <section>). */
const heroOf = (html) => {
  const start = html.indexOf('<section aria-labelledby="hero-heading"');
  assert.ok(start >= 0, 'the hero section is in the first HTML');
  return html.slice(start, html.indexOf('</section>', start) + '</section>'.length);
};
const withCharges = (charges, fn) => { const saved = cart.charges; cart.charges = charges; try { return fn(); } finally { cart.charges = saved; } };

test('HomeClient: the hero is in the first HTML — one h1 with the brief\'s headline, the pill, the line, one CTA and the three trust badges', { skip }, () => {
  const html = render(HomeClient, { heroSlides: [photo()] });
  const hero = heroOf(html);

  assert.equal([...html.matchAll(/<h1\b/g)].length, 1, 'exactly one <h1> on the page');
  const h1 = hero.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/);
  assert.equal(textOf(h1[1]), 'You Are The Occasion. Wear Your Style.');
  assert.match(hero, /<section aria-labelledby="hero-heading"/);
  assert.match(h1[0], /^<h1 id="hero-heading"/);
  assert.match(h1[0], /\bfont-serif\b/, 'the luxury serif the site already loads (Cormorant) — no extra font file');

  assert.match(hero, /<span aria-hidden="true">✨<\/span> NEW CASUAL &amp; FESTIVE COLLECTION<\/p>/);
  assert.match(hero, />Trending chains, necklaces, and daily-wear fashion jewellery crafted to make your everyday look unforgettable\.<\/p>/);

  /* One primary button, nothing else to press in the hero. */
  assert.deepEqual([...hero.matchAll(/<a\b/g)].length, 1, 'a single link in the hero');
  assert.doesNotMatch(hero, /<button\b/);
  const cta = hero.match(/<a href="\/shop"([^>]*)>([\s\S]*?)<\/a>/);
  assert.ok(cta, 'the CTA goes to /shop');
  const ctaClass = attr(` ${cta[1]}`, 'class').split(/\s+/);
  for (const c of ['bg-[#4A1224]', 'text-white', 'hover:bg-gold-500', 'hover:text-stone-900', 'min-h-12', 'transition-colors', 'focus-visible:ring-2', 'rounded-full']) assert.ok(ctaClass.includes(c), c);
  assert.ok(!ctaClass.some((c) => /^bg-(gold|wine|stone)/.test(c)), 'the resting colour is the deep burgundy only');
  assert.equal(textOf(cta[2]), '⚡ Explore Collection');
  assert.match(cta[2], /<span aria-hidden="true">⚡<\/span> Explore Collection/);
  assert.match(cta[2], /<svg[^>]*data-icon="FiArrowRight"[^>]*aria-hidden="true"/, 'the arrow is decorative');

  /* The trust strip: three single-line, fixed-height items, icons hidden from a screen reader. */
  const items = [...hero.matchAll(/<li class="([^"]*)">([\s\S]*?)<\/li>/g)];
  assert.deepEqual(items.map((m) => textOf(m[2])), ['🚚 Free Nationwide Shipping', '💵 COD Available', '🛡️ 100% Anti-Tarnish Finish']);
  assert.ok(items.every((m) => /\bh-6\b/.test(m[1]) && /\bwhitespace-nowrap\b/.test(m[1])), 'one line, 24px tall — a wrapped label cannot change the height');
  assert.ok(items.every((m) => /<span aria-hidden="true"[^>]*>[^<]+<\/span>/.test(m[2])));
  assert.match(hero, /<ul role="list"/);
});

test('HomeClient: the hero is the brief\'s layout — warm off-white, 2 columns from 1024px, photo first on a phone, no viewport-height dependence', { skip }, () => {
  const hero = heroOf(render(HomeClient, { heroSlides: [photo()] }));
  const section = hero.match(/^<section [^>]*class="([^"]*)"/)[1].split(/\s+/);
  assert.ok(section.includes('bg-[#FAF8F5]'), 'warm off-white');
  assert.ok(section.some((c) => c.startsWith('bg-[radial-gradient(')), 'a very soft warm gradient, not an image file');
  assert.ok(section.includes('overflow-hidden'));
  const grid = hero.match(/<div class="(section-container grid[^"]*)"/)[1].split(/\s+/);
  for (const c of ['grid-cols-1', 'lg:grid-cols-2', 'lg:gap-12', 'items-center']) assert.ok(grid.includes(c), c);
  assert.match(hero, /<div class="order-first flex justify-center lg:order-last">/, 'photo above the words on a phone, right of them from 1024px (the DOM keeps the h1 first)');
  assert.ok(hero.indexOf('<h1') < hero.indexOf('<picture'), 'the h1 comes before the photo in the HTML (reading order), though a phone shows the photo first');
  assert.match(hero, /class="relative aspect-\[4\/5\] overflow-hidden/, 'the photo box reserves a fixed 4:5 area before any byte arrives');
  assert.match(hero, /lg:min-h-\[40rem\]/, 'a minimum height in rem — not in viewport units');
  /* The one viewport-height use: a phone's photo box shrinks on a short screen (svh = bars showing, so it never changes as they hide),
     only where svh exists, over a plain-rem width everywhere else. */
  const svhClasses = hero.match(/[^\s"]*100svh[^\s"]*/g);
  assert.equal(svhClasses.length, 2, 'the two phone widths (md and lg switch it back off)');
  assert.match(hero, /md:supports-\[height:1svh\]:w-\[min\(100%,24rem\)\]/);
  assert.match(hero, /lg:supports-\[height:1svh\]:w-full/);
  assert.ok(svhClasses.every((c) => /(^|:)supports-\[height:1svh\]:w-\[min\(100%,(18|20)rem,max\(14rem,calc\(\(100svh-33rem\)\*0\.8\)\)\)\]$/.test(c)), svhClasses.join(' '));
  assert.doesNotMatch(hero.replace(/[^\s"]*svh[^\s"]*/g, ''), /\d(?:vh|dvh|svh)\b|h-screen|min-h-screen|hero-viewport/, 'nothing else sizes the hero by the viewport height');
  const source = read('src/app/HomeClient.js');
  const heroSource = source.slice(source.indexOf('export function HeroSection'), source.indexOf('const BROWSE_CATS'));
  assert.doesNotMatch(heroSource, /dvh|\b\d+vh\b|h-screen|min-h-screen/, 'no 100dvh jank: nothing in the hero follows the browser bars');
  /* The mobile stack: pill, headline, line, button, trust strip — in that order. */
  const order = ['NEW CASUAL', '<h1', 'Trending chains', 'Explore Collection', '<ul role="list"'].map((s) => hero.indexOf(s));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(order.every((i) => i > 0));
});

test('HomeClient: the hero photo is in the first HTML — AVIF → WebP → JPEG at a fixed 4:5 crop, eager + high priority, preloaded once', { skip }, () => {
  const html = render(HomeClient, { heroSlides: [photo(), photo({ id: '2', imageUrl: TWO })] });
  const sources = sourcesOf(html);
  assert.equal(sources.length, 2, 'avif, webp (the <img> is the JPEG fallback)');
  assert.deepEqual(sources.map((s) => attr(s, 'type')), ['image/avif', 'image/webp']);
  assert.ok(sources.every((s) => attr(s, 'media') === undefined), 'one crop for every screen — the box is 4:5 everywhere');
  assert.ok(sources.every((s) => /,c_lfill,g_auto,ar_0\.8,/.test(attr(s, 'srcSet'))), '4:5 (0.8), smart-cropped so the jewellery stays in frame whatever shape was uploaded');
  assert.ok(sources.every((s) => /q_auto:good/.test(attr(s, 'srcSet'))), 'shown at ≤ 480 CSS px: "good" is indistinguishable from "best" at about half the bytes');
  assert.ok(sources.every((s) => !/q_auto:best/.test(attr(s, 'srcSet'))));
  assert.ok(sources.every((s) => widthsIn(attr(s, 'srcSet')).join() === '320,480,640,828,960,1200'), 'a ladder for ≤ 480px boxes — not the full-bleed 1440–2400 rungs');
  assert.ok(sources.every((s) => attr(s, 'sizes') === HERO_PHOTO.sizes));
  assert.ok(sources.every((s) => s.includes('hero-one')), 'the first slide only');
  assert.doesNotMatch(html, /hero-two/, 'a second slide is not shown, fetched or preloaded');

  const [img] = imgs(html);
  assert.equal(imgs(html).length, 1);
  assert.equal(attr(img, 'loading'), 'eager');
  assert.equal(attr(img, 'fetchPriority'), 'high');
  assert.equal(attr(img, 'decoding'), 'async');
  assert.equal(attr(img, 'alt'), HERO_PHOTO.alt);
  assert.equal(attr(img, 'sizes'), HERO_PHOTO.sizes);
  assert.equal(attr(img, 'class'), 'absolute inset-0 object-cover object-[50%_30%]');
  assert.equal(attr(img, 'style'), 'width:100%;height:100%');
  assert.match(img, /f_jpg,.*ar_0\.8.*fl_progressive/, 'the last-resort JPEG is progressive and cropped the same');

  /* The hints the browser acts on before it has run any script — one image, so one preload. */
  const preloads = links(html, 'preload');
  assert.equal(preloads.length, 1);
  assert.ok(attr(preloads[0], 'as') === 'image' && attr(preloads[0], 'type') === 'image/avif' && attr(preloads[0], 'fetchPriority') === 'high');
  assert.equal(attr(preloads[0], 'media'), undefined);
  assert.equal(attr(preloads[0], 'imageSrcSet'), attr(sources[0], 'srcSet'), 'same candidates as the <source> → one download, not two');
  assert.equal(attr(preloads[0], 'imageSizes'), HERO_PHOTO.sizes);
  assert.deepEqual(links(html, 'preconnect').map((l) => attr(l, 'href')), ['https://res.cloudinary.com']);
});

test('HomeClient: the photo is the first slide that has a usable link — an empty or mistyped first slide does not blank the hero', { skip }, () => {
  const html = render(HomeClient, { heroSlides: [photo({ imageUrl: '' }), photo({ id: '2', imageUrl: 'abc' }), photo({ id: '3', imageUrl: TWO }), photo({ id: '4', imageUrl: ONE })] });
  assert.ok(sourcesOf(html).every((s) => s.includes('hero-two')));
  assert.doesNotMatch(html, /hero-one/);
  assert.ok(links(html, 'preload').every((p) => p.includes('hero-two')));
});

test('HomeClient: the box sizes match the CSS — `sizes` is the real width at every viewport, the ladder never serves much more than it shows', { skip }, () => {
  const html = render(HomeClient, { heroSlides: [photo()] });
  const box = html.match(/<div class="relative (w-\[min[^"]*)">/)[1];
  for (const c of ['w-[min(100%,18rem)]', 'min-[400px]:w-[min(100%,20rem)]', 'md:w-[min(100%,24rem)]', 'lg:w-full', 'lg:max-w-[30rem]']) assert.ok(box.split(/\s+/).includes(c), c);
  /* The columns: section-container is max-w-7xl with px-4 / sm:px-6 / lg:px-8; the grid gap is gap-12 from 1024px. */
  const css = read('src/app/globals.css');
  assert.match(css, /\.section-container\s*\{\s*@apply max-w-7xl mx-auto px-4 sm:px-6 lg:px-8;/);
  assert.match(html, /grid-cols-1 items-center gap-6 (?:max-sm:\[@media\(max-height:720px\)\]:gap-3 )?lg:grid-cols-2 lg:gap-12/);
  const gutter = (vw) => (vw >= 1024 ? 32 : vw >= 640 ? 24 : 16);
  const column = (vw) => (Math.min(vw, 1280) - 2 * gutter(vw) - 48) / 2;
  const widest = (vw) => (vw >= 1024 ? Math.min(480, column(vw)) : vw >= 768 ? Math.min(384, vw - 2 * gutter(vw)) : vw >= 400 ? Math.min(320, vw - 2 * gutter(vw)) : Math.min(288, vw - 2 * gutter(vw)));
  const slot = (sizes, vw) => {
    const entries = [];
    for (let depth = 0, from = 0, i = 0; i <= sizes.length; i++) {
      if (sizes[i] === '(') depth++;
      else if (sizes[i] === ')') depth--;
      else if ((sizes[i] === ',' && depth === 0) || i === sizes.length) { entries.push(sizes.slice(from, i).trim()); from = i + 1; }
    }
    for (const entry of entries) {
      const m = entry.match(/^\(min-width:\s*(\d+)px\)\s*(.+)$/);
      if (m ? vw >= Number(m[1]) : false) return evalLength(m[2], vw);
    }
    return evalLength(entries.at(-1), vw);
  };
  const evalLength = (expr, vw) => Function(`"use strict"; return (${expr.replace(/100vw/g, String(vw)).replace(/(\d+(?:\.\d+)?)px/g, '$1').replace(/\bmin\(/g, 'Math.min(').replace(/\bcalc\(/g, '(')});`)();
  const ladder = [...HERO_PHOTO.widths];
  const dprs = { phone: [1, 1.5, 2, 2.625, 3], tablet: [1, 1.5, 2, 2.5], desktop: [1, 1.25, 1.5, 2, 2.5] };
  for (const vw of [320, 360, 375, 390, 400, 412, 599, 640, 767, 768, 1023, 1024, 1100, 1280, 1536, 1920]) {
    const px = slot(HERO_PHOTO.sizes, vw);
    assert.ok(Math.abs(px - widest(vw)) < 0.01, `${vw}px wide: sizes says ${px}, the CSS box is at most ${widest(vw)}`);
    for (const dpr of dprs[vw >= 1024 ? 'desktop' : vw >= 768 ? 'tablet' : 'phone']) {
      const need = px * dpr;
      const rung = ladder.find((w) => w >= need);
      assert.ok(rung, `${vw}px @${dpr}×: needs ${need}px, the ladder tops out at ${ladder.at(-1)}`);
      assert.ok(rung <= Math.max(need * 1.3, ladder[0]), `${vw}px @${dpr}×: needs ${need}px, would download ${rung}px`);
    }
  }
});

test('HomeClient: no usable photo (none set, a mistyped link, http) → the on-brand illustration in the same 4:5 box — never a broken image or a gap', { skip }, () => {
  const reference = render(HomeClient, { heroSlides: [photo()] });
  for (const heroSlides of [undefined, null, [], [photo({ imageUrl: '' })], [photo({ imageUrl: 'abc' })], [photo({ imageUrl: 'http://insecure.example/x.jpg' }), photo({ imageUrl: '' })]]) {
    const html = render(HomeClient, { heroSlides });
    const hero = heroOf(html);
    const label = JSON.stringify(heroSlides);
    assert.doesNotMatch(hero, /<img|<picture|<source/, label);
    assert.deepEqual(links(html, 'preload'), [], label);
    assert.deepEqual(links(html, 'preconnect'), [], label);
    const svg = hero.match(/<svg viewBox="0 0 400 500"[^>]*>/)?.[0];
    assert.ok(svg, `${label}: the illustration`);
    assert.match(svg, /aria-hidden="true"/);
    assert.match(svg, /class="absolute inset-0 h-full w-full"/);
    assert.match(hero, /class="relative aspect-\[4\/5\] overflow-hidden[^"]*"><svg viewBox/, 'inside the very same 4:5 box the photo gets');
    assert.doesNotMatch(hero, /<text|coming soon|undefined|null|NaN/i, label);
    assert.equal(textOf(hero), textOf(heroOf(reference)), 'the words, button and badges are exactly the same with or without a photo');
    assert.equal(hero.replace(/<svg viewBox[\s\S]*?<\/svg>/, '').length, heroOf(reference).replace(/<picture>[\s\S]*?<\/picture>/, '').length, 'and so is every other byte of the hero');
  }
  /* The illustration on its own: layered chains, a pendant, a pair of earrings, all decorative. */
  const art = render(HeroIllustration, {});
  assert.equal([...art.matchAll(/<linearGradient|<radialGradient/g)].length, 3);
  assert.equal([...art.matchAll(/stroke-dasharray/g)].length, 3, 'three layered chains');
  assert.equal([...art.matchAll(/<g transform="translate\(\d+ 372\)">/g)].length, 2, 'a pair of earrings');
  assert.doesNotMatch(art, /<text|<image|href=/, 'self-contained: no file, no words');
});

test('HeroArt: a photo that fails to load (also one that failed before React attached) is swapped for the illustration — never a broken image', { skip }, () => {
  hooks.slots = [];
  const draw = (photoUrl) => { hooks.at = 0; pictureProps = null; return render(HeroArtStateful, { photoUrl }); };
  assert.match(draw(ONE), /data-picture/);
  assert.equal(typeof pictureProps.onError, 'function');
  assert.equal(typeof pictureProps.ref, 'function', 'the check for an <img> that finished (and failed) before hydration');
  /* An <img> still loading, one that loaded, and an unmounted one change nothing. */
  for (const el of [{ complete: false, naturalWidth: 0 }, { complete: true, naturalWidth: 288 }, null]) pictureProps.ref(el);
  assert.match(draw(ONE), /data-picture/);
  /* One that already failed on the server-rendered page. */
  pictureProps.ref({ complete: true, naturalWidth: 0 });
  assert.match(draw(ONE), /<svg viewBox="0 0 400 500"/);
  assert.equal(pictureProps, null, 'no <img> is drawn for a link that failed');
  assert.match(draw(TWO), /data-picture/, 'a new link gets its own chance');
  /* One that fails after hydration. */
  pictureProps.onError();
  assert.match(draw(TWO), /<svg viewBox="0 0 400 500"/);
  assert.doesNotMatch(draw(''), /data-picture/, 'no link: the illustration');
});

test('HomeClient: a photo that is not a Cloudinary upload still renders — a plain <img> in the same box, same priority', { skip }, () => {
  for (const url of ['https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=1600', '/images/hero.jpg']) {
    const html = render(HomeClient, { heroSlides: [photo({ imageUrl: url })] });
    assert.doesNotMatch(html, /<picture|<source|<svg viewBox="0 0 400 500"/);
    const [img] = imgs(html);
    assert.equal(attr(img, 'src'), url.replace(/&/g, '&amp;'));
    assert.equal(attr(img, 'fetchPriority'), 'high');
    assert.equal(attr(img, 'loading'), 'eager');
    assert.equal(attr(img, 'class'), 'absolute inset-0 object-cover object-[50%_30%]');
    assert.match(heroOf(html), /class="relative aspect-\[4\/5\] overflow-hidden[^"]*"><img /);
    /* No Cloudinary variants to negotiate, so no preconnect of ours; React itself hints a
       high-priority <img> that is not inside a <picture>, with the one URL it has. */
    assert.deepEqual(links(html, 'preconnect'), []);
    assert.deepEqual(links(html, 'preload').map((l) => attr(l, 'href')), [url.replace(/&/g, '&amp;')]);
  }
});

test('HomeClient: the shipping badge says what the store really does — and is true from the first paint, before the charges are fetched', { skip }, () => {
  const badge = (html) => textOf(heroOf(html).match(/<li [^>]*>([\s\S]*?)<\/li>/)[1]);
  const SECURE = '🔒 Secure Checkout';
  const FREE_BADGE = '🚚 Free Nationwide Shipping';
  /* Only "every order ships free" is advertised; any other rule (a threshold, a flat fee) puts another true badge in its place. */
  const cases = [
    [FREE, FREE_BADGE],
    [{ ...FREE, enable_shipping_fee: true }, SECURE],
    [{ ...FREE, enable_shipping_fee: true, free_shipping_threshold: 0, shipping_fee_amount: 79 }, SECURE],
  ];
  for (const [charges, text] of cases) assert.equal(withCharges(charges, () => badge(render(HomeClient, { heroSlides: [photo()] }))), text, JSON.stringify(charges));
  /* Not fetched yet (CartContext still on DEFAULT_CHARGES): the rule the server rendered. */
  assert.equal(withCharges(DEFAULT_CHARGES, () => badge(render(HomeClient, { heroSlides: [photo()], shipping: FREE }))), FREE_BADGE);
  assert.equal(withCharges(DEFAULT_CHARGES, () => badge(render(HomeClient, { heroSlides: [photo()], shipping: null }))), SECURE, 'server could not read it: the defaults, never a made-up "free for every order"');
  /* Fetched: the live charges win over the (up to 5 minutes old) page. */
  assert.equal(withCharges({ ...DEFAULT_CHARGES, free_shipping_threshold: 3000 }, () => badge(render(HomeClient, { heroSlides: [photo()], shipping: FREE }))), SECURE);
  assert.equal(withCharges({ ...FREE, enable_shipping_fee: false }, () => badge(render(HomeClient, { heroSlides: [photo()], shipping: null }))), FREE_BADGE);
  /* No "free above ₹N" wording survives anywhere on the home page, whatever the rule. */
  for (const charges of [FREE, { ...FREE, enable_shipping_fee: true }, DEFAULT_CHARGES]) {
    assert.doesNotMatch(withCharges(charges, () => render(HomeClient, { heroSlides: [photo()], shipping: charges })), /Free (?:Shipping )?above|Above ₹/i, JSON.stringify(charges));
  }
  /* "COD Available" and the anti-tarnish line are fixed words: there is no store setting that switches COD off for the whole shop
     (only a per-pincode check and an order-value cap at checkout) and "100% Anti-Tarnish Finish" is the owner's product claim. */
  assert.match(heroOf(render(HomeClient, { heroSlides: [photo()] })), /💵<\/span>COD Available<\/li>/);
  assert.match(heroOf(render(HomeClient, { heroSlides: [photo()] })), /🛡️<\/span>100% Anti-Tarnish Finish<\/li>/);
});

test('HomeClient: every colour in the hero reads at WCAG AA or better on its background (4.5:1 for text)', { skip }, () => {
  const colors = require('../tailwind.config.js').theme.extend.colors;
  const hex = (token) => {
    const arbitrary = token.match(/\[(#[0-9a-fA-F]{6})\]$/);
    if (arbitrary) return arbitrary[1];
    const [, name, shade] = token.match(/-([a-z]+)-(\d+)$/);
    return colors[name][shade];
  };
  const lum = (h) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => { const [hi, lo] = [lum(hex(a)), lum(hex(b))].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const hero = heroOf(render(HomeClient, { heroSlides: [photo()] }));
  const classes = (re) => hero.match(re)[1].split(/\s+/);
  const find = (cls, re) => { const t = cls.find((c) => re.test(c)); assert.ok(t, String(re)); return t; };
  const BG = 'bg-[#FAF8F5]';
  const checks = [
    ['pill', find(classes(/<p class="([^"]*)"><span aria-hidden="true">✨/), /^text-gold-\d+$/), BG, 4.5],
    ['headline', find(classes(/<h1 [^>]*class="([^"]*)"/), /^text-stone-\d+$/), BG, 7],
    ['headline accent', find(classes(/<span class="block (text-\[#4A1224\])"/).concat('block'), /^text-\[#4A1224\]$/), BG, 7],
    ['line', find(classes(/<p class="(mt-4 [^"]*max-w-md[^"]*)"/), /^text-stone-\d+$/), BG, 4.5],
    ['badges', find(classes(/<li class="([^"]*)"/), /^text-stone-\d+$/), BG, 4.5],
  ];
  for (const [what, fg, bg, min] of checks) assert.ok(contrast(fg, bg) >= min, `${what}: ${fg} on ${bg} is ${contrast(fg, bg).toFixed(2)}:1`);
  const cta = classes(/<a href="\/shop" class="([^"]*)"/);
  assert.ok(contrast(find(cta, /^text-white$/).replace('text-white', 'text-[#FFFFFF]'), find(cta, /^bg-\[#4A1224\]$/)) >= 7, 'white on the burgundy button');
  assert.ok(contrast(find(cta, /^hover:text-stone-\d+$/).replace('hover:', ''), find(cta, /^hover:bg-gold-\d+$/).replace('hover:', '')) >= 4.5, 'dark label on the gold hover');
});

test('HomeClient: nothing of the old hero is left — no rental button or route, no slider, no particles, no sample copy', { skip }, () => {
  const html = render(HomeClient, { heroSlides: [slide(), slide({ id: '2', imageUrl: TWO })] });
  assert.doesNotMatch(html, /rental|Rent\b|Book Rental/i);
  assert.doesNotMatch(html, /\/rentals|rental-booking|rental-success/);
  assert.doesNotMatch(html, /<canvas|hero-canvas|hero-viewport|Previous slide|Next slide|Go to slide|aria-current="true"/);
  assert.doesNotMatch(html.replace(/tulsi-bridal/g, ''), /\bbrides?\b|\bbridal\b/i, 'bridal wording is fashion wording now (the Cloudinary folder "tulsi-bridal" in a photo link is a storage path and stays)');
  assert.doesNotMatch(html, /Temple Bride|Jewellery Crafted for Brides|Shop Collection/, 'the old slide texts are not drawn');
  const source = read('src/app/HomeClient.js');
  assert.doesNotMatch(source, /setInterval|setTimeout|requestAnimationFrame|matchMedia|HeroSlider|HeroParticles|HeroPhoto\b|HERO_ART|DEFAULT_SLIDES|DEFAULT_TESTIMONIALS|FiCalendar|FiChevron|transitioning/);
  assert.doesNotMatch(source, /rental|\/rentals|Book Rental/i);
  assert.doesNotMatch(source, /from 'next\/image'/, 'no photo goes through /_next/image (it would download the full master)');
  assert.doesNotMatch(source, /Playfair|next\/font/, 'no extra font on the LCP path');
  assert.doesNotMatch(source.replace(/tulsibridal/g, ''), /bridal|brides?/i, 'except the Instagram handle, which is a real account name');
});

test('HomeClient: the sample reviews are gone — no reviews section until the admin has entered some', { skip }, () => {
  const html = render(HomeClient, { heroSlides: [photo()] });
  assert.doesNotMatch(html, /Happy Customers|What Our Customers Say|What Our Brides Say/);
  assert.doesNotMatch(html, /Priya Sharma|Deepa Krishnan|Anitha Rajan|Rented the bridal set|imitation jewellery/);
  assert.equal(render(CustomerReviews, { reviews: [] }), '');
  assert.equal(render(CustomerReviews, { reviews: undefined }), '');
  const reviews = pickTestimonials([{ name: 'Asha', location: 'Madurai', rating: 4, review: 'Light and pretty', photo: '' }]);
  const shown = render(CustomerReviews, { reviews }).replace(/<!-- -->/g, '');
  assert.match(shown, /What Our Customers Say/);
  assert.match(shown, /<h2[^>]*>Happy Customers<\/h2>/);
  assert.match(shown, /&ldquo;Light and pretty&rdquo;|“Light and pretty”/);
  assert.match(shown, /data-avatar="Asha"/);
  assert.equal([...shown.matchAll(/text-gold-500 fill-current/g)].length, 4, 'a 4-star review shows 4 gold stars');
  assert.equal([...shown.matchAll(/text-stone-200 fill-current/g)].length, 1);
});

test('HomeClient: fashion wording — "Sets", "Why Choose Us", and one WhatsApp message everywhere', { skip }, () => {
  const html = render(HomeClient, { heroSlides: [photo()] });
  assert.match(html, />Sets<\/button>/);
  assert.doesNotMatch(html, /Bridal Set/);
  assert.match(html, /Why Choose Us/);
  assert.doesNotMatch(html, /Special Day|Exquisite|Begin Your/);
  assert.match(html, /Casual to Festive/);
  assert.match(html, /Trending<br\/><span[^>]*>Fashion Jewellery<\/span>/);
  const wa = [...html.matchAll(/href="(https:\/\/wa\.me\/[^"]*)"/g)].map((m) => m[1]);
  assert.equal(wa.length, 3, 'the promo, the CTA strip and the floating button');
  for (const href of wa) assert.equal(decodeURIComponent(href.split('?text=')[1]).replace(/&#x27;/g, "'"), "Hi! I'm interested in your fashion jewellery.");
  assert.ok(wa.every((href) => href.startsWith('https://wa.me/917695868787?')), 'the default store number until the settings arrive');
});

test('HomeClient: a seeded showcase is in the first HTML; unseeded, it waits for the settings (a hidden category never flashes up)', { skip }, () => {
  const seeded = render(HomeClient, { heroSlides: [], showcase: showcaseLib.normalizeShowcase({}) });
  assert.match(seeded, new RegExp(`data-showcase="${showcaseLib.SHOWCASE_CARDS.length}"`));
  assert.doesNotMatch(render(HomeClient, { heroSlides: null, showcase: null }), /data-showcase/);
  assert.doesNotMatch(render(HomeClient, { heroSlides: [] }), /data-showcase/, 'prop omitted = not seeded');
});

test('HomeClient: on a phone the floating WhatsApp button waits for a little scroll, so it never covers the hero\'s trust badges; from 640px up it is always there', { skip }, () => {
  const html = render(HomeClient, { heroSlides: [photo()] });
  const fab = html.match(/<a href="https:\/\/wa\.me\/[^"]*"[^>]*aria-label="Chat with us on WhatsApp"[^>]*>/)[0];
  /* First render (server HTML = first client render): fixed, so no layout, and hidden below sm only. */
  assert.match(fab, /class="fixed bottom-6 right-6 [^"]*max-sm:invisible max-sm:opacity-0/);
  assert.doesNotMatch(fab, /[ "]invisible[ "]/, 'hidden on phones only');
  /* It shows once the page has scrolled past 160px, through a passive scroll listener that is removed again. */
  const src = readFileSync(path.resolve('src/app/HomeClient.js'), 'utf8');
  assert.match(src, /setPastHero\(window\.scrollY > 160\)/);
  assert.match(src, /addEventListener\('scroll', onScroll, \{ passive: true \}\)/);
  assert.match(src, /removeEventListener\('scroll', onScroll\)/);
  assert.match(src, /\$\{pastHero \? '' : ' max-sm:invisible max-sm:opacity-0'\}/);
});

test('HomeClient: every control on the first screen has a name a screen reader can say (PageSpeed: buttons / links / selects)', { skip }, () => {
  const html = render(HomeClient, { heroSlides: [photo()] });
  assert.match(html, /<select[^>]*aria-label="Sort products"/);
  assert.match(html, /<a href="https:\/\/wa\.me\/[^"]*"[^>]*aria-label="Chat with us on WhatsApp"/);
  assert.match(html, /<svg[^>]*aria-hidden="true"/);
  /* Every button on the page names itself with text or an aria-label. */
  for (const [open, , inner] of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    assert.ok(/aria-label=/.test(open) || inner.replace(/<[^>]*>/g, '').trim(), `unnamed button: ${open.slice(0, 120)}`);
  }
  /* Every link says where it goes: text, or an aria-label. The hero's emoji and arrow are hidden from it. */
  for (const [open, inner] of [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => [m[1], m[2]])) {
    const visible = inner.replace(/<span aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g, '').replace(/<svg[^>]*aria-hidden="true"[\s\S]*?<\/svg>|<svg[^>]*aria-hidden="true"[^>]*\/>/g, '').replace(/<[^>]*>/g, '').trim();
    assert.ok(/aria-label=/.test(open) || visible, `unnamed link: ${open.slice(0, 120)}`);
  }
  assert.equal(textOf(heroOf(html).match(/<a href="\/shop"[^>]*>([\s\S]*?)<\/a>/)[1].replace(/<span aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g, '')), 'Explore Collection', 'its accessible name is "Explore Collection"');
});

test('HomeClient: the gold "Shop Now" button has a dark label (white on #c9973a is 2.6:1; WCAG needs 4.5:1)', { skip }, () => {
  const html = render(HomeClient, { heroSlides: [photo()] });
  const shop = [...html.matchAll(/<a [^>]*href="\/shop"[^>]*>/g)].map((m) => m[0]).find((tag) => attr(tag, 'class').split(/\s+/).includes('bg-gold-500')) || '';
  assert.ok(shop, 'the promo section\'s Shop Now button is there');
  assert.match(shop, /\btext-stone-900\b/);
  assert.doesNotMatch(shop, /\btext-white\b/);
});

test('HomeClient: the grids ask for the width they are drawn at, not the generic card sizes', { skip }, () => {
  const source = read('src/app/HomeClient.js');
  assert.match(source, /<ProductCard [^>]*sizes=\{GRID_SIZES\.home\}/, 'the home grid is 2-up, then 4-up from 768px');
  assert.match(source, /INSTAGRAM_SIZES = gridSizes\(\{ cols: \[\[0, 3\]\], gap: \[\[0, 8\], \[768, 12\]\], \.\.\.SECTION_CONTAINER \}\)/);
});

test('HomeClient: seeded and refreshed slides that are equal draw identical markup (nothing moves, nothing reloads)', { skip }, () => {
  const seeded = pickHeroSlides([slide(), slide({ id: '2', imageUrl: TWO })]);
  const refreshed = nextHeroSlides(seeded, [slide({ updatedAt: 'later', title: 'Edited' }), slide({ id: '2', imageUrl: TWO })]);
  assert.equal(refreshed, seeded);
  assert.equal(render(HomeClient, { heroSlides: refreshed }), render(HomeClient, { heroSlides: seeded }));
});

test('CloudinaryPicture receives the hero\'s 4:5 crop and a ratio-less call still crops nothing', { skip }, () => {
  const html = render(HeroSection, { photoUrl: ONE, shippingLabel: 'Free Nationwide Shipping' });
  assert.match(html, /ar_0\.8/);
  assert.doesNotMatch(render(CloudinaryPicture, { src: ONE, alt: 'x', fill: true, priority: true }), /ar_/);
  assert.equal(HERO_PHOTO.ratio, 0.8);
  assert.ok(Object.isFrozen(HERO_PHOTO) && Object.isFrozen(HERO_PHOTO.widths));
});

/* Render HomeClient with `heroSlides`, then do what the browser does next:
   the stored settings copy is applied at once and /api/admin/settings answers
   afterwards. Returns the states of interest: the hero slides, and the reviews. */
async function hydrateAndRefresh({ heroSlides, stored = null, fetched = null }) {
  recorded = { states: [], effects: [] };
  storedSettings = stored;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ json: async () => (fetched ? { success: true, data: fetched } : { success: false }) });
  try {
    render(HomeClientRecorded, { heroSlides });
    const settingsEffect = recorded.effects.find((e) => e.deps?.length === 2 && e.deps.every((d) => typeof d === 'boolean'));
    assert.ok(settingsEffect, 'HomeClient has its settings effect (deps: [seeded, showcaseSeeded])');
    assert.equal(settingsEffect.deps[0], Array.isArray(heroSlides), 'it knows whether the server seeded the slides');
    settingsEffect.fn();
    await new Promise((resolve) => setTimeout(resolve, 0)); // the fetch answers
  } finally { globalThis.fetch = realFetch; storedSettings = null; }
  /* HomeClient's useState order: siteSettings, hero slides, showcase, reviews, … */
  const hero = recorded.states[1];
  assert.deepEqual(hero.initial, Array.isArray(heroSlides) ? heroSlides : [], 'states[1] is the hero slides');
  const reviews = recorded.states[3];
  assert.deepEqual(reviews.initial, [], 'states[3] is the reviews, which start empty — no sample reviews');
  return Object.assign(hero, { reviews });
}
const OLD = [slide({ imageUrl: TWO })];
const NEW = [slide({ imageUrl: ONE })];

test('HomeClient settings refresh: seeded slides + an equal fetch → the same state, never replaced (no re-render, no photo reload)', { skip }, async () => {
  const seeded = pickHeroSlides(NEW);
  const hero = await hydrateAndRefresh({ heroSlides: seeded, stored: { heroSlides: NEW, phone: '1' }, fetched: { heroSlides: [{ ...NEW[0], extra: 1, title: 'Edited' }], phone: '2' } });
  assert.equal(hero.value, seeded, 'still the very same array');
  assert.ok(hero.history.every((h) => h === seeded), 'every setState was a no-op for React');
});

test('HomeClient settings refresh: the stored copy from an hour ago never flashes over seeded slides; the fresh fetch still wins', { skip }, async () => {
  const seeded = pickHeroSlides(NEW);
  const hero = await hydrateAndRefresh({ heroSlides: seeded, stored: { heroSlides: OLD }, fetched: { heroSlides: [slide({ id: '9', imageUrl: TWO })] } });
  assert.ok(hero.history.every((h) => h === seeded || h[0].id === '9'), 'the older hero was never shown');
  assert.equal(hero.value[0].imageUrl, TWO);
});

test('HomeClient settings refresh: when the server could not read the slides, the stored copy fills in at once and the fetch corrects it', { skip }, async () => {
  const hero = await hydrateAndRefresh({ heroSlides: null, stored: { heroSlides: OLD }, fetched: { heroSlides: NEW } });
  assert.deepEqual(hero.history.map((h) => h[0].imageUrl), [TWO, ONE]);
  assert.deepEqual(hero.value, pickHeroSlides(NEW));
});

test('HomeClient settings refresh: a failed fetch leaves the seeded slides on screen', { skip }, async () => {
  const seeded = pickHeroSlides(NEW);
  const hero = await hydrateAndRefresh({ heroSlides: seeded, fetched: null });
  assert.equal(hero.value, seeded);
  assert.deepEqual(hero.history, []);
  assert.deepEqual(hero.reviews.value, [], 'and no reviews are invented');
});

test('HomeClient settings refresh: only the admin\'s own reviews are shown — the fetch fills them in, and an emptied list empties the section', { skip }, async () => {
  const mine = [{ name: 'Asha', rating: 5, review: 'Lovely' }, { name: 'No words', review: '' }, null];
  const filled = await hydrateAndRefresh({ heroSlides: [], fetched: { testimonials: mine } });
  assert.deepEqual(filled.reviews.value, pickTestimonials(mine));
  assert.deepEqual(filled.reviews.value.map((r) => r.name), ['Asha'], 'a review without text is not shown');
  /* The stored copy had reviews; the admin has since removed them all. */
  const emptied = await hydrateAndRefresh({ heroSlides: [], stored: { testimonials: mine }, fetched: { testimonials: [] } });
  assert.equal(emptied.reviews.history.length, 2);
  assert.deepEqual(emptied.reviews.value, [], 'removing every review removes the section');
  /* No reviews list in the settings at all: still nothing. */
  const none = await hydrateAndRefresh({ heroSlides: [], fetched: { phone: '1' } });
  assert.deepEqual(none.reviews.value, []);
});

/* ── Admin → Settings → Hero ── */

test('admin settings: the hero form says plainly that one photo is shown and no longer asks for fields the home page ignores', () => {
  const source = read('src/app/admin/settings/page.js');
  assert.match(source, /Homepage Hero Photo/);
  assert.match(source, /shows one photo: the image of <strong>Slide 1<\/strong>/);
  assert.match(source, /Other slides are kept here but not shown/);
  assert.match(source, /title, subtitle and button fields of the old slider are no longer used on the homepage/);
  assert.match(source, /const BLANK_SLIDE = \{ id: '', imageUrl: '' \};/, 'a new slide is just a photo — no "Book Rental" button saved with it');
  assert.match(source, /shown on the homepage/);
  const row = source.slice(source.indexOf('function SlideRow'), source.indexOf('/* ─────────────────────────── Testimonial row'));
  assert.doesNotMatch(row, /Main Title|Button 1|Button 2|Tag \/ Badge|Subtitle/, 'the unused fields are not listed');
  assert.doesNotMatch(source, /Book Rental|\/rentals|Bridal|Brides|Premium Bridal/, 'no rental button or bridal brand string is suggested anywhere');
  assert.match(source, /businessName: 'Tulsi Fashion Jewellery'/);
  assert.match(source, /The &ldquo;Happy Customers&rdquo; section is hidden on the homepage until you add a real review here/);
});

/* ── src/app/api/admin/settings/route.js ── */

process.env.ADMIN_EMAILS = 'owner@tulsi.test';
delete process.env.NEXT_PUBLIC_ADMIN_BYPASS;
const src = (p) => pathToFileURL(path.resolve('src', p)).href;
let session = null;
const getServerSession = async () => session;
const revalidated = []; // what revalidatePath was asked, and what had been stored by then
let revalidateImpl = () => {};
mock.module('next-auth', { defaultExport: { getServerSession }, namedExports: { getServerSession } });
mock.module(src('app/api/auth/[...nextauth]/route.js'), { namedExports: { authOptions: {} } });
mock.module(src('lib/firebase.js'), {
  namedExports: {
    getDB: () => db,
    docToObj,
    snapshotToArr: (snap) => snap.docs.map((d) => ({ id: d.id, _id: d.id, ...d.data() })),
    FieldValue: { increment: (n) => n },
  },
});
mock.module('next/cache', {
  namedExports: {
    revalidatePath: (...args) => {
      revalidated.push({ args, stored: structuredClone(db.store.get('settings')?.get('site')?.heroSlides) });
      return revalidateImpl(...args);
    },
  },
});
const settingsRoute = await import(src('app/api/admin/settings/route.js'));

beforeEach(() => {
  session = { user: { id: 'owner', email: 'owner@tulsi.test' } };
  revalidated.length = 0;
  revalidateImpl = () => {};
});

const post = (body) => settingsRoute.POST(new Request('http://tulsi.test/api/admin/settings', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}));
const SAVED = [slide({ imageUrl: TWO })];

test('settings save: the cached homepage is dropped once, after the settings are stored', async () => {
  const res = await post({ heroSlides: SAVED });
  assert.equal(res.status, 200);
  assert.equal(revalidated.length, 1);
  assert.deepEqual(revalidated[0].args, ['/']);
  assert.deepEqual(revalidated[0].stored, SAVED, 'revalidated after the write — the rebuild reads the new slides');
});

test('settings save: a slide saved with its old fields is stored untouched (the form hides them, the data is not rewritten)', async () => {
  await post({ heroSlides: SAVED });
  assert.deepEqual(db.store.get('settings').get('site').heroSlides, SAVED);
});

test('settings save: when revalidatePath throws (no Next request around it) the save still succeeds', async () => {
  revalidateImpl = () => { throw new Error('Invariant: static generation store missing in revalidatePath /'); };
  const res = await post({ heroSlides: SAVED });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true, message: 'Settings saved' });
  assert.equal(revalidated.length, 1, 'it was tried');
  assert.deepEqual(db.store.get('settings').get('site').heroSlides, SAVED, 'and the settings are stored');
});

test('settings save: a refused or failed save leaves the cached homepage alone', async () => {
  session = null;
  assert.equal((await post({ heroSlides: SAVED })).status, 403);
  session = { user: { id: 'owner', email: 'owner@tulsi.test' } };
  assert.equal((await post({ razorpay_secret: 'x' })).status, 400);
  const real = db.collection.bind(db);
  db.collection = (name) => ({ ...real(name), doc: (id) => ({ ...real(name).doc(id), set: async () => { throw new Error('UNAVAILABLE'); } }) });
  const res = await post({ heroSlides: SAVED });
  assert.equal(res.status, 500);
  assert.deepEqual(revalidated, [], 'nothing changed, so nothing to refresh');
});

/* ── src/app/api/admin/category-showcase/route.js ── */

const showcaseRoute = await import(src('app/api/admin/category-showcase/route.js'));
const patchShowcase = (body) => showcaseRoute.PATCH(new Request('http://tulsi.test/api/admin/category-showcase', {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}));

test('category showcase save: the homepage (which has the showcase in its HTML) is dropped once, after the change is stored', async () => {
  const res = await patchShowcase({ layout: { size: 'small' } });
  assert.equal(res.status, 200);
  assert.deepEqual(revalidated.map((r) => r.args), [['/']]);
  assert.equal(db.store.get('settings').get('site').categoryShowcase.layout.size, 'small');
});

test('category showcase save: when revalidatePath throws (no Next request) the save still succeeds', async () => {
  revalidateImpl = () => { throw new Error('Invariant: static generation store missing in revalidatePath /'); };
  const res = await patchShowcase({ layout: { size: 'medium' } });
  assert.equal(res.status, 200);
  assert.equal(revalidated.length, 1, 'it was tried');
  assert.equal(db.store.get('settings').get('site').categoryShowcase.layout.size, 'medium');
});

test('category showcase save: a rejected change does not touch the cached homepage', async () => {
  const res = await patchShowcase({ layout: { size: 'enormous' } });
  assert.equal(res.status, 400);
  assert.deepEqual(revalidated, []);
});
