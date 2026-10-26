/* Website advertisements: the slot every page draws, where the pages place it, and the admin editor's helpers. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import * as marketing from '../src/lib/marketing.js';
import * as showcaseLib from '../src/lib/categoryShowcase.js';

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
const Link = ({ href, children, ...rest }) => React.createElement('a', { href, 'data-next-link': 'true', ...rest }, children);

const CLD = 'https://res.cloudinary.com/djolb5idc/image/upload/v1/tulsi-bridal/ads';
const ad = (over = {}) => marketing.newItem('ads', { id: 'a1', image: `${CLD}/one.jpg`, link: '/shop', title: 'Festive chains', buttonText: 'Shop now', placements: ['shop'], ...over });
const slot = (items, layout = {}) => ({ layout: marketing.normalizeLayout(layout, 'ads'), items });

const AdSlot = sucrase ? load('src/components/ads/AdSlot.jsx', {
  'next/link': { __esModule: true, default: Link },
  '@/lib/marketing': marketing,
  '@/components/home/FocusPhoto': load('src/components/home/FocusPhoto.jsx', { '@/lib/categoryShowcase': showcaseLib }),
  '@/components/home/SliderRow': { __esModule: true, default: ({ children, label }) => React.createElement('div', { 'data-slider': label }, children) },
}).default : null;

describe('AdSlot', { skip }, () => {
  test('no ads, nothing: the page is exactly the page it was', () => {
    assert.equal(render(React.createElement(AdSlot, { placement: 'shop' })), '');
    assert.equal(render(React.createElement(AdSlot, { placement: 'shop', ads: slot([]) })), '');
    assert.equal(render(React.createElement(AdSlot, { placement: 'shop', ads: null })), '');
    assert.equal(render(React.createElement(AdSlot, { placement: 'shop', ads: { items: 'x' } })), '');
  });

  test('one banner: a 16:9 link in a labelled section, photo cropped to the shape, title and button over a scrim', () => {
    const h = render(React.createElement(AdSlot, { placement: 'shop', ads: slot([ad()]) }));
    assert.match(h, /<section aria-label="Offers" data-ad-slot="shop" class="section-container"/);
    assert.match(h, /<a href="\/shop" data-next-link="true" class="group relative block overflow-hidden[^"]*aspect-video rounded-2xl/);
    assert.match(h, /max-w-4xl/);
    assert.match(h, /c_fill,ar_16:9,g_auto/);
    assert.match(h, /alt="Festive chains"/);
    assert.match(h, /Festive chains<\/span>/);
    assert.match(h, /Shop now<\/span>/);
    assert.match(h, /from-black\/70/);
    assert.match(h, /loading="lazy"/);
  });

  test('a link outside the site opens in a new tab safely; no link = not clickable', () => {
    const ext = render(React.createElement(AdSlot, { placement: 'home', ads: slot([ad({ link: 'https://example.com/sale' })]) }));
    assert.match(ext, /<a href="https:\/\/example\.com\/sale" target="_blank" rel="noopener noreferrer"/);
    assert.doesNotMatch(ext, /data-next-link/);
    const none = render(React.createElement(AdSlot, { placement: 'home', ads: slot([ad({ link: '' })]) }));
    assert.doesNotMatch(none, /<a /);
    assert.match(none, /<div class="group relative block/);
  });

  test('no text, no overlay; alt falls back to a neutral phrase', () => {
    const h = render(React.createElement(AdSlot, { placement: 'cart', ads: slot([ad({ title: '', buttonText: '' })]) }));
    assert.doesNotMatch(h, /from-black\/70/);
    assert.match(h, /alt="Special offer"/);
  });

  test('priority: the first banner is fetched at once, the others stay lazy', () => {
    const h = render(React.createElement(AdSlot, { placement: 'shop', priority: true, ads: slot([ad(), ad({ id: 'a2' })], { displayMode: 'grid' }) }));
    assert.equal((h.match(/loading="eager"/g) || []).length, 1);
    assert.equal((h.match(/loading="lazy"/g) || []).length, 1);
    assert.match(h, /fetchPriority="high"/);
  });

  test('several ads: a grid by density, or one swipeable row for Slider', () => {
    const two = [ad(), ad({ id: 'a2', title: 'Second' })];
    const grid = (size) => render(React.createElement(AdSlot, { placement: 'shop', ads: slot(two, { displayMode: 'grid', size }) }));
    assert.match(grid('large'), /grid-cols-1 gap-4/);
    assert.match(grid('medium'), /md:grid-cols-2/);
    assert.match(grid('small'), /grid-cols-2[^"]*md:grid-cols-3/);
    const slider = render(React.createElement(AdSlot, { placement: 'shop', ads: slot(two, { displayMode: 'slider' }) }));
    assert.match(slider, /data-slider="Offers"/);
    assert.equal((slider.match(/snap-start/g) || []).length, 2);
    assert.match(slider, /w-\[88vw\]/);
    /* A lone ad is not a slider, whatever the mode. */
    assert.doesNotMatch(render(React.createElement(AdSlot, { placement: 'shop', ads: slot([ad()], { displayMode: 'slider' }) })), /data-slider/);
  });

  test('every shape draws its own frame; the crop the owner set reaches the photo', () => {
    const frames = { circle: 'aspect-square rounded-full', square: 'aspect-square rounded-2xl', king_size: 'aspect-[4/5]', wide: 'aspect-video' };
    for (const [variant, cls] of Object.entries(frames)) {
      assert.match(render(React.createElement(AdSlot, { placement: 'home', ads: slot([ad()], { layoutVariant: variant }) })), new RegExp(cls.replace(/[[\]/]/g, '\\$&')), variant);
    }
    const north = render(React.createElement(AdSlot, { placement: 'home', ads: slot([ad({ focus: { gravity: 'north', x: 50, y: 50, zoom: 1 } })]) }));
    assert.match(north, /g_north/);
    const custom = render(React.createElement(AdSlot, { placement: 'home', ads: slot([ad({ focus: { gravity: 'custom', x: 20, y: 80, zoom: 1.4 } })]) }));
    assert.match(custom, /object-position:20% 80%/);
  });

  test('stored text is plain text: tags cannot get in, and what is left is escaped', () => {
    const h = render(React.createElement(AdSlot, { placement: 'home', ads: slot([marketing.newItem('ads', { id: 'x', image: `${CLD}/x.jpg`, title: '<img src=x onerror=alert(1)>Sale & more', link: 'javascript:alert(1)', placements: ['home'] })]) }));
    assert.doesNotMatch(h, /<img src=x|onerror|javascript:/i);
    assert.match(h, /Sale &amp; more/);
  });
});

