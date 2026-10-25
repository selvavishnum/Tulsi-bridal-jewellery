/* ─────────────────────────────────────────────
   Homepage category showcase — the storefront section
   (src/components/home/CategoryShowcase.jsx) rendered to static HTML with
   the real React + react-dom/server.

   The file is JSX, which Node can't load, so it is transpiled here with
   sucrase (already in node_modules via tailwindcss) to CommonJS and run
   with its imports wired by hand: React and the real showcase module;
   next/link → a plain <a>, react-icons → an <svg> stub. If sucrase is
   ever missing the whole file is skipped (with that reason), never
   silently green.

   Run: npm test
   ───────────────────────────────────────────── */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import * as showcaseLib from '../src/lib/categoryShowcase.js';

const { SHOWCASE_CARDS, LAYOUT_VARIANTS, DISPLAY_MODES, SIZES, normalizeShowcase, applyShowcasePatch, showcaseImageUrl, showcaseSrcSet } = showcaseLib;
const require = createRequire(import.meta.url);

let sucrase = null;
try { sucrase = require('sucrase'); } catch { /* skipped below */ }
const skip = sucrase ? false : 'sucrase is not installed, so CategoryShowcase.jsx cannot be transpiled for node --test';

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function loadComponent() {
  const file = path.resolve('src/components/home/CategoryShowcase.jsx');
  const { code } = sucrase.transform(readFileSync(file, 'utf8'), {
    transforms: ['jsx', 'imports'], jsxRuntime: 'automatic', production: true, filePath: file,
  });
  const Link = ({ href, children, prefetch: _prefetch, ...rest }) => React.createElement('a', { href, ...rest }, children);
  const icon = (name) => {
    const Icon = (props) => React.createElement('svg', { 'data-icon': name, ...props });
    Icon.displayName = name;
    return Icon;
  };
  const deps = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/link': { __esModule: true, default: Link },
    'react-icons/fi': { FiChevronLeft: icon('FiChevronLeft'), FiChevronRight: icon('FiChevronRight') },
    '@/lib/categoryShowcase': showcaseLib,
  };
  const req = (id) => {
    if (!Object.hasOwn(deps, id)) throw new Error(`CategoryShowcase.jsx imports ${id}: add a stub for it in this test`);
    return deps[id];
  };
  const mod = { exports: {} };
  vm.runInThisContext(`(function (exports, require, module) {${code}\n})`, { filename: file })(mod.exports, req, mod);
  return mod.exports.default;
}
const CategoryShowcase = sucrase ? loadComponent() : null;

/* Render, failing on any React warning (missing keys, bad DOM props …). */
function render(showcase, props = {}) {
  const warnings = [];
  const orig = console.error;
  console.error = (...args) => { warnings.push(args.map(String).join(' ')); };
  let html;
  try { html = renderToStaticMarkup(React.createElement(CategoryShowcase, { showcase, ...props })); } finally { console.error = orig; }
  assert.deepEqual(warnings, [], 'React warned while rendering');
  return html;
}

const KEYS = SHOWCASE_CARDS.map((c) => c.key);
const CARD = Object.fromEntries(SHOWCASE_CARDS.map((c) => [c.key, c]));
const CLD = (name) => `https://res.cloudinary.com/tulsi/image/upload/v17/tulsi-bridal/categories/${name}.jpg`;
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const make = (layout, items = [], extra = {}) => normalizeShowcase({ categoryShowcase: { layout, items }, ...extra });
const patchOf = (s, patch) => applyShowcasePatch(s, patch);

