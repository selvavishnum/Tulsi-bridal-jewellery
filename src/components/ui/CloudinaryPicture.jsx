/* A product / hero photo that is as light as it can be and never shifts the
   page: AVIF → WebP → JPEG in a <picture>, a srcset per format so every
   device downloads only the pixels it can show, the box reserved before the
   bytes arrive, and a "priority" mode for the one image that is the LCP.

   No hooks and no 'use client': it renders the same on the server (the
   <picture> is in the HTML the browser first sees, so the download starts
   with the document — not after JavaScript) and inside client components.

   Source: the plain Cloudinary secure_url as stored (src/lib/cloudinary.js
   keeps the full-resolution master). Anything else — a local file, Unsplash —
   is rendered as an ordinary <img> with the same reserved box.

   Why <picture> and not f_auto in one srcset? f_auto makes Cloudinary guess
   from the Accept header, so one URL maps to several files and the CDN must
   Vary on it. Explicit f_avif / f_webp / f_jpg URLs are stable and cacheable,
   and the browser — which knows exactly what it can decode — makes the pick.
   (The catalog grid still uses f_auto: 3 formats × 2 photos × many cards
   would triple its markup for no LCP gain.) */
import { preconnect, preload } from 'react-dom';
import { CLOUDINARY_ORIGIN, IMAGE_SIZES, IMAGE_WIDTHS, PIXEL, cldSrcSet, pictureModel } from '@/lib/cloudinaryImage';

/**
 * @typedef {Object} CloudinaryPictureProps
 * @property {string}   src     Stored Cloudinary secure_url (untransformed).
 * @property {string}   alt     Required. Use "" only for decorative images.
 * @property {number}   width   Intrinsic width of what is shown (any unit — only the ratio with `height` matters).
 * @property {number}   height  Intrinsic height. With `width` it reserves the box → CLS 0. Ignored when `fill`.
 * @property {boolean}  [fill=false]  Cover an absolutely-positioned parent that reserves its own size (object-fit via className).
 * @property {string}   [sizes]       How wide it is drawn per breakpoint (see IMAGE_SIZES). Default '100vw'.
 * @property {number[]} [widths]      Candidate widths in px (see IMAGE_WIDTHS). Default: gallery ladder.
 * @property {'eco'|'low'|'good'|'best'|number} [quality='good']
 * @property {('avif'|'webp')[]} [formats=['avif','webp']]  Modern formats, best first.
 * @property {'jpg'|'png'} [fallbackFormat='jpg']  Last resort; 'png' for cut-outs with transparency.
 * @property {boolean}  [priority=false]  The LCP image: eager, fetchpriority=high, preloaded. At most one per page.
 * @property {string}   [showWhen]  A single media query; where it does NOT match, the photo is not fetched (a 1×1 pixel is). For twin
 *                                  mobile/desktop layouts where CSS hides one copy but the browser would still download it.
 * @property {string}   [hideWhen]  The inverse: where this query matches, a pixel is fetched instead. Use it for the copy that
 *                                  CSS hides at a breakpoint, with the SAME query the other copy passes to `showWhen`, so the
 *                                  two are exact complements at every width (a hand-written "max-width: 1023.99px" is not:
 *                                  browsers round fractional widths, so at exactly 1024px both copies would download).
 * @property {number}   [ratio]    A fixed crop for every source, width ÷ height (e.g. 0.8 for 4:5), smart-cropped with g_auto so the
 *                                  jewellery stays in frame whatever the shape of the stored photo. Pair it with a parent of the same
 *                                  aspect ratio. Default: the whole photo (c_limit). Not used for a non-Cloudinary URL.
 * @property {{ media: string, ratio: number, widths?: number[], sizes?: string, quality?: 'eco'|'low'|'good'|'best'|number }} [art]
 *                                  Art direction: under `media` serve a different crop (`ratio` = width ÷ height, g_auto
 *                                  keeps the jewellery in frame) — e.g. a portrait crop on phones instead of a landscape
 *                                  photo mostly cut off by object-cover. `art.quality` overrides `quality` for the crop
 *                                  (a phone shows it small, so 'good' is enough). Not with `showWhen` / `hideWhen`.
 * @property {string}   [className]
 * @property {import('react').CSSProperties} [style]
 * @property {(e: import('react').SyntheticEvent<HTMLImageElement>) => void} [onLoad]
 * @property {(e: import('react').SyntheticEvent<HTMLImageElement>) => void} [onError]
 */

