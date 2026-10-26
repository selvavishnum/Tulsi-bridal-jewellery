/* ─────────────────────────────────────────────
   Product page (PDP) image performance — what the browser receives and what
   it then fetches, for the LCP photo and everything around it.

   The page is rendered with the real React, the real CloudinaryPicture and
   the real ProductDetail (only the app's contexts, router and network hooks
   are stubbed), so the markup checked here is the first HTML the server
   sends. A small model of the browser's <picture> source selection (media
   queries, `type`, `sizes`, srcset density) then answers "which file would a
   390px phone / a 1920px desktop download?" — the thing PageSpeed measures.

   What is guarded:
     • the product and its photo are in the first HTML (not after hydration)
     • the phone and the desktop copy of the gallery never both download the
       photo: the hidden one is served a 1×1 pixel at every width, including
       the fractional widths browser zoom produces around the lg breakpoint
     • each copy has its own preload, with the right media
     • `sizes` is the width the CSS really draws (checked against the layout
       classes), so a 1920px desktop does not fetch the 1080/1800px file
     • boxes are reserved (no CLS): photo, thumbnails, rating row
     • thumbnails are lazy/async, small, 'good' quality
     • picking another photo loads it promptly and leaves the loupe, the
       full-screen viewer and their sharp tiers working
     • the server page reads the product once, and streams the page without
       waiting for the structured-data reads

   Run: npm test
   ───────────────────────────────────────────── */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import * as lib from '../src/lib/cloudinaryImage.js';
import * as deliveryLib from '../src/lib/deliveryMessage.js';
import { DEFAULT_CHARGES } from '../src/lib/storeCharges.js';

const { IMAGE_WIDTHS, PIXEL, cldBase, cldZoom, cldDeepZoom } = lib;
const require = createRequire(import.meta.url);

let sucrase = null;
try { sucrase = require('sucrase'); } catch { /* skipped below */ }
const skip = sucrase ? false : 'sucrase is not installed, so the .js/.jsx sources cannot be transpiled for node --test';
const React = require('react');
const ReactDOM = require('react-dom');
const { renderToString } = require('react-dom/server');

/* ── a tiny module loader: real sources, stubbed boundaries ── */
const SRC = path.resolve('src');
const isFile = (f) => { try { return statSync(f).isFile(); } catch { return false; } };
const aliasOf = (file) => `@/${path.relative(SRC, file).replace(/\\/g, '/').replace(/\.jsx?$/, '')}`;

function makeLoader(stubs) {
  const cache = new Map();
  function resolveLocal(from, id) {
    const base = id.startsWith('@/') ? path.join(SRC, id.slice(2)) : path.resolve(path.dirname(from), id);
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
      if (id.startsWith('@/') || id.startsWith('.')) {
        const f = resolveLocal(file, id);
        return Object.hasOwn(stubs, aliasOf(f)) ? stubs[aliasOf(f)] : load(f);
      }
      throw new Error(`${path.relative(SRC, file)} imports ${id}: add a stub for it in this test`);
    };
    vm.runInThisContext(`(function (exports, require, module) {${code}\n})`, { filename: file })(mod.exports, req, mod);
    return mod.exports;
  }
  return (relPath) => load(path.join(SRC, relPath));
}

const noop = () => {};
const esm = (value) => ({ __esModule: true, default: value });
const calls = { carousel: 0, zoom: 0 };

/* Everything ProductDetail talks to that is not an image concern. */
function stubsFor(reactModule) {
  return {
    react: reactModule,
    'react-dom': ReactDOM,
    '@/lib/cloudinaryImage': lib,
    'next/navigation': { useParams: () => ({ id: 'p1' }), useRouter: () => ({ push: noop, replace: noop }) },
    'next-auth/react': { useSession: () => ({ data: null }) },
    'next/link': esm(function Link() { return null; }),
    /* HEAD's gallery used next/image; a plain <img> keeps that version loadable so the guards below fail on assertions. */
    'next/image': esm(function Image(props) { return React.createElement('img', { src: props.src, 'data-next-image': '' }); }),
    'react-icons/fi': new Proxy({}, { get: (_, key) => (key === '__esModule' ? false : function Icon() { return null; }) }),
    'react-hot-toast': esm(Object.assign(noop, { success: noop, error: noop })),
    '@/context/CartContext': { useCart: () => ({ dispatch: noop, charges: null }) },
    '@/context/WishlistContext': { useWishlist: () => ({ toggle: noop, isWishlisted: () => false }) },
    '@/hooks/useProductTracking': { useProductTracking: () => ({ recordCarouselClick: () => { calls.carousel += 1; }, recordZoomInteraction: () => { calls.zoom += 1; } }) },
    '@/components/product/useStoreWhatsApp': esm(() => '917695868787'),
    '@/components/product/useBuyNowReturn': esm(noop),
    '@/components/chat/ChatWithSeller': esm(function ChatWithSeller() { return null; }),
    '@/components/ui/LoadingSpinner': esm(function LoadingSpinner() { return React.createElement('i', { 'data-loading': '' }); }),
  };
}
const detailPath = 'app/product/[id]/ProductDetail.js';
const loadDetail = (reactModule = React) => makeLoader(stubsFor(reactModule))(detailPath);

/* ── fixture ── */
const IMG = (n) => `https://res.cloudinary.com/djolb5idc/image/upload/v1712345${n}/tulsi-bridal/products/necklace-${n}.jpg`;
const IMAGES = [IMG(0), IMG(1), IMG(2), IMG(3)];
const PIECE = {
  id: 'p1', name: 'Kundan Bridal Necklace', category: 'necklace', price: 24999, discountPrice: 19999, stock: 3,
  description: 'A hand-set kundan necklace.', images: IMAGES, ratings: { average: 4.6, count: 12 },
};
/* One query, Tailwind's lg, for both copies: the desktop copy is shown under it
   (showWhen), the phone copy hidden under it (hideWhen) — exact complements at
   every width, fractional ones included. PHONE_MEDIA is what the phone copy's
   preload carries. */
const DESKTOP_MEDIA = '(min-width: 1024px)';
const PHONE_MEDIA = `not all and ${DESKTOP_MEDIA}`;

function ssr(element) {
  const warnings = [];
  const orig = console.error;
  console.error = (...a) => { warnings.push(a.map(String).join(' ')); };
  let html;
  try { html = renderToString(element); } finally { console.error = orig; }
  assert.deepEqual(warnings, [], 'React warned while rendering');
  return html;
}
const text = (html) => html.replace(/<!-- -->/g, '');

/* ── a model of the browser: <picture> source selection ── */
const tag = (s, name) => s.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const pictures = (html) => [...html.matchAll(/<picture>([\s\S]*?)<\/picture>/g)].map((m) => m[1]);
const links = (html, rel) => [...html.matchAll(new RegExp(`<link rel="${rel}"[^>]*>`, 'g'))].map((m) => m[0]);

