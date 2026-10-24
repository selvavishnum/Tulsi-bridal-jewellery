/* ─────────────────────────────────────────────
   Homepage hero = the LCP element. It has to be in the first HTML (not
   discovered after JS + a settings fetch), preloaded from <head>, light on a
   phone, and the same before and after the browser's own settings refresh.

   - src/lib/heroSlides.js: which fields travel to the browser; "same slides"
     (nothing to re-render) vs "changed"
   - src/app/page.js: the server reads the slides, survives Firestore being
     down, and never lets a failed rebuild replace the last good page
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
import { absoluteUrl } from '../src/lib/seoSchema.js';

const { HERO_SLIDE_FIELDS, pickHeroSlides, sameHeroSlides, nextHeroSlides } = heroLib;
const { IMAGE_WIDTHS } = imageLib;
const require = createRequire(import.meta.url);

const CLD = 'https://res.cloudinary.com/djolb5idc/image/upload/v1712345678/tulsi-bridal/hero';
const ONE = `${CLD}/bride-one.jpg`;
const TWO = `${CLD}/bride-two.jpg`;
const slide = (over = {}) => ({
  id: '1', imageUrl: ONE, tag: 'New Bridal Collection', title: 'Temple Bride', subtitle: 'Jewellery Crafted for Brides',
  ctaText: 'Shop Collection', ctaLink: '/shop', cta2Text: 'Book Rental', cta2Link: '/rentals', ...over,
});

/* ── src/lib/heroSlides.js ── */

test('pickHeroSlides: only the fields the hero reads, all strings, junk dropped', () => {
  assert.deepEqual([...HERO_SLIDE_FIELDS], ['id', 'imageUrl', 'tag', 'title', 'subtitle', 'ctaText', 'ctaLink', 'cta2Text', 'cta2Link']);
  const picked = pickHeroSlides([
    { ...slide(), internalNote: 'do not ship', createdAt: { seconds: 1 }, bg: 'from-red-500' },
    null, 'oops', 7,
    { title: 'Only a title', ctaText: 42 },
  ]);
  assert.equal(picked.length, 2);
  assert.deepEqual(picked[0], slide());
  assert.deepEqual(Object.keys(picked[0]), HERO_SLIDE_FIELDS.slice(), 'a fixed key order, so two lists compare equal as text');
  assert.equal(picked[1].title, 'Only a title');
  assert.equal(picked[1].ctaText, '', 'a non-string is "not set", not a crash later');
  assert.equal(picked[1].imageUrl, '');
  for (const notAList of [undefined, null, 'x', {}, 3]) assert.deepEqual(pickHeroSlides(notAList), []);
  assert.deepEqual(JSON.parse(JSON.stringify(picked)), picked, 'survives the server → browser boundary');
});

test('sameHeroSlides: extra stored fields do not count; any visible change does', () => {
  const a = [slide(), slide({ id: '2', imageUrl: TWO })];
  assert.equal(sameHeroSlides(a, a.map((s) => ({ ...s, updatedBy: 'admin' }))), true);
  assert.equal(sameHeroSlides(a, [...a].reverse()), false, 'order');
  assert.equal(sameHeroSlides(a, a.slice(0, 1)), false, 'length');
  assert.equal(sameHeroSlides(a, [slide({ title: 'Other' }), a[1]]), false, 'text');
  assert.equal(sameHeroSlides(a, [slide({ imageUrl: TWO }), a[1]]), false, 'photo');
  assert.equal(sameHeroSlides([], undefined), true);
});

test('nextHeroSlides: an equal refresh keeps the very same state, so React renders nothing and the photo is untouched', () => {
  const seeded = pickHeroSlides([slide(), slide({ id: '2', imageUrl: TWO })]);
  const fetched = [slide({ createdAt: 'x' }), slide({ id: '2', imageUrl: TWO })]; // same hero, extra stored field
  assert.equal(nextHeroSlides(seeded, fetched), seeded, 'identical reference → setState bails out');
  const none = [];
  assert.equal(nextHeroSlides(none, []), none, 'and for "no slides"');
});

