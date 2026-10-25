/* ─────────────────────────────────────────────
   The shared header and footer, as a screen reader meets them (PageSpeed
   "Buttons / Links do not have an accessible name" and "Elements must only
   use permitted ARIA attributes"):
   - the footer shows a social icon only when the admin has set its address
     (a dead <a> has no role, so its aria-label is not allowed and it has no
     name), and keeps its row height while the settings load;
   - the header's wishlist and cart icons are named, with the count.

   Run: npm test
   ───────────────────────────────────────────── */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
let sucrase = null;
try { sucrase = require('sucrase'); } catch { /* skipped below */ }
const skip = sucrase ? false : 'sucrase is not installed, so Footer.js cannot be transpiled for node --test';
const React = require('react');
const { renderToString } = require('react-dom/server');
const { NAV_LINKS } = await import('../src/components/layout/navLinks.js');
const brand = await import('../src/lib/brand.js');

function loadFooter(settings) {
  const file = path.resolve('src/components/layout/Footer.js');
  const { code } = sucrase.transform(readFileSync(file, 'utf8'), { transforms: ['jsx', 'imports'], jsxRuntime: 'automatic', production: true, filePath: file });
  const icon = (name) => function Icon(props) { return React.createElement('svg', { 'data-icon': name, ...props }); };
  /* useState gives the settings straight away, as they are once /api/admin/settings has answered. */
  const fakeReact = { ...React, useState: (init) => [Object.keys(init).length || !settings ? init : settings, () => {}], useEffect: () => {} };
  const deps = {
    react: fakeReact,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/link': { __esModule: true, default: function Link({ href, children, ...rest }) { return React.createElement('a', { href, ...rest }, children); } },
    'react-icons/fi': new Proxy({}, { get: (_, name) => (typeof name === 'string' && name.startsWith('Fi') ? icon(name) : undefined) }),
    '@/components/layout/navLinks': { NAV_LINKS },
    '@/lib/brand': brand,
  };
  const mod = { exports: {} };
  vm.runInThisContext(`(function (exports, require, module) {${code}\n})`, { filename: file })(mod.exports, (id) => {
    if (!Object.hasOwn(deps, id)) throw new Error(`Footer.js imports ${id}: add a stub`);
    return deps[id];
  }, mod);
  return mod.exports.default;
}
const social = (html) => [...html.matchAll(/<a [^>]*aria-label="(Instagram|Facebook|YouTube)"[^>]*>/g)].map((m) => ({ label: m[1], tag: m[0] }));

test('footer: only the social icons that have an address are shown, each a real link with a name', { skip }, () => {
  const Footer = loadFooter({ instagram: 'https://instagram.com/tulsijewels', facebook: '', youtube: undefined });
  const html = renderToString(React.createElement(Footer));
  const icons = social(html);
  assert.deepEqual(icons.map((i) => i.label), ['Instagram'], 'no dead Facebook / YouTube icon');
  assert.match(icons[0].tag, /href="https:\/\/instagram\.com\/tulsijewels"/);
  assert.match(icons[0].tag, /target="_blank"/);
  assert.match(icons[0].tag, /rel="noopener noreferrer"/);
  assert.match(html, /<svg[^>]*aria-hidden="true"/, 'the icon itself is hidden from a screen reader (the link has the name)');
  /* Every <a> that has an aria-label has a destination: an <a> without href has no role, and aria-label is not allowed on it. */
  for (const m of html.matchAll(/<a\b([^>]*)>/g)) if (/aria-label=/.test(m[1])) assert.match(m[1], /href=/, `<a> with a label but no href: ${m[0]}`);
});

test('footer: no addresses set at all → no icons, and the row still holds its height (nothing jumps when they load)', { skip }, () => {
  const html = renderToString(React.createElement(loadFooter(null)));
  assert.deepEqual(social(html), []);
  assert.match(html, /<div class="flex gap-2\.5 min-h-9"><\/div>/);
});

test('footer: all three set → all three, in order', { skip }, () => {
  const Footer = loadFooter({ instagram: 'https://i.example/a', facebook: 'https://f.example/a', youtube: 'https://y.example/a' });
  assert.deepEqual(social(renderToString(React.createElement(Footer))).map((i) => i.label), ['Instagram', 'Facebook', 'YouTube']);
});

