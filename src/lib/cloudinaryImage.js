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
export const WHITE_BG = process.env.NEXT_PUBLIC_CLOUDINARY_BG_REMOVAL === 'true';

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

/* ─────────────────────────────────────────────
   Generic builder + <picture> model (used by CloudinaryPicture).

   The tiers above are fixed recipes; this is the one place that turns
   "this image, this wide, this crop, this format" into a URL, so a
   srcset can be built for any layout without hand-writing strings.
   Pure functions: safe on the server, in the browser and in tests.
   ───────────────────────────────────────────── */

export const CLOUDINARY_ORIGIN = 'https://res.cloudinary.com';

/** A 1×1 transparent GIF: what a hidden twin layout downloads instead of the photo. */
export const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/* Width ladders (CSS px × the densities that matter, capped where the extra
   pixels stop being visible). The browser picks one per device from `sizes`,
   so a phone never receives a desktop-sized file.
   Steps are ~1.3× apart: close enough that the chosen file is never much
   bigger than needed, few enough that Cloudinary's CDN cache stays warm. */
export const IMAGE_WIDTHS = Object.freeze({
  thumb:   [96, 160, 240, 320],
  card:    [320, 480, 640, 800, 1000, 1400],
  gallery: [480, 640, 828, 1080, 1400, 1800],
  hero:    [640, 828, 1080, 1440, 1920, 2400],
});

/* `sizes` — how wide the image is drawn at each breakpoint, as the
   browser needs it BEFORE layout (so it can start the download early). They
   must match the real CSS, or the browser over/under-fetches. */
export const IMAGE_SIZES = Object.freeze({
  card:    '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw', // 2 / 3 / 4-up grid
  hero:    '100vw',
  gallery: '(max-width: 1023px) 100vw, 50vw',                         // PDP: full width on phones, half on desktop
  thumb:   '80px',
});

