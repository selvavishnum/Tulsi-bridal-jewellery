/* ─────────────────────────────────────────────
   Catalog images (product cards, grids, thumbnails): what the browser
   receives in the first HTML and what it makes of it.

     · which cards load first (the priority rule) and that no grid writes its own
     · one quality constant, one srcset recipe, a ladder with no unusable rungs
     · `sizes` against the real grid CSS — worked out here, independently, from the
       container and grid classes in the source files (and globals.css), at many
       viewport widths, so changing either side alone fails
     · a reserved box for every image
     · ProductCard and CategoryShowcase rendered with the real React

   Run: npm test
   ───────────────────────────────────────────── */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import * as lib from '../src/lib/catalogImages.js';
import * as cld from '../src/lib/cloudinaryImage.js';
import * as showcaseLib from '../src/lib/categoryShowcase.js';

const {
  CARD_QUALITY, CARD_RATIO, CARD_WIDTHS, THUMB_WIDTHS, CARD_TILE, PRIORITY_CARDS, GRID_SIZES, SECTION_CONTAINER,
  cardPriority, cardLoading, cardImage, gridSizes,
} = lib;
const { IMAGE_WIDTHS, IMAGE_SIZES, cldUrl, cldBase, cldZoom } = cld;
const { SHOWCASE_CARDS, LAYOUT_VARIANTS, DISPLAY_MODES, SIZES, normalizeShowcase, applyShowcasePatch } = showcaseLib;
const require = createRequire(import.meta.url);

const U = 'https://res.cloudinary.com/djolb5idc/image/upload/v1712345678/tulsi-bridal/products/necklace.jpg';
const U2 = 'https://res.cloudinary.com/djolb5idc/image/upload/v1712345678/tulsi-bridal/products/necklace-2.jpg';
const read = (rel) => readFileSync(path.resolve(rel), 'utf8');
const widthsIn = (srcset) => [...srcset.matchAll(/ (\d+)w(?:,|$)/g)].map((m) => Number(m[1]));

/* ─────────────────────────────────────────────
   A browser, in miniature: `sizes`, srcset choice, and Tailwind's layout
   ───────────────────────────────────────────── */

/* Split on the commas that are not inside parentheses: min(42vw, 260px) is one value. */
function splitTop(s) {
  const out = [];
  let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
function evalLength(v, vw) {
  let m;
  if ((m = /^calc\(\s*([\d.]+)vw\s*([-+])\s*([\d.]+)px\s*\)$/.exec(v))) return (Number(m[1]) * vw) / 100 + (m[2] === '-' ? -1 : 1) * Number(m[3]);
  if ((m = /^min\(\s*([\d.]+)vw\s*,\s*([\d.]+)px\s*\)$/.exec(v))) return Math.min((Number(m[1]) * vw) / 100, Number(m[2]));
  if ((m = /^([\d.]+)px$/.exec(v))) return Number(m[1]);
  if ((m = /^([\d.]+)vw$/.exec(v))) return (Number(m[1]) * vw) / 100;
  throw new Error(`cannot evaluate the sizes value "${v}"`);
}
/** The slot width the browser takes from `sizes` at a viewport: the first clause whose media condition holds. */
function slotWidth(sizes, vw) {
  for (const clause of splitTop(sizes)) {
    const m = /^(?:\((min|max)-width:\s*([\d.]+)px\)\s+)?(.+)$/s.exec(clause);
    if (!m) throw new Error(`bad sizes clause "${clause}"`);
    const holds = !m[1] || (m[1] === 'min' ? vw >= Number(m[2]) : vw <= Number(m[2]));
    if (holds) return evalLength(m[3].trim(), vw);
  }
  throw new Error(`no sizes clause applies at ${vw}px: ${sizes}`);
}
/** The candidate a browser downloads: the smallest that covers slot × density, else the largest. */
const pickWidth = (widths, slot, dpr) => widths.find((w) => w >= slot * dpr) ?? widths[widths.length - 1];

const BP = { sm: 640, md: 768, lg: 1024, xl: 1280 };
const MAX_W = { 'max-w-3xl': 768, 'max-w-5xl': 1024, 'max-w-6xl': 1152, 'max-w-7xl': 1280 };
/** A responsive Tailwind utility `<prop>-<n>` (with optional sm:/md:/lg:/xl: prefix) as it applies at a viewport width. */
function twValue(classes, prop, vw) {
  let best = null;
  for (const token of classes.split(/\s+/)) {
    const m = new RegExp(`^(?:(sm|md|lg|xl):)?${prop}-(\\d+)$`).exec(token);
    if (!m) continue;
    const from = m[1] ? BP[m[1]] : 0;
    if (vw >= from && (!best || from >= best.from)) best = { from, n: Number(m[2]) };
  }
  return best ? best.n : undefined;
}
/** Width of one tile (spanning `span` columns) of `grid` inside `container`, at a viewport width. */
function tileWidth(container, grid, vw, span = 1) {
  const maxToken = container.split(/\s+/).find((t) => MAX_W[t]);
  const room = Math.min(vw, maxToken ? MAX_W[maxToken] : Infinity) - 2 * 4 * twValue(container, 'px', vw);
  const gap = 4 * twValue(grid, 'gap', vw);
  const cols = twValue(grid, 'grid-cols', vw);
  const s = span === 'full' ? cols : Math.min(span, cols);
  const tile = (room - (cols - 1) * gap) / cols;
  return s * tile + (s - 1) * gap;
}
const VIEWPORTS = [320, 360, 375, 390, 412, 430, 500, 600, 639, 640, 641, 700, 744, 767, 768, 769, 820, 900, 1023, 1024, 1025, 1100, 1151, 1152, 1279, 1280, 1281, 1366, 1440, 1536, 1920, 2560];

/* ─────────────────────────────────────────────
   Rendering the real components (sucrase → run → react-dom/server)
   ───────────────────────────────────────────── */
let sucrase = null;
try { sucrase = require('sucrase'); } catch { /* skipped below */ }
const skip = sucrase ? false : 'sucrase is not installed, so the components cannot be transpiled for node --test';
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const SRC = path.resolve('src');
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
function makeLoader(stubs) {
  const cache = new Map();
  function resolveLocal(from, id) {
    let base;
    if (id.startsWith('@/')) base = path.join(SRC, id.slice(2));
    else if (id.startsWith('.')) base = path.resolve(path.dirname(from), id);
    else return null;
    const hit = [base, `${base}.js`, `${base}.jsx`].find(isFile);
    if (!hit) throw new Error(`cannot resolve ${id} from ${from}`);
    return hit;
  }
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const { code } = sucrase.transform(readFileSync(file, 'utf8'), { transforms: ['jsx', 'imports'], jsxRuntime: 'automatic', production: true, filePath: file });
    const mod = { exports: {} };
    cache.set(file, mod);
    const req = (id) => {
      if (Object.hasOwn(stubs, id)) return stubs[id];
      if (id === 'react/jsx-runtime') return require(id);
      const local = resolveLocal(file, id);
      if (local) return load(local);
      throw new Error(`${path.relative(SRC, file)} imports ${id}: add a stub for it in this test`);
    };
    try {
      vm.runInThisContext(`(function (exports, require, module) {${code}\n})`, { filename: file })(mod.exports, req, mod);
    } catch (err) {
      cache.delete(file); // a failed load must fail again, not hand back an empty module
      throw err;
    }
    return mod.exports;
  }
  return (rel) => load(path.join(SRC, rel));
}

