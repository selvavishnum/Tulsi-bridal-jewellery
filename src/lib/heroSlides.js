/* ─────────────────────────────────────────────
   What the homepage reads from the site settings, as plain JSON-safe objects:
   the hero photo, the shipping rule and the owner's delivery message behind the
   hero's first badge, and the customer reviews.

   The homepage is rendered on the server (src/app/page.js) so the hero photo
   is in the HTML the browser receives first, and the same settings are fetched
   again in the browser (HomeClient) to pick up an admin's change. Both sides
   go through this file so a "slide" means the same thing in both places, and
   "is what the server drew still what the settings say?" is a single
   comparison — equal means no state change, so no re-render, no image reload,
   no flash.

   Pure module: safe on the server, in the browser and in tests.
   ───────────────────────────────────────────── */
import { DEFAULT_CHARGES, normalizeCharges } from './storeCharges.js';
import { deliveryMessageFor } from './deliveryMessage.js';

/* The owner's delivery message follows the very same rule as the slides and the showcase:
   pickDeliveryMessage is what the server seeds, nextDeliveryMessage is what the browser
   keeps once its own fetch answers (the same object when nothing changed). They live in
   src/lib/deliveryMessage.js, next to the strip's and the product page's use of it, and are
   re-exported here so the homepage reads everything from the settings through this one file. */
export { pickDeliveryMessage, nextDeliveryMessage } from './deliveryMessage.js';

/* Exactly what the hero reads. The home hero is one editorial photo — the
   first slide that has one (Admin → Settings → Hero). A stored slide also has
   a tag, title, subtitle and two buttons from the old slider; the home page
   no longer draws them, so they stay out of the HTML (they would only add
   bytes to the page for no reason) and an admin edit of one is not a change
   the page has to re-render for. */
export const HERO_SLIDE_FIELDS = Object.freeze(['id', 'imageUrl']);

/**
 * The slides in `value` (settings.heroSlides), trimmed to HERO_SLIDE_FIELDS.
 * Every field is a string ('' when missing), so the result survives the
 * server → client prop boundary (JSON) and `slide.imageUrl.x` can't hit
 * undefined. A malformed entry (null, a string) is dropped rather than
 * crashing the page; a non-array is "no slides".
 *
 * @param {unknown} value
 * @returns {{ id: string, imageUrl: string }[]}
 */
export function pickHeroSlides(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((slide) => slide && typeof slide === 'object')
    .map((slide) => Object.fromEntries(HERO_SLIDE_FIELDS.map((field) => [field, typeof slide[field] === 'string' ? slide[field] : ''])));
}

/** True when two slide lists would draw the same hero (extra stored fields don't count). */
export function sameHeroSlides(a, b) {
  return JSON.stringify(pickHeroSlides(a)) === JSON.stringify(pickHeroSlides(b));
}

/**
 * What the hero should hold once settings arrive.
 *
 * Returns `prev` itself — the same reference — when nothing should change, so
 * React skips the render entirely and the photo already on screen is not
 * touched. That is the case when:
 *  - `incoming` has no slides list (settings never saved one);
 *  - `stale` is set: the list came from the browser's stored copy (up to an
 *    hour old) while the server already put newer slides in the HTML — taking
 *    it would flash an older hero before the fresh fetch put the right one back;
 *  - `incoming` draws the same hero as `prev`.
 * Otherwise the new list, trimmed to what the hero reads.
 *
 * @param {ReturnType<typeof pickHeroSlides>} prev
 * @param {unknown} incoming  settings.heroSlides
 * @param {{ stale?: boolean }} [from]
 */
export function nextHeroSlides(prev, incoming, { stale = false } = {}) {
  if (stale || !Array.isArray(incoming)) return prev;
  return sameHeroSlides(prev, incoming) ? prev : pickHeroSlides(incoming);
}

/* A link a browser can load as the hero image: https (an http image on an https
   page is blocked as mixed content) or a path on this site. Anything else
   ("abc", "javascript:…") would be a broken image. */
