/* ─────────────────────────────────────────────
   The Marketing tab through the REAL settings route handlers:
     POST /api/admin/settings   (the page's Save: only validated fields are stored)
     GET  /api/admin/settings   (public: what the storefront reads)

   Only the edges are swapped out (as in delivery-message-api.test.mjs): the
   NextAuth session, the nextauth route's authOptions, Firestore (in-memory fake)
   and next/cache (to see which cached pages a save drops). requireAdmin →
   requireRole is the production code path.

   The pure rules:                    tests/marketing.test.mjs
   The server-side ads reader/cache:  tests/marketing-server.test.mjs

   Run: npm test
   ───────────────────────────────────────────── */
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeFirestore } from './helpers/fakeFirestore.mjs';

process.env.ADMIN_EMAILS = 'owner@tulsi.test';
delete process.env.NEXT_PUBLIC_ADMIN_BYPASS;

const src = (p) => pathToFileURL(path.resolve('src', p)).href;
let db;
let session = null;
const signInAs = (email) => { session = email ? { user: { id: `uid-${email}`, email } } : null; };
const getServerSession = async () => session;
const revalidated = []; // what revalidatePath was asked, and what had been stored by then
let revalidateImpl = () => {};

mock.module('next-auth', { defaultExport: { getServerSession }, namedExports: { getServerSession } });
mock.module(src('app/api/auth/[...nextauth]/route.js'), { namedExports: { authOptions: {} } });
mock.module(src('lib/firebase.js'), {
  namedExports: {
    getDB: () => db,
    FieldValue: { increment: (n) => n, serverTimestamp: () => new Date().toISOString() },
    docToObj: (d) => (d.exists ? { id: d.id, ...d.data() } : null),
    snapshotToArr: (snap) => snap.docs.map((d) => ({ id: d.id, _id: d.id, ...d.data() })),
  },
});
mock.module('next/cache', {
  namedExports: {
    revalidatePath: (...args) => {
      revalidated.push({ args, site: structuredClone(db.store.get('settings')?.get('site')) });
      return revalidateImpl(...args);
    },
  },
});

const settingsRoute = await import(src('app/api/admin/settings/route.js'));
const marketing = await import(src('lib/marketing.js'));
const server = await import(src('lib/marketingServer.js'));
const { normalizeAdvertisements, normalizeMarketing, adsForPlacement, SECTIONS, PLACEMENTS, LIMITS } = marketing;
const { normalizeDeliveryMessage } = await import(src('lib/deliveryMessage.js'));

const OWNER = 'owner@tulsi.test';
const CLD = (name) => `https://res.cloudinary.com/tulsi/image/upload/v17/tulsi-bridal/marketing/${name}.jpg`;
const clone = (v) => JSON.parse(JSON.stringify(v));
const LEGACY_SLIDE = {
  id: '1', imageUrl: CLD('hero'), tag: 'New Bridal Collection', title: 'Temple Bride', subtitle: 'Jewellery Crafted for Brides',
  ctaText: 'Shop Collection', ctaLink: '/shop', cta2Text: 'Book Rental', cta2Link: '/rentals',
};
const AD = (over = {}) => ({
  id: 'a1', isActive: true, image: CLD('ad1'), focus: { gravity: 'auto', x: 50, y: 50, zoom: 1 }, link: '/shop',
  title: 'Festive sale', buttonText: 'Shop now', placements: ['home', 'shop'], ...over,
});

beforeEach(() => {
  session = null;
  revalidated.length = 0;
  revalidateImpl = () => {};
  server.clearAdvertisementsCache();
  db = fakeFirestore({
    staff: { biz: { email: 'biz@tulsi.test', role: 'BUSINESS_MANAGER', status: 'Active', roleGrantedBy: OWNER } },
    settings: { site: { phone: '+91 76958 68787', heroSlides: [{ id: 'old', imageUrl: CLD('old') }] } },
  });
});

const site = () => db.store.get('settings')?.get('site');
async function post({ body, raw } = {}) {
  const request = new Request('http://tulsi.test/api/admin/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw !== undefined ? raw : JSON.stringify(body),
  });
  const res = await settingsRoute.POST(request);
  return { status: res.status, json: await res.json() };
}
const publicGet = async () => {
  const res = await settingsRoute.GET();
  return { status: res.status, json: await res.json() };
};

/* ── Each key is sanitised ── */

