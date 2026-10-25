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
