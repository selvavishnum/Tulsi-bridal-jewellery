/* Marketing tab: the hero / reviews / Instagram panels (shared PhotoSectionManager) and what the storefront
   does with what they save — visibility, crop, shape, size, slider. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import * as marketing from '../src/lib/marketing.js';
import * as showcaseLib from '../src/lib/categoryShowcase.js';
import * as heroLib from '../src/lib/heroSlides.js';

const require = createRequire(import.meta.url);
let sucrase = null;
try { sucrase = require('sucrase'); } catch { /* skipped below */ }
const skip = sucrase ? false : 'sucrase is not installed, so the components cannot be transpiled for node --test';
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(rel, deps) {
  const file = path.resolve(rel);
  const { code } = sucrase.transform(readFileSync(file, 'utf8'), { transforms: ['jsx', 'imports'], jsxRuntime: 'automatic', production: true, filePath: file });
  const all = { react: React, 'react/jsx-runtime': require('react/jsx-runtime'), ...deps };
  const mod = { exports: {} };
  vm.runInThisContext(`(function (exports, require, module) {${code}\n})`, { filename: file })(mod.exports, (id) => {
    if (!Object.hasOwn(all, id)) throw new Error(`${rel} imports ${id}: add a stub for it in this test`);
    return all[id];
  }, mod);
  return mod.exports;
}
const icon = (name) => { const Icon = (props) => React.createElement('svg', { 'data-icon': name, ...props }); Icon.displayName = name; return Icon; };
const icons = new Proxy({}, { get: (_, name) => (typeof name === 'string' && name.startsWith('Fi') ? icon(name) : undefined) });
const render = (el) => {
  const warnings = [];
  const orig = console.error;
  console.error = (...a) => { warnings.push(a.map(String).join(' ')); };
  try { return renderToStaticMarkup(el); } finally { console.error = orig; assert.deepEqual(warnings, [], 'React warned while rendering'); }
};
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const parts = sucrase ? load('src/components/admin/showcase/parts.jsx', { 'react-icons/fi': icons, '@/lib/categoryShowcase': showcaseLib }) : null;
const manager = sucrase ? load('src/components/admin/marketing/PhotoSectionManager.jsx', {
  'react-hot-toast': { __esModule: true, default: { success() {}, error() {} } },
  'react-icons/fi': icons,
  '@/lib/cloudinaryUpload': { uploadToCloudinary: async () => ({ url: 'https://res.cloudinary.com/x/image/upload/v1/new.jpg' }) },
  '@/lib/marketing': marketing,
  '@/components/admin/showcase/parts': parts,
  '@/components/admin/showcase/ShowcasePreviewModal': { __esModule: true, default: () => React.createElement('div', { 'data-modal': 'preview' }) },
}) : null;
const panels = sucrase ? load('src/components/admin/marketing/MarketingPanels.jsx', {
  '@/lib/marketing': marketing,
  './PhotoSectionManager': { __esModule: true, default: manager.default },
}) : null;

const CLD = 'https://res.cloudinary.com/djolb5idc/image/upload/v1/tulsi-bridal';
const slides = [
  { id: 'a', imageUrl: `${CLD}/hero/a.jpg`, isActive: true, focus: showcaseLib.DEFAULT_FOCUS },
  { id: 'b', imageUrl: `${CLD}/hero/b.jpg`, isActive: false, focus: showcaseLib.DEFAULT_FOCUS },
  { id: 'c', imageUrl: `${CLD}/hero/c.jpg`, isActive: true, focus: { gravity: 'north', x: 50, y: 50, zoom: 1.5 } },
];
const heroLayout = marketing.normalizeLayout(null, 'hero');
const noop = () => {};