/* Hooks: real React, except `useState` can be pinned by call order — the way to see the card
   "after its photo loaded" with a server renderer (ProductCard: 1st = photo index, 2nd = loaded). */
let pinned = {};
let stateCall = 0;
const reactWithPinnedState = {
  ...React,
  useState(initial) {
    const i = stateCall++;
    const [value, set] = React.useState(initial);
    return [Object.hasOwn(pinned, i) ? pinned[i] : value, set];
  },
};
const esm = (value) => ({ __esModule: true, default: value });
const Link = ({ href, children, prefetch: _prefetch, ...rest }) => React.createElement('a', { href, ...rest }, children);
const icons = new Proxy({}, { get: (_, name) => (typeof name === 'string' && /^Fi/.test(name) ? function Icon() { return null; } : undefined), has: () => true });
const toast = Object.assign(() => {}, { success() {}, error() {} });

const loadWithState = sucrase ? makeLoader({
  react: reactWithPinnedState,
  'next/link': esm(Link),
  'react-icons/fi': icons,
  'react-hot-toast': esm(toast),
  '@/context/CartContext': { useCart: () => ({ dispatch() {} }) },
  '@/context/WishlistContext': { useWishlist: () => ({ toggle() {}, isWishlisted: () => false }) },
}) : null;
/* Loaded on first use, so a component that cannot load fails its own tests with a clear error instead of the whole file. */
const lazy = (get) => { let value; return () => (value ??= get()); };
const getProductCard = lazy(() => loadWithState('components/shop/ProductCard.js').default);
const getCatalogImage = lazy(() => loadWithState('components/ui/CatalogImage.jsx').default);
const getCategoryShowcase = lazy(() => makeLoader({
  react: React,
  'next/link': esm(Link),
  'react-icons/fi': icons,
  '@/lib/categoryShowcase': showcaseLib,
})('components/home/CategoryShowcase.jsx').default);

function markup(element, state = {}) {
  pinned = state; stateCall = 0;
  const warnings = [];
  const orig = console.error;
  console.error = (...a) => { warnings.push(a.map(String).join(' ')); };
  let html;
  try { html = renderToStaticMarkup(element); } finally { console.error = orig; }
  assert.deepEqual(warnings, [], 'React warned while rendering');
  return html;
}
const product = (over = {}) => ({ _id: 'p1', name: 'Temple Necklace', category: 'necklace', price: 1000, images: [U], stock: 3, ...over });
const card = (over, props, state) => markup(React.createElement(getProductCard(), { product: product(over), ...props }), state);

test('ProductCard: a piece still flagged rentable in the database is just a piece — no "Rent" pill, rental price or calendar', { skip }, () => {
  const html = card({ isAvailableForRent: true, rentalPrice: 499, rentalStock: 2 }, {});
  assert.match(html, /Temple Necklace/);
  assert.doesNotMatch(html, /\bRent\b|rental|\/day/i);
  assert.equal(html, card({}, {}), 'the rental fields change nothing on the card');
  assert.doesNotMatch(read('src/components/shop/ProductCard.js'), /FiCalendar|isAvailableForRent|rentalPrice/);
});