function mediaMatches(query, vw) {
  const negated = query.startsWith('not all and ');
  const m = query.replace(/^not all and /, '').match(/^\((min|max)-width: ([\d.]+)px\)$/);
  assert.ok(m, `the test's media model does not know "${query}"`);
  /* Chromium snaps a max-width length UP to its 1/64px layout grid, so
     "max-width: 1023.99px" is 1024px to it (measured in Chromium 141). */
  const ok = m[1] === 'min' ? vw >= Number(m[2]) : vw <= Math.ceil(Number(m[2]) * 64) / 64;
  return negated ? !ok : ok;
}
function lengthPx(v, vw) {
  const calc = v.match(/^calc\(([\d.]+)vw - ([\d.]+)px\)$/);
  if (calc) return (vw * Number(calc[1])) / 100 - Number(calc[2]);
  if (/vw$/.test(v)) return (vw * parseFloat(v)) / 100;
  if (/px$/.test(v)) return parseFloat(v);
  throw new Error(`the test's sizes model does not know "${v}"`);
}
/** The slot width the `sizes` attribute declares at this viewport. */
function slotPx(sizes, vw) {
  for (const part of sizes.split(/,(?![^(]*\))/)) {
    const m = part.trim().match(/^(?:(\([^)]*\))\s+)?(\S.*)$/);
    if (m[1] && !mediaMatches(m[1], vw)) continue;
    return lengthPx(m[2], vw);
  }
  throw new Error(`no sizes entry matches ${vw}: ${sizes}`);
}
/** Browser's srcset pick: the smallest candidate that covers slot × density, else the largest. */
function pickCandidate(srcset, sizes, vw, dpr) {
  if (srcset.startsWith('data:')) return { url: srcset, w: 1 };
  const cands = srcset.split(', ').map((c) => { const [url, w] = c.split(' '); return { url, w: parseInt(w, 10) }; });
  const need = slotPx(sizes || '100vw', vw) * dpr;
  return cands.find((c) => c.w >= need) || cands[cands.length - 1];
}
/** What one <picture> downloads in a browser that decodes AVIF. */
function choose(inner, { vw, dpr = 1 }) {
  for (const el of inner.matchAll(/<(source|img) [^>]*>/g)) {
    const t = el[0];
    if (el[1] === 'source') {
      const media = tag(t, 'media');
      if (media && !mediaMatches(media, vw)) continue;
      const type = tag(t, 'type');
      if (type && !['image/avif', 'image/webp'].includes(type)) continue;
      return { ...pickCandidate(tag(t, 'srcSet'), tag(t, 'sizes'), vw, dpr), type: type || 'pixel' };
    }
    return { ...pickCandidate(tag(t, 'srcSet') || tag(t, 'src'), tag(t, 'sizes'), vw, dpr), type: 'fallback' };
  }
  throw new Error('empty <picture>');
}
const isPixel = (pick) => pick.url === PIXEL;

/* Phone = Tailwind's lg:hidden copy shows; desktop = hidden lg:block copy shows (lg = 1024px). */
const cssShows = (vw) => (vw >= 1024 ? DESKTOP_MEDIA : PHONE_MEDIA);
/** Each picture, tagged by its twin (from its pixel source) and role (the main photo is eager; thumbnails are lazy). */
function gallery(html) {
  return pictures(html).map((inner) => {
    const pixel = inner.match(/<source media="([^"]+)" srcSet="data:/)?.[1];
    const img = inner.match(/<img [^>]*>/)[0];
    /* the desktop copy fetches the pixel `not all and lg`; the phone copy fetches it AT lg */
    const twin = pixel === PHONE_MEDIA ? DESKTOP_MEDIA : pixel === DESKTOP_MEDIA ? PHONE_MEDIA : undefined;
    return { inner, img, twin, main: tag(img, 'loading') === 'eager' };
  });
}

/* ═════════════ the first HTML ═════════════ */

describe('PDP: the media model', () => {
  test('a hand-written "max-width: 1023.99px" would still match at exactly 1024px — why the twins use one query, shown and hidden', () => {
    assert.equal(mediaMatches('(max-width: 1023.99px)', 1024), true, 'the trap: both copies would download at 1024px');
    assert.equal(mediaMatches('(max-width: 1023.99px)', 1024.01), false);
    for (const vw of [1023, 1023.5, 1023.984375, 1023.99, 1024, 1024.01, 1025]) {
      assert.notEqual(mediaMatches(DESKTOP_MEDIA, vw), mediaMatches(PHONE_MEDIA, vw), `${vw}px: exactly one of the two copies is visible`);
    }
  });
});