describe('the photo sections (admin)', { skip }, () => {
  test('moved(): swaps neighbours, stays put at the ends, never mutates', () => {
    const list = ['a', 'b', 'c'];
    assert.deepEqual(manager.moved(list, 0, 1), ['b', 'a', 'c']);
    assert.deepEqual(manager.moved(list, 2, -1), ['a', 'c', 'b']);
    assert.equal(manager.moved(list, 0, -1), list);
    assert.equal(manager.moved(list, 2, 1), list);
    assert.deepEqual(list, ['a', 'b', 'c']);
  });

  test('modalItem(): the preview modal sees the showcase item shape (name, photo, crop, switch)', () => {
    const m = manager.modalItem(slides[1], 1, { photoField: 'imageUrl', name: 'Photo 2', emoji: '🖼️' });
    assert.deepEqual({ key: m.key, label: m.label, image: m.image, isActive: m.isActive, emoji: m.emoji }, { key: '1', label: 'Photo 2', image: slides[1].imageUrl, isActive: false, emoji: '🖼️' });
    assert.deepEqual(m.focus, showcaseLib.DEFAULT_FOCUS);
    assert.equal(manager.modalItem({ photo: 5 }, 0, { photoField: 'photo', name: 'x', emoji: 'y' }).image, '', 'a non-string photo is no photo');
  });

  test('hero panel: layout bar with Single photo / Slider, a card per photo, hidden ones marked, Preview and Add', () => {
    const h = render(React.createElement(panels.HeroPhotosPanel, { items: slides, onItemsChange: noop, layout: heroLayout, onLayoutChange: noop }));
    const t = text(h);
    assert.match(t, /Shape/); assert.match(t, /Display mode/); assert.match(t, /Density/);
    assert.match(t, /Single photo/); assert.match(t, /Slider/);
    assert.match(t, /Circle/); assert.match(t, /King Size 4:5/);
    assert.match(h, /aria-pressed="true"[^>]*>[^]*?King Size/, 'King Size (today) is the chosen shape');
    for (const n of [1, 2, 3]) assert.match(t, new RegExp(`Photo ${n}`));
    assert.equal((h.match(/role="switch"/g) || []).length, 3, 'a show/hide switch per photo');
    assert.match(h, /aria-checked="false"/, 'the hidden one is off');
    assert.match(t, /Hidden/);
    assert.equal((t.match(/Shown on Home/g) || []).length, 2);
    assert.match(t, /2 of 3 shown/);
    assert.match(t, /Add photo \(3\/6\)/);
    assert.match(t, /Preview/);
    assert.match(h, /aria-label="Move Photo 1 later"/); assert.match(h, /aria-label="Move Photo 3 earlier"/);
    assert.match(h, /aria-label="Preview and crop Photo 2"/);
    assert.match(h, /id="hero-move-0-earlier"[^>]*disabled/, 'the first photo cannot move earlier');
  });

  test('hero panel: empty, and full (Add is off at 6)', () => {
    const empty = text(render(React.createElement(panels.HeroPhotosPanel, { items: [], onItemsChange: noop, layout: heroLayout, onLayoutChange: noop })));
    assert.match(empty, /No hero photo yet/);
    const six = Array.from({ length: 6 }, (_, i) => marketing.newItem('hero', { id: `s${i}` }));
    const h = render(React.createElement(panels.HeroPhotosPanel, { items: six, onItemsChange: noop, layout: heroLayout, onLayoutChange: noop }));
    assert.match(h, /<button[^>]*disabled[^>]*>(?:(?!<\/button>)[^])*Add photo \(6\/6\)/);
  });

  test('reviews panel: one column on a phone, the reviewer’s name on its card, shapes for the photo frame', () => {
    const items = [marketing.newItem('testimonials', { name: 'Asha', review: 'Lovely', rating: 5 }), marketing.newItem('testimonials', {})];
    const h = render(React.createElement(panels.TestimonialsPanel, { items, onItemsChange: noop, layout: marketing.normalizeLayout(null, 'testimonials'), onLayoutChange: noop }));
    const t = text(h);
    assert.match(t, /Asha/); assert.match(t, /Review 2/);
    assert.match(h, /grid-cols-1/);
    assert.match(t, /Add review \(2\/50\)/);
  });

  test('instagram panel: caps at 6 and names posts by position', () => {
    const items = [marketing.newItem('instagram', { imageUrl: `${CLD}/ig/1.jpg` })];
    const h = render(React.createElement(panels.InstagramPanel, { items, onItemsChange: noop, layout: marketing.normalizeLayout(null, 'instagram'), onLayoutChange: noop }));
    assert.match(text(h), /Post 1/); assert.match(text(h), /Add post \(1\/6\)/);
  });
});