describe('where the pages place it', () => {
  const read = (p) => readFileSync(p, 'utf8');
  const SITES = [
    ['src/app/shop/page.js', 'shop'], ['src/app/catalog/page.js', 'category'],
    ['src/app/cart/layout.js', 'cart'], ['src/app/checkout/layout.js', 'checkout'],
    ['src/app/order-success/layout.js', 'order-success'], ['src/app/track-order/layout.js', 'track-order'],
  ];
  test('shop, category, cart, checkout, order-success and track-order draw their own slot from the server, rebuilt every 5 minutes', () => {
    for (const [file, placement] of SITES) {
      const src = read(file);
      assert.match(src, new RegExp(`<AdSlot placement="${placement}" ads=\\{ads\\}`), file);
      assert.match(src, new RegExp(`adsForPlacement\\(await getAdvertisements\\(\\), '${placement}'\\)`), file);
      assert.match(src, /export const revalidate = 300;/, file);
      assert.doesNotMatch(src, /'use client'/, `${file} stays a server file`);
    }
  });
  test('product page and home: read with the page’s own data, no extra round trip', () => {
    const product = read('src/app/product/[id]/page.js');
    assert.match(product, /Promise\.all\(\[getProduct\(id\), getSiteExtras\(\)\]\)/, 'one settings read for the delivery message and the banners');
    assert.match(product, /adsForPlacement\(site\.advertisements, 'product'\)/);
    assert.match(product, /<AdSlot placement="product" ads=\{ads\}/);
    assert.doesNotMatch(product, /getAdvertisements/, 'no second read of the settings document');
    const home = read('src/app/page.js');
    assert.match(home, /Promise\.all\(\[loadHomeSettings\(\), getAdvertisements\(\)\]\)/);
    assert.match(home, /ads=\{adsForPlacement\(allAds, 'home'\)\}/);
    assert.match(read('src/app/HomeClient.js'), /<AdSlot placement="home" ads=\{homeAds\}/);
  });
  test('every placement the admin can tick has a slot somewhere', () => {
    const all = [...SITES.map(([, p]) => p), 'product', 'home'].sort();
    assert.deepEqual(all, [...marketing.PLACEMENT_VALUES].sort());
  });
  test('a layout draws the client page first, then the slot; a failed read leaves the page alone', async () => {
    for (const [file] of SITES.filter(([f]) => f.endsWith('layout.js'))) {
      for (const reader of [async () => marketing.normalizeAdvertisements({ items: [ad({ placements: ['cart', 'checkout', 'order-success', 'track-order'] })] }), async () => marketing.emptyAds()]) {
        const Layout = load(file, {
          '@/lib/seo': { absoluteUrl: (p) => p },
          '@/lib/marketing': marketing,
          '@/lib/marketingServer': { getAdvertisements: reader },
          '@/components/ads/AdSlot': { __esModule: true, default: function AdSlotStub() { return null; } },
        }).default;
        const tree = await Layout({ children: React.createElement('main', { id: 'page' }) });
        const kids = React.Children.toArray(tree.props.children);
        assert.equal(kids[0].props.id, 'page', `${file}: the page comes first`);
        assert.equal(kids[1].type.name, 'AdSlotStub');
      }
    }
  });
});