test('nextHeroSlides: a changed list replaces the state (trimmed); a missing list changes nothing', () => {
  const seeded = pickHeroSlides([slide()]);
  const changed = nextHeroSlides(seeded, [slide({ title: 'New title', internalNote: 'x' })]);
  assert.notEqual(changed, seeded);
  assert.deepEqual(changed, [slide({ title: 'New title' })]);
  assert.deepEqual(nextHeroSlides(seeded, []), [], 'the admin removed every slide');
  for (const noList of [undefined, null, 'x', {}]) assert.equal(nextHeroSlides(seeded, noList), seeded);
});

test('nextHeroSlides: the browser\'s stored copy never replaces slides the server already rendered', () => {
  const seeded = pickHeroSlides([slide({ title: 'Fresh from the server' })]);
  const oldCopy = [slide({ title: 'An hour ago' })];
  assert.equal(nextHeroSlides(seeded, oldCopy, { stale: true }), seeded, 'no flash of an older hero');
  assert.deepEqual(nextHeroSlides(seeded, oldCopy, { stale: false }), [slide({ title: 'An hour ago' })], 'the fetch, which is fresh, still can');
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

test('page.js: passes the configured hero slides to HomeClient — only those, only the fields the hero reads', { skip }, async () => {
  db = fakeFirestore({ settings: { site: {
    phone: '+91 76958 68787',
    testimonials: [{ name: 'A', review: 'long text '.repeat(50) }],
    heroSlides: [{ ...slide(), internalNote: 'x' }, slide({ id: '2', imageUrl: TWO })],
  } } });
  const el = await page.default();
  assert.equal(el.type, HomeClientStub);
  assert.deepEqual(Object.keys(el.props), ['heroSlides', 'showcase'], 'no other setting is put into the page');
  assert.deepEqual(el.props.heroSlides, [slide(), slide({ id: '2', imageUrl: TWO })]);
  assert.deepEqual(JSON.parse(JSON.stringify(el.props)), el.props, 'plain JSON');
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

test('page.js: when the settings cannot be read, neither the slides nor the showcase are guessed', { skip }, async () => {
  dbDown = new Error('Firestore is down');
  try {
    const el = await inEnv('dev', () => page.default());
    assert.equal(el.props.heroSlides, null);
    assert.equal(el.props.showcase, null);
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
    for (const failure of ['init', 'read']) {
      if (failure === 'init') dbDown = new Error('FIREBASE_PROJECT_ID is missing');
      else {
        dbDown = null;
        db = { collection: () => ({ doc: () => ({ get: async () => { throw new Error('UNAVAILABLE: no connection'); } }) }) };
      }
      const el = await inEnv(env, () => page.default());
      assert.equal(el.type, HomeClientStub, `${env}/${failure}`);
      assert.equal(el.props.heroSlides, null, `${env}/${failure}: null = unknown, never a fake "no slides"`);
    }
  }
});

test('page.js: a failed rebuild on the running server throws, so Next keeps the last good page', { skip }, async () => {
  /* Next re-sets the previous HTML and retries (within 30 s) when a background
     rebuild throws. A render that "succeeded" with no slides would replace the
     good page with the gradient default for the next 5 minutes. */
  dbDown = new Error('FIREBASE_PROJECT_ID is missing');
  await assert.rejects(inEnv('production', () => page.default()), /FIREBASE_PROJECT_ID is missing/);
  dbDown = null;
  db = { collection: () => ({ doc: () => ({ get: async () => { throw new Error('UNAVAILABLE: no connection'); } }) }) };
  await assert.rejects(inEnv('production', () => page.default()), /UNAVAILABLE/);
  /* ...and a healthy read on the same server is fine. */
  db = fakeFirestore({ settings: { site: { heroSlides: [slide()] } } });
  assert.deepEqual((await inEnv('production', () => page.default())).props.heroSlides, [slide()]);
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

/* A server render always starts on slide 1; to see another slide the way the
   timer would show it, this React lets a test choose HeroSlider's `current`
   state (its first useState(0)). Without a DOM that is the only way to draw
   slide 2 from a test. */
const showing = { current: null };
const realUseState = React.useState;
const reactWithChosenSlide = {
  ...React,
  useState: (initial) => (showing.current !== null && initial === 0 ? [showing.current, () => {}] : realUseState(initial)),
};

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
let HeroPhoto = null;
let HeroSlider = null;
if (sucrase) {
  CloudinaryPicture = loadJsx('src/components/ui/CloudinaryPicture.jsx', { 'react-dom': ReactDOM, '@/lib/cloudinaryImage': imageLib }).default;
  const homeDeps = {
    'next/link': { __esModule: true, default: Link },
    'next/image': { __esModule: true, default: (props) => React.createElement('img', { 'data-next-image': 'true', alt: props.alt }) },
    'react-icons/fi': new Proxy({}, { get: (_, name) => (typeof name === 'string' && name.startsWith('Fi') ? icon(name) : undefined) }),
    '@/context/CartContext': { useCart: () => ({ charges: { enable_shipping_fee: false } }) },
    '@/lib/clientCache': { cacheGet: () => null, cacheSet: () => {} },
    '@/components/shop/ProductCard': { __esModule: true, default: Nothing },
    '@/components/home/CategoryShowcase': { __esModule: true, default: ({ showcase }) => React.createElement('i', { 'data-showcase': showcase.items.length }) },
    '@/components/ui/CustomerAvatar': { __esModule: true, default: Nothing },
    '@/components/ui/CloudinaryPicture': { __esModule: true, default: CloudinaryPicture },
    '@/components/ui/CatalogImage': { __esModule: true, default: Nothing },
    '@/lib/catalogImages': catalogLib,
    '@/lib/cloudinaryImage': imageLib,
    '@/lib/categoryShowcase': showcaseLib,
    '@/lib/heroSlides': heroLib,
  };
  const home = loadJsx('src/app/HomeClient.js', homeDeps);
  HomeClient = home.default;
  HeroPhoto = home.HeroPhoto;
  HeroSlider = loadJsx('src/app/HomeClient.js', { ...homeDeps, react: reactWithChosenSlide }).HeroSlider;
  HomeClientRecorded = loadJsx('src/app/HomeClient.js', { ...homeDeps, react: recordingReact, '@/lib/clientCache': cacheStub }).default;
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
/* Tall phones only: a landscape-ish window or a portrait tablet keeps the full photo. */
const PHONE = '(max-width: 767px) and (max-aspect-ratio: 3/4)';

test('HomeClient: the seeded hero is in the first HTML — AVIF → WebP → JPEG, a phone portrait crop, eager + high priority', { skip }, () => {
  const html = render(HomeClient, { heroSlides: [slide(), slide({ id: '2', title: 'Second', imageUrl: TWO })] });

  const sources = sourcesOf(html);
  assert.equal(sources.length, 5, 'phone crop: avif, webp, jpeg; everything else: avif, webp');
  assert.deepEqual(sources.map((s) => attr(s, 'type')), ['image/avif', 'image/webp', undefined, 'image/avif', 'image/webp']);
  assert.ok(sources.slice(0, 3).every((s) => attr(s, 'media') === PHONE), 'the phone crop is listed first, under the media query');
  assert.ok(sources.slice(3).every((s) => attr(s, 'media') === undefined));
  assert.ok(sources.slice(0, 3).every((s) => /ar_0\.66,/.test(attr(s, 'srcSet')) && /c_lfill,g_auto/.test(attr(s, 'srcSet'))), 'portrait 0.66 (wider than the usual 0.52 box, so a phone covers by height), smart-cropped');
  assert.deepEqual(widthsIn(attr(sources[0], 'srcSet')), [480, 640, 828, 1080, 1280], 'a phone never gets a desktop-sized file');
  assert.ok(sources.slice(3).every((s) => !/ar_/.test(attr(s, 'srcSet'))), 'tablet / desktop keep the whole photo');
  assert.deepEqual(widthsIn(attr(sources[3], 'srcSet')), [...IMAGE_WIDTHS.hero]);
  assert.ok(sources.slice(0, 3).every((s) => /q_auto:good/.test(attr(s, 'srcSet'))), 'a phone shows the crop at ≤ 500 CSS px: good is enough, at about half the bytes');
  assert.ok(sources.slice(3).every((s) => /q_auto:best/.test(attr(s, 'srcSet'))), 'the full-bleed desktop hero keeps the best quality tier');
  assert.ok(sources.slice(0, 3).every((s) => attr(s, 'sizes') === '128vw'), 'the 0.66 crop is drawn ~1.28× the viewport width (cover by height)');
  assert.ok(sources.slice(3).every((s) => attr(s, 'sizes') === '100vw'));
  assert.ok(sources.every((s) => s.includes('bride-one')), 'the first slide only');

  const [img] = imgs(html);
  assert.equal(imgs(html).length, 1);
  assert.equal(attr(img, 'loading'), 'eager');
  assert.equal(attr(img, 'fetchPriority'), 'high');
  assert.equal(attr(img, 'decoding'), 'async');
  assert.equal(attr(img, 'alt'), 'Temple Bride');
  assert.equal(attr(img, 'sizes'), '100vw');
  assert.equal(attr(img, 'class'), 'absolute inset-0 object-cover object-top');
  assert.equal(attr(img, 'style'), 'width:100%;height:100%');
  assert.match(img, /f_jpg,.*fl_progressive/, 'the last-resort JPEG is progressive');

  /* The hints the browser acts on before it has run any script. */
  const preloads = links(html, 'preload');
  assert.equal(preloads.length, 2, 'one for a phone, one for everything else — a given screen fetches one of them');
  assert.ok(preloads.every((p) => attr(p, 'as') === 'image' && attr(p, 'type') === 'image/avif' && attr(p, 'fetchPriority') === 'high'));
  assert.equal(attr(preloads[0], 'media'), PHONE);
  assert.equal(attr(preloads[1], 'media'), `not all and ${PHONE}`);
  assert.equal(attr(preloads[0], 'imageSrcSet'), attr(sources[0], 'srcSet'), 'same candidates as the <source> → one download, not two');
  assert.equal(attr(preloads[1], 'imageSrcSet'), attr(sources[3], 'srcSet'));
  assert.deepEqual(links(html, 'preconnect').map((l) => attr(l, 'href')), ['https://res.cloudinary.com']);

  /* The slide's words are in the HTML as well, in a box whose height CSS fixes. */
  assert.match(html, /<section class="relative w-full overflow-hidden bg-stone-100 hero-viewport">/);
  assert.match(html, /Temple Bride/);
  assert.match(html, /<a href="\/shop"[^>]*>Shop Collection/);
  assert.match(html, /Book Rental/);
});

test('HomeClient: a seeded showcase is in the first HTML; unseeded, it waits for the settings (a hidden category never flashes up)', { skip }, () => {
  const seeded = render(HomeClient, { heroSlides: [], showcase: showcaseLib.normalizeShowcase({}) });
  assert.match(seeded, new RegExp(`data-showcase="${showcaseLib.SHOWCASE_CARDS.length}"`));
  assert.doesNotMatch(render(HomeClient, { heroSlides: null, showcase: null }), /data-showcase/);
  assert.doesNotMatch(render(HomeClient, { heroSlides: [] }), /data-showcase/, 'prop omitted = not seeded');
});

test('HomeClient: the grids ask for the width they are drawn at, not the generic card sizes', { skip }, () => {
  const source = readFileSync(path.resolve('src/app/HomeClient.js'), 'utf8');
  assert.match(source, /<ProductCard [^>]*sizes=\{GRID_SIZES\.home\}/, 'the home grid is 2-up, then 4-up from 768px');
  assert.match(source, /INSTAGRAM_SIZES = gridSizes\(\{ cols: \[\[0, 3\]\], gap: \[\[0, 8\], \[768, 12\]\], \.\.\.SECTION_CONTAINER \}\)/);
  assert.doesNotMatch(source, /next\/image/, 'no photo goes through /_next/image any more (it would download the full master)');
});

test('HomeClient: later slides are never preloaded or fetched with the first one', { skip }, () => {
  const html = render(HomeClient, { heroSlides: [slide(), slide({ id: '2', title: 'Second', imageUrl: TWO })] });
  assert.doesNotMatch(html, /bride-two/, 'one slide is drawn at a time; the next is not in the HTML at all');
  assert.ok(links(html, 'preload').every((p) => p.includes('bride-one')));
});

test('HeroPhoto: a slide after the first loads eagerly at normal priority, with no preload', { skip }, () => {
  const html = render(HeroPhoto, { slide: slide({ imageUrl: TWO, title: 'Second' }), priority: false });
  const [img] = imgs(html);
  assert.equal(attr(img, 'loading'), 'eager', 'it appears after the timer: no lazy-load wait');
  assert.doesNotMatch(img, /fetchPriority/);
  assert.deepEqual(links(html, 'preload'), []);
  assert.deepEqual(links(html, 'preconnect'), []);
  assert.equal(sourcesOf(html).length, 5, 'same formats and phone crop as the first slide');
  assert.equal(attr(img, 'alt'), 'Second');
  /* The first slide, for contrast. */
  const first = render(HeroPhoto, { slide: slide(), priority: true });
  assert.equal(attr(imgs(first)[0], 'fetchPriority'), 'high');
  assert.equal(links(first, 'preload').length, 2);
});

test('HeroSlider: the slide after the first is drawn eagerly at normal priority and is not preloaded', { skip }, () => {
  const slides = [slide(), slide({ id: '2', title: 'Second', imageUrl: TWO })];
  showing.current = 1;
  try {
    const html = render(HeroSlider, { slides });
    const [img] = imgs(html);
    assert.match(img, /bride-two/);
    assert.equal(attr(img, 'loading'), 'eager');
    assert.doesNotMatch(img, /fetchPriority/);
    assert.deepEqual(links(html, 'preload'), []);
    assert.deepEqual(links(html, 'preconnect'), []);
    assert.equal(sourcesOf(html).length, 5, 'same formats and phone crop as the first slide');
  } finally { showing.current = null; }
  const first = render(HeroSlider, { slides });
  assert.equal(attr(imgs(first)[0], 'fetchPriority'), 'high');
  assert.equal(links(first, 'preload').length, 2);
});

test('HeroSlider: a refresh that shortens the list while a later slide is showing falls back to the first slide, not a crash', { skip }, () => {
  showing.current = 3;
  try {
    const html = render(HeroSlider, { slides: [slide({ title: 'First' }), slide({ id: '2', title: 'Second', imageUrl: TWO })] });
    assert.match(html, /First/);
    assert.equal(attr(imgs(html)[0], 'fetchPriority'), 'high', 'it is the first slide again, so it takes the first slide\'s priority');
    const dots = [...html.matchAll(/<button class="transition-all duration-300 rounded-full ([^"]*)"/g)].map((m) => m[1]);
    assert.equal(dots.length, 2);
    assert.match(dots[0], /w-7/, 'and the first dot is the active one');
    assert.doesNotMatch(dots[1], /w-7/);
  } finally { showing.current = null; }
});

test('HomeClient: no slides configured, or not readable on the server → the gradient hero, no photo, no hints', { skip }, () => {
  for (const heroSlides of [undefined, null, []]) {
    const html = render(HomeClient, { heroSlides });
    assert.match(html, /bg-gradient-to-br from-wine-900 via-wine-800 to-velvet-900/, String(heroSlides));
    assert.match(html, /The Occasion/);
    assert.doesNotMatch(html, /<img|<picture/);
    assert.deepEqual(links(html, 'preload'), []);
    assert.deepEqual(links(html, 'preconnect'), []);
  }
});

test('HomeClient: a stored slide without a photo gets the default gradient (not the word "undefined")', { skip }, () => {
  const html = render(HomeClient, { heroSlides: [slide({ imageUrl: '', title: 'Text only' })] });
  assert.match(html, /bg-gradient-to-br from-wine-900 via-wine-800 to-velvet-900/);
  assert.doesNotMatch(html, /undefined/);
  assert.match(html, /Text only/);
  assert.doesNotMatch(html, /<img/);
});

test('HomeClient: a photo that is not a Cloudinary upload still renders, as a plain <img> with the same box and priority', { skip }, () => {
  const url = 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=1600';
  const html = render(HomeClient, { heroSlides: [slide({ imageUrl: url })] });
  assert.doesNotMatch(html, /<picture|<source/);
  const [img] = imgs(html);
  assert.equal(attr(img, 'src'), url.replace(/&/g, '&amp;'));
  assert.equal(attr(img, 'fetchPriority'), 'high');
  assert.equal(attr(img, 'loading'), 'eager');
  assert.equal(attr(img, 'class'), 'absolute inset-0 object-cover object-top');
  /* No Cloudinary variants to negotiate, so no preconnect of ours; React itself hints a
     high-priority <img> that is not inside a <picture>, with the one URL it has. */
  assert.deepEqual(links(html, 'preconnect'), []);
  assert.deepEqual(links(html, 'preload').map((l) => attr(l, 'href')), [url.replace(/&/g, '&amp;')]);
});

test('HomeClient: the alt text is the slide title, or a generic description when it has none', { skip }, () => {
  assert.equal(attr(imgs(render(HomeClient, { heroSlides: [slide({ title: 'Kundan Bride' })] }))[0], 'alt'), 'Kundan Bride');
  assert.equal(attr(imgs(render(HomeClient, { heroSlides: [slide({ title: '' })] }))[0], 'alt'), 'Bridal jewellery');
});

test('HomeClient: seeded and refreshed slides that are equal draw identical markup (nothing moves, nothing reloads)', { skip }, () => {
  const seeded = pickHeroSlides([slide(), slide({ id: '2', imageUrl: TWO })]);
  const refreshed = nextHeroSlides(seeded, [slide({ updatedAt: 'later' }), slide({ id: '2', imageUrl: TWO })]);
  assert.equal(render(HomeClient, { heroSlides: refreshed }), render(HomeClient, { heroSlides: seeded }));
});

/* Render HomeClient with `heroSlides`, then do what the browser does next:
   the stored settings copy is applied at once and /api/admin/settings answers
   afterwards. Returns the hero-slides state: its value and every value set. */
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
  const hero = recorded.states[1]; // HomeClient's second useState: siteSettings, then the hero slides
  assert.deepEqual(hero.initial, Array.isArray(heroSlides) ? heroSlides : [], 'states[1] is the hero slides');
  return hero;
}
const OLD = [slide({ title: 'An hour ago' })];
const NEW = [slide({ title: 'Fresh from the server' })];

test('HomeClient settings refresh: seeded slides + an equal fetch → the same state, never replaced (no re-render, no photo reload)', { skip }, async () => {
  const seeded = pickHeroSlides(NEW);
  const hero = await hydrateAndRefresh({ heroSlides: seeded, stored: { heroSlides: NEW, phone: '1' }, fetched: { heroSlides: [{ ...NEW[0], extra: 1 }], phone: '2' } });
  assert.equal(hero.value, seeded, 'still the very same array');
  assert.ok(hero.history.every((h) => h === seeded), 'every setState was a no-op for React');
});

test('HomeClient settings refresh: the stored copy from an hour ago never flashes over seeded slides; the fresh fetch still wins', { skip }, async () => {
  const seeded = pickHeroSlides(NEW);
  const hero = await hydrateAndRefresh({ heroSlides: seeded, stored: { heroSlides: OLD }, fetched: { heroSlides: [slide({ title: 'Changed a minute ago' })] } });
  assert.ok(hero.history.every((h) => h === seeded || h[0].title === 'Changed a minute ago'), 'the older hero was never shown');
  assert.equal(hero.value[0].title, 'Changed a minute ago');
});

test('HomeClient settings refresh: when the server could not read the slides, the stored copy fills in at once and the fetch corrects it', { skip }, async () => {
  const hero = await hydrateAndRefresh({ heroSlides: null, stored: { heroSlides: OLD }, fetched: { heroSlides: NEW } });
  assert.deepEqual(hero.history.map((h) => h[0].title), ['An hour ago', 'Fresh from the server']);
  assert.deepEqual(hero.value, NEW);
});

test('HomeClient settings refresh: a failed fetch leaves the seeded slides on screen', { skip }, async () => {
  const seeded = pickHeroSlides(NEW);
  const hero = await hydrateAndRefresh({ heroSlides: seeded, fetched: null });
  assert.equal(hero.value, seeded);
  assert.deepEqual(hero.history, []);
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
const SAVED = [slide({ title: 'Saved just now' })];

test('settings save: the cached homepage is dropped once, after the settings are stored', async () => {
  const res = await post({ heroSlides: SAVED });
  assert.equal(res.status, 200);
  assert.equal(revalidated.length, 1);
  assert.deepEqual(revalidated[0].args, ['/']);
  assert.deepEqual(revalidated[0].stored, SAVED, 'revalidated after the write — the rebuild reads the new slides');
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
