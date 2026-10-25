/* ─────────────────────────────────────────────
   The store's own name, tagline and description come from the code
   ("Tulsi Fashion Jewellery"); Admin → Settings → Business can override them.
   A store that saved those settings while it was still the old "Bridal"
   store holds that text in the database until the owner saves them again,
   and it would print the old brand in the footer and in the search engines'
   store data on every page. So saved text that still says "bridal" is
   ignored for those few fields, and the new brand is used instead. Any other
   saved text wins, as before. (scripts/setup-welcome-offer.mjs lists the
   stored settings that still say it, for the owner to edit.)

   Pure module — no React, no '@/…' imports.
   ───────────────────────────────────────────── */
const OLD_BRAND = /\bbridal\b/i;

/**
 * @param {unknown} saved     what Admin → Settings saved (any type, may be missing)
 * @param {string}  fallback  the built-in text
 * @returns {string} the saved text when it is a non-blank string that doesn't carry the old brand, else `fallback`
 */
export function savedBrandText(saved, fallback) {
  if (typeof saved !== 'string') return fallback;
  const text = saved.trim();
  return text && !OLD_BRAND.test(text) ? text : fallback;
}