test('ProductCard: named for a screen reader without repeating itself — the photo names the link, the buttons are 24px targets', { skip }, () => {
  const html = card({}, {});
  const link = html.match(/<a [^>]*href="\/product\/[^"]*"[^>]*class="relative block aspect-\[3\/4\][^"]*"[^>]*>|<a [^>]*class="relative block aspect-\[3\/4\][^"]*"[^>]*href="\/product\/[^"]*"[^>]*>/)?.[0] || '';
  assert.ok(link, 'the photo link is there');
  assert.doesNotMatch(link, /aria-label/, 'its name comes from the photo (alt = the product name) — an aria-label that differs from the visible text fails the WCAG label-in-name rule');
  assert.match(html, /<img [^>]*alt="Temple Necklace"/);
  const noPhoto = card({ images: [] }, {});
  assert.match(noPhoto, /aria-label="Temple Necklace"/, 'without a photo the link keeps its own name');
  assert.match(html, /<button[^>]*aria-label="Add [^"]*to cart"[^>]*class="[^"]*\bh-6 w-6\b/, 'the add-to-cart button is a 24px target (WCAG 2.2 target size)');
  assert.doesNotMatch(html, /text-stone-400/, 'small text on white needs 4.5:1; stone-400 is 2.5:1');
  assert.doesNotMatch(html, /opacity-70/, 'and an opacity on the label made it 3.6:1');
});
const imgs = (html) => [...html.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
const attr = (tag, name) => tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
const unescape = (s) => s?.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

/* ─────────────────────────────────────────────
   1 · Which cards load first
   ───────────────────────────────────────────── */

test('priority rule: the first row (2 cards) is high, cards 3–4 are eager, everything else is lazy', () => {
  assert.deepEqual(PRIORITY_CARDS, { high: 2, eager: 4 });
  assert.deepEqual([0, 1].map(cardPriority), ['high', 'high']);
  assert.deepEqual([2, 3].map(cardPriority), ['eager', 'eager']);
  assert.deepEqual([4, 5, 11, 99].map(cardPriority), [false, false, false, false]);
  assert.deepEqual([undefined, NaN, '7'].map(cardPriority), [false, false, false], 'junk never promotes a card');
});

test('priority → loading attributes: only "high" sets fetchpriority; "eager" leaves it to the browser; the rest are lazy', () => {
  assert.deepEqual(cardLoading('high'), { loading: 'eager', fetchPriority: 'high' });
  assert.deepEqual(cardLoading(true), { loading: 'eager', fetchPriority: 'high' }, 'the old boolean means high');
  assert.deepEqual(cardLoading('eager'), { loading: 'eager' });
  assert.ok(!('fetchPriority' in cardLoading('eager')), 'auto is the default: no redundant attribute');
  assert.deepEqual(cardLoading('low'), { loading: 'lazy', fetchPriority: 'low' });
  assert.deepEqual(cardLoading(false), { loading: 'lazy' });
  assert.deepEqual(cardLoading(undefined), { loading: 'lazy' });
});

test('no grid hand-writes the rule: shop, catalog and wishlist all call cardPriority(i)', () => {
  for (const file of ['src/app/shop/ShopContent.js', 'src/app/catalog/CatalogContent.js', 'src/app/wishlist/page.js']) {
    const src = read(file);
    assert.match(src, /priority=\{cardPriority\(i\)\}/, file);
    assert.doesNotMatch(src, /\bi\s*<\s*\d/, `${file}: a hand-written index condition`);
    assert.doesNotMatch(src, /fetchPriority/i, `${file}: loading hints belong to the shared helper`);
  }
});

test('grids further down a page stay lazy: nothing but the shop and catalog (and the page-top lists) promotes cards', () => {
  assert.doesNotMatch(read('src/components/shop/FeaturedProducts.js'), /priority/);
  /* The home "All Products" grid sits under the hero and the category showcase: it must never compete with the hero. */
  for (const tag of read('src/app/HomeClient.js').match(/<ProductCard\b[^>]*>/g) || []) assert.doesNotMatch(tag, /priority/, tag);
});

test('a rendered grid of 8 cards: 2 high, 2 eager, 4 lazy — and the hover photo is never a candidate for the LCP', { skip }, () => {
  const photo = (i) => U.replace('necklace', `necklace-card-${i}`);
  const html = markup(React.createElement('div', null, Array.from({ length: 8 }, (_, i) => React.createElement(getProductCard(), { key: i, product: product({ _id: `p${i}`, images: [photo(i), U2] }), priority: cardPriority(i) }))));
  const tags = imgs(html);
  assert.equal(tags.length, 8, 'the second photos wait until their first has loaded');
  assert.equal(tags.filter((t) => attr(t, 'fetchPriority') === 'high').length, 2);
  assert.equal(tags.filter((t) => attr(t, 'loading') === 'eager' && !attr(t, 'fetchPriority')).length, 2);
  assert.equal(tags.filter((t) => attr(t, 'loading') === 'lazy').length, 4);
  assert.deepEqual(tags.map((t) => attr(t, 'loading') === 'eager' && attr(t, 'fetchPriority') === 'high'), [true, true, false, false, false, false, false, false]);
  /* We never call preload() for a card (see below). When a grid IS server-rendered, React itself hints the non-lazy <img>s
     (the first four here) from the head, with the very srcset and sizes of the <img>, so it is still one download — and the lazy ones get nothing. */
  const hints = [...html.matchAll(/<link rel="preload" as="image" imageSrcSet="([^"]*)" imageSizes="([^"]*)"/g)].map((m) => [unescape(m[1]), unescape(m[2])]);
  assert.equal(hints.length, 4);
  hints.forEach(([srcSet, sizes], i) => {
    assert.equal(srcSet, unescape(attr(tags[i], 'srcSet')));
    assert.equal(sizes, unescape(attr(tags[i], 'sizes')));
  });
});

test('card images are never preloaded by us: no preload() / preconnect() in the card or the image component', () => {
  for (const file of ['src/components/shop/ProductCard.js', 'src/components/ui/CatalogImage.jsx', 'src/lib/catalogImages.js']) {
    assert.doesNotMatch(read(file), /\bpreload\(|\bpreconnect\(|from 'react-dom'/, file);
  }
});

/* ─────────────────────────────────────────────
   2 · Quality, recipe and ladder
   ───────────────────────────────────────────── */

test('CARD_QUALITY is "good" and is the only quality a tile or thumbnail asks for; hero, PDP and zoom keep "best"', () => {
  assert.equal(CARD_QUALITY, 'good');
  const tile = cardImage(U, { ...CARD_TILE });
  for (const url of [tile.src, ...tile.srcSet.split(', ').map((c) => c.split(' ')[0])]) {
    assert.match(url, /,q_auto:good,/);
    assert.doesNotMatch(url, /q_auto:best/);
  }
  assert.match(cardImage(U, { widths: THUMB_WIDTHS }).src, /,q_auto:good,/, 'thumbnails use the same constant');
  assert.match(cardImage(U, { quality: 'best' }).src, /q_auto:best/, 'a one-line change really changes every URL');
  /* Nothing else spells the quality out: change the constant, everything follows. */
  for (const file of ['src/components/shop/ProductCard.js', 'src/components/ui/CatalogImage.jsx', 'src/app/shop/ShopContent.js', 'src/app/catalog/CatalogContent.js']) {
    assert.doesNotMatch(read(file), /q_auto|quality=['"{]/, file);
  }
  assert.match(read('src/components/ui/CatalogImage.jsx'), /quality = CARD_QUALITY/);
  /* The other tiers were not touched. */
  assert.match(cldBase(U), /q_auto:best/);
  assert.match(cldZoom(U), /q_90/);
});

test('a card tile: f_auto, a 3:4 smart crop that never upscales, one srcset of 320–800px', () => {
  assert.equal(CARD_RATIO, 0.75);
  assert.deepEqual([...CARD_WIDTHS], [320, 480, 640, 800]);
  assert.ok(CARD_WIDTHS.every((w) => IMAGE_WIDTHS.card.includes(w)), 'the shared rungs, so the CDN cache is shared too');
  assert.deepEqual([...THUMB_WIDTHS], [96, 160, 240]);
  assert.ok(THUMB_WIDTHS.every((w) => IMAGE_WIDTHS.thumb.includes(w)));
  const img = cardImage(U, { ...CARD_TILE, sizes: GRID_SIZES.shop });
  assert.deepEqual(widthsIn(img.srcSet), [320, 480, 640, 800]);
  assert.equal(img.srcSet.split(', ').length, 4);
  for (const part of img.srcSet.split(', ')) assert.match(part, /\/upload\/f_auto,q_auto:good,c_lfill,g_auto,ar_0\.75,w_\d+\/v1712345678\/tulsi-bridal\/products\/necklace\.jpg \d+w$/);
  assert.equal(img.src, cldUrl(U, { quality: 'good', ratio: 0.75, width: 640 }), 'the src (for a browser without srcset) is the middle rung');
  assert.equal(img.sizes, GRID_SIZES.shop);
  assert.doesNotMatch(img.srcSet, /dpr_auto|w_1\d{3}|w_2\d{3}/, 'no 1000–2000px rungs: no tile is that wide');
});

test('whiteBg keeps the Background Removal option: its own step first, then the tile; off unless asked', () => {
  assert.equal(typeof cld.WHITE_BG, 'boolean');
  assert.equal(CARD_TILE.whiteBg, cld.WHITE_BG, 'follows NEXT_PUBLIC_CLOUDINARY_BG_REMOVAL, as cldCard did');
  assert.match(cldUrl(U, { width: 480, ratio: 0.75, whiteBg: true }), /\/upload\/e_background_removal\/b_rgb:FFFFFF,f_auto,q_auto:good,c_lfill,g_auto,ar_0\.75,w_480\//);
  assert.doesNotMatch(cldUrl(U, { width: 480, ratio: 0.75 }), /background_removal/, 'the hero and PDP are not affected');
  assert.match(cldUrl(U, { width: 480, whiteBg: true }), /^https:\/\/res\.cloudinary\.com\/djolb5idc\/image\/upload\/e_background_removal\/b_rgb:FFFFFF,/);
  /* The same two-step structure as the old card recipe. */
  assert.equal(cld.cldCard(U, 480, { whiteBg: true }).split('/b_rgb:FFFFFF,')[0], cldUrl(U, { width: 480, whiteBg: true }).split('/b_rgb:FFFFFF,')[0]);
  assert.match(cardImage(U, { whiteBg: true }).srcSet, /e_background_removal/);
  assert.doesNotMatch(cardImage(U).srcSet, /e_background_removal/);
});

test('anything that is not a Cloudinary image upload is returned as it is: no srcset, no sizes', () => {
  for (const other of ['https://images.unsplash.com/photo-1.jpg', '/images/a.jpg', 'https://res.cloudinary.com/djolb5idc/video/upload/a.mp4']) {
    assert.deepEqual(cardImage(other, { ...CARD_TILE, sizes: GRID_SIZES.shop }), { src: other });
  }
});

test('the ladder has no unusable rungs and no gaps: against every real grid, viewport and density', () => {
  const grids = {
    shop: { sizes: GRID_SIZES.shop, container: 'max-w-3xl mx-auto px-3', grid: 'grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3' },
    home: { sizes: GRID_SIZES.home, container: 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8', grid: 'grid-cols-2 md:grid-cols-4 gap-2 md:gap-4' },
  };
  const used = new Set();
  for (const [name, g] of Object.entries(grids)) {
    for (const vw of VIEWPORTS) {
      /* The densities that exist at each width: phones up to 3.5×, unfolded foldables up to ~2.6×, tablets 2×, desktop monitors up to 2.5×. */
      for (const dpr of vw <= 480 ? [1, 1.5, 2, 2.625, 3, 3.5] : vw <= 700 ? [1, 1.5, 2, 2.625] : vw <= 1024 ? [1, 1.5, 2] : [1, 1.5, 2, 2.5]) {
        const need = tileWidth(g.container, g.grid, vw) * dpr;
        const got = pickWidth(CARD_WIDTHS, slotWidth(g.sizes, vw), dpr);
        used.add(got);
        /* Sharp: the file has ≥ 90% of the pixels the tile can show. */
        assert.ok(got >= 0.9 * need, `${name} ${vw}px @${dpr}x: needs ${Math.round(need)}px, gets ${got}`);
        /* Light: never more than one rung above what is needed (320 is the floor). */
        assert.ok(got <= Math.max(320, 1.5 * need), `${name} ${vw}px @${dpr}x: needs ${Math.round(need)}px, gets ${got}`);
      }
    }
  }
  assert.deepEqual([...used].sort((a, b) => a - b), [...CARD_WIDTHS], 'every rung is chosen by some phone, tablet or desktop; none is dead weight');
});

/* ─────────────────────────────────────────────
   3 · `sizes` against the grid CSS
   ───────────────────────────────────────────── */

test('gridSizes: the documented shapes, and a span or an unbounded container', () => {
  assert.equal(GRID_SIZES.shop, '(min-width: 768px) 240px, (min-width: 640px) calc(33.3333vw - 16px), calc(50vw - 16px)');
  assert.equal(GRID_SIZES.home, '(min-width: 1280px) 292px, (min-width: 1024px) calc(25vw - 28px), (min-width: 768px) calc(25vw - 24px), (min-width: 640px) calc(50vw - 28px), calc(50vw - 20px)');
  assert.equal(gridSizes({ cols: [[0, 2]], gap: [[0, 8]], pad: [[0, 16]] }), 'calc(50vw - 20px)', 'no cap, no breakpoints: one calc');
  assert.equal(gridSizes({ cols: [[0, 1]], gap: [[0, 0]], pad: [[0, 0]] }), '100vw');
  assert.equal(gridSizes({ cols: [[0, 3]], gap: [[0, 12]], pad: [[0, 16]], span: 'full' }), 'calc(100vw - 32px)', 'a full-row span is the container');
  assert.equal(gridSizes({ cols: [[0, 3]], gap: [[0, 12]], pad: [[0, 16]], span: 2 }), 'calc(66.6667vw - 25.3333px)', 'two of three columns, and the gap between them');
  assert.equal(gridSizes({ cols: [[0, 2]], gap: [[0, 8]], pad: [[0, 16]], span: 5 }), 'calc(100vw - 32px)', 'a span cannot exceed the columns');
});

function gridOf(file, afterRe) {
  const src = read(file);
  const at = src.search(afterRe);
  assert.ok(at >= 0, `${file}: ${afterRe} not found`);
  const before = src.slice(0, at);
  const grid = [...before.matchAll(/className="(grid [^"]*)"/g)].pop()?.[1];
  const container = [...before.matchAll(/className="([^"]*(?:max-w-\w+ mx-auto px-\d|section-container)[^"]*)"/g)].pop()?.[1];
  assert.ok(grid && container, `${file}: no container/grid classes before ${afterRe}`);
  return { grid, container };
}
const sectionContainer = () => {
  const m = /\.section-container\s*\{\s*@apply ([^;]+);/.exec(read('src/app/globals.css'));
  assert.ok(m, 'globals.css .section-container');
  return m[1];
};

function assertSizesMatchCss(name, sizes, { container, grid }, span = 1) {
  for (const vw of VIEWPORTS) {
    const want = tileWidth(container, grid, vw, span);
    const got = slotWidth(sizes, vw);
    assert.ok(Math.abs(got - want) <= 1, `${name} at ${vw}px: the tile is ${want.toFixed(1)}px wide, sizes says ${got.toFixed(1)}px (${sizes})`);
  }
}

test('sizes match the grid CSS: /shop and /catalog (max-w-3xl, px-3, 2 → 3 columns) — and both pages pass them', () => {
  for (const file of ['src/app/shop/ShopContent.js', 'src/app/catalog/CatalogContent.js']) {
    const css = gridOf(file, /products\.map\(/);
    assert.equal(css.grid, 'grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3', file);
    assert.match(css.container, /max-w-3xl mx-auto px-3/, file);
    assertSizesMatchCss(file, GRID_SIZES.shop, css);
    assert.match(read(file), /<ProductCard [^>]*sizes=\{GRID_SIZES\.shop\}/, `${file} must pass the grid's sizes`);
  }
});

test('sizes match the grid CSS: home "All Products" (section-container, 2 → 4 columns) — the HomeClient grid is checked, not edited', () => {
  const css = gridOf('src/app/HomeClient.js', /browseProducts\.map\(/);
  assert.equal(css.grid, 'grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4');
  assert.match(css.container, /section-container/);
  assertSizesMatchCss('home', GRID_SIZES.home, { container: sectionContainer(), grid: css.grid });
  /* globals.css is what SECTION_CONTAINER mirrors. */
  assert.equal(sectionContainer(), 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8');
  assert.equal(SECTION_CONTAINER.max, 1280);
});

test('sizes match the grid CSS: /wishlist tiles', () => {
  for (const [file, key, container] of [['src/app/wishlist/page.js', 'wishlist', 'max-w-5xl mx-auto px-4']]) {
    const css = gridOf(file, /(?:products|items)\.map\(/);
    assert.equal(css.grid, 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4', file);
    assert.match(css.container, new RegExp(container), file);
    assertSizesMatchCss(key, GRID_SIZES[key], css);
    assert.match(read(file), new RegExp(`sizes=\\{GRID_SIZES\\.${key}\\}`), file);
  }
});

test('sizes of the old generic card string were wrong for these grids (why every grid now passes its own)', () => {
  /* /shop on a desktop: tiles are 240px; "25vw" at 1440 asked for 360px (a 1.5× larger file than needed). */
  assert.equal(slotWidth(IMAGE_SIZES.card, 1440), 360);
  assert.equal(slotWidth(GRID_SIZES.shop, 1440), 240);
  /* home on a 700px tablet: 2 columns of 322px; "33vw" said 231px (a soft photo). */
  assert.ok(Math.abs(slotWidth(IMAGE_SIZES.card, 700) - 231) < 1);
  assert.ok(Math.abs(slotWidth(GRID_SIZES.home, 700) - 322) < 1);
});

/* ── CategoryShowcase ── */

const CLD = (name) => `https://res.cloudinary.com/tulsi/image/upload/v17/tulsi-bridal/categories/${name}.jpg`;
const make = (layout, items = []) => normalizeShowcase({ categoryShowcase: { layout, items } });
const renderShowcase = (showcase) => markup(React.createElement(getCategoryShowcase(), { showcase }));
/** Every card with a photo; `featured` (a card key) is the double-slot "king" card. */
const photographed = (featured) => SHOWCASE_CARDS.map((c) => ({ key: c.key, image: CLD(c.key), isFeatured: c.key === featured }));
/** One entry per rendered card (a card is an <li>; they do not nest). */
function showcaseCards(html) {
  return html.split(/<li(?=[\s>])/).slice(1).map((chunk) => { // not "<link": React hints non-lazy images from the head
    const body = chunk.slice(0, chunk.indexOf('</li>'));
    return {
      liClass: body.match(/^[^>]*?class="([^"]*)"/)?.[1] ?? '',
      body,
      href: unescape(body.match(/<a [^>]*?href="([^"]*)"/)?.[1] ?? ''),
      img: body.match(/<img [^>]*>/)?.[0] ?? null,
      linkClass: body.match(/<a [^>]*?class="([^"]*)"/)?.[1] ?? '',
      frameClass: body.match(/<span class="(relative block overflow-hidden rounded-full[^"]*)"/)?.[1] ?? '',
    };
  });
}
const SLIDE_PX = (liClass, vw) => {
  const vwPart = /(?:^|\s)w-\[(\d+)vw\]/.exec(liClass);
  const cap = /max-w-\[(\d+)px\]/.exec(liClass);
  const md = /md:w-(?:\[(\d+)px\]|(\d+))/.exec(liClass);
  if (vw >= 768 && md) return md[1] ? Number(md[1]) : Number(md[2]) * 4;
  if (vwPart) return Math.min((Number(vwPart[1]) * vw) / 100, cap ? Number(cap[1]) : Infinity);
  return 4 * Number(/(?:^|\s)w-(\d+)(?:\s|$)/.exec(liClass)[1]);
};

test('sizes match the CSS in every CategoryShowcase layout: grid tiles, double-slot "king" cards, full-row banners, circles, sliders', { skip }, () => {
  const container = sectionContainer();
  let checked = 0;
  for (const v of LAYOUT_VARIANTS) {
    for (const mode of DISPLAY_MODES) {
      for (const size of SIZES) {
        for (const featured of [false, true]) {
          const showcase = make({ layoutVariant: v.value, displayMode: mode.value, size }, photographed(featured ? 'set' : undefined));
          const html = renderShowcase(showcase);
          const list = html.match(/<ul [^>]*?class="([^"]*)"/)?.[1];
          for (const c of showcaseCards(html)) {
            assert.ok(c.img, `${v.value}/${mode.value}/${size}: a photo`);
            const sizes = unescape(attr(c.img, 'sizes'));
            for (const vw of VIEWPORTS) {
              let want;
              if (mode.value === 'slider') want = SLIDE_PX(c.liClass, vw);
              else if (v.value === 'circle') want = SLIDE_PX(c.frameClass, vw);
              else want = tileWidth(container, list, vw, /col-span-full/.test(c.liClass) ? 'full' : /col-span-2/.test(c.liClass) ? 2 : 1);
              assert.ok(Math.abs(slotWidth(sizes, vw) - want) <= 1, `${v.value}/${mode.value}/${size}${featured ? '/featured' : ''} ${c.href} at ${vw}px: the photo is ${want.toFixed(1)}px wide, sizes says ${slotWidth(sizes, vw).toFixed(1)}px (${sizes})`);
            }
            checked += 1;
          }
        }
      }
    }
  }
  assert.equal(checked, 4 * 2 * 3 * 2 * 6);
});

test('the showcase\'s own sizes arithmetic agrees with gridSizes() (it cannot import it: its isolated test loader)', { skip }, () => {
  const ex = { ...SECTION_CONTAINER, gap: [[0, 12], [768, 16]] };
  const sizesOf = (html, liClass) => unescape(attr(showcaseCards(html).find((c) => c.liClass === liClass).img, 'sizes'));
  for (const [variant, size, cols] of [['king_size', 'large', [[0, 2], [768, 3]]], ['square', 'small', [[0, 3], [768, 6]]], ['wide', 'medium', [[0, 1], [768, 2]]], ['square', 'medium', [[0, 2], [768, 4]]]]) {
    const html = renderShowcase(make({ layoutVariant: variant, displayMode: 'grid', size }, photographed('set')));
    assert.equal(sizesOf(html, ''), gridSizes({ ...ex, cols }), `${variant}/${size} tile`);
    const span = variant === 'wide' ? 'full' : 2;
    assert.equal(sizesOf(html, variant === 'wide' ? 'col-span-full' : 'col-span-2 row-span-2'), gridSizes({ ...ex, cols, span }), `${variant}/${size} featured`);
  }
});

test('a featured "king" card is no longer under-sized: it asks for the 2 columns (or the full row) it really occupies', { skip }, () => {
  /* Phone, Square/Medium (2 columns): the featured card spans both = the whole container (≈358px at 390px). The old string said 50vw (195px). */
  const html = renderShowcase(make({ layoutVariant: 'square', displayMode: 'grid', size: 'medium' }, photographed('set')));
  const featured = showcaseCards(html).find((c) => c.liClass.includes('col-span-2'));
  const sizes = unescape(attr(featured.img, 'sizes'));
  assert.ok(Math.abs(slotWidth(sizes, 390) - 358) <= 1);
  assert.ok(slotWidth(sizes, 390) > 1.8 * 195);
  const wide = renderShowcase(make({ layoutVariant: 'wide', displayMode: 'grid', size: 'large' }, photographed('set')));
  const banner = showcaseCards(wide).find((c) => c.liClass === 'col-span-full');
  assert.ok(Math.abs(slotWidth(unescape(attr(banner.img, 'sizes')), 1440) - 1216) <= 1, 'a featured banner is the whole container on a desktop (the old string said 50vw = 720px)');
});

/* ─────────────────────────────────────────────
   4 · Reserved boxes
   ───────────────────────────────────────────── */

test('ProductCard: the photo frame is a 3:4 box reserved before any byte arrives; the photos only fill it', { skip }, () => {
  const html = card({ images: [U, U2] }, { priority: 'high' }, { 1: true });
  const frame = html.match(/<a [^>]*class="([^"]*aspect-\[3\/4\][^"]*)"/)?.[1];
  assert.ok(frame, 'the photo link has aspect-[3/4]');
  assert.match(frame, /\brelative\b/);
  assert.match(frame, /\boverflow-hidden\b/);
  const photoLink = html.slice(html.indexOf('<a '), html.indexOf('</a>'));
  assert.equal(imgs(photoLink).length, 2, 'both photos are inside the reserved frame');
  for (const tag of imgs(html)) {
    assert.match(attr(tag, 'class'), /\babsolute inset-0 h-full w-full object-cover\b/, 'out of the flow: a photo arriving cannot move anything');
    assert.doesNotMatch(tag, / width=| height=/, 'the frame, not the photo, owns the size');
  }
  /* Text below the photo has fixed-height lines: the card height is known before the photo. */
  assert.match(html, /contain-intrinsic-size:auto_300px/);
});

test('CategoryShowcase: every photo sits in a box with its own aspect ratio or fixed size; lazy and decoded off-thread', { skip }, () => {
  for (const v of LAYOUT_VARIANTS) {
    for (const mode of DISPLAY_MODES) {
      const html = renderShowcase(make({ layoutVariant: v.value, displayMode: mode.value, size: 'medium' }, photographed()));
      const list = showcaseCards(html);
      assert.equal(list.length, 6);
      for (const c of list) {
        const tag = c.img;
        assert.ok(tag, `${v.value}/${mode.value}`);
        assert.match(tag, / loading="lazy"/);
        assert.match(tag, / decoding="async"/);
        assert.doesNotMatch(tag, /fetchPriority|loading="eager"/i, 'below the fold: never prioritised');
        const box = v.value === 'circle' ? c.frameClass : c.linkClass;
        assert.match(box, /\brelative\b.*\boverflow-hidden\b|\boverflow-hidden\b.*\brelative\b/, `${v.value}/${mode.value}: the box clips and positions its photo`);
        assert.match(box, v.value === 'circle' ? /\b(?:w-full aspect-square|w-\d+ h-\d+ md:w-\d+ md:h-\d+)\b/ : /(?:^|\s)aspect-(?:square|video|\[4\/5\])(?:\s|$)/, `${v.value}/${mode.value}: a reserved size (${box})`);
        assert.match(c.body, /<div class="absolute inset-0 overflow-hidden[^"]*"><img /, 'the photo is out of the flow inside it');
      }
    }
  }
});

test('every product / category image in the listing files is a reserved box + right-sized srcset (no next/image, no bare full-size <img>)', () => {
  const files = [
    'src/components/shop/ProductCard.js', 'src/components/home/CategoryShowcase.jsx', 'src/app/shop/ShopContent.js', 'src/app/catalog/CatalogContent.js',
    'src/app/wishlist/page.js', 'src/app/cart/page.js',
    'src/app/order-success/page.js', 'src/app/account/page.js', 'src/app/track-order/page.js', 'src/components/chat/ChatInbox.js',
  ];
  let found = 0;
  for (const file of files) {
    const src = read(file);
    assert.doesNotMatch(src, /from 'next\/image'/, `${file}: a full master through /_next/image`);
    for (const m of src.matchAll(/<CatalogImage\b[^>]*>/g)) {
      found += 1;
      const tag = m[0];
      assert.match(tag, /\bsizes=/, `${file}: without sizes the browser assumes 100vw and takes the biggest file — ${tag}`);
      if (file.endsWith('ProductCard.js')) continue; // its frame is checked on the rendered card
      if (/\bfill\b/.test(tag)) {
        const before = src.slice(Math.max(0, m.index - 700), m.index);
        const box = [...before.matchAll(/className="([^"]*\brelative\b[^"]*)"/g)].pop()?.[1] || '';
        assert.match(box, /\baspect-(?:square|\[\d+\/\d+\])\b|\bw-\d+ h-\d+\b/, `${file}: the parent of a fill image must reserve its size — ${box}`);
      } else {
        assert.match(tag, /\bwidth=\{\d+\}/, `${file}: ${tag}`);
        assert.match(tag, /\bheight=\{\d+\}/, `${file}: ${tag}`);
      }
    }
  }
  assert.ok(found >= 7, `expected at least 7 CatalogImage sites (ProductCard, 2 grids, 4 thumbnails), found ${found}`);
  assert.doesNotMatch(read('src/components/home/CategoryShowcase.jsx'), /<Image\b/);
});

/* ─────────────────────────────────────────────
   5 · ProductCard, as the browser first receives it
   ───────────────────────────────────────────── */

test('ProductCard (Cloudinary): srcset + sizes, the priority attributes, async decoding, a blurred preview', { skip }, () => {
  const html = card({}, { priority: 'high', sizes: GRID_SIZES.shop });
  const [tag] = imgs(html);
  assert.equal(imgs(html).length, 1);
  assert.match(tag, /loading="eager"/);
  assert.match(tag, /fetchPriority="high"/);
  assert.match(tag, /decoding="async"/);
  assert.match(tag, /alt="Temple Necklace"/);
  assert.match(tag, /draggable="false"/);
  assert.deepEqual(widthsIn(unescape(attr(tag, 'srcSet'))), [320, 480, 640, 800]);
  assert.match(unescape(attr(tag, 'srcSet')), /f_auto,q_auto:good,c_lfill,g_auto,ar_0\.75,w_320\//);
  assert.equal(unescape(attr(tag, 'sizes')), GRID_SIZES.shop);
  assert.match(unescape(attr(tag, 'src')), /w_640\//);
  assert.doesNotMatch(html, /_next\/image|<picture|<source/);
  /* A server-rendered high-priority <img> is hinted by React with its own srcset and sizes: one download, not two. */
  const hint = html.match(/<link rel="preload" as="image" imageSrcSet="([^"]*)" imageSizes="([^"]*)"/);
  assert.equal(unescape(hint[1]), unescape(attr(tag, 'srcSet')));
  assert.equal(unescape(hint[2]), unescape(attr(tag, 'sizes')));
  /* Shimmer + a ~1KB blurred preview behind the sharp photo until it loads. */
  assert.match(unescape(html), /background-image:url\("https:\/\/res\.cloudinary\.com\/djolb5idc\/image\/upload\/f_auto,q_auto:low,w_32,ar_3:4,c_fill,g_auto,e_blur:400\//);
  assert.match(html, /class="absolute inset-0 skeleton opacity-50"/);
  assert.match(attr(tag, 'class'), /opacity-0/, 'invisible until onLoad');
});

test('ProductCard: every priority renders the right attributes — and the old boolean still means high', { skip }, () => {
  const cases = [[false, 'lazy', undefined], [undefined, 'lazy', undefined], ['eager', 'eager', undefined], ['high', 'eager', 'high'], [true, 'eager', 'high']];
  for (const [priority, loading, fetchPriority] of cases) {
    const [tag] = imgs(card({}, { priority }));
    assert.equal(attr(tag, 'loading'), loading, String(priority));
    assert.equal(attr(tag, 'fetchPriority'), fetchPriority, String(priority));
    assert.equal(attr(tag, 'decoding'), 'async', 'every photo decodes off-thread, first fold or not');
    assert.doesNotMatch(tag, /fetchPriority="auto"/, 'a redundant "auto" is never written');
  }
});

test('ProductCard: sizes default to the generic card string; a grid passes its own', { skip }, () => {
  assert.equal(unescape(attr(imgs(card({}))[0], 'sizes')), IMAGE_SIZES.card);
  assert.equal(unescape(attr(imgs(card({}, { sizes: GRID_SIZES.home }))[0], 'sizes')), GRID_SIZES.home);
});

test('ProductCard (not Cloudinary): a plain <img> in the same reserved frame — no srcset, no preview, same loading rules', { skip }, () => {
  const url = 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=800';
  const html = card({ images: [url] }, { priority: 'high', sizes: GRID_SIZES.shop });
  const [tag] = imgs(html);
  assert.equal(unescape(attr(tag, 'src')), url);
  assert.doesNotMatch(tag, /srcSet|sizes=/i, 'nothing to negotiate');
  assert.match(tag, /loading="eager"/);
  assert.match(tag, /fetchPriority="high"/);
  assert.match(tag, /decoding="async"/);
  assert.match(html, /aspect-\[3\/4\]/);
  assert.doesNotMatch(html, /background-image/, 'no blurred preview without Cloudinary');
  assert.doesNotMatch(html, /_next\/image/);
  assert.match(imgs(card({ images: [url] }))[0], /loading="lazy"/);
});

test('ProductCard: the second photo is fetched only after the first has loaded, lazily and last in the queue', { skip }, () => {
  const two = { images: [U, U2] };
  /* First paint: one photo (the one being waited for) — the hover photo does not compete with it. */
  assert.equal(imgs(card(two, { priority: 'high' })).length, 1);
  /* Once the first is on screen: the hover photo mounts, decorative, invisible, lazy + low priority. */
  const html = card(two, { priority: 'high' }, { 1: true });
  const [main, hover] = imgs(html);
  assert.equal(imgs(html).length, 2);
  assert.match(main, /group-hover:opacity-0/, 'the first fades out on hover only when there is a second to show');
  assert.match(main, /opacity-100/);
  assert.match(hover, /alt=""/);
  assert.match(hover, /loading="lazy"/);
  assert.match(hover, /fetchPriority="low"/);
  assert.match(hover, /decoding="async"/);
  assert.match(attr(hover, 'class'), /\bopacity-0\b/);
  assert.match(unescape(attr(hover, 'src')), /w_640\//);
  assert.match(unescape(attr(hover, 'src')), /necklace-2\.jpg/);
  assert.doesNotMatch(html, /class="absolute inset-0 skeleton/, 'the shimmer is gone once loaded');
  /* One photo → no hover photo, and no hover fade. */
  const one = card({}, { priority: 'high' }, { 1: true });
  assert.equal(imgs(one).length, 1);
  assert.doesNotMatch(one, /group-hover:opacity-0/);
  /* After a swipe to the second photo there is no "next" hover photo. */
  assert.equal(imgs(card(two, {}, { 0: 1, 1: true })).length, 1);
});

test('CatalogImage: nothing without a source; thumbnails and extra props reach the <img>', { skip }, () => {
  assert.equal(markup(React.createElement(getCatalogImage(), { src: '', alt: 'x' })), '');
  const html = markup(React.createElement(getCatalogImage(), { src: U, alt: 'Chain', widths: THUMB_WIDTHS, sizes: '80px', width: 40, height: 40, className: 'rounded', 'data-testid': 'thumb' }));
  const [tag] = imgs(html);
  assert.deepEqual(widthsIn(unescape(attr(tag, 'srcSet'))), [96, 160, 240]);
  assert.equal(attr(tag, 'sizes'), '80px');
  assert.match(tag, /width="40"/);
  assert.match(tag, /height="40"/);
  assert.match(tag, /loading="lazy"/);
  assert.match(tag, /decoding="async"/);
  assert.match(tag, /data-testid="thumb"/);
  assert.equal(attr(tag, 'class'), 'rounded', 'no fill classes unless asked');
  assert.doesNotMatch(unescape(attr(tag, 'srcSet')), /ar_/, 'a thumbnail keeps the whole photo (its box crops it)');
  assert.match(attr(imgs(markup(React.createElement(getCatalogImage(), { src: U, alt: 'x', fill: true, className: 'object-cover' })))[0], 'class'), /^absolute inset-0 h-full w-full object-cover$/);
});