test('heroSlides + heroLayout: photos are https (or a path), the list is capped at 6, the layout is complete; the old slider fields a slide was saved with stay', async () => {
  signInAs(OWNER);
  const slides = [
    LEGACY_SLIDE,
    { id: '2', imageUrl: 'javascript:alert(1)', isActive: false },
    { id: '3', imageUrl: '/images/hero.jpg', focus: { gravity: 'custom', x: 30, y: 70, zoom: 1.5 } },
    null, 'oops', 7,
    ...Array.from({ length: 8 }, (_, i) => ({ id: `x${i}`, imageUrl: CLD(`x${i}`), onclick: 'alert(1)', internalNote: 'private' })),
  ];
  const res = await post({ body: { heroSlides: slides, heroLayout: { layoutVariant: 'wide', displayMode: 'slider', junk: 1 } } });
  assert.equal(res.status, 200);
  assert.equal(res.json.success, true);
  const stored = site().heroSlides;
  assert.equal(stored.length, 6);
  assert.deepEqual(stored[0], LEGACY_SLIDE, 'stored untouched');
  assert.deepEqual(stored[1], { id: '2', imageUrl: '', isActive: false });
  assert.deepEqual(stored[2], { id: '3', imageUrl: '/images/hero.jpg', focus: { gravity: 'custom', x: 30, y: 70, zoom: 1.5 } });
  assert.deepEqual(stored[3], { id: 'x0', imageUrl: CLD('x0') }, 'unknown fields are not stored');
  assert.deepEqual(site().heroLayout, { layoutVariant: 'wide', displayMode: 'slider', size: 'large' });
  assert.ok(!JSON.stringify(site().heroSlides).match(/onclick|internalNote|javascript/));
});

test('testimonials + testimonialsLayout: a photo is kept only when it is a usable https link, text is plain, at most 50, `text` becomes `review`', async () => {
  signInAs(OWNER);
  const reviews = [
    { name: 'Vishalini', rating: 5, review: 'Loved it', photo: CLD('v') },
    { name: '<b>Priya</b>', location: '<i>Chennai</i>', rating: 9, review: 'Beautiful', photo: 'https://collection.cloudinary.com/djolb5idc/7c1e9a' },
    { name: 'Anitha', rating: 4, text: 'Words in the old field', photo: 'javascript:alert(1)' },
    { name: 'Deepa', rating: 'abc', review: 'Nice', photo: '', isActive: false, focus: { gravity: 'face' } },
    ...Array.from({ length: 60 }, (_, i) => ({ name: `N${i}`, review: 'ok' })),
  ];
  const res = await post({ body: { testimonials: reviews, testimonialsLayout: { layoutVariant: 'square', displayMode: 'slider', size: 'small' } } });
  assert.equal(res.status, 200);
  const stored = site().testimonials;
  assert.equal(stored.length, 50);
  assert.deepEqual(stored.slice(0, 4).map((t) => t.photo), [CLD('v'), '', '', '']);
  assert.deepEqual(stored.slice(0, 4).map((t) => t.name), ['Vishalini', 'Priya', 'Anitha', 'Deepa']);
  assert.deepEqual(stored.slice(0, 4).map((t) => t.rating), [5, 5, 4, 5]);
  assert.equal(stored[1].location, 'Chennai');
  assert.equal(stored[2].review, 'Words in the old field');
  assert.ok(!('text' in stored[2]));
  assert.equal(stored[3].isActive, false);
  assert.deepEqual(stored[3].focus, { gravity: 'face', x: 50, y: 50, zoom: 1 });
  assert.deepEqual(site().testimonialsLayout, { layoutVariant: 'square', displayMode: 'slider', size: 'small' });
});

test('instagramFeed + instagramLayout: at most 6, https photos and post links, plain captions', async () => {
  signInAs(OWNER);
  const posts = Array.from({ length: 9 }, (_, i) => ({
    imageUrl: CLD(`ig${i}`), caption: `<b>c${i}</b>`, postUrl: i === 0 ? 'javascript:alert(1)' : `https://www.instagram.com/p/${i}/`,
  }));
  const res = await post({ body: { instagramFeed: posts, instagramLayout: { layoutVariant: 'circle', displayMode: 'grid', size: 'medium' } } });
  assert.equal(res.status, 200);
  const stored = site().instagramFeed;
  assert.equal(stored.length, 6);
  assert.equal(stored[0].postUrl, '');
  assert.equal(stored[1].postUrl, 'https://www.instagram.com/p/1/');
  assert.deepEqual(stored.map((p) => p.caption), ['c0', 'c1', 'c2', 'c3', 'c4', 'c5']);
  assert.deepEqual(site().instagramLayout, { layoutVariant: 'circle', displayMode: 'grid', size: 'medium' });
});