describe('the storefront reads what the panels save', () => {
  const picked = heroLib.pickHeroSlides(slides);

  test('an untouched slide is what it always was; only a switch-off or a crop adds a field', () => {
    assert.deepEqual(heroLib.pickHeroSlides([{ id: 'a', imageUrl: `${CLD}/a.jpg`, isActive: true, focus: showcaseLib.DEFAULT_FOCUS }]), [{ id: 'a', imageUrl: `${CLD}/a.jpg` }]);
    assert.equal(picked[1].isActive, false);
    assert.equal(picked[2].focus.gravity, 'north');
    assert.equal('focus' in picked[0] || 'isActive' in picked[0], false);
  });

  test('heroPhotos(): Single = the first photo that is on; Slider = every one that is on (max 6); none = none', () => {
    assert.deepEqual(heroLib.heroPhotos(picked, { displayMode: 'single' }).map((p) => p.url), [`${CLD}/hero/a.jpg`]);
    assert.deepEqual(heroLib.heroPhotos(picked, { displayMode: 'slider' }).map((p) => p.url), [`${CLD}/hero/a.jpg`, `${CLD}/hero/c.jpg`]);
    assert.equal(heroLib.heroPhotos(picked, { displayMode: 'slider' })[1].focus.gravity, 'north');
    assert.equal(heroLib.heroPhotos(picked, null)[0].focus, null);
    const hiddenFirst = heroLib.pickHeroSlides([{ ...slides[0], isActive: false }, slides[2]]);
    assert.deepEqual(heroLib.heroPhotos(hiddenFirst, { displayMode: 'single' }).map((p) => p.url), [`${CLD}/hero/c.jpg`], 'the next one that is on takes its place');
    assert.deepEqual(heroLib.heroPhotos([], { displayMode: 'slider' }), []);
    assert.deepEqual(heroLib.heroPhotos(Array.from({ length: 9 }, (_, i) => ({ id: String(i), imageUrl: `${CLD}/${i}.jpg` })), { displayMode: 'slider' }).length, 6);
    assert.equal(heroLib.heroPhotoUrl(hiddenFirst), `${CLD}/hero/c.jpg`);
  });

  test('pickTestimonials(): a review that is switched off is not shown; a crop rides along only when set', () => {
    const r = heroLib.pickTestimonials([
      { name: 'A', review: 'x', isActive: false },
      { name: 'B', review: 'y', focus: showcaseLib.DEFAULT_FOCUS },
      { name: 'C', review: 'z', focus: { gravity: 'face', x: 50, y: 50, zoom: 1 } },
    ]);
    assert.deepEqual(r.map((t) => t.name), ['B', 'C']);
    assert.equal('focus' in r[0], false);
    assert.equal(r[1].focus.gravity, 'face');
  });
});

