/* A photo drawn the way the admin cropped it (Marketing → crop & focus): in the shape's frame
   (Circle / Square / King Size 4:5 / Wide 16:9), Cloudinary cropping to the frame for the preset
   gravities and the browser centring on a custom point, then the zoom. The same helpers draw the
   preview in the admin, so what is previewed is what is shown. No hooks: renders on the server. */
import { showcaseImageUrl, showcaseSrcSet, focusStyle, DEFAULT_FOCUS } from '@/lib/categoryShowcase';

/**
 * @param {object} props
 * @param {string} props.src  stored photo URL
 * @param {string} props.alt
 * @param {'circle'|'square'|'king_size'|'wide'} [props.variant='square']  the frame's shape (for the crop ratio)
 * @param {object} [props.focus]  { gravity, x, y, zoom }
 * @param {number[]} [props.widths]
 * @param {string} [props.sizes]
 * @param {boolean} [props.priority]  eager + high priority (the first thing on the page); otherwise lazy
 * @param {string} [props.className]  extra classes for the <img> (it already fills its parent)
 */
export default function FocusPhoto({ src, alt, variant = 'square', focus = DEFAULT_FOCUS, widths = [240, 400, 640, 900], sizes = '100vw', priority = false, className = '' }) {
  if (!src) return null;
  const mid = widths[Math.min(widths.length - 1, 1)];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={showcaseImageUrl(src, { variant, focus, width: mid })}
      srcSet={showcaseSrcSet(src, { variant, focus }, widths)}
      sizes={sizes}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      draggable={false}
      className={`absolute inset-0 h-full w-full ${className}`.trim()}
      style={focusStyle(focus)}
    />
  );
}
