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

/* High-resolution zoom tier — fetched only once the viewer explicitly
   zooms (opens the full-screen viewer or hovers the desktop loupe), never
   during the initial page render. */
export function cldZoom(url) {
  return withTransform(url, 'f_auto,q_auto:best,w_4000');
}

/* Small thumbnail tier — the 48–64px selector strip has no business
   pulling the same 1400px-wide bytes as the hero image next to it. */
export function cldThumb(url, w = 160) {
  return withTransform(url, `f_auto,q_auto:best,w_${w},dpr_auto`);
}