test('advertisements: links, photos and texts are validated, at most 12 ads, placements are known pages, no unknown fields', async () => {
  signInAs(OWNER);
  const items = [
    AD({ id: 'good' }),
    AD({ id: 'evil-link', link: 'javascript:alert(1)' }),
    AD({ id: 'proto-rel', link: '//evil.com/x' }),
    AD({ id: 'http-img', image: 'http://x.example.com/a.jpg' }),
    AD({ id: 'markup', title: '<script>alert(1)</script>Big <b>sale</b>', buttonText: '<img src=x onerror=alert(1)>Go' }),
    AD({ id: 'long', title: 'T'.repeat(200), buttonText: 'B'.repeat(200) }),
    AD({ id: 'pages', placements: ['cart', 'shop', 'shop', 'nowhere', 'track-order'] }),
    { id: 'extra', image: CLD('e'), onclick: 'alert(1)', html: '<b>x</b>' },
    ...Array.from({ length: 10 }, (_, i) => AD({ id: `n${i}` })),
  ];
  const res = await post({ body: { advertisements: { layout: { layoutVariant: 'square', displayMode: 'grid', size: 'small' }, items } } });
  assert.equal(res.status, 200);
  const { layout, items: stored } = site().advertisements;
  assert.deepEqual(layout, { layoutVariant: 'square', displayMode: 'grid', size: 'small' });
  assert.equal(stored.length, 12);
  const by = Object.fromEntries(stored.map((a) => [a.id, a]));
  assert.deepEqual(by.good, AD({ id: 'good' }));
  assert.equal(by['evil-link'].link, '');
  assert.equal(by['proto-rel'].link, '');
  assert.equal(by['http-img'].image, '');
  assert.equal(by.markup.title, 'alert(1)Big sale');
  assert.equal(by.markup.buttonText, 'Go');
  assert.equal(by.long.title.length, LIMITS.adTitle);
  assert.equal(by.long.buttonText.length, LIMITS.adButton);
  assert.deepEqual(by.pages.placements, ['shop', 'cart', 'track-order']);
  assert.ok(!('onclick' in by.extra) && !('html' in by.extra));
  assert.ok(!JSON.stringify(site().advertisements).match(/[<>]|javascript:|onerror|evil\.com/));
  /* what the storefront reads back is what the owner sent, cleaned */
  assert.deepEqual(normalizeAdvertisements(site().advertisements), normalizeAdvertisements({ layout: { layoutVariant: 'square', displayMode: 'grid', size: 'small' }, items }));
  assert.deepEqual(site().advertisements.items.at(-1), { id: 'n3', isActive: true, image: CLD('ad1'), focus: { gravity: 'auto', x: 50, y: 50, zoom: 1 }, link: '/shop', title: 'Festive sale', buttonText: 'Shop now', placements: ['home', 'shop'] });
});

test('a full-page Save (all seven Marketing keys, as the settings page sends them) stores each one, keeps the unrelated keys, ignores categoryShowcase', async () => {
  signInAs(OWNER);
  const normalised = normalizeMarketing({
    heroSlides: [LEGACY_SLIDE], testimonials: [{ name: 'A', review: 'B' }], instagramFeed: [{ imageUrl: CLD('i') }],
    advertisements: { items: [AD()] }, heroLayout: { displayMode: 'slider' },
  });
  const res = await post({
    body: {
      phone: '+91 90000 00000', email: 'hello@tulsi.test', showTestimonials: true, announcement: { enabled: true, text: 'Hi' },
      deliveryMessage: { enabled: false, barText: '<b>Free</b>' },
      categoryShowcase: { layout: { layoutVariant: 'circle' }, items: [] },
      ...normalised,
    },
  });
  assert.equal(res.status, 200);
  const s = site();
  assert.equal(s.phone, '+91 90000 00000');
  assert.equal(s.email, 'hello@tulsi.test');
  assert.equal(s.showTestimonials, true);
  assert.deepEqual(s.announcement, { enabled: true, text: 'Hi' });
  assert.deepEqual(s.deliveryMessage, normalizeDeliveryMessage({ enabled: false, barText: '<b>Free</b>' }), 'the delivery message is still normalised');
  assert.doesNotMatch(s.deliveryMessage.barText, /[<>]/);
  assert.ok(!('categoryShowcase' in s), 'the showcase has its own endpoint');
  for (const key of ['heroSlides', 'heroLayout', 'testimonials', 'testimonialsLayout', 'instagramFeed', 'instagramLayout', 'advertisements']) assert.ok(key in s, key);
  assert.deepEqual(s.heroLayout, { layoutVariant: 'king_size', displayMode: 'slider', size: 'large' });
  assert.deepEqual(s.advertisements.items, [AD()]);
  assert.deepEqual(normalizeMarketing(s), normalizeMarketing(normalised), 'stored and read back is the same Marketing tab');
});

