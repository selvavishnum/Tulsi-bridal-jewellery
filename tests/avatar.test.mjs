/* ─────────────────────────────────────────────
   Customer avatars (Happy Customers + the admin testimonial editor):
   src/lib/avatar.js, the CustomerAvatar component rendered with the real
   React, and the settings save keeping only usable photo links.

   Run: npm test
   ───────────────────────────────────────────── */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { fakeFirestore } from './helpers/fakeFirestore.mjs';
import * as avatarLib from '../src/lib/avatar.js';

const { avatarUrl, isUsableImageUrl, isCloudinaryUpload, initialOf, AVATAR_PX } = avatarLib;
const require = createRequire(import.meta.url);
const CLD = 'https://res.cloudinary.com/djolb5idc/image/upload/v1712345678/tulsi-bridal/testimonials/vishalini.jpg';

/* ── src/lib/avatar.js ── */

test('avatarUrl: Cloudinary uploads get the face-centred, round, retina crop', () => {
  assert.equal(AVATAR_PX, 200);
  assert.equal(
    avatarUrl(CLD),
    'https://res.cloudinary.com/djolb5idc/image/upload/c_fill,g_face,w_200,h_200,r_max,q_auto:best,f_auto/v1712345678/tulsi-bridal/testimonials/vishalini.jpg',
  );
  assert.match(avatarUrl(CLD, 96), /c_fill,g_face,w_96,h_96,r_max,q_auto:best,f_auto\//);
  assert.match(avatarUrl(CLD, 5), /w_32,h_32/, 'clamped to a sensible minimum');
  assert.match(avatarUrl(CLD, 99999), /w_800,h_800/, 'and maximum');
});

test('avatarUrl: other https images pass through; unusable links give "" (the initial shows)', () => {
  assert.equal(avatarUrl('https://images.unsplash.com/photo-1.jpg'), 'https://images.unsplash.com/photo-1.jpg');
  for (const bad of ['', null, undefined, 'https://collection', 'https://', 'http://res.cloudinary.com/x/image/upload/a.jpg',
    'javascript:alert(1)', 'data:image/png;base64,AAAA', '/uploads/a.jpg', 'https://exa mple.com/a.jpg', `https://x.com/${'a'.repeat(700)}`]) {
    assert.equal(avatarUrl(bad), '', String(bad));
    assert.equal(isUsableImageUrl(bad), false, String(bad));
  }
  /* A truncated link can still look like a real host ("collection.cloudi"):
     it is tried, and the component falls back to the initial when it fails
     to load (onError / an already-failed image on hydration). */
  assert.equal(avatarUrl('https://collection.cloudi'), 'https://collection.cloudi');
  /* Cloudinary share pages (the link that broke the avatar) are not images. */
  for (const page of ['https://collection.cloudinary.com/djolb5idc/abc123', 'https://console.cloudinary.com/x', 'https://cloudinary.com/x.jpg']) {
    assert.equal(avatarUrl(page), '', page);
  }
  assert.equal(isCloudinaryUpload(CLD), true);
  assert.equal(isCloudinaryUpload('https://res.cloudinary.com/x/video/upload/a.mp4'), false);
});

test('initialOf: first letter of the name, uppercased; a star for no name', () => {
  assert.equal(initialOf('Vishalini'), 'V');
  assert.equal(initialOf('  priya sharma'), 'P');
  assert.equal(initialOf('விஷாலினி'), 'வ');
  assert.equal(initialOf(''), '★');
  assert.equal(initialOf(null), '★');
});

/* ── CustomerAvatar (rendered) ── */

let sucrase = null;
try { sucrase = require('sucrase'); } catch { /* skipped below */ }
const skip = sucrase ? false : 'sucrase is not installed, so CustomerAvatar.jsx cannot be transpiled for node --test';
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function loadAvatar() {
  const file = path.resolve('src/components/ui/CustomerAvatar.jsx');
  const { code } = sucrase.transform(readFileSync(file, 'utf8'), {
    transforms: ['jsx', 'imports'], jsxRuntime: 'automatic', production: true, filePath: file,
  });
  const deps = { react: React, 'react/jsx-runtime': require('react/jsx-runtime'), '@/lib/avatar': avatarLib };
  const req = (id) => {
    if (!Object.hasOwn(deps, id)) throw new Error(`CustomerAvatar.jsx imports ${id}: add a stub`);
    return deps[id];
  };
  const mod = { exports: {} };
  vm.runInThisContext(`(function (exports, require, module) {${code}\n})`, { filename: file })(mod.exports, req, mod);
  return mod.exports.default;
}
const CustomerAvatar = sucrase ? loadAvatar() : null;
function render(props) {
  const warnings = [];
  const orig = console.error;
  console.error = (...a) => { warnings.push(a.map(String).join(' ')); };
  let html;
  try { html = renderToStaticMarkup(React.createElement(CustomerAvatar, props)); } finally { console.error = orig; }
  assert.deepEqual(warnings, [], 'React warned while rendering');
  return html;
}

test('CustomerAvatar: a Cloudinary photo renders as a round, face-cropped <img> of the asked size', { skip }, () => {
  const html = render({ name: 'Vishalini', photo: CLD, size: 56 });
  assert.match(html, /<img /);
  assert.match(html, /c_fill,g_face,w_200,h_200,r_max,q_auto:best,f_auto/);
  assert.match(html, /alt="Vishalini"/);
  assert.match(html, /width="56"/);
  assert.match(html, /rounded-full/);
});

test('CustomerAvatar: no photo or a broken link → the initial badge (gold ring, burgundy disc), never an <img>', { skip }, () => {
  for (const photo of ['', undefined, 'https://collection', 'not a url']) {
    const html = render({ name: 'Vishalini', photo, size: 56 });
    assert.doesNotMatch(html, /<img/, String(photo));
    assert.match(html, />V</);
    assert.match(html, /bg-wine-800/);
    assert.match(html, /ring-gold-400/);
    assert.match(html, /role="img"/);
    assert.match(html, /aria-label="Vishalini"/);
  }
  assert.match(render({ name: '', photo: '' }), />★</);
});

/* ── Settings save keeps only usable photo links ── */

process.env.ADMIN_EMAILS = 'owner@tulsi.test';
delete process.env.NEXT_PUBLIC_ADMIN_BYPASS;
const src = (p) => pathToFileURL(path.resolve('src', p)).href;
let db;
let session = null;
const getServerSession = async () => session;
mock.module('next-auth', { defaultExport: { getServerSession }, namedExports: { getServerSession } });
mock.module(src('app/api/auth/[...nextauth]/route.js'), { namedExports: { authOptions: {} } });
mock.module(src('lib/firebase.js'), {
  namedExports: {
    getDB: () => db,
    docToObj: (d) => (d.exists ? { id: d.id, ...d.data() } : null),
    snapshotToArr: (snap) => snap.docs.map((d) => ({ id: d.id, _id: d.id, ...d.data() })),
    FieldValue: { increment: (n) => n },
  },
});
const settingsRoute = await import(src('app/api/admin/settings/route.js'));

beforeEach(() => {
  db = fakeFirestore({ settings: { site: { phone: '+91 76958 68787' } } });
  session = null;
});

test('settings save: a testimonial photo is kept only when it is a usable https link', async () => {
  session = { user: { id: 'owner', email: 'owner@tulsi.test' } };
  const testimonials = [
    { name: 'Vishalini', rating: 5, review: 'Loved it', photo: CLD },
    { name: 'Priya', rating: 5, review: 'Beautiful', photo: 'https://collection.cloudinary.com/djolb5idc/7c1e9a' },
    { name: 'Anitha', rating: 5, review: 'Great', photo: 'javascript:alert(1)' },
    { name: 'Deepa', rating: 4, review: 'Nice', photo: '' },
  ];
  const res = await settingsRoute.POST(new Request('http://tulsi.test/api/admin/settings', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ testimonials }),
  }));
  assert.equal(res.status, 200);
  const saved = db.store.get('settings').get('site').testimonials;
  assert.deepEqual(saved.map((t) => t.photo), [CLD, '', '', '']);
  assert.deepEqual(saved.map((t) => t.name), ['Vishalini', 'Priya', 'Anitha', 'Deepa'], 'everything else kept');
  assert.equal(db.store.get('settings').get('site').phone, '+91 76958 68787', 'other settings untouched');
});

test('settings save: still owner-only', async () => {
  const res = await settingsRoute.POST(new Request('http://tulsi.test/api/admin/settings', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ testimonials: [] }),
  }));
  assert.equal(res.status, 403);
});