/* One entry per rendered card (each card is one <li>; they don't nest). */
function cards(html) {
  return html.split('<li').slice(1).map((chunk) => {
    const body = chunk.slice(0, chunk.indexOf('</li>'));
    const href = unescape(body.match(/<a [^>]*?href="([^"]*)"/)?.[1] ?? '');
    const img = body.match(/<img [^>]*>/)?.[0] || null;
    const attr = (name) => {
      const m = img?.match(new RegExp(` ${name}="([^"]*)"`, 'i'));
      return m ? unescape(m[1]) : undefined;
    };
    return {
      key: SHOWCASE_CARDS.find((c) => c.href === href)?.key,
      href,
      liClass: body.match(/^[^>]*?class="([^"]*)"/)?.[1] ?? null,
      body,
      img,
      src: attr('src'),
      srcset: attr('srcset'),
      sizes: attr('sizes'),
      style: attr('style'),
    };
  });
}
const listClass = (html) => html.match(/<ul [^>]*?class="([^"]*)"/)?.[1];
const count = (html, needle) => html.split(needle).length - 1;
/* A label as it appears in markup: "Chains & Necklaces" renders as "Chains &amp; Necklaces". */
const inHtml = (text) => text.replace(/&/g, '&amp;');

/* ── What is shown, and in what order ── */

test('defaults: all six cards, in card order, as King Size 4:5 tiles in a grid, emoji placeholders', { skip }, () => {
  const html = render(normalizeShowcase({}));
  const list = cards(html);
  assert.deepEqual(list.map((c) => c.key), KEYS);
  assert.match(html, /^<section [^>]*aria-labelledby="shop-by-category"/);
  assert.match(html, /<h2 id="shop-by-category"[^>]*>Discover Our Collections<\/h2>/);
  assert.match(listClass(html), /\bgrid\b.*grid-cols-2 md:grid-cols-3/);
  assert.doesNotMatch(html, /snap-x|<button/);
  for (const c of list) {
    assert.match(c.body, /aspect-\[4\/5\]/);
    assert.ok(c.body.includes(`>${inHtml(CARD[c.key].label)}</span>`), `${c.key} label is the link text`);
    assert.ok(c.body.includes(CARD[c.key].emoji), `${c.key} emoji placeholder`);
    assert.ok(c.body.includes(CARD[c.key].color), `${c.key} gradient`);
    assert.equal(c.img, null);
  }
  assert.match(render(normalizeShowcase({}), { headingId: 'preview-shop-by-category' }), /aria-labelledby="preview-shop-by-category"[\s\S]*<h2 id="preview-shop-by-category"/);
});

test('hidden cards are not rendered at all — no link, label, emoji or image', { skip }, () => {
  const s = make({ layoutVariant: 'square', displayMode: 'grid', size: 'medium' }, [
    { key: 'earrings', isActive: false, image: CLD('earrings') },
    { key: 'anklet', isActive: false },
  ]);
  for (const showcase of [s, patchOf(s, { layout: { displayMode: 'slider' } }), patchOf(s, { layout: { layoutVariant: 'circle' } }), patchOf(s, { layout: { layoutVariant: 'circle', displayMode: 'slider' } })]) {
    const html = render(showcase);
    assert.deepEqual(cards(html).map((c) => c.key), ['necklace', 'bracelet', 'bangles', 'set'], JSON.stringify(showcase.layout));
    for (const k of ['earrings', 'anklet']) {
      assert.ok(!html.includes(`href="${CARD[k].href}"`), `${k} link`);
      assert.ok(!html.includes(`>${inHtml(CARD[k].label)}<`), `${k} label`);
      assert.ok(!html.includes(CARD[k].emoji), `${k} emoji`);
    }
    assert.ok(!html.includes('earrings.jpg'));
  }
});

test('the admin order is the storefront order, in every layout', { skip }, () => {
  const order = ['anklet', 'set', 'bracelet', 'necklace', 'bangles', 'earrings'];
  const base = patchOf(normalizeShowcase({}), { order, items: [{ key: 'bracelet', isActive: false }] });
  for (const v of LAYOUT_VARIANTS) {
    for (const m of DISPLAY_MODES) {
      const html = render(patchOf(base, { layout: { layoutVariant: v.value, displayMode: m.value } }));
      assert.deepEqual(cards(html).map((c) => c.key), order.filter((k) => k !== 'bracelet'), `${v.value}/${m.value}`);
    }
  }
});

