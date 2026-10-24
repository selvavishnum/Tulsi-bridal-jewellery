/* A photo in a grid, a list or a thumbnail: one <img> with a right-sized
   Cloudinary srcset, lazy by default, and no JavaScript of its own. The light
   sibling of CloudinaryPicture (which is for the hero and the product page):
   a tile is f_auto with one srcset — see src/lib/catalogImages.js for why.

   Why not next/image? These photos are stored as full-resolution masters;
   next/image without a loader would download the whole master on the server
   and re-encode it, to make a 64px thumbnail. Cloudinary does the resizing
   (and the AVIF/WebP choice) on its CDN, from the stored URL.

   The caller reserves the box, as for any image: `fill` covers a `relative`
   parent that has an aspect ratio or a fixed size; without `fill`, give it
   width/height (or w-N h-N classes). Anything that isn't a Cloudinary photo is
   rendered as an ordinary <img> in the same box. */
import { CARD_QUALITY, cardImage, cardLoading } from '@/lib/catalogImages';

/**
 * @typedef {Object} CatalogImageProps
 * @property {string}  src    Stored Cloudinary secure_url (untransformed).
 * @property {string}  alt    Required. "" only for a decorative image.
 * @property {string}  [sizes]   How wide it is drawn per breakpoint (GRID_SIZES, or "80px" for a fixed thumbnail).
 * @property {number[]} [widths] Candidate widths (CARD_WIDTHS, THUMB_WIDTHS).
 * @property {number}  [ratio]   Crop to width ÷ height with smart gravity; omitted = the whole photo (the parent's object-cover crops it).
 * @property {'eco'|'low'|'good'|'best'|number} [quality=CARD_QUALITY]
 * @property {boolean} [whiteBg]  Background Removal first (see CARD_TILE).
 * @property {boolean} [fill=false]  Cover a `relative` parent that reserves its own size.
 * @property {boolean|'high'|'eager'|'low'} [priority=false]  See cardLoading: false = lazy.
 * @property {string}  [className]
 */

/** @param {CatalogImageProps & Omit<import('react').ImgHTMLAttributes<HTMLImageElement>, keyof CatalogImageProps>} props */
export default function CatalogImage({
  src, alt, sizes, widths, ratio, quality = CARD_QUALITY, whiteBg,
  fill = false, priority = false, className = '', ...rest
}) {
  if (!src) return null;
  const img = cardImage(src, { sizes, widths, ratio, quality, whiteBg });
  const { loading, fetchPriority } = cardLoading(priority);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={img.src}
      srcSet={img.srcSet}
      sizes={img.sizes}
      alt={alt}
      loading={loading}
      /* decoding=async: decode off the main thread, so a grid of photos can't block input. */
      decoding="async"
      fetchPriority={fetchPriority}
      className={`${fill ? 'absolute inset-0 h-full w-full' : ''} ${className}`.trim() || undefined}
      {...rest}
    />
  );
}