describe('PDP: server-rendered markup', { skip }, () => {
  const ProductDetail = skip ? null : loadDetail().default;
  const html = skip ? '' : ssr(React.createElement(ProductDetail, { initialProduct: PIECE }));
  const pics = skip ? [] : gallery(html);

  test('the product, its price and its photo are in the HTML the server sends (not fetched after hydration)', () => {
    assert.match(html, /<h1[^>]*>Kundan Bridal Necklace<\/h1>/);
    assert.match(text(html), /₹19,999/);
    assert.doesNotMatch(html, /data-loading/, 'no spinner: the product arrived with the page');
    assert.equal(pics.filter((p) => p.main).length, 2, 'the phone and desktop copies of the main photo');
    assert.ok(pics.every((p) => p.inner.includes('res.cloudinary.com')));
  });

  test('every width: exactly ONE main photo is downloaded — the copy CSS hides gets the 1×1 pixel', () => {
    const widths = [320, 360, 390, 412, 768, 1000, 1023, 1023.5, 1023.984375 /* widest phone layout: 1024 − 1/64 */, 1023.99, 1024, 1024.01, 1100, 1280, 1536, 1920, 2560];
    for (const vw of widths) for (const dpr of [1, 2, 3]) {
      const mains = pics.filter((p) => p.main).map((p) => ({ twin: p.twin, pick: choose(p.inner, { vw, dpr }) }));
      const photos = mains.filter((m) => !isPixel(m.pick));
      assert.equal(photos.length, 1, `${vw}px @${dpr}x downloads ${photos.length} main photos`);
      assert.equal(photos[0].twin, cssShows(vw), `${vw}px: the photo must be the copy that is visible (${cssShows(vw)}), not the hidden one`);
      assert.ok(photos[0].pick.url.includes('res.cloudinary.com') && photos[0].pick.url.includes('necklace-0.jpg'));
    }
  });

  test('every width: only the visible strip\'s thumbnails are downloaded, one file each', () => {
    for (const vw of [390, 1023.5, 1024, 1920]) {
      const thumbs = pics.filter((p) => !p.main).map((p) => ({ twin: p.twin, pick: choose(p.inner, { vw }) }));
      const photos = thumbs.filter((t) => !isPixel(t.pick));
      assert.equal(photos.length, IMAGES.length, `${vw}px`);
      assert.ok(photos.every((t) => t.twin === cssShows(vw)), `${vw}px: thumbnails of the hidden strip must be pixels`);
      assert.equal(new Set(photos.map((t) => t.pick.url)).size, IMAGES.length, 'a different file per thumbnail');
    }
  });

  test('the file chosen is sized for the box it fills — a 1920px desktop does not fetch the 1080/1800px rung', () => {
    const main = (twin) => pics.find((p) => p.main && p.twin === twin);
    const widthAt = (twin, vw, dpr) => choose(main(twin).inner, { vw, dpr }).w;
    /* [twin, viewport, density, expected rung of IMAGE_WIDTHS.gallery] — slot × density, hand-derived from the layout. */
    for (const [twin, vw, dpr, expected] of [
      [PHONE_MEDIA, 360, 2, 828],     // 720px needed
      [PHONE_MEDIA, 412, 1.75, 828],  // 721px (PageSpeed's phone profile)
      [PHONE_MEDIA, 390, 3, 1400],    // 1170px
      [PHONE_MEDIA, 768, 2, 1800],    // a tablet draws the square full width: 1536px
      [DESKTOP_MEDIA, 1024, 1, 480],  // box 414px
      [DESKTOP_MEDIA, 1280, 1, 640],  // box 542px
      [DESKTOP_MEDIA, 1920, 1, 640],  // still 542px: IMAGE_SIZES.gallery (50vw = 960px) would pick 1080
      [DESKTOP_MEDIA, 1920, 2, 1400], // 1084px
    ]) assert.equal(widthAt(twin, vw, dpr), expected, `${twin} ${vw}px @${dpr}x`);
  });

  test('`sizes` equals the width the layout classes really draw, from 1024px to 2560px', () => {
    /* The assumptions behind the number, checked against the source rather than trusted. */
    const css = readFileSync('src/app/globals.css', 'utf8');
    assert.match(css, /\.section-container\s*\{\s*@apply max-w-7xl mx-auto px-4 sm:px-6 lg:px-8;/, 'container: 1280px max, 32px padding at lg');
    const src = readFileSync('src/app/product/[id]/ProductDetail.js', 'utf8');
    assert.match(src, /grid lg:grid-cols-2/);
    assert.match(src, /hidden lg:block p-8 bg-stone-50\/60/);
    assert.match(src, /relative aspect-square rounded-2xl overflow-hidden bg-white border border-stone-100/);
    const tw = require('../tailwind.config.js');
    assert.equal(tw.theme.screens, undefined, 'lg is still Tailwind\'s default 1024px — the media queries mirror it');
    assert.equal(tw.theme.extend.screens, undefined);

    const sizes = tag(pics.find((p) => p.main && p.twin === DESKTOP_MEDIA).img, 'sizes');
    for (let vw = 1024; vw <= 2560; vw += 16) {
      const drawn = (Math.min(vw, 1280) - 64) / 2 - 64 - 2; // container − 2 columns − p-8 − 1px borders
      assert.ok(Math.abs(slotPx(sizes, vw) - drawn) < 1, `${vw}px: sizes says ${slotPx(sizes, vw)}, CSS draws ${drawn}`);
    }
    assert.equal(tag(pics.find((p) => p.main && p.twin === PHONE_MEDIA).img, 'sizes'), '100vw');
  });

  test('preloads: one per twin, each only for its own viewport, AVIF, high priority, same candidates as the <source>', () => {
    const preloads = links(html, 'preload').filter((l) => l.includes('as="image"'));
    assert.equal(preloads.length, 2, 'one per twin (React keeps both because their sizes differ)');
    assert.equal(links(html, 'preconnect').length, 1);
    for (const twin of [PHONE_MEDIA, DESKTOP_MEDIA]) {
      const mine = preloads.filter((l) => tag(l, 'media') === twin);
      assert.equal(mine.length, 1, twin);
      assert.match(mine[0], /type="image\/avif"/);
      assert.match(mine[0], /fetchPriority="high"/);
      const main = pics.find((p) => p.main && p.twin === twin);
      const avif = main.inner.match(/<source type="image\/avif"[^>]*>/)[0];
      assert.equal(tag(mine[0], 'imageSrcSet'), tag(avif, 'srcSet'), 'one download, not two');
      assert.equal(tag(mine[0], 'imageSizes'), tag(avif, 'sizes'));
    }
    assert.notEqual(tag(preloads[0], 'imageSizes'), tag(preloads[1], 'imageSizes'));
  });

  test('main photo: AVIF → WebP → progressive JPEG, the gallery ladder, quality best, eager + high priority', () => {
    for (const twin of [PHONE_MEDIA, DESKTOP_MEDIA]) {
      const { inner, img } = pics.find((p) => p.main && p.twin === twin);
      const sources = [...inner.matchAll(/<source [^>]*>/g)].map((m) => m[0]);
      assert.deepEqual(sources.map((s) => tag(s, 'type') || 'pixel'), ['pixel', 'image/avif', 'image/webp']);
      const widthsOf = (srcset) => [...srcset.matchAll(/ (\d+)w(?:,|$)/g)].map((m) => Number(m[1]));
      for (const [i, fmt] of [[1, 'f_avif'], [2, 'f_webp']]) {
        const set = tag(sources[i], 'srcSet');
        assert.deepEqual(widthsOf(set), IMAGE_WIDTHS.gallery);
        assert.ok(set.split(', ').every((c) => c.includes(`${fmt},q_auto:best,c_limit,w_`)), `${fmt} at q_auto:best, never upscaled, whole photo (no crop)`);
      }
      const jpg = tag(img, 'srcSet');
      assert.deepEqual(widthsOf(jpg), IMAGE_WIDTHS.gallery);
      assert.ok(jpg.split(', ').every((c) => c.includes('f_jpg,q_auto:best,c_limit,w_') && c.includes('fl_progressive')));
      assert.equal(tag(img, 'loading'), 'eager');
      assert.equal(tag(img, 'fetchPriority'), 'high');
      assert.equal(tag(img, 'decoding'), 'async');
      assert.equal(tag(img, 'alt'), 'Kundan Bridal Necklace');
    }
  });

  test('thumbnails: lazy + async, a ladder that stops at 320px, quality good, no priority hints', () => {
    const thumbs = pics.filter((p) => !p.main);
    assert.equal(thumbs.length, IMAGES.length * 2, 'a strip in each copy');
    for (const { inner, img, twin } of thumbs) {
      assert.equal(tag(img, 'loading'), 'lazy');
      assert.equal(tag(img, 'decoding'), 'async');
      assert.equal(tag(img, 'fetchPriority'), undefined);
      const set = tag(img, 'srcSet');
      assert.deepEqual([...set.matchAll(/ (\d+)w(?:,|$)/g)].map((m) => Number(m[1])), IMAGE_WIDTHS.thumb);
      assert.ok(set.split(', ').every((c) => c.includes('q_auto:good')));
      assert.equal(tag(img, 'sizes'), twin === PHONE_MEDIA ? '52px' : '60px');
      assert.match(inner, /<source type="image\/avif"/);
    }
    /* A 3× phone needs 156px for a 52px thumbnail: it must not get the 1400px file the hero uses. */
    const phoneThumb = thumbs.find((t) => t.twin === PHONE_MEDIA);
    assert.equal(choose(phoneThumb.inner, { vw: 390, dpr: 3 }).w, 160);
    assert.equal(choose(thumbs.find((t) => t.twin === DESKTOP_MEDIA).inner, { vw: 1280, dpr: 1 }).w, 96);
  });

  test('no layout shift: every photo sits in a box that has its size before the file arrives', () => {
    const imgs = [...html.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
    assert.equal(imgs.length, pics.length, 'only the gallery draws <img>');
    for (const img of imgs) {
      /* The main photo is shown whole (object-contain: nothing of the piece is cropped); thumbnails are square crops. */
      const fit = tag(img, 'loading') === 'eager' ? 'contain' : 'cover';
      assert.match(img, new RegExp(`class="absolute inset-0 object-${fit}"`), 'fills its box, takes no space of its own');
      assert.match(img, /style="width:100%;height:100%"/);
    }
    /* …and the boxes: the main one is a square, the thumbnails are fixed-size buttons. */
    assert.equal((html.match(/relative w-full aspect-square overflow-hidden/g) || []).length, 1, 'phone box');
    assert.equal((html.match(/relative aspect-square rounded-2xl overflow-hidden/g) || []).length, 1, 'desktop box');
    assert.equal((html.match(/relative w-14 h-14 rounded-xl/g) || []).length, IMAGES.length);
    assert.equal((html.match(/relative w-16 h-16 rounded-xl/g) || []).length, IMAGES.length);
  });

  test('the rating above the price is in the first HTML (it would push the price down if it arrived after hydration)', () => {
    assert.match(text(html), /4\.6<\/span><span[^>]*>\(12 reviews\)/);
    const none = text(ssr(React.createElement(ProductDetail, { initialProduct: { ...PIECE, ratings: undefined } })));
    assert.doesNotMatch(none, /reviews\)/);
    const one = text(ssr(React.createElement(ProductDetail, { initialProduct: { ...PIECE, ratings: { average: 5, count: 1 } } })));
    assert.match(one, /\(1 review\)/);
    /* The breakdown is counted from the reviews, which arrive later: no empty bars meanwhile. */
    assert.doesNotMatch(html, /Rating summary|text-6xl/);
  });

  test('streamed: when the page arrives after the shell (the loading.js boundary), its preload hints arrive with it, before the photo', async () => {
    const { renderToPipeableStream } = require('react-dom/server');
    const { PassThrough } = require('node:stream');
    const page = new Promise((resolve) => setTimeout(() => resolve(React.createElement(ProductDetail, { initialProduct: PIECE })), 20));
    const Slow = () => React.use(page);
    const out = await new Promise((resolve, reject) => {
      const sink = new PassThrough();
      let buf = '';
      sink.on('data', (c) => { buf += c; });
      sink.on('end', () => resolve(buf));
      const { pipe } = renderToPipeableStream(
        /* A real document root, as Next renders: only then does Fizz flush the shell (the skeleton) ahead of the late boundary. */
        React.createElement('html', null, React.createElement('head'), React.createElement('body', null,
          React.createElement(React.Suspense, { fallback: React.createElement('p', null, 'skeleton') }, React.createElement(Slow)))),
        { onShellReady() { pipe(sink); }, onError: reject }, // flush the shell now, as the server does; the page streams in after
      );
    });
    const first = out.indexOf('skeleton');
    const preloads = links(out, 'preload').filter((l) => l.includes('as="image"'));
    assert.ok(first >= 0 && first < out.indexOf('<h1'), 'the shell (skeleton) came first');
    assert.equal(preloads.length, 2);
    assert.deepEqual(preloads.map((l) => tag(l, 'media')).sort(), [DESKTOP_MEDIA, PHONE_MEDIA].sort());
    assert.ok(out.indexOf(preloads[0]) < out.indexOf('<picture>') && out.indexOf(preloads[1]) < out.indexOf('<picture>'));
  });

  test('a product without photos, or a non-Cloudinary one, still renders without a broken box', () => {
    const empty = ssr(React.createElement(ProductDetail, { initialProduct: { ...PIECE, images: [] } }));
    assert.doesNotMatch(empty, /<picture|<img/);
    const other = ssr(React.createElement(ProductDetail, { initialProduct: { ...PIECE, images: ['https://images.unsplash.com/photo-1.jpg'] } }));
    assert.doesNotMatch(other, /<picture/);
    assert.match(other, /<img [^>]*src="https:\/\/images\.unsplash\.com\/photo-1\.jpg"/);
  });
});

/* ═════════════ choosing another photo, the loupe, the full-screen viewer ═════════════ */

/* ProductDetail run with a minimal hooks runtime, so a click can be made and
   the page read again (effects are not run: no network). */
function interactive(initialProduct = PIECE) {
  const slots = [];
  let cursor = 0;
  const hooks = {
    useState(init) {
      const slot = (slots[cursor] ||= { v: typeof init === 'function' ? init() : init });
      cursor += 1;
      return [slot.v, (next) => { slot.v = typeof next === 'function' ? next(slot.v) : next; }];
    },
    useRef(init) { const slot = (slots[cursor] ||= { current: init }); cursor += 1; return slot; },
    useEffect: noop,
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
  };
  const Comp = loadDetail({ ...React, ...hooks }).default;
  const page = { tree: null, render() { cursor = 0; page.tree = Comp({ initialProduct }); return page.tree; } };
  page.render();
  return page;
}
function walk(node, visit) {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, visit)); return; }
  if (!node || typeof node !== 'object' || !node.props) return;
  visit(node);
  walk(node.props.children, visit);
}
const findAll = (tree, pred) => { const out = []; walk(tree, (n) => { if (pred(n)) out.push(n); }); return out; };
const named = (n, name) => typeof n.type === 'function' && n.type.name === name;
const mainPhoto = (page, phone) => findAll(page.tree, (n) => named(n, 'MainPhoto') && !!n.props.phone === phone)[0];
const thumbButton = (page, i, phone) => findAll(page.tree, (n) => n.type === 'button' && findAll(n.props.children, (c) => named(c, 'ThumbPhoto') && !!c.props.phone === phone).length)[i];
const desktopBox = (page) => findAll(page.tree, (n) => typeof n.props.onMouseEnter === 'function')[0];
const loupeOf = (page) => findAll(page.tree, (n) => n.props.style?.backgroundImage)[0];

