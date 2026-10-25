import HomeClient from './HomeClient';
import { absoluteUrl } from '@/lib/seo';
import { getDB, docToObj } from '@/lib/firebase';
import { pickHeroSlides, pickShipping } from '@/lib/heroSlides';
import { normalizeShowcase } from '@/lib/categoryShowcase';
import { getStoreCharges } from '@/lib/storeChargesServer';

/* Server wrapper so the homepage has its own canonical and description
   (a client page can't export metadata). */
export const metadata = {
  alternates: { canonical: absoluteUrl('/') },
  openGraph: { url: absoluteUrl('/') },
};

/* Pre-rendered with the hero photo in the HTML, then rebuilt in the
   background at most every 5 minutes (the first visit after that still gets
   the old copy instantly). Saving the site settings drops the copy at once
   (revalidatePath in api/admin/settings), so the 5 minutes only covers a
   change made some other way — the shipping rule (settings/store_settings)
   is one: the hero's first badge shows it from the first paint, and the live
   charges the browser fetches take over from there. */
export const revalidate = 300;

/* Production after the build: a failed read must fail this render. Next keeps
   serving the last good page when a background rebuild throws (and retries
   within 30 s); a render that "succeeds" with no slides would instead replace
   it with the gradient default for 5 minutes. During `next build` and in dev
   there is no good page to protect, so a failed read just means "no data" and
   the page still renders. */
const keepLastGoodPage = () => process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build';

/* What the homepage draws from the site settings, as plain objects for
   HomeClient:
   - heroSlides: an array (empty when none are set);
   - showcase: the normalized category showcase (cards, order, layout);
   - shipping: the shipping rule behind the hero's first badge (always a rule —
     a missing document means the defaults, which is what the checkout uses);
   - or null when the settings could not be read, so the browser decides from
     its own fetch.
   (Not getSiteSettings(): it turns an error into {} and so can't tell
   "no slides" from "Firestore is down".) */
async function loadHomeSettings() {
  try {
    const db = getDB();
    const [doc, charges] = await Promise.all([db.collection('settings').doc('site').get(), getStoreCharges(db)]);
    const settings = doc.exists ? docToObj(doc) : {};
    return { heroSlides: pickHeroSlides(settings?.heroSlides), showcase: normalizeShowcase(settings), shipping: pickShipping(charges) };
  } catch (err) {
    if (keepLastGoodPage()) throw err;
    return null;
  }
}

export default async function HomePage() {
  const home = await loadHomeSettings();
  return <HomeClient heroSlides={home?.heroSlides ?? null} showcase={home?.showcase ?? null} shipping={home?.shipping ?? null} />;
}