describe('the admin editor', { skip }, () => {
  const mgr = sucrase ? load('src/components/admin/marketing/AdvertisementsManager.jsx', {
    react: React,
    '@/lib/marketing': marketing,
    './PhotoSectionManager': { __esModule: true, default: ({ items, copy, previewConfig }) => React.createElement('div', { 'data-manager': items.length, 'data-add': copy.addLabel, 'data-max': copy.max, 'data-preview-src': previewConfig.src }) },
    './MarketingPanels': { MODE_CHOICES: { grid: { value: 'grid', label: 'Grid' }, slider: { value: 'slider', label: 'Slider' } } },
  }) : null;

  test('placementCounts(): only ads that are on count, per page', () => {
    const items = [ad({ placements: ['shop', 'cart'] }), ad({ id: 'a2', placements: ['shop'], isActive: false }), ad({ id: 'a3', placements: ['home', 'shop'] }), ad({ id: 'a4', image: '', placements: ['product'] })];
    const c = Object.fromEntries(mgr.placementCounts(items).map((p) => [p.value, p.count]));
    assert.deepEqual(c, { home: 1, shop: 2, category: 0, product: 0, cart: 1, checkout: 0, 'order-success': 0, 'track-order': 0 });
    assert.equal(mgr.placementCounts([]).length, 8);
  });

  test('linkProblem(): empty, a site path and https are fine; anything else says what to use', () => {
    for (const fine of ['', '  ', '/shop', '/catalog?category=earrings', 'https://example.com/x']) assert.equal(mgr.linkProblem(fine), '', fine);
    for (const bad of ['javascript:alert(1)', '//evil.test', 'http://insecure.test', 'shop', 'ftp://x']) assert.match(mgr.linkProblem(bad), /https:\/\//, bad);
  });

  test('every page has a plain-words note, and the editor is the shared manager with the Add ad button and a page picker', () => {
    assert.deepEqual(Object.keys(mgr.PLACEMENT_NOTES).sort(), [...marketing.PLACEMENT_VALUES].sort());
    const h = render(React.createElement(mgr.default, { value: marketing.normalizeAdvertisements({ items: [ad(), ad({ id: 'a2' })] }), onChange() {} }));
    assert.match(h, /data-manager="2"/); assert.match(h, /data-add="Add ad"/); assert.match(h, /data-max="12"/);
    assert.match(h, /data-preview-src="\/marketing-preview\?section=ads"/);
    assert.match(h, /aria-label="Banners per page"/);
    assert.match(h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), /Shop: 2/);
  });

  test('a draft without ads renders (older settings have none)', () => {
    assert.match(render(React.createElement(mgr.default, { value: undefined, onChange() {} })), /data-manager="0"/);
  });
});