describe('PDP: picking a photo, the loupe and the full-screen viewer', { skip }, () => {
  test('a thumbnail pick loads the new photo at once: eager + high priority, no new preload, still one photo per viewport', () => {
    const page = interactive();
    assert.equal(mainPhoto(page, true).props.first, true);
    thumbButton(page, 2, false).props.onClick();
    page.render();
    for (const phone of [true, false]) {
      const el = mainPhoto(page, phone);
      assert.equal(el.props.url, IMAGES[2]);
      assert.equal(el.props.first, false);
      const html = ssr(el);
      assert.deepEqual(links(html, 'preload'), [], 'the first photo is the LCP image; later picks are not preloaded');
      const img = html.match(/<img [^>]*>/)[0];
      assert.equal(tag(img, 'loading'), 'eager');
      assert.equal(tag(img, 'fetchPriority'), 'high');
      assert.match(html, /necklace-2\.jpg/);
      assert.doesNotMatch(html, /necklace-0\.jpg/);
      const [pixel, avif, webp] = [...html.matchAll(/<source [^>]*>/g)].map((m) => m[0]);
      assert.ok(pixel.includes(PIXEL) && pixel.includes(`media="${phone ? DESKTOP_MEDIA : PHONE_MEDIA}"`), 'the hidden twin still gets the pixel');
      assert.ok(tag(avif, 'srcSet').includes('f_avif,q_auto:best') && tag(webp, 'srcSet').includes('f_webp,q_auto:best'));
    }
    assert.equal(calls.carousel > 0, true, 'the carousel click is still recorded');
    /* Back to the first photo: it is the LCP image again. */
    thumbButton(page, 0, true).props.onClick();
    page.render();
    assert.equal(mainPhoto(page, false).props.first, true);
    assert.equal(links(ssr(mainPhoto(page, false)), 'preload').length, 1);
  });

  test('the loupe starts from the file the gallery already downloaded (no blank flash, no second download)', () => {
    const page = interactive();
    const loaded = 'https://res.cloudinary.com/djolb5idc/image/upload/f_avif,q_auto:best,c_limit,w_640/v17123450/tulsi-bridal/products/necklace-0.jpg';
    mainPhoto(page, false).props.imgRef.current = { currentSrc: loaded };
    assert.equal(loupeOf(page), undefined, 'no loupe until the cursor enters');
    desktopBox(page).props.onMouseEnter();
    page.render();
    assert.equal(loupeOf(page).props.style.backgroundImage, `url(${loaded})`);

    /* The photo changes while the cursor is still over the box: the file loaded for the old one must not be shown. */
    thumbButton(page, 1, false).props.onClick();
    page.render();
    assert.equal(loupeOf(page).props.style.backgroundImage, `url(${cldBase(IMAGES[1])})`, 'w_1400 stands in until the sharp tier arrives');
  });

  test('the loupe falls back to the w_1400 tier when no file is known (image not in the page yet, or the 1×1 pixel)', () => {
    for (const currentSrc of [undefined, '', PIXEL]) {
      const page = interactive();
      mainPhoto(page, false).props.imgRef.current = currentSrc === undefined ? null : { currentSrc };
      desktopBox(page).props.onMouseEnter();
      page.render();
      assert.equal(loupeOf(page).props.style.backgroundImage, `url(${cldBase(IMAGES[0])})`);
    }
  });

  test('opening the viewer hands it the file on screen; the sharp tiers are exactly the ones the viewer always used', () => {
    const loaded = 'https://res.cloudinary.com/djolb5idc/image/upload/f_webp,q_auto:best,c_limit,w_828/v17123451/tulsi-bridal/products/necklace-1.jpg';
    const page = interactive();
    thumbButton(page, 1, false).props.onClick();
    page.render();
    mainPhoto(page, true).props.imgRef.current = { currentSrc: loaded };
    findAll(page.tree, (n) => typeof n.props.onTouchStart === 'function')[0].props.onClick(); // phone box
    page.render();
    const modal = findAll(page.tree, (n) => named(n, 'ImageZoomModal'))[0];
    assert.deepEqual(modal.props.shown, { index: 1, src: loaded });
    assert.equal(modal.props.startIndex, 1);
    assert.deepEqual(modal.props.images, IMAGES);

    const Modal = makeLoader(stubsFor(React))('components/shop/ImageZoomModal.js').default; // real hooks, not this page's fake ones
    const html = ssr(React.createElement(Modal, modal.props));
    const imgs = [...html.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
    assert.equal(tag(imgs[0], 'src'), loaded, 'base layer = the cached gallery file');
    assert.equal(tag(imgs[1], 'src'), cldZoom(IMAGES[1]), 'w_3000 q_90 layer, unchanged');
    assert.equal(imgs.filter((i) => i.includes('w_5000')).length, 0, 'the deep tier waits for a pinch past 2×');
    assert.match(cldZoom(IMAGES[1]), /f_auto,q_90,w_3000,c_limit/);
    assert.match(cldDeepZoom(IMAGES[1]), /f_auto,q_90,w_5000,c_limit/);
  });

  test('the viewer: no file known (admin order view, hidden twin) or another photo → the w_1400 base, as before', () => {
    const Modal = makeLoader(stubsFor(React))('components/shop/ImageZoomModal.js').default;
    const base = (props) => tag(ssr(React.createElement(Modal, { images: IMAGES, productName: 'N', onClose: noop, ...props })).match(/<img [^>]*>/)[0], 'src');
    assert.equal(base({ startIndex: 2 }), cldBase(IMAGES[2]));
    assert.equal(base({ startIndex: 2, shown: null }), cldBase(IMAGES[2]));
    assert.equal(base({ startIndex: 2, shown: { index: 1, src: 'https://x.test/a.avif' } }), cldBase(IMAGES[2]), 'a file belongs to its own photo only');
    assert.equal(base({ startIndex: 1, shown: { index: 1, src: 'https://x.test/a.avif' } }), 'https://x.test/a.avif');
  });

  test('a pixel (hidden copy) is never handed to the viewer or the loupe', () => {
    const page = interactive();
    mainPhoto(page, true).props.imgRef.current = { currentSrc: PIXEL };
    findAll(page.tree, (n) => typeof n.props.onTouchStart === 'function')[0].props.onClick();
    page.render();
    assert.equal(findAll(page.tree, (n) => named(n, 'ImageZoomModal'))[0].props.shown, null);
  });
});

/* ═════════════ the loading skeleton ═════════════ */

describe('PDP: loading skeleton', { skip }, () => {
  test('has the product page\'s boxes (square on phones, gallery card on desktops), not the home page\'s hero and grid', () => {
    const Loading = makeLoader(stubsFor(React))('app/product/[id]/loading.js').default;
    const html = ssr(React.createElement(Loading));
    const detail = readFileSync('src/app/product/[id]/ProductDetail.js', 'utf8');
    for (const cls of ['lg:hidden bg-white', 'w-full aspect-square', 'section-container py-8', 'bg-white rounded-2xl shadow-card overflow-hidden mb-8',
      'grid lg:grid-cols-2', 'hidden lg:block p-8 bg-stone-50/60', 'aspect-square rounded-2xl', 'p-6 lg:p-8 flex flex-col']) {
      assert.ok(html.includes(cls), `skeleton: ${cls}`);
      assert.ok(detail.includes(cls), `ProductDetail: ${cls}`);
    }
    assert.doesNotMatch(html, /h-\[340px\]|grid-cols-2 sm:grid-cols-3/, 'not the home skeleton');
  });
});

/* ═════════════ the server page ═════════════ */

describe('PDP: the server page (page.js)', { skip }, () => {
  const productDoc = { id: 'p1', name: 'Kundan Bridal Necklace', category: 'necklace', images: IMAGES, isActive: true };

  /* `site` is the settings/site document ({} = none saved, undefined = the document does not exist);
     `settingsDown` makes reading it fail; the gates hold a read until released. */
  function pageWith({ reviewsGate, productGate, settingsGate, product = productDoc, site = { phone: '+91 76958 68787' }, settingsDown = null } = {}) {
    const reads = { product: 0, reviews: 0, charges: 0, settings: 0 };
    const order = []; // which read started when
    const jsonLd = [];
    const db = {
      collection: (name) => ({
        doc: () => ({
          get: async () => {
            if (name === 'settings') {
              reads.settings += 1; order.push('settings');
              await settingsGate;
              if (settingsDown) throw settingsDown;
              return site ? { exists: true, id: 'site', data: () => site } : { exists: false };
            }
            reads.product += 1; order.push('product');
            await productGate;
            return product ? { exists: true, id: product.id, data: () => product } : { exists: false };
          },
        }),
        where: () => ({ get: async () => { reads.reviews += 1; await reviewsGate; return { docs: [{ data: () => ({ rating: 5, comment: 'Lovely', reviewerName: 'Asha K', createdAt: '2026-01-02' }) }] }; } }),
      }),
    };
    /* cache(): what React does per request in a server component. */
    const memo = (fn) => { const seen = new Map(); return (arg) => { if (!seen.has(arg)) seen.set(arg, fn(arg)); return seen.get(arg); }; };
    const stubs = {
      react: { ...React, cache: memo },
      '@/lib/firebase': { getDB: () => db, docToObj: (d) => ({ id: d.id, ...d.data() }), toPublicProduct: (p) => p },
      '@/lib/seo': {
        absoluteUrl: (p) => `https://t.test${p}`, JsonLd: function JsonLd() { return null; },
        buildProductJsonLd: (p, id, o) => { jsonLd.push(o); return { '@type': 'Product' }; }, buildBreadcrumbJsonLd: () => ({ '@type': 'BreadcrumbList' }),
        describeProduct: () => 'A necklace.', productKeywords: () => [],
      },
      '@/lib/cloudinaryImage': lib,
      '@/lib/storeChargesServer': { getStoreCharges: async () => { reads.charges += 1; return { free_shipping_threshold: 2000 }; } },
      './ProductDetail': esm(function ProductDetail() { return null; }),
    };
    const mod = makeLoader(stubs)('app/product/[id]/page.js');
    return { mod, reads, order, jsonLd, params: Promise.resolve({ id: 'p1' }) };
  }

  test('generateMetadata and the page share one product read per request', async () => {
    const { mod, reads, params } = pageWith();
    await mod.generateMetadata({ params });
    await mod.default({ params });
    assert.equal(reads.product, 1);
  });

  test('link previews (og:image, twitter:image) get a 1200px JPEG, not the multi-MB master', async () => {
    const { mod, params } = pageWith();
    const meta = await mod.generateMetadata({ params });
    const og = meta.openGraph.images[0].url;
    assert.match(og, /\/upload\/f_jpg,q_auto:good,c_limit,w_1200,fl_progressive\/v1712345\d\/tulsi-bridal\/products\/necklace-0\.jpg$/);
    assert.deepEqual(meta.twitter.images, [og]);
    assert.equal(meta.openGraph.images[0].width, 1200);
    assert.equal(meta.openGraph.images[0].height, undefined, 'the real height depends on the photo — not guessed');
    const none = await pageWith({ product: { ...productDoc, images: [] } }).mod.generateMetadata({ params: Promise.resolve({ id: 'p1' }) });
    assert.equal(none.openGraph.images, undefined);
  });

  test('the page (and so the LCP photo) does not wait for the reviews or store charges: they stream in under <Suspense>', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { mod, reads, jsonLd, params } = pageWith({ reviewsGate: gate });
    let timer;
    const tree = await Promise.race([mod.default({ params }), new Promise((r) => { timer = setTimeout(() => r('timed out'), 500); })]);
    clearTimeout(timer);
    assert.notEqual(tree, 'timed out', 'ProductPage must not await the reviews');
    assert.equal(reads.reviews, 0, 'nothing but the product was read to build the page');

    const detail = findAll(tree, (n) => n.type.name === 'ProductDetail');
    assert.equal(detail.length, 1);
    assert.equal(detail[0].props.initialProduct.name, 'Kundan Bridal Necklace');
    const suspense = findAll(tree, (n) => n.type === React.Suspense);
    assert.equal(suspense.length, 1);
    assert.equal(findAll(suspense[0].props.children, (n) => n.type.name === 'ProductDetail').length, 0, 'the page itself is outside the boundary');
    const sd = findAll(suspense[0].props.children, (n) => n.type.name === 'ProductStructuredData');
    assert.equal(sd.length, 1);

    /* When the reads finish, the structured data still carries the real reviews and charges. */
    release();
    const out = await sd[0].type(sd[0].props);
    assert.equal(out.type.name, 'JsonLd');
    assert.equal(reads.reviews, 1);
    assert.equal(reads.charges, 1);
    assert.equal(jsonLd[0].reviews[0].comment, 'Lovely');
    assert.equal(jsonLd[0].charges.free_shipping_threshold, 2000);
  });

  test('a product that does not exist renders the (client-redirecting) shell with no structured data and no reads', async () => {
    const { mod, reads, params } = pageWith({ product: null });
    const tree = await mod.default({ params });
    assert.equal(findAll(tree, (n) => n.type.name === 'ProductDetail')[0].props.initialProduct, null);
    assert.equal(findAll(tree, (n) => n.type === React.Suspense).length, 0);
    assert.equal(reads.reviews + reads.charges, 0);
  });

  const detailProps = (tree) => findAll(tree, (n) => n.type.name === 'ProductDetail')[0].props;

  test('the owner\'s delivery message is handed to ProductDetail, normalized — and nothing else of the site settings goes with it', async () => {
    const stored = {
      enabled: true, mode: 'always', barText: '  Free   <b>delivery</b> above ₹999 ', icon: '🎁',
      style: { model: 'outline', tone: 'gold', weight: 'bold', colors: { text: '#ABCDEF', bg: '#123456' }, junk: 1 }, leaked: 'x',
    };
    const { mod, params } = pageWith({ site: { phone: '+91 76958 68787', email: 'owner@tulsi.test', deliveryMessage: stored } });
    const props = detailProps(await mod.default({ params }));
    assert.deepEqual(Object.keys(props).sort(), ['deliveryMessage', 'initialProduct']);
    assert.deepEqual(props.deliveryMessage, deliveryLib.normalizeDeliveryMessage(stored));
    assert.equal(props.deliveryMessage.barText, 'Free bdelivery/b above ₹999', 'plain text: no markup survives');
    assert.deepEqual(JSON.parse(JSON.stringify(props.deliveryMessage)), props.deliveryMessage, 'plain JSON across the server → browser boundary');
    assert.doesNotMatch(JSON.stringify(props), /76958|owner@tulsi|"leaked"|junk/, 'not the phone, the e-mail or an unknown key');
  });

  test('nothing saved yet (no document, no field, or junk) → the default message, which is today\'s trust list; an unreadable document → null', async () => {
    for (const site of [null, {}, { phone: '1' }, { phone: '1', deliveryMessage: 'off' }, { deliveryMessage: [1] }, { deliveryMessage: null }, { deliveryMessage: { enabled: 'no', mode: 5, style: 'bold' } }]) {
      const { mod, params } = pageWith({ site });
      assert.deepEqual(detailProps(await mod.default({ params })).deliveryMessage, deliveryLib.DEFAULT_DELIVERY_MESSAGE, JSON.stringify(site));
    }
    /* A failed read must not fail the product page: the browser gets "unknown" (the defaults), the page still renders. */
    for (const settingsDown of [new Error('UNAVAILABLE: no connection'), new Error('FIREBASE_PROJECT_ID is missing')]) {
      const { mod, params } = pageWith({ settingsDown });
      const tree = await mod.default({ params });
      assert.equal(detailProps(tree).deliveryMessage, null);
      assert.equal(detailProps(tree).initialProduct.name, 'Kundan Bridal Necklace', 'and the product is still in the first HTML');
    }
    /* The product that does not exist still gets the owner's message for the client-side shell. */
    const { mod, params } = pageWith({ product: null, site: { deliveryMessage: { enabled: false } } });
    const props = detailProps(await mod.default({ params }));
    assert.equal(props.initialProduct, null);
    assert.equal(props.deliveryMessage.enabled, false);
  });

  test('one round trip, not two: the settings are read while the product is being read, not after it', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { mod, reads, order, params } = pageWith({ productGate: gate });
    const rendering = mod.default({ params });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(reads, { product: 1, reviews: 0, charges: 0, settings: 1 }, 'both reads are already under way while the product is still pending');
    assert.deepEqual(order.sort(), ['product', 'settings']);
    release();
    assert.equal(detailProps(await rendering).initialProduct.name, 'Kundan Bridal Necklace');
    /* ...and it is the same the other way round: a slow settings read does not make the product read start later. */
    const slow = new Promise((r) => { release = r; });
    const other = pageWith({ settingsGate: slow });
    const rendering2 = other.mod.default({ params: other.params });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(other.reads.product, 1);
    release();
    await rendering2;
    /* generateMetadata still shares the page's one product read, and never reads the settings. */
    const shared = pageWith();
    await shared.mod.generateMetadata({ params: shared.params });
    await shared.mod.default({ params: shared.params });
    assert.equal(shared.reads.product, 1);
    assert.equal(shared.reads.settings, 1, 'only the page reads the settings');
  });
});

