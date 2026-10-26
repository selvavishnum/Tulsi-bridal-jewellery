/* ─────────────────────────────────────────────
   getAdvertisements() (src/lib/marketingServer.js): the server-only reader the
   pages with an <AdSlot> use — one Firestore read shared for 60 seconds, the
   ads normalised, and never an exception.

   The pure rules:           tests/marketing.test.mjs
   The settings API (which forgets the copy on save):  tests/marketing-api.test.mjs

   Run: npm test
   ───────────────────────────────────────────── */
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const src = (p) => pathToFileURL(path.resolve('src', p)).href;

/* A stand-in for the one document the reader asks for: settings/site. */
let site = null; // the document's data, or null = does not exist
let reads = 0;
let failure = null; // 'db' (getDB throws), 'read' (get rejects), 'data' (data() throws)
let gate = null; // a promise the read waits for
mock.module(src('lib/firebase.js'), {
  namedExports: {
    getDB: () => {
      if (failure === 'db') throw new Error('FIREBASE_PROJECT_ID is missing');
      return {
        collection: (name) => ({
          doc: (id) => ({
            get: async () => {
              assert.deepEqual([name, id], ['settings', 'site'], 'the ads live in the site settings');
              reads += 1;
              /* the document as it is when the read STARTS, however long the answer takes */
              const seen = site === null ? null : structuredClone(site);
              if (gate) await gate;
              if (failure === 'read') throw new Error('UNAVAILABLE');
              return {
                exists: seen !== null,
                data: () => {
                  if (failure === 'data') throw new Error('corrupt');
                  return seen;
                },
              };
            },
          }),
        }),
      };
    },
  },
});

const { getAdvertisements, clearAdvertisementsCache, ADS_CACHE_MS, ADS_FAILURE_CACHE_MS } = await import(src('lib/marketingServer.js'));
const { adsForPlacement, emptyAds, normalizeAdvertisements } = await import(src('lib/marketing.js'));

const CLD = (name) => `https://res.cloudinary.com/tulsi/image/upload/v17/tulsi-bridal/marketing/${name}.jpg`;
const AD = (over = {}) => ({ id: 'a1', isActive: true, image: CLD('ad1'), link: '/shop', title: 'Festive sale', buttonText: 'Shop now', placements: ['home', 'shop'], ...over });
const ids = (ads) => ads.items.map((a) => a.id);

beforeEach(() => {
  site = { phone: '1', advertisements: { layout: { layoutVariant: 'wide', displayMode: 'grid', size: 'medium' }, items: [AD()] } };
  reads = 0;
  failure = null;
  gate = null;
  clearAdvertisementsCache();
  mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
});
afterEach(() => {
  mock.timers.reset();
});

test('reads settings/site.advertisements and returns it normalised: every field complete, the layout included', async () => {
  const ads = await getAdvertisements();
  assert.deepEqual(ads, normalizeAdvertisements(site.advertisements));
  assert.deepEqual(ads.layout, { layoutVariant: 'wide', displayMode: 'grid', size: 'medium' });
  assert.deepEqual(ads.items[0].focus, { gravity: 'auto', x: 50, y: 50, zoom: 1 }, 'a stored ad without a crop reads as auto');
  assert.equal(reads, 1);
});

test('whatever is stored is cleaned on the way out: a hostile link, a photo that is not https, markup in a title', async () => {
  site.advertisements = { items: [AD({ id: 'x', link: 'javascript:alert(1)', image: 'http://x.example.com/a.jpg', title: '<img src=x onerror=alert(1)>Sale', placements: ['shop', 'bogus'] })] };
  const [ad] = (await getAdvertisements()).items;
  assert.deepEqual([ad.link, ad.image, ad.title, ad.placements], ['', '', 'Sale', ['shop']]);
});

test('no document, no advertisements field, or junk there → no ads with the default layout', async () => {
  for (const stored of [null, {}, { advertisements: null }, { advertisements: 'x' }, { advertisements: 5 }, { advertisements: { items: 'x' } }]) {
    site = stored;
    clearAdvertisementsCache();
    assert.deepEqual(await getAdvertisements(), emptyAds(), JSON.stringify(stored));
  }
});

