/* ─────────────────────────────────────────────
   The ₹ glyph without the big latin-extended font files.

   Inter's and Cormorant's main files have no ₹; it is in each font's
   "latin-extended" file (Inter 83 KB, Cormorant 33 KB), which the browser
   downloads in full — behind the CSS, on the critical path — as soon as a
   price is on the page. public/fonts/*-rupee.woff2 carry only that glyph, and
   the font stacks list them first. These tests pin the wiring (the files were
   cut with fontTools and checked: one glyph, weight axis kept).

   Run: npm test
   ───────────────────────────────────────────── */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const read = (p) => readFileSync(path.resolve(p), 'utf8');
const require = createRequire(import.meta.url);
const FILES = ['inter-rupee', 'cormorant-rupee', 'cormorant-italic-rupee'];

test('the three rupee fonts exist, are real woff2 files, and are tiny (one glyph)', () => {
  for (const f of FILES) {
    const file = path.resolve(`public/fonts/${f}.woff2`);
    const head = readFileSync(file).subarray(0, 4).toString('latin1');
    assert.equal(head, 'wOF2', f);
    assert.ok(statSync(file).size < 3 * 1024, `${f} is ${statSync(file).size} bytes — more than one glyph?`);
  }
});

test('globals.css: each face covers U+20B9 only, swaps, and keeps the weight range of its font', () => {
  const css = read('src/app/globals.css');
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.equal(faces.length, 3);
  for (const f of faces) {
    assert.match(f, /unicode-range:\s*U\+20B9\s*;/, 'only the rupee sign — every other character stays on the real font');
    assert.match(f, /font-display:\s*swap/);
    assert.match(f, /url\('\/fonts\/(inter|cormorant|cormorant-italic)-rupee\.woff2'\) format\('woff2'\)/);
  }
  const inter = faces.find((f) => /Inter Rupee/.test(f));
  assert.match(inter, /font-weight:\s*100 900/);
  const cormorant = faces.filter((f) => /Cormorant Rupee/.test(f));
  assert.deepEqual(cormorant.map((f) => /font-style:\s*(\w+)/.exec(f)[1]).sort(), ['italic', 'normal']);
  assert.ok(cormorant.every((f) => /font-weight:\s*300 700/.test(f)));
});

test('tailwind: the rupee face comes first in the sans / serif / display stacks, the real font right after it', () => {
  const { theme } = require(path.resolve('tailwind.config.js'));
  const stacks = theme.extend.fontFamily;
  assert.deepEqual(stacks.sans.slice(0, 2), ['"Inter Rupee"', 'Inter']);
  assert.deepEqual(stacks.serif.slice(0, 2), ['"Cormorant Rupee"', '"Cormorant Garamond"']);
  assert.deepEqual(stacks.display.slice(0, 2), ['"Cormorant Rupee"', '"Cormorant Garamond"']);
});

test('layout: the two faces the first screen uses are preloaded with the document (not discovered behind the CSS)', () => {
  const layout = read('src/app/layout.js');
  assert.match(layout, /import \{ preload \} from 'react-dom'/);
  assert.match(layout, /for \(const file of \['inter-rupee', 'cormorant-rupee'\]\) preload\(`\/fonts\/\$\{file\}\.woff2`, \{ as: 'font', type: 'font\/woff2', crossOrigin: 'anonymous' \}\)/);
});

test('next.config: /fonts/* is cached for a year (Next would otherwise send max-age=0 for public/ files)', async () => {
  const { default: config } = await import(path.resolve('next.config.mjs'));
  const rules = await config.headers();
  const fonts = rules.find((r) => r.source === '/fonts/:file*');
  assert.ok(fonts, 'a rule for /fonts');
  assert.deepEqual(fonts.headers, [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }]);
  /* …and the security headers still apply to everything. */
  assert.ok(rules.find((r) => r.source === '/:path*')?.headers.some((h) => h.key === 'X-Content-Type-Options'));
});