test('nothing visible → no section at all (empty markup)', { skip }, () => {
  const allHidden = { items: SHOWCASE_CARDS.map((c) => ({ key: c.key, isActive: false })) };
  for (const v of LAYOUT_VARIANTS) {
    for (const m of DISPLAY_MODES) {
      assert.equal(render(patchOf(normalizeShowcase({}), { ...allHidden, layout: { layoutVariant: v.value, displayMode: m.value } })), '', `${v.value}/${m.value}`);
    }
  }
  const one = patchOf(normalizeShowcase({}), { items: SHOWCASE_CARDS.filter((c) => c.key !== 'set').map((c) => ({ key: c.key, isActive: false })) });
  assert.deepEqual(cards(render(one)).map((c) => c.key), ['set'], 'one visible card still renders the section');
});

/* ── Grid vs slider ── */

test('slider: a horizontal snap-x list with prev/next buttons; grid has neither', { skip }, () => {
  for (const v of LAYOUT_VARIANTS) {
    const grid = render(make({ layoutVariant: v.value, displayMode: 'grid', size: 'medium' }));
    const slider = render(make({ layoutVariant: v.value, displayMode: 'slider', size: 'medium' }));
    assert.doesNotMatch(grid, /snap-x|snap-start|<button/, `${v.value} grid`);
    assert.match(listClass(slider), /\bflex\b.*snap-x snap-mandatory.*overflow-x-auto/, `${v.value} slider list`);
    assert.doesNotMatch(listClass(slider), /\bgrid\b/);
    const list = cards(slider);
    assert.equal(list.length, 6);
    for (const c of list) assert.match(c.liClass, /\bshrink-0 snap-start\b/);
    assert.match(slider, /<button type="button" aria-label="Previous categories"[^>]*><svg data-icon="FiChevronLeft" aria-hidden="true"/);
    assert.match(slider, /<button type="button" aria-label="Next categories"[^>]*><svg data-icon="FiChevronRight" aria-hidden="true"/);
    assert.equal(count(slider, '<button'), 2);
  }
});

test('slider: cards get the shape\'s slide width; a featured card the wider one', { skip }, () => {
  const want = {
    circle: ['w-24 md:w-36', 'w-32 md:w-48'],
    square: ['w-[42vw] max-w-[260px] md:w-60', 'w-[68vw] max-w-[420px] md:w-96'],
    king_size: ['w-[44vw] max-w-[300px] md:w-64', 'w-[70vw] max-w-[440px] md:w-[400px]'],
    wide: ['w-[82vw] max-w-[640px] md:w-[520px]', 'w-[90vw] max-w-[760px] md:w-[720px]'],
  };
  for (const v of LAYOUT_VARIANTS) {
    const html = render(make({ layoutVariant: v.value, displayMode: 'slider', size: 'small' }, [{ key: 'set', isFeatured: true }]));
    const [normal, featured] = want[v.value];
    for (const c of cards(html)) {
      assert.ok(c.liClass.includes(c.key === 'set' ? featured : normal), `${v.value}/${c.key}: ${c.liClass}`);
      assert.doesNotMatch(c.liClass, /col-span/, 'no grid spans in a slider');
    }
  }
});

/* ── Featured ("King Size") slot ── */

