/* ─────────────────────────────────────────────
   Homepage category showcase — the pure data model
   (src/lib/categoryShowcase.js): normalizing whatever is stored (or the
   pre-showcase legacy fields), the stored form, the PATCH schema, applying
   a patch, and the Cloudinary crop / CSS focus helpers the storefront and
   the admin preview share.

   API route tests:   tests/category-showcase-api.test.mjs
   Storefront markup: tests/category-showcase-render.test.mjs

   Run: npm test
   ───────────────────────────────────────────── */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHOWCASE_VERSION, PREVIEW_MSG, SHOWCASE_CARDS, LAYOUT_VARIANTS, DISPLAY_MODES, SIZES, GRAVITIES, ASPECTS,
  DEFAULT_FOCUS, DEFAULT_LAYOUT, ZOOM_RANGE,
  normalizeShowcase, toStored, visibleItems, applyShowcasePatch,
  isCloudinary, showcaseImageUrl, showcaseSrcSet, focusStyle,
} from '../src/lib/categoryShowcase.js';
import { ShowcasePatch } from '../src/lib/categoryShowcaseSchema.js';

const KEYS = SHOWCASE_CARDS.map((c) => c.key);
const CARD = Object.fromEntries(SHOWCASE_CARDS.map((c) => [c.key, c]));
const CLD = (name) => `https://res.cloudinary.com/tulsi/image/upload/v17/tulsi-bridal/categories/${name}.jpg`;
const byKey = (s) => Object.fromEntries(s.items.map((it) => [it.key, it]));
const keysOf = (s) => s.items.map((it) => it.key);
const stored = (categoryShowcase, extra = {}) => normalizeShowcase({ categoryShowcase, ...extra });
const NORMALIZED_ITEM_FIELDS = ['key', 'label', 'href', 'emoji', 'color', 'isActive', 'displayOrder', 'isFeatured', 'image', 'focus'].sort();
const STORED_ITEM_FIELDS = ['key', 'isActive', 'displayOrder', 'isFeatured', 'image', 'focus'].sort();

