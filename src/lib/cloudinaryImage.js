/* ─────────────────────────────────────────────
   Cloudinary dual-tier image transforms.

   Product photos are uploaded at full camera resolution (see
   src/lib/cloudinary.js — "No quality transformation — store at full
   quality so zoom stays sharp") and stored as a plain secure_url:
     https://res.cloudinary.com/<cloud>/image/upload/v<ver>/<public_id>.<ext>

   Every render site asks Cloudinary for exactly the pixels it needs by
   inserting a transformation string right after "/upload/" — Cloudinary
   resizes/re-encodes on its own CDN edge and caches the result, so the
   browser never downloads more than the tier calls for and next/image
   never has to re-process bytes Cloudinary already optimized.
   ───────────────────────────────────────────── */

const UPLOAD_MARKER = '/upload/';

function withTransform(url, transformation) {
  if (typeof url !== 'string' || !url.includes('res.cloudinary.com')) return url; // not Cloudinary (e.g. a demo/Unsplash image) — leave untouched
  const idx = url.indexOf(UPLOAD_MARKER);
  if (idx === -1) return url;
  const splitAt = idx + UPLOAD_MARKER.length;
  return `${url.slice(0, splitAt)}${transformation}/${url.slice(splitAt)}`;
}

/* Base display tier — the main product-gallery image (PDP hero) and, at a
   smaller width, catalog grid cards.
   f_auto: best format for the requesting browser (avif/webp/jpg)
   q_auto:best: highest-quality end of Cloudinary's perceptual compression
   dpr_auto: serves retina-correct pixel density automatically
   w: caps width — default 1400 matches the PDP gallery pane, which is the
   widest this tier ever renders; a catalog grid card is a fraction of
   that on screen, so it asks for less (see cldGrid below) rather than
   reusing 1400 and shipping 4-8x the bytes a small tile needs. */
export function cldBase(url, w = 1400) {
  return withTransform(url, `f_auto,q_auto:best,w_${w},dpr_auto`);
}

/* Catalog / listing grid tier — same recipe, sized for a grid tile rather
   than a full gallery pane. 600 covers even a 2-up mobile grid at 3x DPR
   comfortably without paying for 1400px of a ~150-300px rendered tile. */
export function cldGrid(url) {
  return cldBase(url, 600);
}

/* Deep-zoom tiers (8000px masters) — fetched only on demand, never during
   page render. Opening the full-screen viewer loads w_3000 at q_90 (sharp
   on any phone at 1×–2× zoom); pinching past 2× swaps in w_5000 so single
   stones and chain links stay crisp. c_limit never upscales. */
export function cldZoom(url) {
  return withTransform(url, 'f_auto,q_90,w_3000,c_limit');
}
export function cldDeepZoom(url) {
  return withTransform(url, 'f_auto,q_90,w_5000,c_limit');
}

/* Small thumbnail tier — the 48–64px selector strip has no business
   pulling the same 1400px-wide bytes as the hero image next to it. */
export function cldThumb(url, w = 160) {
  return withTransform(url, `f_auto,q_auto:best,w_${w},dpr_auto`);
}

/* ── Catalog cards: edge-to-edge, retina-sharp tiles ──

   Each card tile gets a srcset of Cloudinary renditions, so the browser
   picks the right width for the tile's rendered size and the screen's
   pixel density — up to 2000px (a 1000px tile at 2×).

   With the Cloudinary "AI Background Removal" add-on switched on
   (NEXT_PUBLIC_CLOUDINARY_BG_REMOVAL=true), coloured backdrops and props
   are removed and the piece sits on pure white (#FFFFFF). The flag keeps
   the transformation off when the add-on isn't active — otherwise every
   tile URL would fail. */
export const CARD_WIDTHS = Object.freeze([400, 600, 800, 1000, 1400, 2000]);
const WHITE_BG = process.env.NEXT_PUBLIC_CLOUDINARY_BG_REMOVAL === 'true';

/**
 * Grid tile, edge-to-edge: a 3:4 crop that fills the card, with
 * Cloudinary's content-aware gravity (g_auto) keeping the jewellery in
 * frame so it appears zoomed-in and large. Widths up to 2000 (a 1000px
 * tile at 2×) come from the srcset — the browser picks per device, so a
 * phone never downloads desktop pixels.
 */
export function cldCard(url, w = 1000, { whiteBg = WHITE_BG } = {}) {
  const tile = `f_auto,q_auto:best,w_${w},ar_3:4,c_fill,g_auto`;
  /* Background removal first (its own step), then flatten onto white. */
  return withTransform(url, whiteBg ? `e_background_removal/b_rgb:FFFFFF,${tile}` : tile);
}

/** srcset for a card tile, e.g. "…w_320… 320w, …w_480… 480w, …". */
export function cldCardSrcSet(url, opts) {
  if (!isCloudinary(url)) return undefined;
  return CARD_WIDTHS.map((w) => `${cldCard(url, w, opts)} ${w}w`).join(', ');
}

/** ~1KB blurred preview shown while the sharp tile loads (LQIP). */
export function cldPlaceholder(url) {
  return isCloudinary(url) ? withTransform(url, 'f_auto,q_auto:low,w_32,ar_3:4,c_fill,g_auto,e_blur:400') : null;
}

export const isCloudinary = (url) => typeof url === 'string' && url.includes('res.cloudinary.com') && url.includes(UPLOAD_MARKER);