/* ═════════════ the trust list: the owner's delivery message ═════════════ */

/* ProductDetail rendered on the server with the real DeliveryMessage; the icons draw as <svg data-icon="Fi…"> so the truck can be seen. */
describe('PDP: the delivery message in the trust list', { skip }, () => {
  const FREE = { ...DEFAULT_CHARGES, enable_shipping_fee: false };
  const PAID = DEFAULT_CHARGES;
  const ROW = 'flex items-center gap-2 text-xs text-stone-500';
  const msg = (over = {}) => deliveryLib.normalizeDeliveryMessage(over);
  const icons = new Proxy({}, { get: (_, key) => (key === '__esModule' ? false : (props) => React.createElement('svg', { 'data-icon': String(key), ...props })) });

  function draw({ charges, deliveryMessage } = {}, { withProp = true } = {}) {
    const stubs = { ...stubsFor(React), 'react-icons/fi': icons, '@/context/CartContext': { useCart: () => ({ dispatch: noop, charges }) } };
    const Detail = makeLoader(stubs)(detailPath).default;
    return ssr(React.createElement(Detail, withProp ? { initialProduct: PIECE, deliveryMessage } : { initialProduct: PIECE }));
  }
  /* The grid's direct children, as HTML. */
  function cells(html) {
    const open = '<div class="mt-5 pt-5 border-t border-stone-100 grid grid-cols-2 gap-2">';
    const start = html.indexOf(open);
    assert.ok(start >= 0, 'the trust list is in the first HTML');
    const rest = html.slice(start + open.length);
    const out = [];
    let depth = 0;
    let from = 0;
    for (const m of rest.matchAll(/<div\b|<\/div>/g)) {
      if (m[0] === '</div>') {
        if (depth === 0) break; // the grid's own end
        depth -= 1;
        if (depth === 0) out.push(rest.slice(from, m.index + m[0].length));
      } else {
        if (depth === 0) from = m.index;
        depth += 1;
      }
    }
    return out;
  }
  const words = (cell) => cell.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const OTHERS = ['Anti-Tarnish Finish', '7-Day Damaged / Wrong-Item Returns', 'Secure Payment'];
  const textsOf = (html) => cells(html).map(words);

  test('the default message is today\'s trust list: the second item, in the list\'s own row and green truck — only while every order ships free', () => {
    const html = draw({ charges: FREE });
    assert.deepEqual(textsOf(html), ['Anti-Tarnish Finish', 'Free Delivery across India', '7-Day Damaged / Wrong-Item Returns', 'Secure Payment']);
    const [, delivery] = cells(html);
    /* Byte for byte the cell it was before the message was editable, `<Icon className="text-green-500 flex-shrink-0" /> <span>{label}</span>`
       in the list's own row: the same as the other three cells, the truck included (no extra attribute, no missing span or space). */
    assert.equal(delivery, `<div class="${ROW}"><svg data-icon="FiTruck" class="text-green-500 flex-shrink-0"></svg> <span>Free Delivery across India</span></div>`);
    /* The other three are untouched. */
    assert.equal(cells(html)[0], `<div class="${ROW}"><svg data-icon="FiShield" class="text-green-500 flex-shrink-0"></svg> <span>Anti-Tarnish Finish</span></div>`);
    assert.equal(cells(html)[3], `<div class="${ROW}"><svg data-icon="FiCheckCircle" class="text-green-500 flex-shrink-0"></svg> <span>Secure Payment</span></div>`);
    /* Not free for every order (or not known yet): the item is left out, the others keep their places. */
    for (const charges of [PAID, null, undefined, { ...FREE, enable_shipping_fee: true }]) assert.deepEqual(textsOf(draw({ charges })), OTHERS, JSON.stringify(charges));
    assert.doesNotMatch(draw({ charges: PAID }), /Free Delivery|FiTruck/);
    /* Never an "above ₹N" promise from the default message. */
    assert.doesNotMatch(draw({ charges: { ...PAID, free_shipping_threshold: 999 } }), /above ₹|Free Delivery/i);
  });

  test('not set, not read, never edited, or junk: the very same page as the default message', () => {
    const reference = draw({ charges: FREE, deliveryMessage: deliveryLib.DEFAULT_DELIVERY_MESSAGE });
    for (const deliveryMessage of [undefined, null, {}, msg(), 'junk', 5, [], { style: { tone: 'auto', model: 'text' } }]) {
      assert.equal(draw({ charges: FREE, deliveryMessage }), reference, JSON.stringify(deliveryMessage));
    }
    assert.equal(draw({ charges: FREE }, { withProp: false }), reference, 'a caller that passes no message (the loading shell, tests) gets the default');
  });

  test('switched off: the item is nowhere, free shipping or not, whatever the mode', () => {
    for (const mode of ['auto', 'always']) {
      for (const charges of [FREE, PAID, null]) {
        const html = draw({ charges, deliveryMessage: msg({ enabled: false, mode }) });
        assert.deepEqual(textsOf(html), OTHERS, `${mode} ${JSON.stringify(charges)}`);
        assert.doesNotMatch(html, /Free Delivery|FiTruck/);
      }
    }
  });

  test('"Smart" never says what the checkout does not do; "Always" shows the owner\'s own words, before the charges are even known', () => {
    const smart = msg({ barText: 'Free delivery above ₹999' });
    const always = msg({ mode: 'always', barText: 'Free delivery above ₹999' });
    assert.deepEqual(textsOf(draw({ charges: PAID, deliveryMessage: smart })), OTHERS);
    assert.deepEqual(textsOf(draw({ charges: FREE, deliveryMessage: smart })), [OTHERS[0], 'Free delivery above ₹999', OTHERS[1], OTHERS[2]]);
    for (const charges of [PAID, FREE, null, undefined]) {
      assert.deepEqual(textsOf(draw({ charges, deliveryMessage: always })), [OTHERS[0], 'Free delivery above ₹999', OTHERS[1], OTHERS[2]], JSON.stringify(charges));
    }
  });

  test('the owner\'s words and icon, as text: the shop page uses the strip\'s words (barText), not the hero\'s', () => {
    const html = draw({ charges: FREE, deliveryMessage: msg({ barText: 'Free Shipping Pan-India', badgeText: 'Hero words only' }) });
    assert.equal(textsOf(html)[1], 'Free Shipping Pan-India');
    assert.doesNotMatch(html, /Hero words only/);
    /* An emoji icon replaces the truck (still hidden from a screen reader); no icon leaves just the words. */
    const gift = cells(draw({ charges: FREE, deliveryMessage: msg({ icon: '🎁' }) }))[1];
    assert.match(gift, new RegExp(`^<div class="${ROW}"><span aria-hidden="true" class="flex-shrink-0 leading-none">🎁</span> <span>Free Delivery across India</span></div>$`));
    assert.doesNotMatch(gift, /<svg/);
    assert.equal(cells(draw({ charges: FREE, deliveryMessage: msg({ icon: '' }) }))[1], `<div class="${ROW}"><span>Free Delivery across India</span></div>`);
    /* Hostile words stored by hand or sent by a tampered cache: text only. */
    for (const deliveryMessage of [{ barText: '<img src=x onerror=alert(1)><script>alert(2)</script>' }, msg({ barText: '<b>x</b> & "y"' })]) {
      const out = draw({ charges: FREE, deliveryMessage });
      assert.doesNotMatch(out, /<img src=x|<script>alert|<b>x/);
      assert.equal(cells(out).length, 4);
    }
  });

  test('every shape and colour the owner can pick is still one cell of the list — the trust list keeps its four places, in order', () => {
    const MODELS = deliveryLib.DELIVERY_CHOICES.models;
    const TONES = deliveryLib.DELIVERY_CHOICES.tones;
    let drawn = 0;
    for (const model of MODELS) for (const tone of TONES) for (const extra of [{}, { font: 'serif', size: 'lg', weight: 'bold', italic: true, uppercase: true, tracking: 'wider' }]) {
      const deliveryMessage = msg({ style: { model, tone, colors: { text: '#ffffff', bg: '#8b1a4a' }, ...extra } });
      const where = JSON.stringify({ model, tone, ...extra });
      const html = draw({ charges: FREE, deliveryMessage });
      const all = cells(html);
      drawn += 1;
      assert.equal(all.length, 4, where);
      assert.deepEqual(all.map(words), ['Anti-Tarnish Finish', 'Free Delivery across India', '7-Day Damaged / Wrong-Item Returns', 'Secure Payment'], where);
      assert.match(all[1], /^<div class="[^"]*\bflex\b[^"]*\bitems-center\b[^"]*"/, where);
      /* Inline style only from a validated custom pair. */
      const style = all[1].match(/^<div [^>]*style="([^"]*)"/)?.[1];
      if (style) {
        assert.equal(tone, 'custom', where);
        for (const part of style.split(';')) assert.match(part, /^(?:color|background-color|border-color):#[0-9a-f]{6}$/, where);
      }
      /* The other three are never touched by the owner's choices. */
      assert.deepEqual([all[0], all[2], all[3]], [cells(draw({ charges: FREE }))[0], cells(draw({ charges: FREE }))[2], cells(draw({ charges: FREE }))[3]], where);
    }
    assert.equal(drawn, 5 * 7 * 2);
    /* A pill is a pill (fit to its words, not stretched across the grid cell). */
    const pill = cells(draw({ charges: FREE, deliveryMessage: msg({ style: { model: 'pill', tone: 'gold' } }) }))[1];
    assert.match(pill, /^<div class="[^"]*\bw-fit\b[^"]*\brounded-full\b/);
  });

  test('no request of its own: the message arrives with the page (server-read), so nothing is fetched, nothing pops in and nothing changes look after hydration', () => {
    const source = readFileSync('src/app/product/[id]/ProductDetail.js', 'utf8');
    assert.doesNotMatch(source, /admin\/settings/, 'ProductDetail does not fetch the site settings');
    assert.doesNotMatch(source, /freeDeliveryClaim/, 'the old hard-wired claim is gone: the message is the owner\'s');
    assert.match(source, /deliveryMessageFor\(deliveryMessage, charges, 'product'\)/);
    /* The first render is the final one: the message is a prop, no state or effect decides it. */
    assert.equal(draw({ charges: FREE, deliveryMessage: msg({ barText: 'Seeded words', style: { model: 'pill', tone: 'wine' } }) }).includes('Seeded words'), true);
  });
});