describe('the hero frame (storefront)', { skip }, () => {
  const photos = sucrase ? load('src/components/home/HeroPhotos.jsx', { 'react-icons/fi': icons, '@/lib/categoryShowcase': showcaseLib }) : null;

  test('Large + King Size is exactly the box the hero always had; the other shapes and sizes have their own', () => {
    const king = photos.heroBoxClass({ layoutVariant: 'king_size', size: 'large' });
    assert.match(king, /supports-\[height:1svh\]:w-\[min\(100%,18rem,max\(14rem,calc\(\(100svh-33rem\)\*0\.8\)\)\)\]/);
    assert.equal(photos.heroBoxClass(null), king);
    assert.doesNotMatch(photos.heroBoxClass({ layoutVariant: 'square', size: 'large' }), /svh/);
    assert.notEqual(photos.heroBoxClass({ layoutVariant: 'king_size', size: 'small' }), king);
    assert.match(photos.heroBoxClass({ layoutVariant: 'wide', size: 'medium' }), /lg:max-w-\[24rem\]/);
    assert.deepEqual(photos.heroShape(null), photos.HERO_SHAPES.king_size);
    assert.equal(photos.HERO_SHAPES.king_size.ratio, 0.8);
    assert.equal(photos.heroShape({ layoutVariant: 'circle' }).round, 'rounded-full');
    assert.equal(photos.heroShape({ layoutVariant: 'nonsense' }), photos.HERO_SHAPES.king_size);
  });

  test('heroCrop(): the default crop adds nothing; presets go to Cloudinary; a custom point is cropped by the browser; zoom scales', () => {
    assert.deepEqual(photos.heroCrop(null), { gravity: undefined, cropped: true, style: undefined });
    assert.deepEqual(photos.heroCrop(showcaseLib.DEFAULT_FOCUS), { gravity: undefined, cropped: true, style: undefined });
    assert.equal(photos.heroCrop({ gravity: 'north', x: 50, y: 50, zoom: 1 }).gravity, 'north');
    assert.equal(photos.heroCrop({ gravity: 'face', x: 50, y: 50, zoom: 1 }).gravity, 'face');
    const custom = photos.heroCrop({ gravity: 'custom', x: 20, y: 70, zoom: 1.5 });
    assert.equal(custom.cropped, false);
    assert.equal(custom.style.objectPosition, '20% 70%');
    assert.equal(custom.style.transform, 'scale(1.5)');
    assert.equal(photos.heroCrop({ gravity: 'center', x: 50, y: 50, zoom: 2 }).style.transform, 'scale(2)');
  });

  test('the slider: the server draws only the first photo (and no dots or arrows); it is a labelled carousel', () => {
    const h = render(React.createElement(photos.HeroSlider, { count: 3, renderSlide: (i) => React.createElement('i', { 'data-slide': i }) }));
    assert.equal((h.match(/data-slide=/g) || []).length, 1);
    assert.match(h, /data-slide="0"/);
    assert.match(h, /aria-roledescription="carousel"/);
    assert.match(h, /aria-label="Photo 1 of 3"/);
    assert.doesNotMatch(h, /Next photo|Choose a photo/, 'the dots and arrows come once the page has loaded');
  });
});

describe('FocusPhoto and SliderRow (storefront)', { skip }, () => {
  const FocusPhoto = sucrase ? load('src/components/home/FocusPhoto.jsx', { '@/lib/categoryShowcase': showcaseLib }).default : null;
  const SliderRow = sucrase ? load('src/components/home/SliderRow.jsx', { 'react-icons/fi': icons }).default : null;

  test('FocusPhoto crops on Cloudinary to the shape for a preset and in the browser for a custom point', () => {
    const north = render(React.createElement(FocusPhoto, { src: `${CLD}/p.jpg`, alt: 'x', variant: 'king_size', focus: { gravity: 'north', x: 50, y: 50, zoom: 1 } }));
    assert.match(north, /c_fill,ar_4:5,g_north/);
    assert.match(north, /loading="lazy"/);
    const custom = render(React.createElement(FocusPhoto, { src: `${CLD}/p.jpg`, alt: 'x', variant: 'wide', focus: { gravity: 'custom', x: 30, y: 60, zoom: 1.2 } }));
    assert.match(custom, /c_limit/);
    assert.match(custom, /object-position:30% 60%/);
    assert.match(custom, /scale\(1\.2\)/);
    assert.equal(render(React.createElement(FocusPhoto, { src: '', alt: '' })), '');
    const eager = render(React.createElement(FocusPhoto, { src: `${CLD}/p.jpg`, alt: '', priority: true }));
    assert.match(eager, /loading="eager"/); assert.match(eager, /fetchPriority="high"/);
  });

  test('SliderRow: a labelled carousel with previous / next buttons', () => {
    const h = render(React.createElement(SliderRow, { label: 'Reviews' }, React.createElement('div', null, 'card')));
    assert.match(h, /aria-roledescription="carousel"/); assert.match(h, /aria-label="Reviews"/);
    assert.match(h, /aria-label="Reviews: previous"/); assert.match(h, /aria-label="Reviews: next"/);
    assert.match(h, /scrollbar-hide/);
  });
});
