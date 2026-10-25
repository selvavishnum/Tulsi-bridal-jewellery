/* ─────────────────────────────────────────────
   Images in grids, lists and thumbnails: product cards, wishlist
   tiles, the 40–80px photos beside an order line. (Heroes and the product
   page use <picture>: components/ui/CloudinaryPicture.jsx.)

   A tile is ONE <img> with ONE f_auto srcset, not a three-format <picture>:
   a shop page is dozens of tiles with two photos each, and <picture> would
   triple that markup for no LCP gain. f_auto lets Cloudinary pick AVIF /
   WebP / JPEG from the browser's Accept header; the srcset lets the browser
   pick the width. Pure functions: safe on the server, in the browser and in
   tests.
   ───────────────────────────────────────────── */
import { IMAGE_SIZES, IMAGE_WIDTHS, WHITE_BG, cldSrcSet, cldUrl } from './cloudinaryImage.js';

/* Perceptual quality of every grid tile and thumbnail. q_auto:good is
   Cloudinary's default "visually identical" level: ~30–40% fewer bytes than
   'best', and these photos are drawn at most ~300 CSS px wide, where the
   difference cannot be seen. The hero, the product page and the zoom viewer
   keep 'best'. One line to change if a tile ever looks soft. */
export const CARD_QUALITY = 'good';

/* The card photo is a 3:4 crop; Cloudinary's content-aware gravity (g_auto)
   keeps the jewellery in frame. */
export const CARD_RATIO = 3 / 4;

/* Candidates nobody can use are left out. The widest tile in the app is 292
   CSS px (the home grid on a ≥1280px screen) → 584px on a 2× display, 876px
   on a 3×; 800 is the last rung that still helps. The old ladder went to
   2000px, for a tile that never exceeds 300. Thumbnails are 40–80 CSS px →
   up to 240px at 3×. The rungs are the shared ladders', so Cloudinary's CDN
   keeps serving the same renditions to everyone. */
export const CARD_WIDTHS = Object.freeze(IMAGE_WIDTHS.card.filter((w) => w <= 800));
export const THUMB_WIDTHS = Object.freeze(IMAGE_WIDTHS.thumb.filter((w) => w <= 240));

/* Everything a product card tile needs, in one spread. whiteBg: with the
   Cloudinary Background Removal add-on on (NEXT_PUBLIC_CLOUDINARY_BG_REMOVAL),
   the piece sits on pure white — as it did before this helper existed. */
export const CARD_TILE = Object.freeze({ ratio: CARD_RATIO, widths: CARD_WIDTHS, whiteBg: WHITE_BG });

/* ── Which images load first ──

   The first two cards are the whole first row on a phone (2-up) and the
   likeliest LCP: eager + fetchpriority=high. Cards 3–4 are probably on the
   first screen too, so they load eagerly (no wait for the lazy-load
   threshold) but at the browser's own priority — marking more than two
   "high" dilutes the signal and slows the one that matters. Everything else
   is lazy. One rule, so no grid hand-writes `i < 4`. Only for a grid that
   starts at the top of a page (/shop, /catalog): a grid far down the home
   page must stay lazy so it cannot compete with the hero. */
export const PRIORITY_CARDS = Object.freeze({ high: 2, eager: 4 });

/** @param {number} index  position of the card in its grid (0-based) @returns {'high'|'eager'|false} */
export function cardPriority(index) {
  if (index < PRIORITY_CARDS.high) return 'high';
  if (index < PRIORITY_CARDS.eager) return 'eager';
  return false;
}

/**
 * The loading attributes for a priority: 'high' (or true) = eager + fetchpriority
 * high; 'eager' = eager, browser-chosen priority (auto is the default, so the
 * attribute is left off); 'low' = lazy and last in the queue, for a photo the
 * shopper may never see (a hover image); false = lazy.
 * @param {boolean|'high'|'eager'|'low'} priority
 * @returns {{ loading: 'eager'|'lazy', fetchPriority?: 'high'|'low' }}
 */
export function cardLoading(priority) {
  if (priority === true || priority === 'high') return { loading: 'eager', fetchPriority: 'high' };
  if (priority === 'eager') return { loading: 'eager' };
  if (priority === 'low') return { loading: 'lazy', fetchPriority: 'low' };
  return { loading: 'lazy' };
}

/**
 * src / srcset / sizes for one tile. A URL that isn't a Cloudinary image is
 * returned as `{ src }` only (nothing to negotiate).
 *
 * @param {string} url  the stored secure_url, untransformed
 * @param {object} [o]
 * @param {string} [o.sizes]    how wide the tile is drawn per breakpoint (GRID_SIZES); default: a generic full-width 2/3/4-up grid
 * @param {number[]} [o.widths] candidate widths; default CARD_WIDTHS
 * @param {number} [o.ratio]    crop to this width ÷ height (CARD_RATIO for a product card); omitted = the whole photo
 * @param {'eco'|'low'|'good'|'best'|number} [o.quality]
 * @param {boolean} [o.whiteBg]
 * @returns {{ src: string, srcSet?: string, sizes?: string }}
 */