/* ── Merge behaviour ── */

test('a save without a Marketing key leaves the stored one alone; a later save replaces a whole list (no stale item survives the merge)', async () => {
  signInAs(OWNER);
  await post({ body: { heroSlides: [LEGACY_SLIDE, { id: '2', imageUrl: CLD('two') }], advertisements: { items: [AD(), AD({ id: 'a2' })] }, heroLayout: { displayMode: 'slider', layoutVariant: 'wide' } } });
  assert.equal((await post({ body: { whatsapp: '917000000000' } })).status, 200);
  assert.equal(site().heroSlides.length, 2);
  assert.equal(site().advertisements.items.length, 2);
  assert.equal(site().heroLayout.layoutVariant, 'wide');
  assert.equal(site().whatsapp, '917000000000');
  await post({ body: { heroSlides: [{ id: '9', imageUrl: CLD('nine') }], advertisements: { items: [AD({ id: 'only' })] }, heroLayout: {} } });
  assert.deepEqual(site().heroSlides.map((s) => s.id), ['9']);
  assert.deepEqual(site().advertisements.items.map((a) => a.id), ['only']);
  assert.deepEqual(site().heroLayout, SECTIONS.hero.defaultLayout, 'a layout is saved whole, not merged field by field');
  await post({ body: { advertisements: { items: [] }, heroSlides: [] } });
  assert.deepEqual(site().advertisements.items, [], 'removing every ad is saved');
  assert.deepEqual(site().heroSlides, []);
});

test('a body from before any of this (today\'s form: the three lists, nothing new) is stored as sent — no defaults added — and reads as today', async () => {
  signInAs(OWNER);
  const body = {
    heroSlides: [LEGACY_SLIDE],
    testimonials: [{ name: 'Priya', location: 'Chennai', rating: 5, review: 'Lovely', photo: '' }],
    instagramFeed: [{ imageUrl: CLD('i'), caption: 'c', postUrl: 'https://instagram.com/p/x' }],
  };
  await post({ body });
  assert.deepEqual(site().heroSlides, body.heroSlides);
  assert.deepEqual(site().testimonials.map(({ name, location, rating, review, photo }) => ({ name, location, rating, review, photo })), body.testimonials);
  assert.deepEqual(site().instagramFeed.map(({ imageUrl, caption, postUrl }) => ({ imageUrl, caption, postUrl })), body.instagramFeed);
  assert.ok(!('heroLayout' in site()) && !('advertisements' in site()), 'nothing was sent, nothing is made up');
  const m = normalizeMarketing(site());
  assert.deepEqual(m.heroLayout, { layoutVariant: 'king_size', displayMode: 'single', size: 'large' });
  assert.equal(m.heroSlides[0].isActive, true);
  assert.deepEqual(m.advertisements.items, []);
});

/* ── Hostile bodies ── */

test('a Marketing key of the wrong type is ignored: what is stored stays, nothing odd is stored', async () => {
  signInAs(OWNER);
  await post({ body: { heroSlides: [LEGACY_SLIDE], advertisements: { items: [AD()] }, heroLayout: { layoutVariant: 'wide' }, testimonials: [{ name: 'A', review: 'B' }] } });
  const before = clone(site());
  for (const bad of [null, '', 'x', '<script>', 7, true, false]) {
    const res = await post({ body: { heroSlides: bad, testimonials: bad, instagramFeed: bad, advertisements: bad, heroLayout: bad, testimonialsLayout: bad, instagramLayout: bad, phone: '1' } });
    assert.equal(res.status, 200, JSON.stringify(bad));
    const now = site();
    for (const key of ['heroSlides', 'testimonials', 'advertisements', 'heroLayout']) assert.deepEqual(now[key], before[key], `${key} after ${JSON.stringify(bad)}`);
    for (const key of ['instagramFeed', 'testimonialsLayout', 'instagramLayout']) assert.ok(!(key in now), key);
    assert.equal(now.phone, '1');
  }
});