/* Every invariant a normalized showcase must hold, whatever went in. */
function assertWellFormed(s) {
  assert.equal(s.version, SHOWCASE_VERSION);
  assert.deepEqual(Object.keys(s.layout).sort(), ['displayMode', 'layoutVariant', 'size']);
  assert.ok(LAYOUT_VARIANTS.some((v) => v.value === s.layout.layoutVariant), `variant ${s.layout.layoutVariant}`);
  assert.ok(DISPLAY_MODES.some((m) => m.value === s.layout.displayMode), `mode ${s.layout.displayMode}`);
  assert.ok(SIZES.includes(s.layout.size), `size ${s.layout.size}`);
  assert.deepEqual([...keysOf(s)].sort(), [...KEYS].sort(), 'every known card exactly once');
  s.items.forEach((it, i) => {
    assert.deepEqual(Object.keys(it).sort(), NORMALIZED_ITEM_FIELDS, `${it.key}: no stray fields`);
    assert.equal(it.displayOrder, i, 'displayOrder is 0..n-1 in array order');
    assert.equal(typeof it.isActive, 'boolean');
    assert.equal(typeof it.isFeatured, 'boolean');
    assert.ok(it.image === '' || /^https:\/\/[^\s"'<>]+$/.test(it.image), `${it.key}: image ${it.image}`);
    const { label, href, emoji, color } = CARD[it.key];
    assert.deepEqual({ label: it.label, href: it.href, emoji: it.emoji, color: it.color }, { label, href, emoji, color });
    assert.deepEqual(Object.keys(it.focus).sort(), ['gravity', 'x', 'y', 'zoom']);
    assert.ok(GRAVITIES.some((g) => g.value === it.focus.gravity));
    for (const k of ['x', 'y']) assert.ok(Number.isInteger(it.focus[k]) && it.focus[k] >= 0 && it.focus[k] <= 100, `${k} ${it.focus[k]}`);
    assert.ok(it.focus.zoom >= ZOOM_RANGE.min && it.focus.zoom <= ZOOM_RANGE.max, `zoom ${it.focus.zoom}`);
  });
}

/* ── The constants the admin UI, the storefront and the API agree on ── */

test('constants: six cards, four shapes, two modes, three sizes; every shape has an aspect', () => {
  assert.deepEqual(KEYS, ['necklace', 'earrings', 'bangles', 'maang-tikka', 'set', 'rentals']);
  assert.deepEqual(SHOWCASE_CARDS.map((c) => c.label), ['Necklaces', 'Earrings', 'Bangles', 'Maang Tikka', 'Bridal Sets', 'Rentals']);
  for (const c of SHOWCASE_CARDS) assert.match(c.href, /^\/[a-z]/, `${c.key}: an internal link`);
  assert.deepEqual(LAYOUT_VARIANTS.map((v) => v.value), ['circle', 'square', 'king_size', 'wide']);
  assert.deepEqual(Object.keys(ASPECTS).sort(), LAYOUT_VARIANTS.map((v) => v.value).sort());
  assert.deepEqual(ASPECTS, { circle: [1, 1], square: [1, 1], king_size: [4, 5], wide: [16, 9] });
  assert.deepEqual(DISPLAY_MODES.map((m) => m.value), ['grid', 'slider']);
  assert.deepEqual([...SIZES], ['small', 'medium', 'large']);
  assert.deepEqual(GRAVITIES.map((g) => g.value), ['auto', 'face', 'center', 'north', 'south', 'custom']);
  assert.deepEqual({ ...DEFAULT_FOCUS }, { gravity: 'auto', x: 50, y: 50, zoom: 1 });
  assert.deepEqual({ ...ZOOM_RANGE }, { min: 1, max: 2.5 });
  assert.equal(typeof PREVIEW_MSG, 'string');
  assert.ok(PREVIEW_MSG.length > 0);
  for (const frozen of [SHOWCASE_CARDS, LAYOUT_VARIANTS, DISPLAY_MODES, SIZES, GRAVITIES, ASPECTS, DEFAULT_FOCUS, DEFAULT_LAYOUT, ZOOM_RANGE]) {
    assert.ok(Object.isFrozen(frozen));
  }
});

/* ── normalizeShowcase: defaults ── */

test('normalize: {} → all six cards visible, in card order, default layout, no photos, default focus', () => {
  const s = normalizeShowcase({});
  assertWellFormed(s);
  assert.deepEqual(s.layout, { ...DEFAULT_LAYOUT });
  assert.deepEqual(DEFAULT_LAYOUT, { layoutVariant: 'king_size', displayMode: 'grid', size: 'large' });
  assert.deepEqual(keysOf(s), KEYS);
  for (const it of s.items) {
    assert.equal(it.isActive, true);
    assert.equal(it.isFeatured, false);
    assert.equal(it.image, '');
    assert.deepEqual(it.focus, { ...DEFAULT_FOCUS });
  }
  assert.deepEqual(visibleItems(s).map((it) => it.key), KEYS);
});

test('normalize: no argument, null, a string or a junk showcase field all give the defaults', () => {
  const dflt = normalizeShowcase({});
  for (const input of [undefined, null, 'site', 42, { categoryShowcase: null }, { categoryShowcase: 'junk' },
    { categoryShowcase: { layout: 'circle', items: 'all' } }, { categoryShowcase: { items: [null, 'set', 7, []] } },
    { categoryImages: 'nope' }, { categoryImages: null }]) {
    const s = normalizeShowcase(input);
    assertWellFormed(s);
    assert.deepEqual(s, dflt, JSON.stringify(input));
  }
});

test('normalize: returns fresh objects — mutating the result never leaks into the defaults or the next call', () => {
  const a = normalizeShowcase({});
  a.layout.layoutVariant = 'wide';
  a.items[0].label = 'Mutated';
  a.items[0].focus.x = 1;
  const b = normalizeShowcase({});
  assert.equal(b.layout.layoutVariant, DEFAULT_LAYOUT.layoutVariant);
  assert.equal(b.items[0].label, 'Necklaces');
  assert.equal(b.items[0].focus.x, 50);
  assert.equal(SHOWCASE_CARDS[0].label, 'Necklaces');
  assert.equal(DEFAULT_FOCUS.x, 50);
});

/* ── normalizeShowcase: settings saved before the showcase existed ── */

test('legacy layout: circle stays circle; square+small stays square; square+medium/large become King Size', () => {
  const cases = [
    [{ categoryShape: 'circle' }, { layoutVariant: 'circle', displayMode: 'grid', size: 'large' }],
    [{ categoryShape: 'circle', categorySize: 'small' }, { layoutVariant: 'circle', displayMode: 'grid', size: 'small' }],
    [{ categoryShape: 'circle', categorySize: 'medium' }, { layoutVariant: 'circle', displayMode: 'grid', size: 'medium' }],
    [{ categoryShape: 'square', categorySize: 'small' }, { layoutVariant: 'square', displayMode: 'grid', size: 'small' }],
    [{ categoryShape: 'square', categorySize: 'medium' }, { layoutVariant: 'king_size', displayMode: 'grid', size: 'medium' }],
    [{ categoryShape: 'square', categorySize: 'large' }, { layoutVariant: 'king_size', displayMode: 'grid', size: 'large' }],
    [{ categoryShape: 'square' }, { layoutVariant: 'king_size', displayMode: 'grid', size: 'large' }],
    [{ categorySize: 'medium' }, { layoutVariant: 'king_size', displayMode: 'grid', size: 'medium' }],
    [{ categoryShape: 'square', categorySize: 'huge' }, { layoutVariant: 'king_size', displayMode: 'grid', size: 'large' }],
    [{ categoryShape: 'hexagon', categorySize: 'small' }, { layoutVariant: 'king_size', displayMode: 'grid', size: 'small' }],
  ];
  for (const [legacy, layout] of cases) {
    const s = normalizeShowcase(legacy);
    assertWellFormed(s);
    assert.deepEqual(s.layout, layout, JSON.stringify(legacy));
  }
});

test('legacy photos: categoryImages become the card photos; unknown keys and non-https URLs are dropped', () => {
  const s = normalizeShowcase({
    categoryImages: {
      necklace: CLD('necklace'),
      set: 'https://images.example.test/bridal-set.jpg',
      earrings: 'http://res.cloudinary.com/tulsi/image/upload/v1/earrings.jpg',
      bangles: 'javascript:alert(1)',
      ring: CLD('ring'),
      'maang-tikka': '',
    },
  });
  assertWellFormed(s);
  const it = byKey(s);
  assert.equal(it.necklace.image, CLD('necklace'));
  assert.equal(it.set.image, 'https://images.example.test/bridal-set.jpg');
  assert.equal(it.earrings.image, '', 'plain http is not used');
  assert.equal(it.bangles.image, '');
  assert.equal(it['maang-tikka'].image, '');
  assert.equal(it.rentals.image, '');
  assert.ok(!keysOf(s).includes('ring'), 'no card is invented for an unknown key');
  assert.ok(s.items.every((x) => x.isActive), 'legacy settings had no hidden cards');
});

test('stored values win over legacy ones: layout, photo, and a photo removed on purpose stays removed', () => {
  const legacy = { categoryShape: 'circle', categorySize: 'small', categoryImages: { necklace: CLD('old-necklace'), set: CLD('old-set'), earrings: CLD('old-earrings'), bangles: CLD('old-bangles') } };
  const s = stored({
    layout: { layoutVariant: 'square', displayMode: 'slider', size: 'medium' },
    items: [
      { key: 'necklace', image: CLD('new-necklace') },
      { key: 'set', image: '' },
      { key: 'earrings', image: null },
      { key: 'bangles', isActive: false },
    ],
  }, legacy);
  assertWellFormed(s);
  assert.deepEqual(s.layout, { layoutVariant: 'square', displayMode: 'slider', size: 'medium' });
  const it = byKey(s);
  assert.equal(it.necklace.image, CLD('new-necklace'));
  assert.equal(it.set.image, '', "'' = removed on purpose: the old photo does not come back");
  assert.equal(it.earrings.image, '', 'null is not "unset" either');
  assert.equal(it.bangles.image, CLD('old-bangles'), 'a stored item with no image field still uses the old photo');
  assert.equal(it.bangles.isActive, false);
});

test('a stored layout replaces the legacy one as a whole (missing fields take defaults, not legacy values)', () => {
  const s = stored({ layout: { layoutVariant: 'wide' } }, { categoryShape: 'circle', categorySize: 'small' });
  assert.deepEqual(s.layout, { layoutVariant: 'wide', displayMode: 'grid', size: 'large' });
  const t = stored({ layout: 'circle' }, { categoryShape: 'circle', categorySize: 'small' });
  assert.deepEqual(t.layout, { layoutVariant: 'circle', displayMode: 'grid', size: 'small' }, 'a non-object layout falls back to legacy');
});

/* ── normalizeShowcase: whatever is stored, only valid values come out ── */

test('invalid layout values fall back field by field', () => {
  const cases = [
    [{ layoutVariant: 'hexagon', displayMode: 'carousel', size: 'xl' }, { ...DEFAULT_LAYOUT }],
    [{ layoutVariant: 'slider', displayMode: 'slider', size: 'small' }, { layoutVariant: 'king_size', displayMode: 'slider', size: 'small' }],
    [{ layoutVariant: 'toString', displayMode: 'constructor', size: '__proto__' }, { ...DEFAULT_LAYOUT }],
    [{ layoutVariant: 'CIRCLE', displayMode: 'Grid', size: 'LARGE' }, { ...DEFAULT_LAYOUT }],
    [{ layoutVariant: ['circle'], displayMode: null, size: 2 }, { ...DEFAULT_LAYOUT }],
    [{ layoutVariant: 'circle', displayMode: 'slider', size: 'small', extra: 'x' }, { layoutVariant: 'circle', displayMode: 'slider', size: 'small' }],
  ];
  for (const [layout, want] of cases) {
    const s = stored({ layout });
    assertWellFormed(s);
    assert.deepEqual(s.layout, want, JSON.stringify(layout));
  }
});

test('invalid focus values are clamped into range or fall back to the default', () => {
  const focusOf = (focus) => byKey(stored({ items: [{ key: 'set', focus }] })).set.focus;
  assert.deepEqual(focusOf({ gravity: 'custom', x: 150, y: -20, zoom: 9 }), { gravity: 'custom', x: 100, y: 0, zoom: 2.5 });
  assert.deepEqual(focusOf({ gravity: 'custom', x: 101, y: 100.4, zoom: 0.2 }), { gravity: 'custom', x: 100, y: 100, zoom: 1 });
  assert.deepEqual(focusOf({ gravity: 'g_face', x: 'abc', y: Number.NaN, zoom: 'big' }), { ...DEFAULT_FOCUS });
  assert.deepEqual(focusOf({ gravity: 'custom', x: Infinity, y: -Infinity, zoom: Infinity }), { gravity: 'custom', x: 50, y: 50, zoom: 1 });
  assert.deepEqual(focusOf({ gravity: 'face', x: 33.6, y: 12.4, zoom: 1.234 }), { gravity: 'face', x: 34, y: 12, zoom: 1.23 }, 'x/y whole percents, zoom to 2 dp');
  assert.deepEqual(focusOf('north'), { ...DEFAULT_FOCUS });
  assert.deepEqual(focusOf(null), { ...DEFAULT_FOCUS });
  assert.deepEqual(focusOf({ gravity: 'north', angle: 45, x: 20 }), { gravity: 'north', x: 20, y: 50, zoom: 1 }, 'unknown focus keys dropped');
});

test('invalid photos become "no photo": http, javascript:, data:, quotes/spaces/brackets, over 600 chars, non-strings', () => {
  const bad = [
    'http://res.cloudinary.com/tulsi/image/upload/v1/a.jpg',
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    ' https://x.test/a.jpg',
    'data:image/png;base64,AAAA',
    '//evil.test/a.jpg',
    'https://x.test/a b.jpg',
    'https://x.test/a.jpg" onerror="alert(1)',
    "https://x.test/a.jpg'",
    'https://x.test/<script>.jpg',
    'https://',
    `https://x.test/${'a'.repeat(600)}`,
    123, true, { url: CLD('a') }, [CLD('a')],
  ];
  for (const image of bad) {
    const s = stored({ items: [{ key: 'necklace', image }] }, { categoryImages: { necklace: CLD('legacy') } });
    assert.equal(byKey(s).necklace.image, '', JSON.stringify(image));
  }
  const max = `https://x.test/${'a'.repeat(600 - 'https://x.test/'.length)}`;
  assert.equal(max.length, 600);
  assert.equal(byKey(stored({ items: [{ key: 'necklace', image: max }] })).necklace.image, max, '600 chars is still allowed');
});

test('unknown card keys are ignored, duplicates keep the first, junk entries are skipped', () => {
  const s = stored({
    items: [
      null, 'set', 42,
      { key: 'ring', isActive: false, image: CLD('ring') },
      { key: '__proto__', isActive: false },
      { isActive: false },
      { key: 'set', isActive: false, isFeatured: true },
      { key: 'set', isActive: true, isFeatured: false },
    ],
  });
  assertWellFormed(s);
  assert.equal(s.items.length, SHOWCASE_CARDS.length);
  assert.deepEqual(keysOf(s), KEYS);
  const it = byKey(s);
  assert.equal(it.set.isActive, false, 'first entry for a key wins');
  assert.equal(it.set.isFeatured, true);
  assert.deepEqual(visibleItems(s).map((x) => x.key), KEYS.filter((k) => k !== 'set'));
});

test('flags are strict booleans: anything else means visible / not featured', () => {
  const s = stored({
    items: [
      { key: 'necklace', isActive: 'false', isFeatured: 'true' },
      { key: 'earrings', isActive: 0, isFeatured: 1 },
      { key: 'bangles', isActive: null, isFeatured: null },
      { key: 'set', isActive: false, isFeatured: true },
    ],
  });
  const it = byKey(s);
  assert.deepEqual([it.necklace.isActive, it.necklace.isFeatured], [true, false]);
  assert.deepEqual([it.earrings.isActive, it.earrings.isFeatured], [true, false]);
  assert.deepEqual([it.bangles.isActive, it.bangles.isFeatured], [true, false]);
  assert.deepEqual([it.set.isActive, it.set.isFeatured], [false, true]);
});

test('displayOrder: sorted, ties broken by card order, re-numbered 0..5; non-integers keep the card position', () => {
  const s = stored({
    items: [
      { key: 'necklace', displayOrder: 50 },
      { key: 'earrings', displayOrder: 10 },
      { key: 'bangles', displayOrder: -3 },
      { key: 'maang-tikka', displayOrder: 7 },
      { key: 'set', displayOrder: 7 },
      { key: 'rentals', displayOrder: 100 },
    ],
  });
  assertWellFormed(s);
  assert.deepEqual(keysOf(s), ['bangles', 'maang-tikka', 'set', 'earrings', 'necklace', 'rentals']);
  assert.deepEqual(s.items.map((it) => it.displayOrder), [0, 1, 2, 3, 4, 5]);

  /* Non-integer orders fall back to the card's own index (necklace 0 …
     rentals 5); rentals moved to the front with a real integer. */
  const t = stored({
    items: [
      { key: 'necklace', displayOrder: '2' },
      { key: 'earrings', displayOrder: 1.5 },
      { key: 'bangles', displayOrder: Number.NaN },
      { key: 'maang-tikka', displayOrder: null },
      { key: 'set', displayOrder: Infinity },
      { key: 'rentals', displayOrder: -1 },
    ],
  });
  assertWellFormed(t);
  assert.deepEqual(keysOf(t), ['rentals', 'necklace', 'earrings', 'bangles', 'maang-tikka', 'set']);
});

test('label, link, emoji and colour always come from code, never from the stored doc', () => {
  const s = stored({
    items: SHOWCASE_CARDS.map((c) => ({
      key: c.key, label: 'Hacked', href: 'https://evil.test/phish', emoji: '💀', color: 'from-black', onClick: 'alert(1)', extra: { deep: 1 },
    })),
  });
  assertWellFormed(s);
  for (const it of s.items) {
    assert.equal(it.label, CARD[it.key].label);
    assert.equal(it.href, CARD[it.key].href);
    assert.equal(it.emoji, CARD[it.key].emoji);
    assert.equal(it.color, CARD[it.key].color);
    assert.ok(!('onClick' in it) && !('extra' in it));
  }
});

test('normalizing is idempotent: normalize(toStored(normalize(x))) === normalize(x)', () => {
  const inputs = [
    {},
    { categoryShape: 'square', categorySize: 'medium', categoryImages: { necklace: CLD('n'), rentals: CLD('r') } },
    { categoryShowcase: { layout: { layoutVariant: 'wide', displayMode: 'slider', size: 'small' }, items: [{ key: 'rentals', displayOrder: 0, isFeatured: true, image: CLD('r'), focus: { gravity: 'custom', x: 10, y: 90, zoom: 2 } }, { key: 'set', isActive: false }] } },
  ];
  for (const input of inputs) {
    const s = normalizeShowcase(input);
    assert.deepEqual(normalizeShowcase({ categoryShowcase: toStored(s) }), s);
  }
});

/* ── toStored ── */

test('toStored: keeps only the editable fields (label/href/emoji/color stripped), copies, no undefined anywhere', () => {
  const s = normalizeShowcase({ categoryImages: { necklace: CLD('n') } });
  const out = toStored(s);
  assert.equal(out.version, SHOWCASE_VERSION);
  assert.deepEqual(Object.keys(out).sort(), ['items', 'layout', 'version']);
  assert.deepEqual(out.layout, s.layout);
  assert.notEqual(out.layout, s.layout, 'a copy, not the same object');
  assert.equal(out.items.length, 6);
  out.items.forEach((it, i) => {
    assert.deepEqual(Object.keys(it).sort(), STORED_ITEM_FIELDS);
    for (const k of ['label', 'href', 'emoji', 'color']) assert.ok(!(k in it), `${k} not stored`);
    assert.deepEqual(it.focus, s.items[i].focus);
    assert.notEqual(it.focus, s.items[i].focus);
  });
  assert.equal(out.items[0].image, CLD('n'));
  /* Firestore rejects undefined values. */
  const noUndefined = (v) => (v === undefined ? false : v && typeof v === 'object' ? Object.values(v).every(noUndefined) : true);
  assert.ok(noUndefined(out));
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out, 'plain JSON data');
});

/* ── ShowcasePatch ── */

const ok = (body) => {
  const r = ShowcasePatch.safeParse(body);
  assert.ok(r.success, `${JSON.stringify(body)} should be accepted: ${r.error?.issues?.[0]?.message}`);
  return r.data;
};
const rejected = (body, why) => {
  const r = ShowcasePatch.safeParse(body);
  assert.equal(r.success, false, `${why || JSON.stringify(body)} should be rejected`);
  assert.equal(typeof r.error.issues[0]?.message, 'string');
  return r.error.issues[0].message;
};

test('patch schema accepts each kind of change on its own and together', () => {
  ok({ layout: { layoutVariant: 'circle' } });
  ok({ layout: { displayMode: 'slider' } });
  ok({ layout: { size: 'small' } });
  ok({ layout: { layoutVariant: 'wide', displayMode: 'grid', size: 'medium' } });
  ok({ items: [{ key: 'set', isFeatured: true }] });
  ok({ items: [{ key: 'earrings', isActive: false }] });
  ok({ items: [{ key: 'necklace', image: '' }] });
  ok({ items: [{ key: 'necklace', image: CLD('necklace') }] });
  ok({ items: [{ key: 'necklace', focus: { zoom: 1.5 } }] });
  ok({ items: [{ key: 'necklace', focus: { gravity: 'custom', x: 0, y: 100, zoom: 2.5 } }] });
  ok({ items: [{ key: 'necklace', focus: { x: 0.5, y: 99.5, zoom: 1 } }] });
  ok({ order: [...KEYS].reverse() });
  ok({ layout: { size: 'large' }, items: SHOWCASE_CARDS.map((c) => ({ key: c.key, isActive: true })), order: KEYS });
  for (const v of LAYOUT_VARIANTS) ok({ layout: { layoutVariant: v.value } });
  for (const m of DISPLAY_MODES) ok({ layout: { displayMode: m.value } });
  for (const g of GRAVITIES) ok({ items: [{ key: 'set', focus: { gravity: g.value } }] });
  const parsed = ok({ items: [{ key: 'set', isActive: false }] });
  assert.deepEqual(parsed, { items: [{ key: 'set', isActive: false }] }, 'nothing added on the way through');
});

test('patch schema: nothing to change is rejected', () => {
  assert.equal(rejected({}), 'nothing to change');
  assert.equal(rejected({ items: [] }), 'nothing to change');
  for (const body of [null, undefined, 'layout', 7, true, [], [{ key: 'set' }]]) rejected(body);
});

test('patch schema is strict: unknown keys are rejected at every level', () => {
  rejected({ layout: { layoutVariant: 'circle' }, extra: 1 }, 'unknown top-level key');
  rejected({ categoryShowcase: { layout: {} } }, 'whole-doc write');
  rejected({ version: 2, order: KEYS }, 'version is not patchable');
  rejected({ layout: { layoutVariant: 'circle', columns: 4 } }, 'unknown layout key');
  rejected({ items: [{ key: 'set', label: 'Hacked' }] }, 'label is code-owned');
  rejected({ items: [{ key: 'set', href: 'https://evil.test' }] }, 'href is code-owned');
  rejected({ items: [{ key: 'set', emoji: '💀' }] }, 'emoji is code-owned');
  rejected({ items: [{ key: 'set', displayOrder: 0 }] }, 'order goes through `order`');
  rejected({ items: [{ key: 'set', focus: { gravity: 'auto', angle: 30 } }] }, 'unknown focus key');
});

test('patch schema: card keys must be known; every item needs one; at most one entry per card count', () => {
  rejected({ items: [{ key: 'ring', isActive: false }] });
  rejected({ items: [{ key: '__proto__', isActive: false }] });
  rejected({ items: [{ isActive: false }] });
  rejected({ items: [{ key: 'Set', isActive: false }] });
  rejected({ items: [...SHOWCASE_CARDS.map((c) => ({ key: c.key, isActive: true })), { key: 'set', isActive: false }] }, '7 entries');
  rejected({ items: { key: 'set', isActive: false } }, 'items must be an array');
});

test('patch schema: field types and ranges', () => {
  rejected({ layout: { layoutVariant: 'hexagon' } });
  rejected({ layout: { layoutVariant: 'slider' } }, 'slider is a display mode, not a shape');
  rejected({ layout: { displayMode: 'carousel' } });
  rejected({ layout: { size: 'xl' } });
  rejected({ items: [{ key: 'set', isActive: 'false' }] });
  rejected({ items: [{ key: 'set', isFeatured: 1 }] });
  rejected({ items: [{ key: 'set', focus: { x: 101 } }] });
  rejected({ items: [{ key: 'set', focus: { x: -1 } }] });
  rejected({ items: [{ key: 'set', focus: { y: 100.01 } }] });
  rejected({ items: [{ key: 'set', focus: { zoom: 0.99 } }] });
  rejected({ items: [{ key: 'set', focus: { zoom: 2.51 } }] });
  rejected({ items: [{ key: 'set', focus: { zoom: '2' } }] });
  rejected({ items: [{ key: 'set', focus: { gravity: 'g_face' } }] });
  rejected({ items: [{ key: 'set', focus: { gravity: 'c_fill' } }] });
  rejected({ items: [{ key: 'set', focus: 'north' }] });
});

test('patch schema: a photo must be an https URL (or "" to remove it)', () => {
  for (const image of ['http://res.cloudinary.com/x/image/upload/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,AA',
    '//evil.test/a.jpg', 'https://x.test/a b.jpg', 'https://x.test/a.jpg" onerror="x', 'https://x.test/<b>', 'https://',
    `https://x.test/${'a'.repeat(600)}`, null, 5, { url: 'https://x.test/a.jpg' }]) {
    rejected({ items: [{ key: 'set', image }] }, `image ${JSON.stringify(image)}`);
  }
  const max = `https://x.test/${'a'.repeat(600 - 'https://x.test/'.length)}`;
  ok({ items: [{ key: 'set', image: max }] });
  /* Whatever the schema lets through, normalize keeps (no silent drop on save). */
  const s = applyShowcasePatch(normalizeShowcase({}), ok({ items: [{ key: 'set', image: max }] }));
  assert.equal(byKey(normalizeShowcase({ categoryShowcase: toStored(s) })).set.image, max);
});

test('patch schema: order must list all six cards exactly once', () => {
  rejected({ order: KEYS.slice(0, 5) }, 'five keys');
  rejected({ order: [...KEYS, 'necklace'] }, 'seven keys');
  rejected({ order: ['necklace', 'necklace', 'bangles', 'maang-tikka', 'set', 'rentals'] }, 'a duplicate');
  rejected({ order: ['necklace', 'earrings', 'bangles', 'maang-tikka', 'set', 'ring'] }, 'an unknown key');
  rejected({ order: [] }, 'empty');
  rejected({ order: 'necklace,earrings' }, 'not an array');
  ok({ order: ['rentals', 'set', 'maang-tikka', 'bangles', 'earrings', 'necklace'] });
});

/* ── applyShowcasePatch ── */

const BASE = normalizeShowcase({ categoryImages: { necklace: CLD('necklace'), set: CLD('set') } });
const apply = (s, body) => applyShowcasePatch(s, ok(body));

test('apply: only the fields sent change; the input is not mutated', () => {
  const before = structuredClone(BASE);
  const next = apply(BASE, { items: [{ key: 'earrings', isActive: false }] });
  assert.deepEqual(BASE, before, 'input untouched');
  assertWellFormed(next);
  const expected = structuredClone(BASE);
  expected.items.find((it) => it.key === 'earrings').isActive = false;
  assert.deepEqual(next, expected);

  const featured = apply(next, { items: [{ key: 'set', isFeatured: true }] });
  assert.equal(byKey(featured).set.isFeatured, true);
  assert.equal(byKey(featured).set.isActive, true, 'isActive not sent → unchanged');
  assert.equal(byKey(featured).set.image, CLD('set'), 'image not sent → unchanged');
  assert.equal(byKey(featured).earrings.isActive, false, 'the earlier change survives');

  const mode = apply(BASE, { layout: { displayMode: 'slider' } });
  assert.deepEqual(mode.layout, { ...BASE.layout, displayMode: 'slider' });
  assert.deepEqual(mode.items, BASE.items);
});

test('apply: photos can be replaced and removed; hidden cards can be shown again', () => {
  const removed = apply(BASE, { items: [{ key: 'necklace', image: '' }] });
  assert.equal(byKey(removed).necklace.image, '');
  const replaced = apply(removed, { items: [{ key: 'necklace', image: CLD('new') }] });
  assert.equal(byKey(replaced).necklace.image, CLD('new'));
  const hidden = apply(BASE, { items: [{ key: 'rentals', isActive: false }] });
  assert.deepEqual(visibleItems(hidden).map((it) => it.key), KEYS.filter((k) => k !== 'rentals'));
  const shown = apply(hidden, { items: [{ key: 'rentals', isActive: true }] });
  assert.deepEqual(shown, BASE);
});

test('apply: patches touching different fields give the same result in either order', () => {
  const patches = [
    { items: [{ key: 'earrings', isActive: false }] },
    { items: [{ key: 'earrings', isFeatured: true }] },
    { items: [{ key: 'set', isFeatured: true }] },
    { items: [{ key: 'necklace', image: '' }] },
    { items: [{ key: 'necklace', focus: { zoom: 2 } }] },
    { items: [{ key: 'necklace', focus: { gravity: 'custom', x: 10 } }] },
    { layout: { layoutVariant: 'circle' } },
    { layout: { displayMode: 'slider' } },
    { layout: { size: 'small' } },
    { order: ['set', 'necklace', 'rentals', 'earrings', 'bangles', 'maang-tikka'] },
  ];
  for (let i = 0; i < patches.length; i += 1) {
    for (let j = i + 1; j < patches.length; j += 1) {
      const ab = apply(apply(BASE, patches[i]), patches[j]);
      const ba = apply(apply(BASE, patches[j]), patches[i]);
      assert.deepEqual(ab, ba, `${JSON.stringify(patches[i])} ⇄ ${JSON.stringify(patches[j])}`);
      assertWellFormed(ab);
    }
  }
});

test('apply: order reassigns displayOrder to the given sequence; other fields ride along', () => {
  const hidden = apply(BASE, { items: [{ key: 'bangles', isActive: false }] });
  const order = ['rentals', 'set', 'maang-tikka', 'bangles', 'earrings', 'necklace'];
  const next = apply(hidden, { order });
  assertWellFormed(next);
  assert.deepEqual(keysOf(next), order);
  assert.deepEqual(next.items.map((it) => it.displayOrder), [0, 1, 2, 3, 4, 5]);
  assert.equal(byKey(next).bangles.isActive, false);
  assert.equal(byKey(next).necklace.image, CLD('necklace'));
  assert.deepEqual(visibleItems(next).map((it) => it.key), order.filter((k) => k !== 'bangles'));
  /* Order and item changes in one patch. */
  const both = apply(BASE, { order, items: [{ key: 'rentals', isFeatured: true }] });
  assert.deepEqual(keysOf(both), order);
  assert.equal(both.items[0].isFeatured, true);
  /* The stored round trip keeps the order. */
  assert.deepEqual(keysOf(normalizeShowcase({ categoryShowcase: toStored(next) })), order);
});

test('apply: focus merges partially and is clamped even when the patch skipped validation', () => {
  const a = apply(BASE, { items: [{ key: 'set', focus: { x: 20 } }] });
  assert.deepEqual(byKey(a).set.focus, { gravity: 'auto', x: 20, y: 50, zoom: 1 });
  const b = apply(a, { items: [{ key: 'set', focus: { gravity: 'custom' } }] });
  assert.deepEqual(byKey(b).set.focus, { gravity: 'custom', x: 20, y: 50, zoom: 1 }, 'x kept');
  const c = apply(b, { items: [{ key: 'set', focus: { y: 75.4, zoom: 1.756 } }] });
  assert.deepEqual(byKey(c).set.focus, { gravity: 'custom', x: 20, y: 75, zoom: 1.76 });
  assert.deepEqual(byKey(c).necklace.focus, { ...DEFAULT_FOCUS }, 'other cards untouched');

  /* The admin page applies its optimistic change locally without zod. */
  const raw = applyShowcasePatch(BASE, { items: [{ key: 'set', focus: { x: 500, y: -9, zoom: 10, gravity: 'sideways' } }] });
  assert.deepEqual(byKey(raw).set.focus, { gravity: 'auto', x: 100, y: 0, zoom: 2.5 });
});

/* ── Cloudinary crop + CSS focus ── */

const U = CLD('necklace');
const TAIL = 'v17/tulsi-bridal/categories/necklace.jpg';
const at = (t) => `https://res.cloudinary.com/tulsi/image/upload/${t}/${TAIL}`;

test('image URL: c_fill to the shape\'s aspect with the chosen gravity, inserted right after /upload/', () => {
  assert.equal(showcaseImageUrl(U, { variant: 'circle' }), at('f_auto,q_auto:good,c_fill,ar_1:1,g_auto,w_600'));
  assert.equal(showcaseImageUrl(U, { variant: 'square' }), at('f_auto,q_auto:good,c_fill,ar_1:1,g_auto,w_600'));
  assert.equal(showcaseImageUrl(U, { variant: 'king_size' }), at('f_auto,q_auto:good,c_fill,ar_4:5,g_auto,w_600'));
  assert.equal(showcaseImageUrl(U, { variant: 'wide' }), at('f_auto,q_auto:good,c_fill,ar_16:9,g_auto,w_600'));
  assert.equal(showcaseImageUrl(U, { variant: 'hexagon' }), at('f_auto,q_auto:good,c_fill,ar_1:1,g_auto,w_600'), 'unknown shape → square');
  assert.equal(showcaseImageUrl(U), at('f_auto,q_auto:good,c_fill,ar_1:1,g_auto,w_600'), 'defaults: square, auto, 600px');
  const g = (gravity) => showcaseImageUrl(U, { variant: 'king_size', focus: { ...DEFAULT_FOCUS, gravity } });
  assert.match(g('auto'), /,g_auto,w_600\//);
  assert.match(g('face'), /,g_auto:faces,w_600\//);
  assert.match(g('center'), /,g_center,w_600\//);
  assert.match(g('north'), /,g_north,w_600\//);
  assert.match(g('south'), /,g_south,w_600\//);
  assert.match(g('sideways'), /,g_auto,w_600\//, 'unknown gravity → auto');
  assert.equal(showcaseImageUrl(U, { variant: 'wide', width: 1200 }), at('f_auto,q_auto:good,c_fill,ar_16:9,g_auto,w_1200'));
});

test('image URL: zoom fetches more pixels; width is at least 80 and at most 3000', () => {
  const w = (opts) => Number(showcaseImageUrl(U, opts).match(/,w_(\d+)\//)[1]);
  assert.equal(w({ width: 600, focus: { ...DEFAULT_FOCUS, zoom: 2 } }), 1200);
  assert.equal(w({ width: 400, focus: { ...DEFAULT_FOCUS, zoom: 1.25 } }), 500);
  assert.equal(w({ width: 10 }), 80);
  assert.equal(w({ width: 2000, focus: { ...DEFAULT_FOCUS, zoom: 2.5 } }), 3000);
  assert.equal(w({ width: 600, focus: { ...DEFAULT_FOCUS, zoom: 0.5 } }), 600, 'never below 1×');
});

test('image URL: a custom focal point only resizes (c_limit, width × zoom × 1.6) — the browser crops', () => {
  const custom = (zoom, width) => showcaseImageUrl(U, { variant: 'king_size', focus: { gravity: 'custom', x: 20, y: 80, zoom }, width });
  assert.equal(custom(1.5, 400), at('f_auto,q_auto:good,c_limit,w_960'));
  assert.equal(custom(1, 600), at('f_auto,q_auto:good,c_limit,w_960'));
  assert.equal(custom(2.5, 240), at('f_auto,q_auto:good,c_limit,w_960'));
  assert.equal(custom(1, 10), at('f_auto,q_auto:good,c_limit,w_128'));
  assert.equal(custom(2.5, 1200), at('f_auto,q_auto:good,c_limit,w_3000'));
  assert.doesNotMatch(custom(1.5, 400), /ar_|g_|c_fill/);
});

test('image URL: non-Cloudinary URLs (and empty) are returned untouched', () => {
  for (const url of ['https://images.unsplash.com/photo-1?w=1', 'https://cdn.example.test/upload/a.jpg', 'https://res.cloudinary.com/tulsi/image/fetch/https://x.test/a.jpg', '', undefined]) {
    assert.equal(showcaseImageUrl(url, { variant: 'wide', focus: { gravity: 'face', x: 1, y: 1, zoom: 2 } }), url);
    assert.equal(showcaseSrcSet(url, { variant: 'wide' }), undefined, `no srcset for ${url}`);
  }
  assert.equal(isCloudinary(U), true);
  assert.equal(isCloudinary('https://cdn.example.test/upload/a.jpg'), false);
  assert.equal(isCloudinary(null), false);
});

test('image URL: only the first /upload/ gets the transformation', () => {
  const url = 'https://res.cloudinary.com/tulsi/image/upload/v1/upload/a.jpg';
  assert.equal(showcaseImageUrl(url, { variant: 'circle' }), 'https://res.cloudinary.com/tulsi/image/upload/f_auto,q_auto:good,c_fill,ar_1:1,g_auto,w_600/v1/upload/a.jpg');
});

test('srcset: one candidate per width with the same crop', () => {
  const opts = { variant: 'king_size', focus: { ...DEFAULT_FOCUS, gravity: 'north' } };
  const set = showcaseSrcSet(U, opts).split(', ');
  assert.equal(set.length, 5);
  [240, 400, 600, 900, 1200].forEach((w, i) => {
    assert.equal(set[i], `${showcaseImageUrl(U, { ...opts, width: w })} ${w}w`);
    assert.match(set[i], new RegExp(`/upload/f_auto,q_auto:good,c_fill,ar_4:5,g_north,w_${w}/.* ${w}w$`));
  });
  assert.equal(showcaseSrcSet(U, { variant: 'wide' }, [320, 640]), `${at('f_auto,q_auto:good,c_fill,ar_16:9,g_auto,w_320')} 320w, ${at('f_auto,q_auto:good,c_fill,ar_16:9,g_auto,w_640')} 640w`);
  const custom = showcaseSrcSet(U, { variant: 'square', focus: { gravity: 'custom', x: 5, y: 5, zoom: 2 } }, [300]);
  assert.equal(custom, `${at('f_auto,q_auto:good,c_limit,w_960')} 300w`);
});

test('focusStyle: custom point → object-position and zoom origin; presets → their CSS position; no transform at 1×', () => {
  assert.deepEqual(focusStyle({ gravity: 'custom', x: 20, y: 80, zoom: 1.5 }), {
    objectFit: 'cover', objectPosition: '20% 80%', transformOrigin: '20% 80%', transform: 'scale(1.5)',
  });
  assert.deepEqual(focusStyle({ gravity: 'custom', x: 0, y: 100, zoom: 1 }), {
    objectFit: 'cover', objectPosition: '0% 100%', transformOrigin: '0% 100%', transform: undefined,
  });
  const pos = (gravity, zoom = 1) => focusStyle({ gravity, x: 7, y: 9, zoom });
  assert.equal(pos('auto').objectPosition, '50% 50%');
  assert.equal(pos('center').objectPosition, '50% 50%');
  assert.equal(pos('face').objectPosition, '50% 30%');
  assert.equal(pos('north').objectPosition, '50% 0%');
  assert.equal(pos('south').objectPosition, '50% 100%');
  assert.equal(pos('sideways').objectPosition, '50% 50%');
  assert.equal(pos('north').transform, undefined);
  assert.deepEqual(pos('south', 2), { objectFit: 'cover', objectPosition: '50% 100%', transformOrigin: '50% 100%', transform: 'scale(2)' }, 'presets zoom about their own anchor, x/y ignored');
  assert.deepEqual(focusStyle(), { objectFit: 'cover', objectPosition: '50% 50%', transformOrigin: '50% 50%', transform: undefined });
});
