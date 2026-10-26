/* The Marketing tab's accordion: every card shows only its name until it is opened. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
let sucrase = null;
try { sucrase = require('sucrase'); } catch { /* skipped below */ }
const skip = sucrase ? false : 'sucrase is not installed, so the component cannot be transpiled for node --test';
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(rel, deps) {
  const file = path.resolve(rel);
  const { code } = sucrase.transform(readFileSync(file, 'utf8'), { transforms: ['jsx', 'imports'], jsxRuntime: 'automatic', production: true, filePath: file });
  const all = { 'react/jsx-runtime': require('react/jsx-runtime'), ...deps };
  const mod = { exports: {} };
  vm.runInThisContext(`(function (exports, require, module) {${code}\n})`, { filename: file })(mod.exports, (id) => {
    if (!Object.hasOwn(all, id)) throw new Error(`${rel} imports ${id}: add a stub for it in this test`);
    return all[id];
  }, mod);
  return mod.exports;
}
const Chevron = (props) => React.createElement('svg', { 'data-icon': 'FiChevronDown', ...props });
const CollapsibleSection = sucrase ? load('src/components/admin/marketing/CollapsibleSection.jsx', { react: React, 'react-icons/fi': { FiChevronDown: Chevron } }).default : null;
const render = (props, body = 'BODY-CONTENT') => renderToStaticMarkup(React.createElement(CollapsibleSection, props, React.createElement('div', null, body)));

describe('CollapsibleSection', { skip }, () => {
  test('closed by default: the name and status are there, the features are not', () => {
    const h = render({ title: 'Instagram Feed', status: '2 of 6 posts' });
    assert.match(h, /Instagram Feed/);
    assert.match(h, /2 of 6 posts/);
    assert.match(h, /aria-expanded="false"/);
    assert.doesNotMatch(h, /BODY-CONTENT/, 'the body is not even mounted until it is opened');
  });

  test('the header is one real button that names and controls its region', () => {
    const h = render({ title: 'Hero', defaultOpen: true });
    const btn = h.match(/<button [^>]*>/)[0];
    assert.match(btn, /type="button"/);
    const controls = btn.match(/aria-controls="([^"]+)"/)[1];
    const id = btn.match(/ id="([^"]+)"/)[1];
    assert.match(h, new RegExp(`<div id="${controls.replace(/[:]/g, '\\$&')}" role="region" aria-labelledby="${id.replace(/[:]/g, '\\$&')}"`));
    assert.match(btn, /min-h-14/, 'a big enough tap target');
    assert.match(btn, /focus-visible:ring-amber-600/, 'a visible keyboard focus');
  });

  test('defaultOpen shows the features', () => {
    const h = render({ title: 'Hero', defaultOpen: true });
    assert.match(h, /BODY-CONTENT/);
    assert.match(h, /aria-expanded="true"/);
    assert.doesNotMatch(h, /<div[^>]*role="region"[^>]*hidden/);
  });

  test('unsaved changes show a dot with a screen-reader label; nothing otherwise', () => {
    assert.match(render({ title: 'Hero', dirty: true }), /Unsaved changes/);
    assert.doesNotMatch(render({ title: 'Hero' }), /Unsaved changes/);
  });

  test('the wrapped card is flattened and its own heading is kept for screen readers only', () => {
    const h = render({ title: 'Hero', defaultOpen: true });
    /* (React escapes & and > inside the class attribute.) */
    assert.match(h, /\[&amp;&gt;\*\]:!border-0/);
    assert.match(h, /\[&amp;_h2\]:sr-only/);
    assert.match(render({ title: 'Hero', defaultOpen: true, flatten: false }), /^(?!.*sr-only).*$/s);
  });
});

describe('the Marketing tab', () => {
  const page = readFileSync('src/app/admin/settings/page.js', 'utf8');
  test('every Marketing card is an accordion section', () => {
    const marketing = page.slice(page.indexOf('function renderMarketing()'), page.indexOf('function renderSocialEmail()'));
    const titles = [...marketing.matchAll(/<CollapsibleSection title="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(titles, ['Welcome Offer Bar', 'Delivery Message', 'Homepage Hero Photo', 'Category Showcase', 'Happy Customers (Testimonials)', 'Instagram Feed']);
    assert.equal((marketing.match(/<\/CollapsibleSection>/g) || []).length, titles.length);
    assert.doesNotMatch(marketing, /defaultOpen/, 'all closed on load');
  });
});