test('an empty object for advertisements or a layout is a real (empty) value: no ads / the default layout — only a wrong TYPE is ignored', async () => {
  signInAs(OWNER);
  await post({ body: { advertisements: { items: [AD()] }, heroLayout: { layoutVariant: 'wide' } } });
  await post({ body: { advertisements: {}, heroLayout: {} } });
  assert.deepEqual(site().advertisements, { layout: SECTIONS.ads.defaultLayout, items: [] });
  assert.deepEqual(site().heroLayout, SECTIONS.hero.defaultLayout);
});

test('prototype-pollution-shaped JSON stores nothing it should not, and pollutes nothing', async () => {
  signInAs(OWNER);
  const raw = '{"heroSlides":[{"__proto__":{"imageUrl":"https://evil.example.com/x.jpg"},"constructor":{"prototype":{"polluted":true}},"id":"a","imageUrl":""}],"advertisements":{"__proto__":{"items":[{"id":"evil"}]},"layout":{"__proto__":{"size":"small"},"displayMode":"grid"},"items":[{"id":"a","__proto__":{"image":"https://evil.example.com/y.jpg"},"placements":["shop"]}]},"heroLayout":{"__proto__":{"layoutVariant":"wide"},"size":"medium"}}';
  const res = await post({ raw });
  assert.equal(res.status, 200);
  assert.deepEqual(site().heroSlides, [{ id: 'a', imageUrl: '' }]);
  assert.deepEqual(site().advertisements.layout, { layoutVariant: 'wide', displayMode: 'grid', size: 'large' });
  assert.deepEqual(site().advertisements.items.map((a) => [a.id, a.image]), [['a', '']]);
  assert.deepEqual(site().heroLayout, { layoutVariant: 'king_size', displayMode: 'single', size: 'medium' });
  assert.ok(!JSON.stringify(site()).match(/evil|polluted/));
  assert.equal({}.polluted, undefined);
});

test('the stored Marketing values are plain JSON (they cross the server → client boundary and Firestore)', async () => {
  signInAs(OWNER);
  await post({ body: { heroSlides: [LEGACY_SLIDE], advertisements: { items: [AD()] }, testimonials: [{ name: 'A', review: 'B' }] } });
  for (const key of ['heroSlides', 'advertisements', 'testimonials']) assert.deepEqual(clone(site()[key]), site()[key]);
  assert.equal(Object.getPrototypeOf(site().advertisements), Object.prototype);
});

/* ── Who may save, and what a refused save does ── */

test('only a SUPER_ADMIN can change them, and credentials are still refused (nothing is stored, nothing is dropped from the cache)', async () => {
  const body = { heroSlides: [LEGACY_SLIDE], advertisements: { items: [AD()] }, testimonials: [{ name: 'A', review: 'B' }] };
  for (const who of [null, 'shopper@x.test', 'biz@tulsi.test']) {
    signInAs(who);
    assert.equal((await post({ body })).status, 403, String(who));
  }
  assert.ok(!('advertisements' in site()) && !('testimonials' in site()));
  assert.deepEqual(site().heroSlides, [{ id: 'old', imageUrl: CLD('old') }]);
  signInAs(OWNER);
  for (const key of ['razorpaySecret', 'adminPassword', 'apiKey', 'api_key', 'privateKey', 'accessToken']) {
    const res = await post({ body: { ...body, [key]: 'x' } });
    assert.equal(res.status, 400, key);
    assert.match(res.json.message, /credentials/);
  }
  assert.ok(!('advertisements' in site()) && !('testimonials' in site()), 'a refused save stores nothing');
  assert.deepEqual(revalidated, [], 'and drops nothing from the cache');
});

test('the invalid-JSON and empty-body cases still answer as before', async () => {
  signInAs(OWNER);
  const bad = await post({ raw: '{not json' });
  assert.equal(bad.status, 500);
  assert.equal(bad.json.success, false);
  const empty = await post({ body: {} });
  assert.equal(empty.status, 200);
  assert.ok(!('advertisements' in site()));
  const nul = await post({ raw: 'null' });
  assert.equal(nul.status, 200, 'a null body is an empty save, as it always was');
});

/* ── Which cached pages a save drops ── */

