'use client';

/* A customer's round avatar that never shows a broken-image icon: the
   Cloudinary photo (face-centred, round, retina-sharp — src/lib/avatar.js),
   or — when there is no photo, the link is unusable or it fails to load —
   an initial badge: gold ring, burgundy disc, gold serif letter.

   A plain <img>: Cloudinary already crops, sizes and picks the format, and
   next/image would re-process it (and refuses hosts outside
   images.remotePatterns, which is how hand-typed links broke before). */
import { useCallback, useState } from 'react';
import { avatarUrl, initialOf } from '@/lib/avatar';

/**
 * @param {{ name?: string, photo?: string, size?: number, className?: string, onBroken?: () => void }} props
 *   size  rendered diameter in px (default 48)
 *   onBroken  called once if a photo link fails to load (the admin shows a hint)
 */
export default function CustomerAvatar({ name = '', photo = '', size = 48, className = '', onBroken }) {
  const src = avatarUrl(photo);
  /* Remember which link failed, so a new photo gets its own chance. */
  const [failedSrc, setFailedSrc] = useState(null);
  const showPhoto = src && failedSrc !== src;
  const box = { width: size, height: size };
  const fail = useCallback(() => { setFailedSrc(src); onBroken?.(); }, [src, onBroken]);
  /* The server-rendered page can finish (and fail) loading the image before
     React attaches onError — so check once it is in the page. */
  const checkLoaded = useCallback((el) => {
    if (el && el.complete && el.naturalWidth === 0) fail();
  }, [fail]);

  if (!showPhoto) {
    return (
      <span
        role="img"
        aria-label={name ? `${name}` : 'Customer'}
        style={box}
        className={`inline-flex flex-shrink-0 select-none items-center justify-center rounded-full bg-wine-800 ring-2 ring-gold-400 ring-offset-1 ring-offset-white ${className}`}
      >
        <span aria-hidden="true" className="font-serif font-bold leading-none text-gold-200" style={{ fontSize: Math.round(size * 0.42) }}>
          {initialOf(name)}
        </span>
      </span>
    );
  }

  return (
    <span style={box} className={`relative inline-block flex-shrink-0 overflow-hidden rounded-full bg-stone-100 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={name ? `${name}` : 'Customer'}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="h-full w-full object-cover"
        ref={checkLoaded}
        onError={fail}
      />
    </span>
  );
}