test('one read is shared for 60 seconds, then the next call reads again', async () => {
  assert.equal(ADS_CACHE_MS, 60_000);
  const first = await getAdvertisements();
  assert.equal(await getAdvertisements(), first, 'the very same object');
  mock.timers.tick(ADS_CACHE_MS - 1);
  assert.equal(await getAdvertisements(), first, 'still cached one millisecond before');
  assert.equal(reads, 1);
  site.advertisements = { items: [AD({ id: 'changed' })] };
  mock.timers.tick(1);
  assert.deepEqual(ids(await getAdvertisements()), ['changed'], 'expired: the change is seen');
  assert.equal(reads, 2);
});

test('callers that ask while a read is under way share it (one Firestore read, not one per page)', async () => {
  let release;
  gate = new Promise((resolve) => { release = resolve; });
  const asks = [getAdvertisements(), getAdvertisements(), getAdvertisements()];
  release();
  const [a, b, c] = await Promise.all(asks);
  assert.equal(reads, 1);
  assert.equal(a, b);
  assert.equal(b, c);
});

test('clearAdvertisementsCache: the next call reads again; a read that was under way when it was cleared is not remembered', async () => {
  await getAdvertisements();
  site.advertisements = { items: [AD({ id: 'after-save' })] };
  clearAdvertisementsCache();
  assert.deepEqual(ids(await getAdvertisements()), ['after-save']);
  assert.equal(reads, 2);

  /* a save lands while a read is in flight: that read saw the old document and must not be cached over the save */
  clearAdvertisementsCache();
  site.advertisements = { items: [AD({ id: 'old-document' })] };
  let release;
  gate = new Promise((resolve) => { release = resolve; });
  const slow = getAdvertisements();
  site.advertisements = { items: [AD({ id: 'new-document' })] };
  clearAdvertisementsCache();
  gate = null;
  release();
  await slow;
  assert.deepEqual(ids(await getAdvertisements()), ['new-document'], 'not the copy of the read that started before the save');
});

test('it never throws: no database, a failed read, a corrupt document — each is "no ads"', async () => {
  for (const kind of ['db', 'read', 'data']) {
    failure = kind;
    clearAdvertisementsCache();
    const ads = await getAdvertisements();
    assert.deepEqual(ads, emptyAds(), kind);
  }
});

test('a failed read is remembered for only 5 seconds, so the ads come back with Firestore', async () => {
  assert.equal(ADS_FAILURE_CACHE_MS, 5_000);
  failure = 'read';
  assert.deepEqual(await getAdvertisements(), emptyAds());
  assert.deepEqual(await getAdvertisements(), emptyAds());
  assert.equal(reads, 1, 'a busy page does not hammer a failing database');
  failure = null;
  mock.timers.tick(ADS_FAILURE_CACHE_MS - 1);
  assert.deepEqual(await getAdvertisements(), emptyAds());
  assert.equal(reads, 1);
  mock.timers.tick(1);
  assert.deepEqual(ids(await getAdvertisements()), ['a1'], 'recovered');
  assert.equal(reads, 2);
});

test('the answer is frozen (it is shared between requests): changing it fails, and the cache is not damaged', async () => {
  const ads = await getAdvertisements();
  assert.ok(Object.isFrozen(ads) && Object.isFrozen(ads.layout) && Object.isFrozen(ads.items) && Object.isFrozen(ads.items[0]) && Object.isFrozen(ads.items[0].placements));
  assert.throws(() => { ads.items.push({}); }, TypeError);
  assert.throws(() => { ads.items[0].title = 'hacked'; }, TypeError);
  assert.equal((await getAdvertisements()).items[0].title, 'Festive sale');
  assert.ok(Object.isFrozen(await (async () => { failure = 'read'; clearAdvertisementsCache(); return getAdvertisements(); })()), 'the empty answer too');
});

test('a page picks its own ads from it: adsForPlacement works on the frozen cached value', async () => {
  site.advertisements = { items: [AD({ id: 'shop-only', placements: ['shop'] }), AD({ id: 'home-only', placements: ['home'] }), AD({ id: 'off', placements: ['shop'], isActive: false })] };
  const ads = await getAdvertisements();
  assert.deepEqual(ids(adsForPlacement(ads, 'shop')), ['shop-only']);
  assert.deepEqual(ids(adsForPlacement(ads, 'home')), ['home-only']);
  assert.deepEqual(adsForPlacement(ads, 'cart').items, []);
});