/* Image deliveries only: a /video/upload/ URL must not get image transforms. */
const isImageUpload = (url) => isCloudinary(url) && url.includes('/image/upload/');
const FORMAT = { auto: 'f_auto', avif: 'f_avif', webp: 'f_webp', jpg: 'f_jpg', png: 'f_png' };
const MIME = { avif: 'image/avif', webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png' };
const QUALITY = { eco: 'q_auto:eco', low: 'q_auto:low', good: 'q_auto:good', best: 'q_auto:best' };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/* Where a ratio / height crop looks. Unset = Cloudinary's AI ('g_auto'), as before. */
const GRAVITY = { auto: 'g_auto', face: 'g_auto:faces', center: 'g_center', north: 'g_north', south: 'g_south' };

/**
 * One Cloudinary delivery URL. Anything that isn't a Cloudinary upload URL
 * (a local file, Unsplash, a typo) is returned untouched.
 *
 * @param {string} url  the stored secure_url, untransformed
 * @param {object} [o]
 * @param {'auto'|'avif'|'webp'|'jpg'|'png'} [o.format='auto']
 *   'auto' = f_auto: Cloudinary reads the browser's Accept header (one URL, the
 *   CDN must Vary on it). An explicit format gives a stable URL per format —
 *   what a <picture> needs, because there the browser makes the choice.
 * @param {'eco'|'low'|'good'|'best'|number} [o.quality='good']
 *   q_auto picks the lowest quality that is still visually identical
 *   (perceptual metric, per image). 'good' ≈ 30–40% fewer bytes than
 *   'best' with no visible difference at thumbnail/gallery size; use 'best'
 *   for hero shots shown large. A number = fixed q_N.
 * @param {number} [o.width]   target width in px, 16–4000. Never upscales.
 * @param {number} [o.ratio]   width ÷ height to crop to (e.g. 0.75 for 3:4); smart-crops with g_auto
 * @param {number} [o.height]  explicit crop height (alternative to ratio)
 * @param {'auto'|'face'|'center'|'north'|'south'} [o.gravity]  what a crop (ratio / height) keeps in frame; default 'auto' (the jewellery)
 * @param {boolean} [o.progressive]  jpg only: fl_progressive, so the old-browser fallback paints coarse-to-fine
 * @param {boolean} [o.whiteBg]  AI Background Removal first, then flatten onto white (what cldCard does when
 *   NEXT_PUBLIC_CLOUDINARY_BG_REMOVAL is on; needs the paid add-on, so it is opt-in per call, never a default)
 * @returns {string}
 */
export function cldUrl(url, { format = 'auto', quality = 'good', width, ratio, height, progressive = false, whiteBg = false, gravity } = {}) {
  if (!isImageUpload(url)) return url;
  const parts = [FORMAT[format] || FORMAT.auto];
  parts.push(typeof quality === 'number' ? `q_${clamp(Math.round(quality), 1, 100)}` : (QUALITY[quality] || QUALITY.good));
  const w = Number.isFinite(width) ? clamp(Math.round(width), 16, 4000) : null;
  if (ratio || height) {
    /* c_lfill = c_fill that never upscales a small original. g_auto keeps the
       jewellery (not the empty background) inside the crop. */
    parts.push('c_lfill', GRAVITY[gravity] || 'g_auto');
    if (ratio) parts.push(`ar_${Number(ratio).toFixed(4).replace(/\.?0+$/, '')}`);
    else parts.push(`h_${clamp(Math.round(height), 16, 4000)}`);
  } else {
    parts.push('c_limit'); // fit inside w; a small original is never stretched
  }
  if (w) parts.push(`w_${w}`);
  if (progressive && format === 'jpg') parts.push('fl_progressive');
  /* Background removal is its own transformation step (a "/"), then the rest. */
  return withTransform(url, `${whiteBg ? 'e_background_removal/b_rgb:FFFFFF,' : ''}${parts.join(',')}`);
}

/** "<url> 320w, <url> 480w, …" — undefined for a non-Cloudinary URL. */
export function cldSrcSet(url, widths, opts) {
  if (!isImageUpload(url)) return undefined;
  return widths.map((w) => `${cldUrl(url, { ...opts, width: w })} ${w}w`).join(', ');
}

/**
 * Everything <picture> needs for one image: AVIF source, WebP source, and the
 * <img> fallback (JPEG, or PNG for cut-outs with transparency).
 *
 * The browser walks <source>s in order and takes the first `type` it can
 * decode; a browser that knows neither (or doesn't know <picture> at all)
 * uses the <img>. That is the whole fallback story — no JS, no UA sniffing.
 *
 * @returns {{ cloudinary: boolean,
 *   sources: { type: string, srcSet: string, sizes: string }[],
 *   img: { src: string, srcSet?: string, sizes?: string },
 *   preload: { href: string, imageSrcSet: string, imageSizes: string, type: string } | null }}
 */
export function pictureModel(url, {
  widths = IMAGE_WIDTHS.gallery, sizes = '100vw', formats = ['avif', 'webp'],
  fallbackFormat = 'jpg', quality = 'good', ratio, fallbackWidth, gravity,
} = {}) {
  if (!isImageUpload(url)) return { cloudinary: false, sources: [], img: { src: url }, preload: null };
  const base = { quality, ratio, gravity };
  const sources = formats.map((f) => ({ type: MIME[f], srcSet: cldSrcSet(url, widths, { ...base, format: f }), sizes }));
  const fb = { ...base, format: fallbackFormat, progressive: true };
  const mid = fallbackWidth || widths[Math.min(widths.length - 1, 2)];
  /* Only the first format is preloaded (see CloudinaryPicture). */
  const first = sources[0];
  return {
    cloudinary: true,
    sources,
    img: { src: cldUrl(url, { ...fb, width: mid }), srcSet: cldSrcSet(url, widths, fb), sizes },
    preload: first ? { href: cldUrl(url, { ...base, format: formats[0], width: mid }), imageSrcSet: first.srcSet, imageSizes: sizes, type: first.type } : null,
  };
}

