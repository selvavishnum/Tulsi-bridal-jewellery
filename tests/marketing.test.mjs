/* ─────────────────────────────────────────────
   The Marketing tab's data model (src/lib/marketing.js): what every section
   allows, normalising whatever is stored (missing, legacy, partial, garbage,
   hostile), link and photo rules, which ads a page gets, the reference-stable
   "did it change?" helpers and the settings sanitiser.

   The API through the real settings route:  tests/marketing-api.test.mjs
   The server-side ads reader:                tests/marketing-server.test.mjs

   Run: npm test
   ───────────────────────────────────────────── */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SECTIONS, SECTION_IDS, LIMITS, PLACEMENTS, PLACEMENT_VALUES, MARKETING_KEYS,
  normalizeFocus, normalizeLayout, normalizeHeroSlides, normalizeTestimonialItems, normalizeInstagramItems,
  normalizeAdvertisements, normalizeMarketing, emptyAds, newItem, visible, adsForPlacement, showsSlider,
  safeAdLink, safeHttpsUrl, isExternalLink, sameJson, nextIfChanged, sanitizeMarketingSettings,
} from '../src/lib/marketing.js';
import * as showcaseLib from '../src/lib/categoryShowcase.js';
import { pickHeroSlides, heroPhotoUrl, pickTestimonials } from '../src/lib/heroSlides.js';
import { isUsableImageUrl } from '../src/lib/avatar.js';

const CLD = (name) => `https://res.cloudinary.com/tulsi/image/upload/v17/tulsi-bridal/marketing/${name}.jpg`;
const DEFAULT_FOCUS = { gravity: 'auto', x: 50, y: 50, zoom: 1 };
const clone = (v) => JSON.parse(JSON.stringify(v));
const SHAPES = ['circle', 'square', 'king_size', 'wide'];

/* A throwing getter / a proxy that throws on every touch: the worst a stored document can be. */
const hostileObject = () => ({ get id() { throw new Error('boom'); }, get imageUrl() { throw new Error('boom'); }, get image() { throw new Error('boom'); } });
const hostileProxy = () => new Proxy({}, {
  get() { throw new Error('boom'); }, has() { throw new Error('boom'); }, ownKeys() { throw new Error('boom'); },
  getOwnPropertyDescriptor() { throw new Error('boom'); },
});
const GARBAGE = [undefined, null, '', 'x', '<script>alert(1)</script>', 0, 7, -1, NaN, Infinity, true, false, [], [[]], [null], [1, 'a'], {}, { a: 1 }, () => 1, Symbol('s')];

/* Every invariant a normalised item list must hold, whatever went in. */
const FOCUS_KEYS = ['gravity', 'x', 'y', 'zoom'];
function assertFocus(f) {
  assert.deepEqual(Object.keys(f), FOCUS_KEYS);
  assert.deepEqual(f, normalizeFocus(f), 'a normalised focus is already normal');
}
function assertLayout(l, section) {
  assert.deepEqual(Object.keys(l), ['layoutVariant', 'displayMode', 'size']);
  assert.ok(SECTIONS[section].shapes.includes(l.layoutVariant), l.layoutVariant);
  assert.ok(SECTIONS[section].modes.includes(l.displayMode), l.displayMode);
  assert.ok(SECTIONS[section].sizes.includes(l.size), l.size);
}
const noMarkup = (s) => assert.doesNotMatch(s, /[<>]/, s);

/* ── What each section allows ── */

test('SECTIONS: every section has the four shapes, its display modes, three sizes, a cap and a default that is on its own lists', () => {
  assert.deepEqual([...SECTION_IDS], ['hero', 'showcase', 'testimonials', 'instagram', 'ads']);
  for (const id of SECTION_IDS) {
    const s = SECTIONS[id];
    assert.deepEqual([...s.shapes], SHAPES, `${id}: shapes`);
    assert.deepEqual([...s.sizes], ['small', 'medium', 'large'], `${id}: sizes`);
    assert.ok(s.maxItems >= 1);
    assertLayout(s.defaultLayout, id);
    assert.equal(s.defaultLayout.size, 'large', `${id}: large is "as it is today"`);
  }
  assert.deepEqual([...SECTIONS.hero.modes], ['single', 'slider'], 'the hero: single photo or slider');
  for (const id of ['showcase', 'testimonials', 'instagram', 'ads']) assert.deepEqual([...SECTIONS[id].modes], ['grid', 'slider'], id);
  assert.deepEqual(SECTIONS.hero.maxItems, 6);
  assert.deepEqual(SECTIONS.testimonials.maxItems, 50);
  assert.deepEqual(SECTIONS.instagram.maxItems, 6);
  assert.deepEqual(SECTIONS.ads.maxItems, 12);
  assert.deepEqual(SECTIONS.showcase.maxItems, showcaseLib.SHOWCASE_CARDS.length);
});

test('SECTIONS: the defaults are what the storefront draws today (4:5 hero box with one photo, round avatars, square tiles) and a wide slider for ads', () => {
  assert.deepEqual(SECTIONS.hero.defaultLayout, { layoutVariant: 'king_size', displayMode: 'single', size: 'large' });
  assert.deepEqual(SECTIONS.testimonials.defaultLayout, { layoutVariant: 'circle', displayMode: 'grid', size: 'large' });
  assert.deepEqual(SECTIONS.instagram.defaultLayout, { layoutVariant: 'square', displayMode: 'grid', size: 'large' });
  assert.deepEqual(SECTIONS.ads.defaultLayout, { layoutVariant: 'wide', displayMode: 'slider', size: 'large' });
  assert.deepEqual(SECTIONS.showcase.defaultLayout, { ...showcaseLib.DEFAULT_LAYOUT }, 'the category showcase keeps its own default');
  assert.deepEqual(showcaseLib.ASPECTS.king_size, [4, 5], 'the hero box today is 4:5');
});

test('SECTIONS and PLACEMENTS are frozen: nothing can edit the shared config', () => {
  assert.ok(Object.isFrozen(SECTIONS) && Object.isFrozen(SECTIONS.hero) && Object.isFrozen(SECTIONS.hero.defaultLayout) && Object.isFrozen(SECTIONS.hero.shapes));
  assert.ok(Object.isFrozen(PLACEMENTS) && Object.isFrozen(PLACEMENTS[0]));
  assert.throws(() => { 'use strict'; SECTIONS.hero.maxItems = 99; }, TypeError);
  /* and what the normalisers hand out is never the frozen object itself */
  const layout = normalizeLayout(undefined, 'hero');
  layout.size = 'small';
  assert.equal(SECTIONS.hero.defaultLayout.size, 'large');
  assert.equal(normalizeLayout(undefined, 'hero').size, 'large');
});

test('PLACEMENTS: the eight pages, each with a label and the route Next caches; the product route is dynamic', () => {
  assert.deepEqual([...PLACEMENT_VALUES], ['home', 'shop', 'category', 'product', 'cart', 'checkout', 'order-success', 'track-order']);
  assert.deepEqual(PLACEMENTS.map((p) => p.path), ['/', '/shop', '/catalog', '/product/[id]', '/cart', '/checkout', '/order-success', '/track-order']);
  for (const p of PLACEMENTS) {
    assert.ok(p.label.length > 3, p.value);
    assert.equal(p.dynamic === true, p.path.includes('['), `${p.value}: dynamic exactly for a [param] route`);
  }
  assert.equal(new Set(PLACEMENT_VALUES).size, PLACEMENT_VALUES.length);
  assert.deepEqual([...MARKETING_KEYS], ['heroSlides', 'heroLayout', 'testimonials', 'testimonialsLayout', 'instagramFeed', 'instagramLayout', 'advertisements']);
});

test('normalizeFocus is exported from the category showcase and re-exported here: one set of crop rules for every photo', () => {
  assert.equal(normalizeFocus, showcaseLib.normalizeFocus);
  assert.deepEqual(normalizeFocus(undefined), DEFAULT_FOCUS);
  assert.deepEqual(normalizeFocus({ gravity: 'custom', x: 120.4, y: -3, zoom: 9 }), { gravity: 'custom', x: 100, y: 0, zoom: 2.5 });
  assert.deepEqual(normalizeFocus({ gravity: 'sideways', x: 'a', zoom: 0 }), { gravity: 'auto', x: 50, y: 50, zoom: 1 });
});