export function isImageLink(value) {
  return typeof value === 'string' && /^(https:\/\/\S+|\/(?!\/)\S*)$/i.test(value.trim());
}

/**
 * The hero photo: the first slide that has a usable image link ('' when none
 * does — the hero then draws its own illustration instead of a gap).
 *
 * @param {ReturnType<typeof pickHeroSlides>} slides
 */
export function heroPhotoUrl(slides) {
  const found = (Array.isArray(slides) ? slides : []).find((slide) => slide && isImageLink(slide.imageUrl));
  return found ? found.imageUrl.trim() : '';
}

/**
 * The same rule for the category showcase (already normalized): the very same
 * object when nothing changed, so React skips the render and the tiles on
 * screen are not touched; the new one when the admin changed it.
 *
 * @param {object|null} prev
 * @param {object|null} incoming  normalizeShowcase(settings)
 */
export function nextShowcase(prev, incoming) {
  if (!incoming) return prev;
  return prev && JSON.stringify(prev) === JSON.stringify(incoming) ? prev : incoming;
}

/* ── Shipping rule behind the hero's first trust badge ──
   The badge makes a claim ("Free Nationwide Shipping"), so it follows the
   store's real shipping settings — the same three fields and the same branches
   as freeShippingLine() in storeCharges.js, which the announcement bar uses.
   The server puts the rule (and the owner's delivery message, which says
   whether and how the badge is shown) in the first HTML (src/app/page.js) so
   the badge does not say one thing at first paint and another once the browser
   has fetched the charges and the settings. */

/** The part of the shipping settings the badge needs, as plain JSON (no Firestore timestamp). */
export function pickShipping(charges) {
  const c = normalizeCharges(charges);
  return { enable_shipping_fee: c.enable_shipping_fee, shipping_fee_amount: c.shipping_fee_amount, free_shipping_threshold: c.free_shipping_threshold };
}

/**
 * Which shipping rule to show. CartContext starts on DEFAULT_CHARGES (the very
 * same object) and swaps in what /api/store-charges answers; until it has,
 * the rule the server rendered is the better-informed one. After that, the
 * live charges win (an admin's change shows without waiting for the next
 * rebuild of the page).
 */
export function currentShipping(live, seeded) {
  return live === DEFAULT_CHARGES && seeded ? seeded : live;
}

/**
 * The words of the hero's first badge, or '' — the hero then shows another true
 * badge ("Secure Checkout") in its place.
 *
 * By default (no `config`, or one never edited) that is "Free Nationwide Shipping"
 * exactly when every order ships free (the same rule as the announcement bar and
 * the product page: storeCharges.deliveryFreeForAll); a "free above ₹N" condition
 * is not advertised. The owner (Admin → Settings → Marketing → Delivery message) can
 * switch the badge off, reword it, or show their own words in every case ('always'):
 * deliveryMessageFor decides, with the same rule behind it.
 *
 * @param {object|null} charges  the shipping settings in force
 * @param {unknown} [config]     settings.deliveryMessage (any shape; undefined = the defaults)
 */
export function shippingBadge(charges, config) {
  return deliveryMessageFor(config, charges, 'badge');
}

/**
 * The reviews the admin entered (settings.testimonials) that can be shown: a
 * review needs text. Nothing is invented — no reviews configured means no
 * reviews section.
 *
 * @param {unknown} value
 * @returns {{ name: string, location: string, rating: number, review: string, photo: string }[]}
 */
export function pickTestimonials(value) {
  if (!Array.isArray(value)) return [];
  const text = (v) => (typeof v === 'string' ? v.trim() : '');
  return value
    .filter((t) => t && typeof t === 'object' && (text(t.review) || text(t.text)))
    .map((t) => ({
      name: text(t.name),
      location: text(t.location),
      rating: Number.isFinite(Number(t.rating)) && Number(t.rating) >= 1 ? Math.min(5, Math.round(Number(t.rating))) : 5,
      review: text(t.review) || text(t.text),
      photo: text(t.photo),
    }));
}