test('a save that carries advertisements drops the home page and every page that has an ad slot — once each, after the write; the product route as a dynamic page', async () => {
  signInAs(OWNER);
  const res = await post({ body: { advertisements: { items: [AD({ id: 'fresh' })] } } });
  assert.equal(res.status, 200);
  assert.deepEqual(revalidated.map((r) => r.args), [
    ['/'], ['/shop'], ['/catalog'], ['/product/[id]', 'page'], ['/cart'], ['/checkout'], ['/order-success'], ['/track-order'],
  ]);
  assert.deepEqual(revalidated.map((r) => r.args[0]), PLACEMENTS.map((p) => p.path), 'exactly the placements\' routes');
  for (const r of revalidated) assert.deepEqual(r.site.advertisements.items.map((a) => a.id), ['fresh'], 'already stored when the page was dropped — the rebuild reads the new ads');
});

test('a save without advertisements (any other tab\'s) drops only the home page, as before', async () => {
  signInAs(OWNER);
  assert.equal((await post({ body: { phone: '1', heroSlides: [LEGACY_SLIDE] } })).status, 200);
  assert.deepEqual(revalidated.map((r) => r.args), [['/']]);
  revalidated.length = 0;
  assert.equal((await post({ body: { advertisements: 'not an object' } })).status, 200);
  assert.deepEqual(revalidated.map((r) => r.args), [['/']], 'an ignored advertisements key changed nothing to drop');
});

test('when revalidatePath throws (no Next request around it) the save still succeeds and is stored; every path was tried', async () => {
  revalidateImpl = () => { throw new Error('Invariant: static generation store missing in revalidatePath /'); };
  signInAs(OWNER);
  const res = await post({ body: { advertisements: { items: [AD()] } } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { success: true, message: 'Settings saved' });
  assert.equal(revalidated.length, PLACEMENTS.length, 'one failure does not stop the others');
  assert.deepEqual(site().advertisements.items, [AD()]);
});

test('a failed write drops nothing from the cache', async () => {
  signInAs(OWNER);
  const real = db.collection.bind(db);
  db.collection = (name) => ({ ...real(name), doc: (id) => ({ ...real(name).doc(id), set: async () => { throw new Error('UNAVAILABLE'); } }) });
  const res = await post({ body: { advertisements: { items: [AD()] } } });
  assert.equal(res.status, 500);
  assert.deepEqual(revalidated, []);
});

test('a save forgets the server\'s 60-second copy of the ads, so the rebuild that follows reads the new ones', async () => {
  signInAs(OWNER);
  db.store.get('settings').get('site').advertisements = { items: [AD({ id: 'before' })] };
  assert.deepEqual((await server.getAdvertisements()).items.map((a) => a.id), ['before']);
  /* a change made behind the cache's back is not seen yet … */
  db.store.get('settings').get('site').advertisements = { items: [AD({ id: 'behind-the-back' })] };
  assert.deepEqual((await server.getAdvertisements()).items.map((a) => a.id), ['before'], 'cached');
  /* … but a save is */
  await post({ body: { advertisements: { items: [AD({ id: 'saved' })] } } });
  assert.deepEqual((await server.getAdvertisements()).items.map((a) => a.id), ['saved']);
});

/* ── What the storefront reads ── */

test('public GET → what a page draws is what the owner saved: the visible ads of that page, in order', async () => {
  signInAs(OWNER);
  await post({
    body: {
      advertisements: {
        layout: { layoutVariant: 'wide', displayMode: 'grid', size: 'medium' },
        items: [AD({ id: 'one', placements: ['shop'] }), AD({ id: 'off', placements: ['shop'], isActive: false }), AD({ id: 'cart-only', placements: ['cart'] }), AD({ id: 'two', placements: ['shop', 'home'] })],
      },
    },
  });
  signInAs(null);
  const pub = await publicGet();
  assert.equal(pub.status, 200);
  const shop = adsForPlacement(pub.json.data.advertisements, 'shop');
  assert.deepEqual(shop.items.map((a) => a.id), ['one', 'two']);
  assert.deepEqual(shop.layout, { layoutVariant: 'wide', displayMode: 'grid', size: 'medium' });
  assert.deepEqual(adsForPlacement(pub.json.data.advertisements, 'cart').items.map((a) => a.id), ['cart-only']);
  assert.deepEqual(adsForPlacement(pub.json.data.advertisements, 'checkout').items, []);
});