/* ── Layout ── */

test('normalizeLayout: nothing stored is each section\'s default; valid values pass through', () => {
  for (const id of SECTION_IDS) {
    assert.deepEqual(normalizeLayout(undefined, id), SECTIONS[id].defaultLayout, id);
    assert.deepEqual(normalizeLayout({}, id), SECTIONS[id].defaultLayout, id);
    for (const shape of SHAPES) for (const mode of SECTIONS[id].modes) for (const size of SECTIONS[id].sizes) {
      assert.deepEqual(normalizeLayout({ layoutVariant: shape, displayMode: mode, size }, id), { layoutVariant: shape, displayMode: mode, size });
    }
  }
});

test('normalizeLayout: a value from another section\'s list is not valid here (hero has no "grid", the others no "single")', () => {
  assert.equal(normalizeLayout({ displayMode: 'grid' }, 'hero').displayMode, 'single');
  assert.equal(normalizeLayout({ displayMode: 'single' }, 'ads').displayMode, 'slider');
  assert.equal(normalizeLayout({ displayMode: 'single' }, 'testimonials').displayMode, 'grid');
  assert.equal(normalizeLayout({ displayMode: 'slider' }, 'hero').displayMode, 'slider');
});

test('normalizeLayout: partial and garbage input falls back field by field; the result is always complete, in a fixed key order', () => {
  assert.deepEqual(normalizeLayout({ layoutVariant: 'wide' }, 'hero'), { layoutVariant: 'wide', displayMode: 'single', size: 'large' });
  assert.deepEqual(normalizeLayout({ size: 'small', layoutVariant: 'nope', displayMode: 7 }, 'instagram'), { layoutVariant: 'square', displayMode: 'grid', size: 'small' });
  for (const bad of GARBAGE) {
    for (const id of SECTION_IDS) assert.deepEqual(normalizeLayout(bad, id), SECTIONS[id].defaultLayout, `${String(bad)} → ${id}`);
  }
  for (const v of [['circle'], { toString: () => 'circle' }, 'CIRCLE', ' circle', 'circle ', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.equal(normalizeLayout({ layoutVariant: v }, 'hero').layoutVariant, 'king_size', String(v));
  }
});

test('normalizeLayout: an unknown section gets the category showcase\'s rules (never a crash); a section named like an Object method is unknown', () => {
  for (const section of [undefined, null, 'nope', '__proto__', 'constructor', 'toString', 7, {}, []]) {
    assert.deepEqual(normalizeLayout({ layoutVariant: 'circle' }, section), { ...showcaseLib.DEFAULT_LAYOUT, layoutVariant: 'circle' }, String(section));
  }
});

test('normalizeLayout agrees with the category showcase\'s own layout rules for the same input', () => {
  const inputs = [undefined, {}, { layoutVariant: 'circle', displayMode: 'slider', size: 'small' }, { layoutVariant: 'x', displayMode: 'y', size: 'z' }, { layoutVariant: ['circle'] }, { size: 'medium' }];
  for (const layout of inputs) {
    assert.deepEqual(normalizeLayout(layout, 'showcase'), showcaseLib.normalizeShowcase(layout === undefined ? {} : { categoryShowcase: { layout } }).layout, JSON.stringify(layout));
  }
});

test('normalizeLayout: hostile input never throws and reads only own properties', () => {
  assert.deepEqual(normalizeLayout(hostileProxy(), 'hero'), SECTIONS.hero.defaultLayout);
  const inherited = Object.create({ layoutVariant: 'wide', size: 'small' });
  assert.deepEqual(normalizeLayout(inherited, 'hero'), SECTIONS.hero.defaultLayout, 'nothing inherited is read');
  const polluted = JSON.parse('{"__proto__":{"layoutVariant":"wide"},"constructor":{"prototype":{"size":"small"}},"displayMode":"slider"}');
  assert.deepEqual(normalizeLayout(polluted, 'hero'), { layoutVariant: 'king_size', displayMode: 'slider', size: 'large' });
  assert.equal({}.layoutVariant, undefined);
});

test('showsSlider: only a slider with more than one photo has dots, arrows and a timer', () => {
  assert.equal(showsSlider({ displayMode: 'slider' }, 2), true);
  assert.equal(showsSlider({ displayMode: 'slider' }, 1), false, 'one photo is just a photo');
  assert.equal(showsSlider({ displayMode: 'slider' }, 0), false);
  assert.equal(showsSlider({ displayMode: 'grid' }, 5), false);
  assert.equal(showsSlider({ displayMode: 'single' }, 5), false);
  assert.equal(showsSlider(undefined, 5), false);
  assert.equal(showsSlider(null, 5), false);
});

/* ── Links ── */

test('safeAdLink: nothing, a path on this site, or an https link — every other kind of link is ""', () => {
  for (const ok of ['/', '/shop', '/catalog?category=necklace', '/product/abc123#reviews', '/shop?x=1&y=%20', '/a/b/c.html']) assert.equal(safeAdLink(ok), ok, ok);
  for (const ok of ['https://www.instagram.com/p/abc/', 'https://example.com', 'https://shop.example.co.in/sale?x=1#top', 'https://sub.domain.example.org:8443/a']) assert.equal(safeAdLink(ok), ok, ok);
  assert.equal(safeAdLink('  /shop  '), '/shop', 'trimmed');
  assert.equal(safeAdLink('  https://example.com/a '), 'https://example.com/a');
  assert.equal(safeAdLink('HTTPS://EXAMPLE.COM/a'), 'HTTPS://EXAMPLE.COM/a', 'the scheme is case-insensitive');
  for (const empty of ['', '   ', '\n', undefined, null]) assert.equal(safeAdLink(empty), '');
});

test('safeAdLink: every way of leaving the shop unintentionally, or running code, is refused', () => {
  const bad = [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', '\tjavascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', 'file:///etc/passwd',
    'http://example.com', 'ftp://example.com/x', 'mailto:a@b.co', 'tel:+911234567890', 'whatsapp://send?phone=1', 'blob:https://example.com/x',
    '//evil.com', '//evil.com/path', '///evil.com', '/\\evil.com', '/\\/evil.com', '\\\\evil.com', '\\evil.com',
    'shop', 'shop/x', './shop', '../shop', '#top', '?x=1', 'www.example.com', 'example.com/x',
    'https://user:pass@example.com/', 'https://shop.com@evil.com/', 'https://@evil.com', 'https://example.com@evil.com',
    'https://localhost/x', 'https://intranet/x', 'https://127.0.0.1/x', 'https://192.168.0.1/x', 'https://10.0.0.1:8080/', 'https://[::1]/x', 'https://example.com./x',
    'https://', 'https:///x', 'https://exa mple.com', 'https://example.com/a b', 'https://example.com/"onmouseover="x', "https://example.com/'x", 'https://example.com/<x>', 'https://example.com\\@evil.com',
    'https://example.com/\u0000', 'https://example.com/\u0007', 'https://example.com/\u007f',
    '/a b', '/a"b', "/a'b", '/a<b', '/a>b', '/a\\b', '/a\u0000b', '/a\nb', '/a\tb',
    `https://example.com/${'a'.repeat(700)}`, `/${'a'.repeat(700)}`,
  ];
  for (const link of bad) assert.equal(safeAdLink(link), '', JSON.stringify(link));
  for (const notString of [7, true, {}, [], ['/shop'], { toString: () => '/shop' }, () => '/shop']) assert.equal(safeAdLink(notString), '', String(notString));
});

test('safeHttpsUrl: https to a real host only (used for Instagram post links); a path on this site is not one', () => {
  assert.equal(safeHttpsUrl('https://www.instagram.com/p/Cxyz/'), 'https://www.instagram.com/p/Cxyz/');
  assert.equal(safeHttpsUrl(' https://instagram.com/p/x '), 'https://instagram.com/p/x');
  for (const bad of ['/shop', 'http://instagram.com/p/x', 'instagram.com/p/x', 'javascript:alert(1)', '', null, undefined, 4, 'https://a.com@evil.com']) assert.equal(safeHttpsUrl(bad), '', String(bad));
});

test('isExternalLink: https links leave the site, paths do not', () => {
  assert.equal(isExternalLink('https://example.com'), true);
  assert.equal(isExternalLink('HTTPS://example.com'), true);
  assert.equal(isExternalLink('/shop'), false);
  assert.equal(isExternalLink(''), false);
  assert.equal(isExternalLink(undefined), false);
});

/* ── Hero photos ── */

const legacySlide = (over = {}) => ({
  id: '1', imageUrl: CLD('hero'), tag: 'New Bridal Collection', title: 'Temple Bride', subtitle: 'Jewellery Crafted for Brides',
  ctaText: 'Shop Collection', ctaLink: '/shop', cta2Text: 'Book Rental', cta2Link: '/rentals', bg: 'from-red-500', ...over,
});

test('normalizeHeroSlides: a slide saved before the new fields reads as visible and auto-cropped, without the old slider fields', () => {
  const [slide] = normalizeHeroSlides([legacySlide()]);
  assert.deepEqual(slide, { id: '1', imageUrl: CLD('hero'), isActive: true, focus: DEFAULT_FOCUS });
  assert.deepEqual(Object.keys(slide), ['id', 'imageUrl', 'isActive', 'focus'], 'a fixed key order, so two lists compare equal as text');
  assert.doesNotMatch(JSON.stringify(slide), /Bride|Rental|rentals|ctaLink/);
});

test('normalizeHeroSlides: keeps array order, the switch and the crop; fills only what is missing', () => {
  const out = normalizeHeroSlides([
    { id: 'a', imageUrl: CLD('a'), isActive: false },
    { id: 'b', imageUrl: CLD('b'), focus: { gravity: 'custom', x: 20, y: 80, zoom: 1.5 } },
    { id: 'c', imageUrl: CLD('c'), isActive: true, focus: { gravity: 'face' } },
  ]);
  assert.deepEqual(out.map((s) => s.id), ['a', 'b', 'c']);
  assert.deepEqual(out.map((s) => s.isActive), [false, true, true]);
  assert.deepEqual(out[1].focus, { gravity: 'custom', x: 20, y: 80, zoom: 1.5 });
  assert.deepEqual(out[2].focus, { gravity: 'face', x: 50, y: 50, zoom: 1 });
  out.forEach((s) => assertFocus(s.focus));
});

test('normalizeHeroSlides: at most 6; entries that are not objects are dropped; a non-list is "no slides"', () => {
  const eight = Array.from({ length: 8 }, (_, i) => ({ id: String(i + 1), imageUrl: CLD(`s${i}`) }));
  assert.deepEqual(normalizeHeroSlides(eight).map((s) => s.id), ['1', '2', '3', '4', '5', '6']);
  assert.deepEqual(normalizeHeroSlides([null, 'oops', 7, [], true, { id: 'x' }]).map((s) => s.id), ['x']);
  assert.equal(normalizeHeroSlides([null, 'a', 1, ...eight]).length, 6, 'the cap counts slides, not junk before them');
  for (const notAList of [undefined, null, 'x', {}, 3, true, { length: 3, 0: { id: 'a' } }]) assert.deepEqual(normalizeHeroSlides(notAList), [], String(notAList));
});

test('normalizeHeroSlides: a photo is https or a path on this site (what the hero has always accepted); anything else is ""', () => {
  const photo = (imageUrl) => normalizeHeroSlides([{ id: 'x', imageUrl }])[0].imageUrl;
  for (const ok of [CLD('x'), 'https://images.unsplash.com/photo-1?w=1600&q=80', '/images/hero.jpg', `  ${CLD('x')}  `]) assert.equal(photo(ok), ok.trim(), ok);
  for (const bad of ['', 'abc', 'res.cloudinary.com/x.jpg', 'http://insecure.example/x.jpg', '//cdn.example/x.jpg', '/\\evil.com/x.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'https://a.com/"onerror="x', 'https://a.com/<x>', `https://a.com/${'x'.repeat(2100)}`, 42, {}, [], null, undefined]) {
    assert.equal(photo(bad), '', String(bad).slice(0, 40));
  }
});

test('normalizeHeroSlides: ids are never empty and never repeated; a number is its digits; odd characters go; the same input always gives the same ids', () => {
  const raw = [{ imageUrl: CLD('1') }, { id: '' }, { id: 'a' }, { id: 'a' }, { id: 1712345678901 }, { id: 'we ird<id>!' }];
  const ids = normalizeHeroSlides(raw).map((s) => s.id);
  assert.deepEqual(ids, ['slide-1', 'slide-2', 'a', 'a-2', '1712345678901', 'weirdid']);
  assert.equal(normalizeHeroSlides([{ id: 'x'.repeat(200) }])[0].id.length, LIMITS.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(normalizeHeroSlides(raw).map((s) => s.id), ids, 'deterministic: the server and the browser agree');
});

test('normalizeHeroSlides: junk in isActive / focus falls back to the defaults', () => {
  for (const isActive of ['false', 0, null, 'no', [], {}, undefined]) assert.equal(normalizeHeroSlides([{ id: 'a', isActive }])[0].isActive, true, String(isActive));
  for (const focus of [null, 'auto', 5, [], { gravity: 'x', x: 'y', y: {}, zoom: [] }, { gravity: 'custom', x: 1e9, y: -1e9, zoom: 1e9 }]) {
    const f = normalizeHeroSlides([{ id: 'a', focus }])[0].focus;
    assertFocus(f);
  }
  assert.deepEqual(normalizeHeroSlides([{ id: 'a', focus: { gravity: 'custom', x: 1e9, y: -1e9, zoom: 1e9 } }])[0].focus, { gravity: 'custom', x: 100, y: 0, zoom: 2.5 });
});

test('legacy: the hero photo the home page draws today (the first slide with a usable link) is the first visible one here', () => {
  const lists = [
    [legacySlide({ imageUrl: '' }), legacySlide({ id: '2', imageUrl: 'abc' }), legacySlide({ id: '3', imageUrl: CLD('three') }), legacySlide({ id: '4', imageUrl: CLD('four') })],
    [legacySlide({ imageUrl: `  ${CLD('padded')} ` })],
    [legacySlide({ imageUrl: '/images/hero.jpg' })],
    [legacySlide({ imageUrl: 'http://insecure.example/x.jpg' }), legacySlide({ id: '2', imageUrl: CLD('two') })],
    [], [null, 'x'], undefined, 'nope', {},
  ];
  for (const raw of lists) {
    const today = heroPhotoUrl(pickHeroSlides(raw));
    const first = visible(normalizeHeroSlides(raw), 'hero')[0];
    assert.equal(first ? first.imageUrl : '', today, JSON.stringify(raw));
  }
});

/* ── visible ── */

test('visible: switched on (isActive !== false), in order; a section\'s main field must be there too', () => {
  const slides = normalizeHeroSlides([
    { id: 'a', imageUrl: CLD('a') }, { id: 'b', imageUrl: CLD('b'), isActive: false }, { id: 'c', imageUrl: '' }, { id: 'd', imageUrl: CLD('d') },
  ]);
  assert.deepEqual(visible(slides).map((s) => s.id), ['a', 'c', 'd'], 'without a section only the switch counts');
  assert.deepEqual(visible(slides, 'hero').map((s) => s.id), ['a', 'd'], 'a hero slide needs its photo');
  assert.deepEqual(visible([{ isActive: undefined }, { isActive: null }, { isActive: 0 }, { isActive: false }]).length, 3, 'only false hides');
  const reviews = normalizeTestimonialItems([{ name: 'A', review: 'Lovely' }, { name: 'B', review: '' }, { name: 'C', review: 'Nice', isActive: false }]);
  assert.deepEqual(visible(reviews, 'testimonials').map((r) => r.name), ['A'], 'a review needs words');
  assert.deepEqual(visible(reviews).map((r) => r.name), ['A', 'B']);
  for (const nothing of [undefined, null, 'x', {}, 3]) assert.deepEqual(visible(nothing), []);
  assert.deepEqual(visible([null, 'a', 1, { id: 'ok' }]).length, 1);
  assert.deepEqual(visible(slides, 'nope').length, 3, 'an unknown section only checks the switch');
  const before = clone(slides);
  visible(slides, 'hero');
  assert.deepEqual(slides, before, 'the list is not changed');
});

/* ── Testimonials ── */

test('normalizeTestimonialItems: a review saved by today\'s form reads as visible with the round avatar crop; the words may be in `text`', () => {
  const [t] = normalizeTestimonialItems([{ name: 'Vishalini', location: 'Chennai', rating: 4, review: 'Loved it', photo: CLD('v') }]);
  assert.deepEqual(t, { name: 'Vishalini', location: 'Chennai', rating: 4, review: 'Loved it', photo: CLD('v'), isActive: true, focus: DEFAULT_FOCUS });
  assert.deepEqual(Object.keys(t), ['name', 'location', 'rating', 'review', 'photo', 'isActive', 'focus']);
  assert.equal(normalizeTestimonialItems([{ name: 'A', text: 'Old form' }])[0].review, 'Old form');
  assert.equal(normalizeTestimonialItems([{ name: 'A', review: 'New', text: 'Old' }])[0].review, 'New');
});

test('legacy: the reviews the home page draws today (pickTestimonials) are the visible ones here, field for field', () => {
  const raws = [
    [
      { name: 'Vishalini', location: 'Chennai', rating: 5, review: 'Loved it', photo: CLD('v') },
      { name: 'Priya', location: '', rating: 4, review: '  Beautiful  ', photo: 'https://collection.cloudinary.com/x/y' },
      { name: 'No words', rating: 5, review: '   ' },
      { name: 'Old form', text: 'Words in text', rating: '3' },
      null, 'x', 7, [],
      { name: 'Anitha', review: 'Great', photo: 'javascript:alert(1)', rating: 99 },
      { name: 'Zero', review: 'Zero rating', rating: 0 },
      { name: 'Float', review: 'Float rating', rating: 3.6 },
      { name: 'Str', review: 'String rating', rating: 'abc' },
      { name: 12, review: 'Name is not text', location: {} },
    ],
    [], undefined, 'x', {},
  ];
  for (const raw of raws) {
    const today = pickTestimonials(raw);
    const here = visible(normalizeTestimonialItems(raw), 'testimonials').map(({ name, location, rating, review, photo }) => ({ name, location, rating, review, photo: isUsableImageUrl(photo) ? photo : '' }));
    assert.deepEqual(here, today.map((t) => ({ ...t, photo: isUsableImageUrl(t.photo) ? t.photo : '' })), JSON.stringify(raw)?.slice(0, 60));
  }
});

test('normalizeTestimonialItems: a rating is 1–5 stars (5 when missing or unreadable)', () => {
  const rating = (r) => normalizeTestimonialItems([{ review: 'x', rating: r }])[0].rating;
  assert.deepEqual([1, 2, 3, 4, 5].map(rating), [1, 2, 3, 4, 5]);
  assert.deepEqual([0.4, 0, -2, NaN, Infinity, 'abc', '', null, undefined, {}, [], true].map(rating), [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]);
  assert.deepEqual([4.4, 4.6, '3', 9, 5.5, '2.5'].map(rating), [4, 5, 3, 5, 5, 3]);
});

test('normalizeTestimonialItems: only a usable https photo is kept (the same rule as the avatar and the settings API)', () => {
  const photo = (p) => normalizeTestimonialItems([{ review: 'x', photo: p }])[0].photo;
  assert.equal(photo(CLD('ok')), CLD('ok'));
  for (const bad of ['', 'https://collection.cloudinary.com/djolb5idc/7c1e9a', 'javascript:alert(1)', 'http://x.example.com/a.jpg', 'https://nodot/x.jpg', `https://x.example.com/${'a'.repeat(700)}`, 'https://a.com/"x', null, 5, {}, undefined]) {
    assert.equal(photo(bad), '', String(bad).slice(0, 40));
  }
});

test('normalizeTestimonialItems: texts are plain — no tags, no invisible characters — and clamped; a review with no words is kept but empty', () => {
  const [t] = normalizeTestimonialItems([{
    name: `<b>Priya</b>​  Sharma${'x'.repeat(200)}`, location: '<script>alert(1)</script>Chennai', review: `${'Lovely '.repeat(400)}`, rating: 5,
  }]);
  assert.equal(t.name.length, LIMITS.name);
  assert.match(t.name, /^Priya Sharmaxx/);
  assert.equal(t.location, 'alert(1)Chennai');
  assert.equal(t.review.length <= LIMITS.review, true);
  assert.equal(t.review.length > LIMITS.review - 10, true);
  [t.name, t.location, t.review].forEach(noMarkup);
  assert.deepEqual(normalizeTestimonialItems([{ name: 'A', review: '<<>>' }])[0].review, '');
  assert.deepEqual(normalizeTestimonialItems([{ name: 'A', review: '​‍' }])[0].review, '');
  for (const notText of [7, {}, [], null, true]) assert.equal(normalizeTestimonialItems([{ name: notText, review: 'ok' }])[0].name, '');
});

test('normalizeTestimonialItems: at most 50, in order; junk entries dropped', () => {
  const sixty = Array.from({ length: 60 }, (_, i) => ({ name: `N${i}`, review: 'ok' }));
  const out = normalizeTestimonialItems(sixty);
  assert.equal(out.length, 50);
  assert.equal(out[49].name, 'N49');
  assert.deepEqual(normalizeTestimonialItems([null, 5, 'x', { review: 'a' }]).length, 1);
});

/* ── Instagram ── */

test('normalizeInstagramItems: a post saved by today\'s form reads as visible with a square, auto crop', () => {
  const [p] = normalizeInstagramItems([{ imageUrl: CLD('ig1'), caption: 'Layered chains', postUrl: 'https://www.instagram.com/p/abc/' }]);
  assert.deepEqual(p, { imageUrl: CLD('ig1'), caption: 'Layered chains', postUrl: 'https://www.instagram.com/p/abc/', isActive: true, focus: DEFAULT_FOCUS });
  assert.deepEqual(Object.keys(p), ['imageUrl', 'caption', 'postUrl', 'isActive', 'focus']);
});

test('normalizeInstagramItems: at most 6; a post link is https or ""; the photo is https or a path on this site; the caption is plain text', () => {
  const eight = Array.from({ length: 8 }, (_, i) => ({ imageUrl: CLD(`ig${i}`), caption: `c${i}` }));
  assert.deepEqual(normalizeInstagramItems(eight).map((p) => p.caption), ['c0', 'c1', 'c2', 'c3', 'c4', 'c5']);
  const one = (over) => normalizeInstagramItems([{ imageUrl: CLD('a'), ...over }])[0];
  assert.equal(one({ postUrl: 'javascript:alert(1)' }).postUrl, '');
  assert.equal(one({ postUrl: 'instagram.com/p/x' }).postUrl, '', 'no scheme: not a link a browser follows from here');
  assert.equal(one({ postUrl: 'http://instagram.com/p/x' }).postUrl, '');
  assert.equal(one({ postUrl: '/p/x' }).postUrl, '');
  assert.equal(one({ imageUrl: 'javascript:alert(1)' }).imageUrl, '');
  assert.equal(one({ imageUrl: '/images/ig.jpg' }).imageUrl, '/images/ig.jpg');
  assert.equal(one({ caption: '<img src=x onerror=alert(1)>Chains\n\n  and  more' }).caption, 'Chains and more');
  assert.equal(one({ caption: 'c'.repeat(500) }).caption.length, LIMITS.caption);
});

test('legacy: the posts the home page draws today (those with a photo) are the visible ones here', () => {
  const raw = [{ imageUrl: CLD('1'), caption: 'one' }, { imageUrl: '', caption: 'no photo' }, { caption: 'missing photo' }, { imageUrl: CLD('4'), postUrl: 'https://instagram.com/p/4' }, null, 'x'];
  const today = raw.filter((post) => post && post.imageUrl);
  const here = visible(normalizeInstagramItems(raw), 'instagram');
  assert.deepEqual(here.map((p) => p.imageUrl), today.map((p) => p.imageUrl));
});

/* ── Advertisements ── */

const ad = (over = {}) => ({ id: 'a1', isActive: true, image: CLD('ad1'), focus: { gravity: 'auto', x: 50, y: 50, zoom: 1 }, link: '/shop', title: 'Festive sale', buttonText: 'Shop now', placements: ['home', 'shop'], ...over });

test('normalizeAdvertisements: nothing stored is the default layout and no ads', () => {
  for (const nothing of [undefined, null, {}, [], '', 'x', 5, { items: 'x' }, { items: null }, { layout: 'x', items: {} }]) {
    assert.deepEqual(normalizeAdvertisements(nothing), { layout: { layoutVariant: 'wide', displayMode: 'slider', size: 'large' }, items: [] }, JSON.stringify(nothing));
  }
  assert.deepEqual(emptyAds(), normalizeAdvertisements(undefined));
  assert.notEqual(emptyAds(), emptyAds(), 'a fresh object each time');
});

test('normalizeAdvertisements: a complete ad is kept as it is; the layout is normalised; a bare list of ads is accepted', () => {
  const out = normalizeAdvertisements({ layout: { layoutVariant: 'square', displayMode: 'grid', size: 'small' }, items: [ad(), ad({ id: 'a2', isActive: false, title: 'Hidden' })] });
  assert.deepEqual(out.layout, { layoutVariant: 'square', displayMode: 'grid', size: 'small' });
  assert.deepEqual(out.items[0], ad());
  assert.deepEqual(Object.keys(out.items[0]), ['id', 'isActive', 'image', 'focus', 'link', 'title', 'buttonText', 'placements']);
  assert.equal(out.items[1].isActive, false);
  assert.deepEqual(normalizeAdvertisements([ad()]).items, [ad()], 'a bare list');
});

test('normalizeAdvertisements: at most 12 ads; ids are never empty or repeated', () => {
  const twenty = Array.from({ length: 20 }, () => ({ image: CLD('x'), placements: ['shop'] }));
  const out = normalizeAdvertisements({ items: twenty });
  assert.equal(out.items.length, 12);
  assert.deepEqual(out.items.slice(0, 3).map((a) => a.id), ['ad-1', 'ad-2', 'ad-3']);
  const dup = normalizeAdvertisements({ items: [{ id: 'x' }, { id: 'x' }, { id: 'x-2' }, { id: '' }, { id: '  ' }, { id: '!!!' }] });
  assert.equal(new Set(dup.items.map((a) => a.id)).size, 6);
  assert.ok(dup.items.every((a) => a.id.length > 0));
});

test('normalizeAdvertisements: an ad photo must be https (no http, no data:, no paths, no markup); long or odd links are ""', () => {
  const image = (v) => normalizeAdvertisements({ items: [{ id: 'a', image: v }] }).items[0].image;
  assert.equal(image(CLD('ok')), CLD('ok'));
  assert.equal(image(`  ${CLD('ok')}  `), CLD('ok'));
  for (const bad of ['', 'http://x.example.com/a.jpg', '/images/ad.jpg', '//x.example.com/a.jpg', 'data:image/png;base64,AAAA', 'javascript:alert(1)', 'https://x.example.com/"onerror="x', 'https://x.example.com/<x>', "https://x.example.com/'x", 'https://x.example.com/a b', `https://x.example.com/${'a'.repeat(700)}`, 5, null, {}, []]) {
    assert.equal(image(bad), '', String(bad).slice(0, 40));
  }
});

test('normalizeAdvertisements: the link is "", a path on this site, or https — never anything else', () => {
  const link = (v) => normalizeAdvertisements({ items: [{ id: 'a', link: v }] }).items[0].link;
  assert.equal(link('/catalog?category=necklace'), '/catalog?category=necklace');
  assert.equal(link('https://example.com/offer'), 'https://example.com/offer');
  for (const bad of ['javascript:alert(1)', '//evil.com', '/\\evil.com', 'http://example.com', 'shop', 'data:text/html,x', 'https://a.com@evil.com', 5, {}, null]) assert.equal(link(bad), '', String(bad));
});

test('normalizeAdvertisements: title ≤ 60 and button text ≤ 24 of plain text — tags, invisible characters and control characters are stripped', () => {
  const one = (over) => normalizeAdvertisements({ items: [{ id: 'a', ...over }] }).items[0];
  assert.equal(one({ title: '<b>Festive</b> sale' }).title, 'Festive sale');
  assert.equal(one({ title: '<script>alert(1)</script>Sale' }).title, 'alert(1)Sale');
  assert.equal(one({ title: '<img src=x onerror=alert(1)>Sale' }).title, 'Sale');
  assert.equal(one({ title: '<scr<b>ipt>x' }).title, 'x', 'a tag rebuilt out of pieces is stripped too');
  assert.equal(one({ title: 'Fes​tive‮ sale\u0000\u0007' }).title, 'Festive sale');
  assert.equal(one({ title: '  Festive \n\t sale  ' }).title, 'Festive sale');
  assert.equal(one({ title: 'a'.repeat(100) }).title.length, LIMITS.adTitle);
  assert.equal(one({ buttonText: 'b'.repeat(100) }).buttonText.length, LIMITS.adButton);
  assert.equal(LIMITS.adTitle, 60);
  assert.equal(LIMITS.adButton, 24);
  assert.equal(one({ title: '​‍ ⁠' }).title, '', 'nothing visible is nothing');
  assert.equal(one({ title: '<<>>' }).title, '');
  assert.equal(one({ title: 7 }).title, '');
  assert.equal(one({ title: ['Sale'] }).title, '');
  /* never cut inside an emoji, never leave half of one */
  const emoji = one({ title: `${'a'.repeat(59)}✨💍` }).title;
  assert.equal(emoji, `${'a'.repeat(59)}✨`.slice(0, 60));
  assert.equal(one({ title: `ab\uD83D` }).title, 'ab', 'a lone surrogate is dropped');
  assert.equal(one({ title: `\uDE00ab` }).title, 'ab');
  /* text that is not markup stays (Tamil, accents, punctuation) */
  assert.equal(one({ title: 'தங்க நகைகள் – 50% off!' }).title, 'தங்க நகைகள் – 50% off!');
  assert.equal(one({ buttonText: 'Shop & Save ₹500' }).buttonText, 'Shop & Save ₹500');
});

test('normalizeAdvertisements: placements are the known pages, once each, in the order PLACEMENTS lists them; an ad with none shows nowhere', () => {
  const placements = (v) => normalizeAdvertisements({ items: [{ id: 'a', placements: v }] }).items[0].placements;
  assert.deepEqual(placements(['track-order', 'home', 'shop', 'home', 'bogus', '__proto__', 'constructor', 7, null, ['home'], { 0: 'cart' }]), ['home', 'shop', 'track-order']);
  assert.deepEqual(placements([...PLACEMENT_VALUES].reverse()), [...PLACEMENT_VALUES]);
  assert.deepEqual(placements([]), []);
  for (const notAList of [undefined, null, 'home', 'shop,home', {}, 5, true]) assert.deepEqual(placements(notAList), [], String(notAList));
  assert.deepEqual(placements(['HOME', ' home', 'home ']), [], 'exact ids only');
  assert.deepEqual(normalizeAdvertisements({ items: [{ id: 'a' }] }).items[0].placements, []);
});

test('normalizeAdvertisements: unknown fields are dropped; non-objects in the list are skipped', () => {
  const [a] = normalizeAdvertisements({ items: [null, 'x', 5, [], ad({ onclick: 'alert(1)', html: '<b>x</b>', __proto__x: 1, extra: { a: 1 } })], injected: true }).items;
  assert.deepEqual(a, ad());
  assert.ok(!('onclick' in a) && !('html' in a) && !('extra' in a));
});

test('normalizeAdvertisements: hostile input — throwing getters, proxies, prototype pollution — never throws and reads only own properties', () => {
  assert.deepEqual(normalizeAdvertisements(hostileProxy()), emptyAds());
  assert.deepEqual(normalizeAdvertisements({ layout: hostileProxy(), items: hostileProxy() }), emptyAds());
  assert.deepEqual(normalizeAdvertisements({ items: [hostileObject(), hostileProxy(), ad({ id: 'good' })] }).items.map((a) => a.id), ['good'], 'the entry that throws is skipped, the rest are read');
  const raw = JSON.parse('{"__proto__":{"items":[{"id":"evil"}]},"layout":{"__proto__":{"size":"small"},"displayMode":"grid"},"items":[{"__proto__":{"image":"https://evil.example.com/x.jpg"},"constructor":{"prototype":{"title":"x"}},"id":"a","placements":["shop"]}]}');
  const out = normalizeAdvertisements(raw);
  assert.deepEqual(out.layout, { layoutVariant: 'wide', displayMode: 'grid', size: 'large' });
  assert.deepEqual(out.items.map((a) => [a.id, a.image, a.title]), [['a', '', '']]);
  assert.equal({}.size, undefined);
  assert.equal({}.image, undefined);
  const huge = new Array(5_000_000);
  huge[0] = ad();
  assert.equal(normalizeAdvertisements({ items: huge }).items.length, 1, 'a huge sparse list is not walked');
  assert.equal(normalizeAdvertisements({ items: [ad({ title: 'x'.repeat(5_000_000) })] }).items[0].title.length, LIMITS.adTitle);
});

test('normalizeAdvertisements: reading is idempotent and the result is plain JSON', () => {
  const messy = { layout: { layoutVariant: 'x', displayMode: 'grid' }, items: [ad({ title: '<b>Hi</b>', link: '//evil.com', placements: ['shop', 'shop', 'x'] }), { id: 'a1' }, { id: 'a1', image: CLD('q') }, null] };
  const once = normalizeAdvertisements(messy);
  assert.deepEqual(normalizeAdvertisements(once), once);
  assert.deepEqual(clone(once), once);
  assert.equal(Object.getPrototypeOf(once.items[0]), Object.prototype);
  assert.ok(Object.isFrozen(once) === false, 'a fresh, editable object');
  const input = clone(messy);
  normalizeAdvertisements(messy);
  assert.deepEqual(messy, input, 'the input is not changed');
});

/* ── Which ads a page gets ── */

test('adsForPlacement: the visible ads of that page, in order, with the layout', () => {
  const ads = {
    layout: { layoutVariant: 'wide', displayMode: 'grid', size: 'medium' },
    items: [
      ad({ id: '1', placements: ['shop'] }),
      ad({ id: '2', placements: ['home', 'shop'], isActive: false }),
      ad({ id: '3', placements: ['home'] }),
      ad({ id: '4', placements: ['shop', 'cart'] }),
      ad({ id: '5', placements: ['shop'], image: '' }),
      ad({ id: '6', placements: [] }),
    ],
  };
  const shop = adsForPlacement(ads, 'shop');
  assert.deepEqual(shop.items.map((a) => a.id), ['1', '4'], 'hidden, photo-less and elsewhere are out; order kept');
  assert.deepEqual(shop.layout, { layoutVariant: 'wide', displayMode: 'grid', size: 'medium' });
  assert.deepEqual(adsForPlacement(ads, 'home').items.map((a) => a.id), ['3']);
  assert.deepEqual(adsForPlacement(ads, 'cart').items.map((a) => a.id), ['4']);
  for (const quiet of ['checkout', 'product', 'category', 'order-success', 'track-order']) assert.deepEqual(adsForPlacement(ads, quiet).items, [], quiet);
});

test('adsForPlacement: an unknown page or no ads is no items (never an error); the layout is still complete', () => {
  const ads = { items: [ad()] };
  for (const placement of ['nope', '', 'HOME', '__proto__', 'constructor', undefined, null, 5, {}, ['shop']]) {
    assert.deepEqual(adsForPlacement(ads, placement).items, [], String(placement));
    assertLayout(adsForPlacement(ads, placement).layout, 'ads');
  }
  for (const nothing of [undefined, null, '', 'x', {}, [], { items: 5 }]) {
    assert.deepEqual(adsForPlacement(nothing, 'shop'), { layout: SECTIONS.ads.defaultLayout, items: [] }, JSON.stringify(nothing));
  }
});

test('adsForPlacement: takes the stored or the already normalised value, gives the same answer, and changes nothing', () => {
  const stored = { layout: { displayMode: 'grid' }, items: [{ id: 'a', image: CLD('a'), placements: ['shop', 'home'], title: '<i>Sale</i>' }, { id: 'b', image: CLD('b'), placements: ['home'] }] };
  const normalised = normalizeAdvertisements(stored);
  const before = clone(normalised);
  assert.deepEqual(adsForPlacement(stored, 'shop'), adsForPlacement(normalised, 'shop'));
  assert.deepEqual(adsForPlacement(stored, 'shop').items[0].title, 'Sale');
  assert.deepEqual(normalised, before);
  const frozen = Object.freeze({ layout: Object.freeze({}), items: Object.freeze([Object.freeze({ id: 'f', image: CLD('f'), placements: Object.freeze(['shop']) })]) });
  assert.equal(adsForPlacement(frozen, 'shop').items.length, 1, 'frozen input (the cached server value) is fine');
});

/* ── Whole tab, new items ── */

test('normalizeMarketing: nothing stored is every section\'s default — the page as it is today', () => {
  const m = normalizeMarketing({});
  assert.deepEqual(m, {
    heroSlides: [], heroLayout: SECTIONS.hero.defaultLayout,
    testimonials: [], testimonialsLayout: SECTIONS.testimonials.defaultLayout,
    instagramFeed: [], instagramLayout: SECTIONS.instagram.defaultLayout,
    advertisements: emptyAds(),
  });
  assert.deepEqual(Object.keys(m), [...MARKETING_KEYS]);
  for (const nothing of [undefined, null, 'x', 5, [], hostileProxy()]) assert.deepEqual(normalizeMarketing(nothing), m);
});

test('normalizeMarketing: a settings doc from before any of this (only today\'s fields) reads without change in meaning', () => {
  const doc = {
    phone: '+91 76958 68787',
    heroSlides: [legacySlide()],
    testimonials: [{ name: 'A', location: 'B', rating: 5, review: 'C', photo: '' }],
    instagramFeed: [{ imageUrl: CLD('i'), caption: 'c', postUrl: '' }],
  };
  const m = normalizeMarketing(doc);
  assert.equal(m.heroSlides[0].imageUrl, CLD('hero'));
  assert.deepEqual(m.heroLayout, { layoutVariant: 'king_size', displayMode: 'single', size: 'large' });
  assert.equal(m.testimonials[0].review, 'C');
  assert.deepEqual(m.testimonialsLayout, { layoutVariant: 'circle', displayMode: 'grid', size: 'large' });
  assert.equal(m.instagramFeed[0].caption, 'c');
  assert.deepEqual(m.instagramLayout, { layoutVariant: 'square', displayMode: 'grid', size: 'large' });
  assert.deepEqual(m.advertisements, emptyAds());
});

test('newItem: a complete blank item for each section, ready to edit', () => {
  assert.deepEqual(newItem('hero', { id: 'h1' }), { id: 'h1', imageUrl: '', isActive: true, focus: DEFAULT_FOCUS });
  assert.deepEqual(newItem('testimonials'), { name: '', location: '', rating: 5, review: '', photo: '', isActive: true, focus: DEFAULT_FOCUS });
  assert.deepEqual(newItem('instagram'), { imageUrl: '', caption: '', postUrl: '', isActive: true, focus: DEFAULT_FOCUS });
  assert.deepEqual(newItem('ads', { id: 'ad-x', image: CLD('n'), link: '/shop' }), { id: 'ad-x', isActive: true, image: CLD('n'), focus: DEFAULT_FOCUS, link: '/shop', title: '', buttonText: '', placements: [] });
  assert.deepEqual(newItem('ads', 'junk'), newItem('ads', {}));
  assert.throws(() => newItem('showcase'), TypeError);
  assert.throws(() => newItem('__proto__'), TypeError);
  assert.throws(() => newItem(undefined), TypeError);
});

/* ── "Is it still what the screen shows?" ── */

test('sameJson: equal when they print the same; never throws', () => {
  assert.equal(sameJson({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true);
  assert.equal(sameJson({ a: 1, b: 2 }, { b: 2, a: 1 }), false, 'key order counts: normalised values have a fixed one');
  assert.equal(sameJson([1], [1, 2]), false);
  assert.equal(sameJson(undefined, undefined), true);
  assert.equal(sameJson(null, undefined), false);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(sameJson(cyclic, cyclic), false, 'unprintable is "not the same", not a crash');
  assert.equal(sameJson(1n, 1n), false);
});

test('nextIfChanged: the very same reference when nothing changed, so React renders nothing; the new value when something did', () => {
  const prev = normalizeHeroSlides([{ id: '1', imageUrl: CLD('a') }]);
  assert.equal(nextIfChanged(prev, normalizeHeroSlides([{ id: '1', imageUrl: CLD('a'), title: 'edited old field' }])), prev, 'an edit the page does not draw is no change');
  const changed = normalizeHeroSlides([{ id: '1', imageUrl: CLD('b') }]);
  assert.equal(nextIfChanged(prev, changed), changed);
  assert.equal(nextIfChanged(prev, normalizeHeroSlides([])).length, 0, 'removing every photo is a change');
  const layout = normalizeLayout({ displayMode: 'slider' }, 'hero');
  assert.equal(nextIfChanged(layout, normalizeLayout({ displayMode: 'slider' }, 'hero')), layout);
  assert.notEqual(nextIfChanged(layout, normalizeLayout({ displayMode: 'single' }, 'hero')), layout);
  const ads = normalizeAdvertisements({ items: [ad()] });
  assert.equal(nextIfChanged(ads, normalizeAdvertisements({ items: [ad()] })), ads);
  assert.notEqual(nextIfChanged(ads, normalizeAdvertisements({ items: [ad({ title: 'Other' })] })), ads);
});

test('nextIfChanged: a missing value or the browser\'s older stored copy never replaces what the server drew', () => {
  const prev = normalizeInstagramItems([{ imageUrl: CLD('a') }]);
  const other = normalizeInstagramItems([{ imageUrl: CLD('b') }]);
  for (const missing of [undefined, null]) assert.equal(nextIfChanged(prev, missing), prev);
  assert.equal(nextIfChanged(prev, other, { stale: true }), prev, 'no flash of an older list');
  assert.equal(nextIfChanged(prev, other, { stale: false }), other, 'the fresh fetch still can');
  assert.equal(nextIfChanged(undefined, other), other);
});

/* ── Saving: sanitizeMarketingSettings ── */

test('sanitizeMarketingSettings: every other key is untouched, the input is not changed, and a non-object is nothing', () => {
  const body = { phone: '+91 1', email: 'a@b.co', showTestimonials: true, announcement: { enabled: true }, deliveryMessage: { enabled: false }, weird: [1, { a: 2 }], heroSlides: [legacySlide()], advertisements: { items: [ad()] } };
  const before = clone(body);
  const out = sanitizeMarketingSettings(body);
  for (const key of ['phone', 'email', 'showTestimonials', 'announcement', 'deliveryMessage', 'weird']) assert.deepEqual(out[key], body[key], key);
  assert.deepEqual(body, before, 'the request body is not mutated');
  assert.notEqual(out, body);
  for (const nothing of [undefined, null, 'x', 5, [], hostileProxy()]) assert.deepEqual(sanitizeMarketingSettings(nothing), {});
  assert.deepEqual(sanitizeMarketingSettings({}), {}, 'nothing sent, nothing added');
  assert.deepEqual(sanitizeMarketingSettings({ phone: '1' }), { phone: '1' });
});

test('sanitizeMarketingSettings: a slide saved with its old fields keeps them exactly; nothing that was not sent is filled in', () => {
  const { heroSlides } = sanitizeMarketingSettings({ heroSlides: [legacySlide({ imageUrl: CLD('two') })] });
  assert.deepEqual(heroSlides, [legacySlide({ imageUrl: CLD('two') })], 'stored untouched: the form hides these fields, the data is not rewritten');
  const sent = sanitizeMarketingSettings({ heroSlides: [{ id: 'a', imageUrl: CLD('a'), isActive: false, focus: { gravity: 'custom', x: 10, y: 20, zoom: 2 } }, { id: 'b', imageUrl: CLD('b') }] }).heroSlides;
  assert.deepEqual(sent[0], { id: 'a', imageUrl: CLD('a'), isActive: false, focus: { gravity: 'custom', x: 10, y: 20, zoom: 2 } });
  assert.deepEqual(sent[1], { id: 'b', imageUrl: CLD('b') });
});

test('sanitizeMarketingSettings: only the old slider fields survive besides the new ones — unknown fields are dropped, long ones cut', () => {
  const [s] = sanitizeMarketingSettings({ heroSlides: [{ id: '1', imageUrl: CLD('a'), title: 'T'.repeat(900), tag: 7, internalNote: 'secret', createdAt: { seconds: 1 }, html: '<b>x</b>' }] }).heroSlides;
  assert.deepEqual(Object.keys(s).sort(), ['id', 'imageUrl', 'title']);
  assert.equal(s.title.length, LIMITS.legacyField);
});

test('sanitizeMarketingSettings: photos, links and text are cleaned in every list; caps apply', () => {
  const out = sanitizeMarketingSettings({
    heroSlides: Array.from({ length: 9 }, (_, i) => ({ id: String(i), imageUrl: i === 0 ? 'javascript:alert(1)' : CLD(`h${i}`) })),
    testimonials: [
      { name: '<b>Priya</b>', review: 'Nice', photo: 'https://collection.cloudinary.com/x/y', rating: 9 },
      ...Array.from({ length: 60 }, () => ({ name: 'N', review: 'ok' })),
    ],
    instagramFeed: Array.from({ length: 9 }, (_, i) => ({ imageUrl: CLD(`i${i}`), postUrl: i === 0 ? 'http://x.com' : 'https://instagram.com/p/x', caption: '<i>c</i>' })),
    advertisements: { items: Array.from({ length: 15 }, (_, i) => ad({ id: `a${i}`, link: i === 0 ? '//evil.com' : '/shop' })) },
  });
  assert.equal(out.heroSlides.length, 6);
  assert.equal(out.heroSlides[0].imageUrl, '');
  assert.equal(out.testimonials.length, 50);
  assert.deepEqual([out.testimonials[0].name, out.testimonials[0].photo, out.testimonials[0].rating], ['Priya', '', 5]);
  assert.equal(out.instagramFeed.length, 6);
  assert.equal(out.instagramFeed[0].postUrl, '');
  assert.equal(out.instagramFeed[1].caption, 'c');
  assert.equal(out.advertisements.items.length, 12);
  assert.equal(out.advertisements.items[0].link, '');
});

test('sanitizeMarketingSettings: layouts are complete and valid; advertisements keep a layout beside the items', () => {
  const out = sanitizeMarketingSettings({
    heroLayout: { layoutVariant: 'wide', displayMode: 'slider' },
    testimonialsLayout: { layoutVariant: 'nope', displayMode: 'single', size: 'huge', extra: 1 },
    instagramLayout: { size: 'small' },
    advertisements: { layout: { displayMode: 'grid' }, items: [] },
  });
  assert.deepEqual(out.heroLayout, { layoutVariant: 'wide', displayMode: 'slider', size: 'large' });
  assert.deepEqual(out.testimonialsLayout, SECTIONS.testimonials.defaultLayout);
  assert.deepEqual(out.instagramLayout, { layoutVariant: 'square', displayMode: 'grid', size: 'small' });
  assert.deepEqual(out.advertisements, { layout: { layoutVariant: 'wide', displayMode: 'grid', size: 'large' }, items: [] });
  assert.deepEqual(sanitizeMarketingSettings({ heroLayout: {} }).heroLayout, SECTIONS.hero.defaultLayout, 'an empty layout is the default one');
});

test('sanitizeMarketingSettings: a key of the wrong type is left out (what is stored stays), never stored as sent', () => {
  for (const bad of [null, undefined, 'x', 7, true, {}, { 0: { id: 'a' } }]) {
    const out = sanitizeMarketingSettings({ phone: '1', heroSlides: bad, testimonials: bad, instagramFeed: bad });
    for (const key of ['heroSlides', 'testimonials', 'instagramFeed']) assert.ok(!(key in out), `${key}: ${JSON.stringify(bad)}`);
    assert.equal(out.phone, '1');
  }
  for (const bad of [null, undefined, 'x', 7, true, []]) {
    const out = sanitizeMarketingSettings({ heroLayout: bad, testimonialsLayout: bad, instagramLayout: bad });
    assert.deepEqual(out, {}, JSON.stringify(bad));
  }
  for (const bad of [null, undefined, 'x', 7, true]) assert.ok(!('advertisements' in sanitizeMarketingSettings({ advertisements: bad })), JSON.stringify(bad));
  assert.deepEqual(sanitizeMarketingSettings({ advertisements: [ad()] }).advertisements.items.length, 1, 'a bare list of ads is accepted');
  assert.deepEqual(sanitizeMarketingSettings({ heroSlides: [] }), { heroSlides: [] }, 'an empty list is a real change: "no photos"');
});

test('sanitizeMarketingSettings: sanitising twice changes nothing; hostile input never throws', () => {
  const body = {
    heroSlides: [legacySlide(), null, 'x'], heroLayout: { layoutVariant: 'wide' },
    testimonials: [{ name: '<i>A</i>', review: 'x', photo: CLD('p'), rating: '4' }],
    instagramFeed: [{ imageUrl: CLD('i'), postUrl: 'https://instagram.com/p/x' }],
    advertisements: { layout: { size: 'small' }, items: [ad({ title: '<b>x</b>' }), { id: 'a1' }] },
  };
  const once = sanitizeMarketingSettings(body);
  assert.deepEqual(sanitizeMarketingSettings(once), once);
  assert.deepEqual(clone(once), once, 'plain JSON');
  const hostile = {
    heroSlides: [hostileObject(), hostileProxy(), { id: 'ok', imageUrl: CLD('ok') }],
    testimonials: hostileProxy(), instagramFeed: [hostileProxy()], advertisements: hostileProxy(), heroLayout: hostileProxy(),
  };
  assert.doesNotThrow(() => sanitizeMarketingSettings(hostile));
  const out = sanitizeMarketingSettings(hostile);
  assert.deepEqual(out.heroSlides.map((s) => s.id), ['ok']);
  assert.deepEqual(out.heroLayout, SECTIONS.hero.defaultLayout);
});

test('sanitizeMarketingSettings: __proto__ / constructor payloads store nothing and pollute nothing', () => {
  const raw = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"heroSlides":[{"__proto__":{"imageUrl":"https://evil.example.com/x.jpg"},"id":"a","imageUrl":""}],"advertisements":{"__proto__":{"items":[{"id":"evil"}]},"items":[{"id":"a","constructor":{"prototype":{"image":"https://evil.example.com/x.jpg"}}}]}}');
  const out = sanitizeMarketingSettings(raw);
  assert.deepEqual(out.heroSlides, [{ id: 'a', imageUrl: '' }]);
  assert.deepEqual(out.advertisements.items.map((a) => a.image), ['']);
  assert.equal({}.polluted, undefined);
  assert.equal({}.imageUrl, undefined);
  assert.ok(!JSON.stringify(out.heroSlides).includes('evil') && !JSON.stringify(out.advertisements).includes('evil'));
});

/* ── Fuzz: whatever goes in, the invariants hold ── */

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function junk(rand, depth = 0) {
  const pickOne = (list) => list[Math.floor(rand() * list.length)];
  const kind = Math.floor(rand() * (depth > 2 ? 9 : 12));
  switch (kind) {
    case 0: return undefined;
    case 1: return null;
    case 2: return pickOne([0, -1, 1, 5, 99, 3.7, NaN, Infinity, 1e21]);
    case 3: return pickOne([true, false]);
    case 4: return pickOne(['', ' ', 'x', 'shop', '/shop', '//evil.com', 'javascript:alert(1)', 'https://example.com/a', CLD('f'), '<b>hi</b>', '​', 'home', 'wide', 'slider', 'circle', 'large', '__proto__', 'constructor']);
    case 5: return 'a'.repeat(Math.floor(rand() * 3000));
    case 6: return pickOne(['\uD83D', '\uDE00', '💍'.repeat(40), '\u0000\u0007', 'தங்கம்']);
    case 7: return pickOne([PLACEMENT_VALUES[Math.floor(rand() * PLACEMENT_VALUES.length)], 'bogus']);
    case 8: return pickOne([{}, []]);
    case 9: return Array.from({ length: Math.floor(rand() * 8) }, () => junk(rand, depth + 1));
    default: {
      const o = {};
      for (const k of ['id', 'imageUrl', 'image', 'photo', 'link', 'title', 'buttonText', 'placements', 'isActive', 'focus', 'name', 'review', 'rating', 'caption', 'postUrl', 'layoutVariant', 'displayMode', 'size', 'items', 'layout', 'gravity', 'x', 'y', 'zoom', '__proto__']) {
        if (rand() < 0.35) Object.defineProperty(o, k, { value: junk(rand, depth + 1), enumerable: true, configurable: true, writable: true });
      }
      return o;
    }
  }
}

test('fuzz: whatever is stored, every normaliser returns a complete, valid, plain, idempotent value and never throws', () => {
  const rand = rng(20260426);
  let produced = 0;
  for (let n = 0; n < 1500; n += 1) {
    const raw = junk(rand);
    const list = Array.isArray(raw) ? raw : [raw, junk(rand), junk(rand)];
    const hero = normalizeHeroSlides(list);
    const reviews = normalizeTestimonialItems(list);
    const posts = normalizeInstagramItems(list);
    const ads = normalizeAdvertisements({ layout: junk(rand), items: list });
    assert.ok(hero.length <= 6 && reviews.length <= 50 && posts.length <= 6 && ads.items.length <= 12);
    produced += hero.length + reviews.length + posts.length + ads.items.length;
    hero.forEach((s) => { assertFocus(s.focus); assert.ok(s.imageUrl === '' || /^(https:\/\/|\/)/.test(s.imageUrl)); assert.ok(s.id.length > 0); });
    reviews.forEach((r) => { assertFocus(r.focus); [r.name, r.location, r.review].forEach(noMarkup); assert.ok(r.rating >= 1 && r.rating <= 5 && Number.isInteger(r.rating)); assert.ok(r.photo === '' || isUsableImageUrl(r.photo)); });
    posts.forEach((p) => { assertFocus(p.focus); noMarkup(p.caption); assert.ok(p.postUrl === '' || p.postUrl.startsWith('https://')); });
    assertLayout(ads.layout, 'ads');
    ads.items.forEach((a) => {
      assertFocus(a.focus);
      noMarkup(a.title); noMarkup(a.buttonText);
      assert.ok(a.title.length <= 60 && a.buttonText.length <= 24);
      assert.ok(a.image === '' || /^https:\/\/[^\s"'<>]+$/.test(a.image));
      assert.equal(a.link, safeAdLink(a.link));
      assert.ok(a.placements.every((p) => PLACEMENT_VALUES.includes(p)));
      assert.ok(a.id.length > 0);
    });
    assert.equal(new Set(ads.items.map((a) => a.id)).size, ads.items.length);
    for (const section of ['hero', 'testimonials', 'instagram', 'ads']) assertLayout(normalizeLayout(junk(rand), section), section);
    /* idempotent, plain JSON */
    assert.deepEqual(normalizeHeroSlides(hero), hero);
    assert.deepEqual(normalizeTestimonialItems(reviews), reviews);
    assert.deepEqual(normalizeInstagramItems(posts), posts);
    assert.deepEqual(normalizeAdvertisements(ads), ads);
    assert.deepEqual(clone(ads), ads);
    /* the sanitiser: same promises, and what it keeps reads the same as what it was sent */
    const body = { heroSlides: list, testimonials: list, instagramFeed: list, advertisements: { items: list }, heroLayout: junk(rand), keep: raw };
    const stored = sanitizeMarketingSettings(body);
    assert.deepEqual(sanitizeMarketingSettings(stored), stored);
    if ('heroSlides' in stored) assert.deepEqual(normalizeHeroSlides(stored.heroSlides).map((s) => s.imageUrl), hero.map((s) => s.imageUrl));
    if ('advertisements' in stored) assert.deepEqual(normalizeAdvertisements(stored.advertisements), ads);
    if ('testimonials' in stored) assert.deepEqual(normalizeTestimonialItems(stored.testimonials), reviews);
  }
  assert.ok(produced > 1000, `the fuzz produced items to check (${produced})`);
});

/* ── Purity: the storefront imports this file ── */

test('marketing.js is a pure module: no React, no zod, no @/ alias, no admin copy, no HTML injection', () => {
  const text = readFileSync(new URL('../src/lib/marketing.js', import.meta.url), 'utf8');
  const imports = [...text.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['./avatar.js', './categoryShowcase.js', './deliveryMessage.js']);
  assert.doesNotMatch(text, /dangerouslySetInnerHTML|innerHTML|eval\(|new Function|require\(|process\.env|window\.|document\./);
  assert.doesNotMatch(text, /marketingServer|firebase/i, 'the server reader (Firestore) is not imported by the storefront file');
});