/** @param {CloudinaryPictureProps & Omit<import('react').ImgHTMLAttributes<HTMLImageElement>, keyof CloudinaryPictureProps>} props */
export default function CloudinaryPicture({
  src, alt, width, height, fill = false,
  sizes = IMAGE_SIZES.hero, widths = IMAGE_WIDTHS.gallery,
  quality = 'good', formats = ['avif', 'webp'], fallbackFormat = 'jpg', ratio,
  priority = false, showWhen, hideWhen, art,
  className = '', style, ...rest
}) {
  if (!src) return null;
  const main = pictureModel(src, { widths, sizes, quality, formats, fallbackFormat, ratio });
  const cropQuality = art?.quality || quality;
  const crop = art && main.cloudinary
    ? pictureModel(src, { widths: art.widths || IMAGE_WIDTHS.card, sizes: art.sizes || sizes, quality: cropQuality, formats, fallbackFormat, ratio: art.ratio })
    : null;
  /* Twin layouts: `pixel` is the media query under which a 1×1 pixel is
     fetched instead of the photo; `visible` is its exact complement (the
     media the preload gets, so only the visible copy is preloaded). */
  const gate = showWhen ? { pixel: `not all and ${showWhen}`, visible: showWhen }
    : hideWhen ? { pixel: hideWhen, visible: `not all and ${hideWhen}` }
    : null;

  /* LCP image only. preconnect: open the TLS connection to Cloudinary while
     the HTML is still parsing. preload: queue the file at high priority from
     the document's <head>, before layout or CSS are known. Only the first
     (AVIF) source is preloaded: a browser that can decode AVIF fetches it and
     the <picture> then reuses it; one that can't skips it by `type`. Preloading
     WebP as well would make AVIF browsers download both. */
  if (priority && main.cloudinary) {
    preconnect(CLOUDINARY_ORIGIN);
    const hint = (m, media) => m.preload && preload(m.preload.href, {
      as: 'image', type: m.preload.type, imageSrcSet: m.preload.imageSrcSet, imageSizes: m.preload.imageSizes, fetchPriority: 'high', ...(media && { media }),
    });
    if (crop) { hint(crop, art.media); hint(main, `not all and ${art.media}`); } else hint(main, gate?.visible);
  }

  /* Reserve the box: width/height attributes give the browser the aspect
     ratio before any bytes arrive (the explicit aspect-ratio is the same
     thing for engines that ignore the attributes' hint). */
  const box = fill ? { width: '100%', height: '100%' } : { aspectRatio: width && height ? `${width} / ${height}` : undefined };
  const sourcesOf = (m, media) => m.sources.map((s) => <source key={`${media || 'all'}-${s.type}`} type={s.type} srcSet={s.srcSet} sizes={s.sizes} media={media} />);

  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={main.img.src}
      srcSet={main.img.srcSet}
      sizes={main.img.srcSet ? main.img.sizes : undefined}
      alt={alt}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      /* decoding=async: decode off the main thread so a big photo can't block input.
         Lazy for everything below the fold (the browser fetches it just before it
         scrolls in); the LCP image is eager and top of the fetch queue. */
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={priority ? 'high' : undefined}
      className={`${fill ? 'absolute inset-0' : ''} ${className}`.trim() || undefined}
      style={{ ...box, ...style }}
      {...rest}
    />
  );
  /* Not a Cloudinary photo: nothing to negotiate — just the reserved-box <img>. */
  if (!main.cloudinary) return img;

  return (
    <picture>
      {/* Twin layout hidden by CSS: serve a pixel unless this copy is the visible one. */}
      {gate && <source media={gate.pixel} srcSet={PIXEL} />}
      {crop && sourcesOf(crop, art.media)}
      {crop && <source media={art.media} srcSet={cldSrcSet(src, art.widths || IMAGE_WIDTHS.card, { quality: cropQuality, format: fallbackFormat, ratio: art.ratio, progressive: true })} sizes={art.sizes || sizes} />}
      {sourcesOf(main)}
      {img}
    </picture>
  );
}