test('featured card: double slot (col-span-2 row-span-2) for Square / King Size, full row for Wide; only on that card', { skip }, () => {
  const span = { square: 'col-span-2 row-span-2', king_size: 'col-span-2 row-span-2', wide: 'col-span-full' };
  for (const variant of ['square', 'king_size', 'wide']) {
    for (const size of SIZES) {
      const html = render(make({ layoutVariant: variant, displayMode: 'grid', size }, [{ key: 'set', isFeatured: true }]));
      assert.match(listClass(html), /grid-flow-row-dense/, 'dense packing fills the gaps around the big card');
      for (const c of cards(html)) {
        if (c.key === 'set') {
          assert.equal(c.liClass, span[variant], `${variant}/${size}`);
          assert.match(c.body, /border-gold-300/);
          assert.match(c.body, /font-serif[^"]*">Jewellery Sets</, 'bigger serif label');
        } else {
          assert.equal(c.liClass, '', `${variant}/${size}/${c.key} has no span`);
        }
      }
      if (variant === 'wide') assert.doesNotMatch(html, /row-span-2/);
    }
  }
  const two = render(make({ layoutVariant: 'king_size', displayMode: 'grid', size: 'large' }, [{ key: 'set', isFeatured: true }, { key: 'necklace', isFeatured: true }]));
  assert.equal(count(two, 'col-span-2 row-span-2'), 2, 'more than one card can be featured');
});

test('featured circle: a bigger round frame instead of a grid span', { skip }, () => {
  const html = render(make({ layoutVariant: 'circle', displayMode: 'grid', size: 'large' }, [{ key: 'necklace', isFeatured: true }]));
  assert.doesNotMatch(html, /col-span|row-span/);
  for (const c of cards(html)) {
    const frame = c.key === 'necklace' ? 'w-36 h-36 md:w-52 md:h-52' : 'w-28 h-28 md:w-40 md:h-40';
    assert.ok(c.body.includes(frame), `${c.key}: ${frame}`);
    assert.ok(c.body.includes(c.key === 'necklace' ? 'border-gold-400' : 'border-gold-200'));
  }
});

/* ── Shapes and density ── */

test('circle: every card is a rounded-full frame with the name below, sized by density', { skip }, () => {
  const frames = { small: 'w-20 h-20 md:w-28 md:h-28', medium: 'w-24 h-24 md:w-32 md:h-32', large: 'w-28 h-28 md:w-40 md:h-40' };
  for (const size of SIZES) {
    const html = render(make({ layoutVariant: 'circle', displayMode: 'grid', size }, [{ key: 'anklet', isActive: false }]));
    assert.match(listClass(html), /\bflex flex-wrap\b.*justify-center/);
    assert.doesNotMatch(listClass(html), /\bgrid\b/);
    assert.equal(count(html, 'rounded-full border-2'), 5, `${size}: one round frame per visible card`);
    assert.equal(count(html, frames[size]), 5, size);
    assert.doesNotMatch(html, /rounded-2xl|aspect-\[4\/5\]|aspect-video/);
    for (const c of cards(html)) {
      assert.match(c.body, new RegExp(`</span><span class="[^"]*">${inHtml(CARD[c.key].label)}</span></a>$`), `${c.key}: name below the circle`);
    }
  }
  const slider = render(make({ layoutVariant: 'circle', displayMode: 'slider', size: 'small' }));
  assert.equal(count(slider, 'rounded-full border-2'), 6);
  assert.equal(count(slider, 'w-full aspect-square'), 6, 'slider circles fill their slide');
});

test('tiles: Square 1:1, King Size 4:5, Wide 16:9, never rounded-full', { skip }, () => {
  const aspect = { square: 'aspect-square', king_size: 'aspect-[4/5]', wide: 'aspect-video' };
  for (const variant of Object.keys(aspect)) {
    for (const mode of ['grid', 'slider']) {
      const html = render(make({ layoutVariant: variant, displayMode: mode, size: 'medium' }));
      for (const c of cards(html)) assert.match(c.body, new RegExp(`<a [^>]*class="[^"]*rounded-2xl[^"]*${aspect[variant].replace(/[[\]/]/g, '\\$&')}`), `${variant}/${mode}/${c.key}`);
      assert.doesNotMatch(html, /rounded-full border-2/, `${variant}/${mode}`);
    }
  }
});

test('density sets the grid columns per shape (mobile / desktop)', { skip }, () => {
  const want = {
    square: { small: 'grid-cols-3 md:grid-cols-6', medium: 'grid-cols-2 md:grid-cols-4', large: 'grid-cols-2 md:grid-cols-3' },
    king_size: { small: 'grid-cols-3 md:grid-cols-6', medium: 'grid-cols-2 md:grid-cols-4', large: 'grid-cols-2 md:grid-cols-3' },
    wide: { small: 'grid-cols-2 md:grid-cols-3', medium: 'grid-cols-1 md:grid-cols-2', large: 'grid-cols-1 md:grid-cols-2' },
  };
  for (const [variant, bySize] of Object.entries(want)) {
    for (const [size, cols] of Object.entries(bySize)) {
      const html = render(make({ layoutVariant: variant, displayMode: 'grid', size }));
      assert.ok(listClass(html).endsWith(cols), `${variant}/${size}: ${listClass(html)}`);
    }
  }
  const small = cards(render(make({ layoutVariant: 'square', displayMode: 'grid', size: 'small' })));
  assert.match(small[0].body, /text-xs md:text-sm">Chains &amp; Necklaces</, 'small tiles get smaller labels');
});

/* ── Photos and crops ── */

test('photos: <img> src/srcset carry the Cloudinary crop for the shape (ar + gravity), style the focus', { skip }, () => {
  const ar = { circle: 'ar_1:1', square: 'ar_1:1', king_size: 'ar_4:5', wide: 'ar_16:9' };
  const focus = { gravity: 'north', x: 50, y: 50, zoom: 1 };
  for (const v of LAYOUT_VARIANTS) {
    for (const m of DISPLAY_MODES) {
      const html = render(make({ layoutVariant: v.value, displayMode: m.value, size: 'medium' }, [{ key: 'necklace', image: CLD('necklace'), focus }]));
      const necklace = cards(html).find((c) => c.key === 'necklace');
      assert.ok(necklace.img, `${v.value}/${m.value}: has an image`);
      assert.equal(necklace.src, showcaseImageUrl(CLD('necklace'), { variant: v.value, focus, width: 600 }));
      assert.ok(necklace.src.includes(`/upload/f_auto,q_auto:good,c_fill,${ar[v.value]},g_north,w_600/v17/`), necklace.src);
      assert.equal(necklace.srcset, showcaseSrcSet(CLD('necklace'), { variant: v.value, focus }));
      assert.ok(necklace.sizes && necklace.sizes.length > 0, 'sizes for the srcset');
      assert.match(necklace.img, / alt="" /, 'decorative: the label is the link text');
      assert.match(necklace.img, / loading="lazy"/);
      assert.equal(necklace.style, 'object-fit:cover;object-position:50% 0%;transform-origin:50% 0%');
      assert.ok(!necklace.body.includes(CARD.necklace.emoji), 'no emoji placeholder when there is a photo');
      assert.equal(count(html, '<img'), 1, 'cards without photos have no <img>');
    }
  }
});

test('photos: Face gravity → g_auto:faces; a custom point → c_limit + CSS object-position and zoom', { skip }, () => {
  const face = cards(render(make({ layoutVariant: 'king_size', displayMode: 'grid', size: 'large' }, [{ key: 'set', image: CLD('set'), focus: { gravity: 'face' } }]))).find((c) => c.key === 'set');
  assert.match(face.src, /\/upload\/f_auto,q_auto:good,c_fill,ar_4:5,g_auto:faces,w_600\//);
  assert.match(face.style, /object-position:50% 30%/);

  const focus = { gravity: 'custom', x: 20, y: 80, zoom: 1.5 };
  const custom = cards(render(make({ layoutVariant: 'wide', displayMode: 'grid', size: 'large' }, [{ key: 'set', image: CLD('set'), focus }]))).find((c) => c.key === 'set');
  assert.equal(custom.src, `https://res.cloudinary.com/tulsi/image/upload/f_auto,q_auto:good,c_limit,w_1440/v17/tulsi-bridal/categories/set.jpg`);
  assert.doesNotMatch(custom.src, /ar_|g_/);
  assert.equal(custom.srcset, showcaseSrcSet(CLD('set'), { variant: 'wide', focus }));
  assert.equal(custom.style, 'object-fit:cover;object-position:20% 80%;transform-origin:20% 80%;transform:scale(1.5)');
});

test('photos: a non-Cloudinary URL is used as is, with no srcset', { skip }, () => {
  const url = 'https://images.example.test/jewellery-set.jpg?w=800&q=90';
  const set = cards(render(make({ layoutVariant: 'square', displayMode: 'grid', size: 'large' }, [{ key: 'set', image: url }]))).find((c) => c.key === 'set');
  assert.equal(set.src, url);
  assert.equal(set.srcset, undefined);
  assert.doesNotMatch(set.img, /srcset=/i);
});

test('legacy categoryImages render as the photos; a photo removed on purpose shows the emoji', { skip }, () => {
  const s = normalizeShowcase({ categoryShape: 'circle', categoryImages: { necklace: CLD('necklace'), set: CLD('set') } });
  const list = cards(render(s));
  assert.ok(list.find((c) => c.key === 'necklace').src.includes('c_fill,ar_1:1,g_auto,w_600'));
  assert.equal(count(render(s), 'rounded-full border-2'), 6, 'legacy circle shape kept');
  const removed = patchOf(s, { items: [{ key: 'set', image: '' }] });
  const set = cards(render(removed)).find((c) => c.key === 'set');
  assert.equal(set.img, null);
  assert.ok(set.body.includes(CARD.set.emoji));
});

/* ── Safety and the preview ── */

test('a tampered stored doc cannot inject links, labels or attributes', { skip }, () => {
  const s = normalizeShowcase({
    categoryShowcase: {
      layout: { layoutVariant: 'square', displayMode: 'grid', size: 'large' },
      items: [
        { key: 'necklace', href: 'javascript:alert(1)', label: '<script>alert(1)</script>', image: 'https://x.test/a.jpg" onerror="alert(1)' },
        { key: 'earrings', image: 'javascript:alert(1)' },
        { key: 'evil', href: 'https://evil.test' },
      ],
    },
  });
  const html = render(s);
  assert.doesNotMatch(html, /javascript:|<script|onerror|evil\.test/);
  assert.deepEqual(cards(html).map((c) => c.href), SHOWCASE_CARDS.map((c) => c.href));
  for (const href of cards(html).map((c) => c.href)) assert.match(href, /^\/[a-z]/, 'internal links only');
});

test('a non-string stored shape (e.g. ["circle"]) falls back to King Size instead of crashing the homepage', { skip }, () => {
  for (const layoutVariant of [['circle'], ['square'], { toString: () => 'wide' }]) {
    const s = make({ layoutVariant, displayMode: 'grid', size: 'large' });
    assert.equal(s.layout.layoutVariant, 'king_size');
    const html = render(s);
    assert.equal(cards(html).length, 6);
    assert.match(html, /aspect-\[4\/5\]/);
  }
});

test('the preview frame (draft re-normalized from postMessage) renders exactly what the storefront renders', { skip }, () => {
  const draft = patchOf(normalizeShowcase({ categoryImages: { necklace: CLD('necklace') } }), {
    layout: { layoutVariant: 'king_size', displayMode: 'slider', size: 'small' },
    order: ['set', 'necklace', 'anklet', 'earrings', 'bangles', 'bracelet'],
    items: [{ key: 'set', isFeatured: true }, { key: 'bangles', isActive: false }, { key: 'necklace', focus: { gravity: 'custom', x: 35, y: 65, zoom: 2 } }],
  });
  /* What ShowcasePreviewClient does with the message it receives. */
  const received = normalizeShowcase({ categoryShowcase: structuredClone(draft) });
  assert.equal(render(received), render(draft));
});

test('every shape × mode × density × featured/hidden mix renders cleanly with the right number of cards', { skip }, () => {
  const mixes = [
    [],
    [{ key: 'set', isFeatured: true }],
    SHOWCASE_CARDS.map((c) => ({ key: c.key, isFeatured: true })),
    [{ key: 'necklace', isActive: false }, { key: 'anklet', isActive: false }, { key: 'earrings', isFeatured: true, image: CLD('earrings'), focus: { gravity: 'custom', x: 0, y: 100, zoom: 2.5 } }],
    [{ key: 'bangles', image: 'https://images.example.test/b.jpg', focus: { gravity: 'south', zoom: 1.2 } }],
  ];
  let renders = 0;
  for (const v of LAYOUT_VARIANTS) {
    for (const m of DISPLAY_MODES) {
      for (const size of SIZES) {
        for (const items of mixes) {
          const s = make({ layoutVariant: v.value, displayMode: m.value, size }, items);
          const html = render(s);
          const visible = s.items.filter((it) => it.isActive).map((it) => it.key);
          assert.deepEqual(cards(html).map((c) => c.key), visible);
          assert.equal(count(html, '<a '), visible.length);
          renders += 1;
        }
      }
    }
  }
  assert.equal(renders, 4 * 2 * 3 * 5);
});
