/* ─────────────────────────────────────────────
   The storefront's eight destinations — the header's link row, the mobile
   menu and the footer's quick links all read this one list, so they can't
   drift apart.

   The category links open the catalogue filtered (CatalogContent reads
   ?category=); "Trending Now" is the shop sorted by "Most Popular"
   (ShopContent's ?sort=ratings.average-desc).

   Pure module — no React, no '@/…' imports.
   ───────────────────────────────────────────── */

export const NAV_LINKS = Object.freeze([
  { label: 'Home', href: '/' },
  { label: 'Chains & Necklaces', href: '/catalog?category=necklace' },
  { label: 'Earrings', href: '/catalog?category=earrings' },
  { label: 'Anklets', href: '/catalog?category=anklet' },
  { label: 'Trending Now', href: '/shop?sort=ratings.average-desc' },
  { label: 'About', href: '/about' },
  { label: 'Contact', href: '/contact' },
  { label: 'Track Order', href: '/track-order' },
]);

/**
 * Is `href` the page being viewed? The path must match; a link with a query
 * ("?category=anklet") needs every one of its parameters to match too.
 * `query` is the address bar's query string ('' for none) — or null while
 * it isn't known (the server render and the first client render), when only
 * links without a query can be active. That keeps the server HTML and the
 * first client render identical.
 * @param {string} href
 * @param {string|null|undefined} pathname
 * @param {string|null} query  e.g. 'category=anklet&page=2'
 */
export function isActiveLink(href, pathname, query) {
  if (!pathname) return false;
  const [path, queryOfLink = ''] = href.split('?');
  if (pathname.replace(/\/+$/, '') !== path.replace(/\/+$/, '')) return false;
  if (!queryOfLink) return true;
  if (query === null || query === undefined) return false;
  const have = new URLSearchParams(query);
  for (const [key, value] of new URLSearchParams(queryOfLink)) if (have.get(key) !== value) return false;
  return true;
}
