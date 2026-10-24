/* ─────────────────────────────────────────────
   Responsive Cloudinary images: the URL builder, the <picture> model and the
   CloudinaryPicture component rendered with the real React (what the browser
   receives in the first HTML): AVIF → WebP → JPEG, srcset/sizes, the reserved
   box, the LCP image's preload / eager / fetchpriority, lazy for the rest.

   Run: npm test
   ───────────────────────────────────────────── */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import * as lib from '../src/lib/cloudinaryImage.js';

const { cldUrl, cldSrcSet, pictureModel, cldBase, isCloudinary, IMAGE_WIDTHS, IMAGE_SIZES, PIXEL } = lib;
const require = createRequire(import.meta.url);
const U = 'https://res.cloudinary.com/djolb5idc/image/upload/v1712345678/tulsi-bridal/products/necklace.jpg';
const CLD = 'https://res.cloudinary.com/djolb5idc/image/upload/';
const widthsIn = (srcset) => [...srcset.matchAll(/ (\d+)w(?:,|$)/g)].map((m) => Number(m[1]));

/* ── cldUrl ── */

test('cldUrl: explicit format, perceptual quality and a width that never upscales', () => {
  assert.equal(cldUrl(U, { format: 'avif', width: 800 }), `${CLD}f_avif,q_auto:good,c_limit,w_800/v1712345678/tulsi-bridal/products/necklace.jpg`);
  assert.equal(cldUrl(U, { format: 'webp', quality: 'best', width: 640 }), `${CLD}f_webp,q_auto:best,c_limit,w_640/v1712345678/tulsi-bridal/products/necklace.jpg`);
  assert.match(cldUrl(U, { width: 640 }), /^.*\/f_auto,q_auto:good,c_limit,w_640\//, 'f_auto is the default');
  assert.match(cldUrl(U, { quality: 82, width: 640 }), /,q_82,/);
  assert.match(cldUrl(U, { quality: 'eco', width: 640 }), /,q_auto:eco,/);
  assert.doesNotMatch(cldUrl(U, { width: 640 }), /dpr_auto/, 'dpr_auto does nothing without Client Hints; srcset picks the density');
});

test('cldUrl: width is clamped, a crop uses the no-upscale smart fill, progressive is jpg-only', () => {
  assert.match(cldUrl(U, { width: 5 }), /,w_16\//);
  assert.match(cldUrl(U, { width: 99999 }), /,w_4000\//);
  assert.match(cldUrl(U, { format: 'jpg', width: 800, ratio: 0.75 }), /,c_lfill,g_auto,ar_0\.75,w_800\//);
  assert.match(cldUrl(U, { width: 800, ratio: 1 }), /,c_lfill,g_auto,ar_1,w_800\//);
  assert.match(cldUrl(U, { width: 800, height: 500 }), /,c_lfill,g_auto,h_500,w_800\//);
  assert.match(cldUrl(U, { format: 'jpg', width: 800, progressive: true }), /,w_800,fl_progressive\//);
  assert.doesNotMatch(cldUrl(U, { format: 'avif', width: 800, progressive: true }), /fl_progressive/);
});

test('cldUrl: anything that is not a Cloudinary upload URL is returned untouched', () => {
  for (const other of ['https://images.unsplash.com/photo-1.jpg', '/images/banners/welcome.jpg', '', undefined, null, 'https://res.cloudinary.com/djolb5idc/video/upload/a.mp4']) {
    assert.equal(cldUrl(other, { width: 800 }), other);
    assert.equal(cldSrcSet(other, [320, 640]), undefined);
  }
  assert.equal(isCloudinary(U), true);
});

test('the existing tiers are unchanged', () => {
  assert.equal(cldBase(U, 600), `${CLD}f_auto,q_auto:best,w_600,dpr_auto/v1712345678/tulsi-bridal/products/necklace.jpg`);
});

/* ── cldSrcSet / ladders ── */

test('cldSrcSet: one candidate per width with its w descriptor, same format and crop throughout', () => {
  const set = cldSrcSet(U, [320, 640, 960], { format: 'webp', ratio: 0.75 });
  assert.deepEqual(widthsIn(set), [320, 640, 960]);
  assert.equal(set.split(', ').length, 3);
  for (const part of set.split(', ')) assert.match(part, /f_webp,q_auto:good,c_lfill,g_auto,ar_0\.75,w_\d+\//);
});

test('width ladders are ascending, frozen, and bounded where extra pixels stop showing', () => {
  for (const [name, ladder] of Object.entries(IMAGE_WIDTHS)) {
    assert.deepEqual([...ladder], [...ladder].sort((a, b) => a - b), name);
    assert.ok(ladder.every((w) => w >= 16 && w <= 2400), name);
  }
  assert.ok(Object.isFrozen(IMAGE_WIDTHS) && Object.isFrozen(IMAGE_SIZES));
  assert.equal(IMAGE_SIZES.card, '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw', 'must match the grid CSS');
});

/* ── pictureModel ── */

test('pictureModel: AVIF first, WebP second, progressive JPEG last; only AVIF is preloaded', () => {
  const m = pictureModel(U, { widths: [320, 640, 960], sizes: '100vw' });
  assert.equal(m.cloudinary, true);
  assert.deepEqual(m.sources.map((s) => s.type), ['image/avif', 'image/webp']);
  assert.match(m.sources[0].srcSet, /f_avif/);
  assert.match(m.sources[1].srcSet, /f_webp/);
  assert.match(m.img.src, /f_jpg,.*w_960,fl_progressive/, 'a mid-ladder fallback for a browser with no srcset');
  assert.match(m.img.srcSet, /f_jpg/);
  assert.equal(m.img.sizes, '100vw');
  assert.deepEqual(m.preload, { href: m.preload.href, imageSrcSet: m.sources[0].srcSet, imageSizes: '100vw', type: 'image/avif' });
  assert.match(m.preload.href, /f_avif/);
});

test('pictureModel: PNG fallback for cut-outs, custom format list, and nothing for a non-Cloudinary image', () => {
  assert.match(pictureModel(U, { fallbackFormat: 'png' }).img.src, /f_png/);
  assert.deepEqual(pictureModel(U, { formats: ['webp'] }).sources.map((s) => s.type), ['image/webp']);
  assert.deepEqual(pictureModel('https://images.unsplash.com/a.jpg'), { cloudinary: false, sources: [], img: { src: 'https://images.unsplash.com/a.jpg' }, preload: null });
});

/* ── CloudinaryPicture (rendered) ── */

let sucrase = null;
try { sucrase = require('sucrase'); } catch { /* skipped below */ }
const skip = sucrase ? false : 'sucrase is not installed, so CloudinaryPicture.jsx cannot be transpiled for node --test';
const React = require('react');
const ReactDOM = require('react-dom');
const { renderToString } = require('react-dom/server');

function loadPicture() {
  const file = path.resolve('src/components/ui/CloudinaryPicture.jsx');
  const { code } = sucrase.transform(readFileSync(file, 'utf8'), {
    transforms: ['jsx', 'imports'], jsxRuntime: 'automatic', production: true, filePath: file,
  });
  const deps = { react: React, 'react/jsx-runtime': require('react/jsx-runtime'), 'react-dom': ReactDOM, '@/lib/cloudinaryImage': lib };
  const req = (id) => {
    if (!Object.hasOwn(deps, id)) throw new Error(`CloudinaryPicture.jsx imports ${id}: add a stub`);
    return deps[id];
  };
  const mod = { exports: {} };
  vm.runInThisContext(`(function (exports, require, module) {${code}\n})`, { filename: file })(mod.exports, req, mod);
  return mod.exports.default;
}
const CloudinaryPicture = sucrase ? loadPicture() : null;
function render(props) {
  const warnings = [];
  const orig = console.error;
  console.error = (...a) => { warnings.push(a.map(String).join(' ')); };
  let html;
  try { html = renderToString(React.createElement('div', null, React.createElement(CloudinaryPicture, props))); } finally { console.error = orig; }
  assert.deepEqual(warnings, [], 'React warned while rendering');
  return html;
}
const links = (html, rel) => [...html.matchAll(new RegExp(`<link rel="${rel}"[^>]*>`, 'g'))].map((m) => m[0]);
const sourcesOf = (html) => [...html.matchAll(/<source [^>]*>/g)].map((m) => m[0]);
const imgOf = (html) => html.match(/<img [^>]*>/)[0];

test('CloudinaryPicture: the LCP image — AVIF, WebP, JPEG in order, eager + high priority, one preload, a reserved box', { skip }, () => {
  const html = render({ src: U, alt: 'Temple necklace', width: 1000, height: 1000, priority: true, sizes: IMAGE_SIZES.gallery, widths: IMAGE_WIDTHS.gallery });
  assert.deepEqual(sourcesOf(html).map((s) => s.match(/type="([^"]+)"/)?.[1]), ['image/avif', 'image/webp']);
  assert.match(html, /<picture>.*<img /s);
  const img = imgOf(html);
  assert.match(img, /loading="eager"/);
  assert.match(img, /fetchPriority="high"/);
  assert.match(img, /decoding="async"/);
  assert.match(img, /width="1000"/);
  assert.match(img, /height="1000"/);
  assert.match(img, /style="aspect-ratio:1000 \/ 1000"/);
  assert.match(img, /alt="Temple necklace"/);
  assert.match(img, /sizes="\(max-width: 1023px\) 100vw, 50vw"/);
  assert.match(img, /fl_progressive/, 'the JPEG fallback is progressive');
  /* The hints the browser acts on before it has parsed the body. */
  assert.equal(links(html, 'preconnect').length, 1);
  const preloads = links(html, 'preload');
  assert.equal(preloads.length, 1, 'AVIF only: preloading WebP too would make AVIF browsers fetch both');
  assert.match(preloads[0], /as="image"/);
  assert.match(preloads[0], /type="image\/avif"/);
  assert.match(preloads[0], /fetchPriority="high"/);
  assert.equal(preloads[0].match(/imageSrcSet="([^"]+)"/)[1], sourcesOf(html)[0].match(/srcSet="([^"]+)"/)[1], 'same candidates as the <source> → one download, not two');
});

test('CloudinaryPicture: a catalog image is lazy, has no hints, and still reserves its box', { skip }, () => {
  const html = render({ src: U, alt: 'Jhumka', width: 600, height: 800, sizes: IMAGE_SIZES.card, widths: IMAGE_WIDTHS.card });
  const img = imgOf(html);
  assert.match(img, /loading="lazy"/);
  assert.match(img, /decoding="async"/);
  assert.doesNotMatch(img, /fetchPriority/);
  assert.match(img, /width="600"/);
  assert.match(img, /style="aspect-ratio:600 \/ 800"/);
  assert.deepEqual(links(html, 'preload'), []);
  assert.deepEqual(links(html, 'preconnect'), []);
});

test('CloudinaryPicture: fill mode covers its parent and carries no width/height of its own', { skip }, () => {
  const html = render({ src: U, alt: '', fill: true, priority: true, className: 'object-cover object-top', widths: IMAGE_WIDTHS.hero });
  const img = imgOf(html);
  assert.match(img, /class="absolute inset-0 object-cover object-top"/);
  assert.match(img, /style="width:100%;height:100%"/);
  assert.doesNotMatch(img, / width=| height=/);
});

test('CloudinaryPicture: art direction — a portrait crop under the media query, preloads that never overlap', { skip }, () => {
  const media = '(max-width: 767px)';
  const html = render({ src: U, alt: 'Hero', fill: true, priority: true, widths: [1080, 1920], art: { media, ratio: 0.6, widths: [480, 720] } });
  const sources = sourcesOf(html);
  assert.equal(sources.length, 5, 'art avif, webp, jpeg + default avif, webp');
  assert.ok(sources.slice(0, 3).every((s) => s.includes(`media="${media}"`)), 'the art sources come first');
  assert.ok(sources.slice(0, 3).every((s) => /ar_0\.6/.test(s)));
  assert.ok(sources.slice(3).every((s) => !s.includes('media=')));
  const preloads = links(html, 'preload');
  assert.equal(preloads.length, 2);
  assert.ok(preloads[0].includes(`media="${media}"`) && /ar_0\.6/.test(preloads[0]));
  assert.ok(preloads[1].includes(`media="not all and ${media}"`) && !/ar_0\.6/.test(preloads[1]), 'a phone preloads the crop only, a desktop the full image only');
});

test('CloudinaryPicture: showWhen — the hidden twin layout downloads a pixel, not the photo', { skip }, () => {
  const html = render({ src: U, alt: 'Necklace', width: 1000, height: 1000, priority: true, showWhen: '(min-width: 1024px)' });
  const sources = sourcesOf(html);
  assert.ok(sources[0].includes('media="not all and (min-width: 1024px)"') && sources[0].includes(PIXEL), 'first source: viewports without the media query get the pixel');
  assert.ok(!sources[0].includes('type='));
  assert.ok(links(html, 'preload')[0].includes('media="(min-width: 1024px)"'), 'only the visible twin is preloaded');
});

test('CloudinaryPicture: a non-Cloudinary or missing source is a plain <img> / nothing', { skip }, () => {
  const html = render({ src: 'https://images.unsplash.com/a.jpg', alt: 'U', width: 300, height: 400, priority: true });
  assert.doesNotMatch(html, /<picture|<source/);
  assert.deepEqual(links(html, 'preconnect'), [], 'nothing of ours: it is not Cloudinary');
  assert.match(imgOf(html), /src="https:\/\/images\.unsplash\.com\/a\.jpg"/);
  assert.match(imgOf(html), /style="aspect-ratio:300 \/ 400"/);
  assert.equal(render({ src: '', alt: 'x' }), '<div></div>');
});

test('CloudinaryPicture: extra props reach the <img>, and a PNG fallback is honoured', { skip }, () => {
  const html = render({ src: U, alt: 'x', width: 10, height: 10, fallbackFormat: 'png', draggable: false, 'data-testid': 'photo' });
  assert.match(imgOf(html), /f_png/);
  assert.match(imgOf(html), /draggable="false"/);
  assert.match(imgOf(html), /data-testid="photo"/);
});