test('header: the wishlist and cart icons are named, with how many they hold', () => {
  const nav = readFileSync(path.resolve('src/components/layout/Navbar.js'), 'utf8');
  assert.match(nav, /<Link href="\/wishlist" aria-label=\{wishlistItems\.length > 0 \? `Wishlist, \$\{wishlistItems\.length\} saved` : 'Wishlist'\}/);
  assert.match(nav, /<Link href="\/cart" aria-label=\{itemCount > 0 \? `Cart, \$\{itemCount\} \$\{itemCount === 1 \? 'item' : 'items'\}` : 'Cart'\}/);
});

/* ── Tulsi Fashion Jewellery: the footer's links and wording ── */

const footerLinks = (html, heading) => {
  const from = html.indexOf(`>${heading}</h3>`);
  assert.ok(from >= 0, `${heading} column`);
  const end = html.indexOf('</ul>', from);
  return [...html.slice(from, end).matchAll(/<a href="([^"]*)"[^>]*>(?:<svg[^>]*><\/svg>)?([^<]*)<\/a>/g)]
    .map((m) => [m[2].replace(/&amp;/g, '&'), m[1].replace(/&amp;/g, '&')]);
};

test('footer: quick links are the header’s eight destinations in order, then My Account and the seller page — no rentals or catalogue', { skip }, () => {
  const html = renderToString(React.createElement(loadFooter(null)));
  const links = footerLinks(html, 'Quick Links');
  assert.deepEqual(links.slice(0, 8), NAV_LINKS.map((l) => [l.label, l.href]));
  assert.deepEqual(links.slice(8), [['My Account', '/account'], ['Become a Vendor / Seller Application', '/become-a-vendor']]);
  assert.doesNotMatch(html, /rental|rent jewellery|catalogue|href="\/shop"/i);
});

test('footer: categories lead with Chains & Necklaces, Earrings and Anklets, and every one is a real catalogue category', { skip }, () => {
  const html = renderToString(React.createElement(loadFooter(null)));
  const cats = footerLinks(html, 'Categories');
  assert.deepEqual(cats.slice(0, 3), [
    ['Chains & Necklaces', '/catalog?category=necklace'],
    ['Earrings', '/catalog?category=earrings'],
    ['Anklets', '/catalog?category=anklet'],
  ]);
  const catalog = readFileSync(path.resolve('src/app/catalog/CatalogContent.js'), 'utf8');
  for (const [, href] of cats) assert.match(catalog, new RegExp(`value: '${href.split('=')[1]}'`), `${href} is filterable in the catalogue`);
  assert.doesNotMatch(html, /bridal sets|maang tikka/i);
});

test('footer: Tulsi Fashion Jewellery — wordmark, tagline and copyright (the wordmark does not wait for the settings)', { skip }, () => {
  const markup = (settings) => renderToString(React.createElement(loadFooter(settings))).replace(/<!-- -->/g, '');
  const html = markup(null);
  assert.match(html, />TULSI<\/p>/);
  assert.match(html, />Fashion Jewellery<\/p>/);
  assert.match(html, /Modern fashion jewellery for every day/);
  assert.match(html, /© \d{4} Tulsi Fashion Jewellery\. All rights reserved\./);
  /* The e-mail address is kept as it is (it is the shop's real one); the street-address fallback carries the new name. */
  assert.doesNotMatch(html.replaceAll('tulsibridaljewellery@gmail.com', ''), /bridal/i);
  assert.match(html, /428, Tulsi Fashion Jewellery, Main Bazaar/);
  /* A saved business name changes the copyright line but never the logo's wordmark. */
  const named = markup({ businessName: 'Tulsi Fashion Jewellery Pvt Ltd' });
  assert.match(named, />TULSI<\/p>/);
  assert.match(named, /Tulsi Fashion Jewellery Pvt Ltd\. All rights reserved\./);
});

test('footer: a business name and tagline saved while the store was "Bridal" never show — the new brand does (until the owner saves them again)', { skip }, () => {
  const html = renderToString(React.createElement(loadFooter({ businessName: 'Tulsi Bridal Jewellery', tagline: 'Handcrafted bridal jewellery for brides' }))).replace(/<!-- -->/g, '');
  assert.match(html, /© \d{4} Tulsi Fashion Jewellery\. All rights reserved\./);
  assert.match(html, /Modern fashion jewellery for every day/);
  assert.doesNotMatch(html.replaceAll('tulsibridaljewellery@gmail.com', ''), /bridal/i);
  /* A tagline saved since the rebrand is shown as saved. */
  assert.match(renderToString(React.createElement(loadFooter({ tagline: 'Chains you will live in' }))), /Chains you will live in/);
});
