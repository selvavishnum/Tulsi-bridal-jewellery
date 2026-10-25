/* ─────────────────────────────────────────────
   Homepage hero slides: the part of the site settings the slider reads, as
   plain JSON-safe objects.

   The homepage is rendered on the server (src/app/page.js) so the first
   slide's photo is in the HTML the browser receives first, and the same
   settings are fetched again in the browser (HomeClient) to pick up an
   admin's change. Both sides go through this file so a "slide" means the same
   thing in both places, and "is what the server drew still what the settings
   say?" is a single comparison — equal means no state change, so no
   re-render, no image reload, no flash.

   Pure module: safe on the server, in the browser and in tests.
   ───────────────────────────────────────────── */

/* Exactly what HeroSlider reads (the admin form in app/admin/settings has
   these and nothing else). Anything else in a stored slide stays out of the
   HTML: it would only add bytes to the page for no reason. */
export const HERO_SLIDE_FIELDS = Object.freeze([
  'id', 'imageUrl', 'tag', 'title', 'subtitle', 'ctaText', 'ctaLink', 'cta2Text', 'cta2Link',
]);

/**
 * The slides in `value` (settings.heroSlides), trimmed to HERO_SLIDE_FIELDS.
 * Every field is a string ('' when missing), so the result survives the
 * server → client prop boundary (JSON) and `slide.title.x` can't hit
 * undefined. A malformed entry (null, a string) is dropped rather than
 * crashing the page; a non-array is "no slides".
 *
 * @param {unknown} value
 * @returns {{ id: string, imageUrl: string, tag: string, title: string, subtitle: string, ctaText: string, ctaLink: string, cta2Text: string, cta2Link: string }[]}
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
 * What the slider should hold once settings arrive.
 *
 * Returns `prev` itself — the same reference — when nothing should change, so
 * React skips the render entirely and the photo already on screen is not
 * touched. That is the case when:
 *  - `incoming` has no slides list (settings never saved one);
 *  - `stale` is set: the list came from the browser's stored copy (up to an
 *    hour old) while the server already put newer slides in the HTML — taking
 *    it would flash an older hero before the fresh fetch put the right one back;
 *  - `incoming` draws the same hero as `prev`.
 * Otherwise the new list, trimmed to what the slider reads.
 *
 * @param {ReturnType<typeof pickHeroSlides>} prev
 * @param {unknown} incoming  settings.heroSlides
 * @param {{ stale?: boolean }} [from]
 */
export function nextHeroSlides(prev, incoming, { stale = false } = {}) {
  if (stale || !Array.isArray(incoming)) return prev;
  return sameHeroSlides(prev, incoming) ? prev : pickHeroSlides(incoming);
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