export function cardImage(url, { sizes = IMAGE_SIZES.card, widths = CARD_WIDTHS, ratio, quality = CARD_QUALITY, whiteBg = false } = {}) {
  const opts = { format: 'auto', quality, ratio, whiteBg };
  const srcSet = cldSrcSet(url, widths, opts);
  if (!srcSet) return { src: url };
  /* `src` is only for a browser that ignores srcset: a middle rung. */
  return { src: cldUrl(url, { ...opts, width: widths[Math.min(widths.length - 1, 2)] }), srcSet, sizes };
}

/* ── `sizes`, worked out from the layout ──

   `sizes` tells the browser how wide the tile will be BEFORE layout, so it
   can start the right download early. Too big and every phone fetches
   desktop pixels; too small and the photo is blurry. So it is not guessed:
   gridSizes() derives it from the same numbers the CSS uses.

   Each argument lists one CSS property the way Tailwind writes it, as
   [min-width in px, value] steps — `px-4 sm:px-6 lg:px-8` is
   [[0, 16], [640, 24], [1024, 32]]. Breakpoints: sm 640, md 768, lg 1024, xl 1280. */

const valueAt = (steps, vw) => steps.reduce((value, [from, v]) => (vw >= from ? v : value), steps[0][1]);
const num = (n) => String(Number(n.toFixed(4)));

/**
 * `sizes` for a tile of a grid inside a centred, padded container.
 * @param {object} g
 * @param {[number, number][]} g.cols  columns of the grid
 * @param {[number, number][]} g.gap   gap in px between tiles
 * @param {[number, number][]} g.pad   horizontal padding of the container, px per side
 * @param {number} [g.max]             container max width in px (border-box, so it includes the padding); default none
 * @param {number|'full'} [g.span=1]   columns the tile spans ('full' = col-span-full)
 * @returns {string}
 */
export function gridSizes({ cols, gap, pad, max = Infinity, span = 1 }) {
  const breaks = new Set([0, max, ...[cols, gap, pad].flatMap((steps) => steps.map(([from]) => from))]);
  breaks.delete(Infinity);
  const clauses = [...breaks].sort((a, b) => a - b).map((from) => {
    const c = valueAt(cols, from);
    const g = valueAt(gap, from);
    const p = valueAt(pad, from);
    const k = Math.min(span === 'full' ? c : span, c) / c; // a span of s columns is s/c of the row
    /* Tile width at container width w: k × (w − 2p + g) − g. */
    if (from >= max) return [from, `${num(k * (max - 2 * p + g) - g)}px`];
    const off = k * (2 * p - g) + g;
    return [from, off === 0 ? `${num(100 * k)}vw` : `calc(${num(100 * k)}vw ${off > 0 ? '-' : '+'} ${num(Math.abs(off))}px)`];
  });
  /* Adjacent breakpoints that give the same width collapse into the lower one. */
  const merged = clauses.filter(([, v], i) => i === 0 || v !== clauses[i - 1][1]);
  return merged.reverse().map(([from, v]) => (from === 0 ? v : `(min-width: ${from}px) ${v}`)).join(', ');
}

/* `section-container` (globals.css): max-w-7xl, px-4 sm:px-6 lg:px-8. */
export const SECTION_CONTAINER = Object.freeze({ max: 1280, pad: Object.freeze([[0, 16], [640, 24], [1024, 32]]) });

/* The grids ProductCard and the tile images live in. Each entry mirrors the
   container + grid classes written next to it; tests/perf-catalog.test.mjs
   reads those files and fails if either side changes alone. */
export const GRID_SIZES = Object.freeze({
  /* /shop, /catalog — `max-w-3xl mx-auto px-3` around `grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3` */
  shop: gridSizes({ cols: [[0, 2], [640, 3]], gap: [[0, 8], [640, 12]], pad: [[0, 12]], max: 768 }),
  /* Home "All Products" — section-container around `grid-cols-2 md:grid-cols-4 gap-2 md:gap-4` */
  home: gridSizes({ cols: [[0, 2], [768, 4]], gap: [[0, 8], [768, 16]], ...SECTION_CONTAINER }),
  /* /wishlist — `max-w-5xl mx-auto px-4` around `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4` */
  wishlist: gridSizes({ cols: [[0, 2], [640, 3], [1024, 4]], gap: [[0, 16]], pad: [[0, 16]], max: 1024 }),
});
