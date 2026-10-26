/* ─────────────────────────────────────────────
   Server-only reader of the website advertisements (settings/site.advertisements)
   for the pages that draw an <AdSlot>: shop, catalog, product, cart, checkout,
   order-success, track-order and the home page.

   Those pages are pre-rendered and rebuilt in the background every few minutes
   (`export const revalidate = 300`), several of them in the same moment, and a
   product page is rebuilt per product — so one Firestore read is shared for 60
   seconds instead of one per page. Saving the settings drops it at once
   (clearAdvertisementsCache, called by api/admin/settings) so the rebuild that
   follows the save reads the new ads.

   It never throws: ads are decoration, and a page must not fail — or lose its
   products — because the ads could not be read. A failed read gives "no ads"
   (and is not remembered for long, so the next render tries again).
   ───────────────────────────────────────────── */
import { getDB } from '@/lib/firebase';
import { normalizeAdvertisements, emptyAds } from '@/lib/marketing';

export const ADS_CACHE_MS = 60 * 1000;
/* A read that failed is remembered only briefly: long enough that a Firestore outage is not hit by
   every request of a busy page, short enough that the ads come back with it. */
export const ADS_FAILURE_CACHE_MS = 5 * 1000;

let cached = null; // { value, until }
let inflight = null; // the read in progress, shared by everyone who asks meanwhile
let generation = 0; // bumped by clearAdvertisementsCache: a read that started before it must not be cached

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

async function readAds() {
  try {
    const snap = await getDB().collection('settings').doc('site').get();
    const data = snap.exists ? snap.data() : null;
    return { value: deepFreeze(normalizeAdvertisements(data && data.advertisements)), ttl: ADS_CACHE_MS };
  } catch (err) {
    if (process.env.NODE_ENV === 'production') console.warn('[ads] could not read the advertisements:', err && err.message);
    return { value: deepFreeze(emptyAds()), ttl: ADS_FAILURE_CACHE_MS };
  }
}

/**
 * The advertisements as the storefront should draw them: `{ layout, items }`, normalized
 * (every ad, shown or not — pick a page's with adsForPlacement from src/lib/marketing.js).
 * Cached for 60 seconds; the same, frozen object while it is — never change it. Never throws.
 * @returns {Promise<ReturnType<typeof normalizeAdvertisements>>}
 */
export async function getAdvertisements() {
  if (cached && cached.until > Date.now()) return cached.value;
  if (!inflight) {
    const started = generation;
    const read = readAds()
      .then((r) => {
        if (started === generation) cached = { value: r.value, until: Date.now() + r.ttl };
        return r.value;
      })
      .finally(() => { if (inflight === read) inflight = null; });
    inflight = read;
  }
  return inflight;
}

/** Forget the remembered ads (the admin just saved; also for tests). The next call reads again. */
export function clearAdvertisementsCache() {
  cached = null;
  inflight = null;
  generation += 1;
}
