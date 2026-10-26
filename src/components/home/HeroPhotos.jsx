'use client';

/* ─────────────────────────────────────────────
   The homepage hero photo's frame: the shapes and sizes the owner can pick in
   Admin → Settings → Marketing → Homepage Hero Photo, how a saved crop is applied, and the
   slider used when "Slider" is chosen and more than one photo is switched on.

   The class strings are written out in full: Tailwind only ships classes it can see in source.
   King Size 4:5 at Large is what the hero has always been — its classes are the ones HomeClient
   used before these options existed.
   ───────────────────────────────────────────── */
import { useCallback, useEffect, useRef, useState } from 'react';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { focusStyle } from '@/lib/categoryShowcase';

/* Frame per shape: the aspect box, its corners, and the ratio Cloudinary crops to. */
export const HERO_SHAPES = {
  king_size: { aspect: 'aspect-[4/5]', round: 'rounded-[1.75rem]', ratio: 0.8 },
  square: { aspect: 'aspect-square', round: 'rounded-[1.75rem]', ratio: 1 },
  wide: { aspect: 'aspect-video', round: 'rounded-[1.75rem]', ratio: 16 / 9 },
  circle: { aspect: 'aspect-square', round: 'rounded-full', ratio: 1 },
};
export const heroShape = (layout) => HERO_SHAPES[layout?.layoutVariant] || HERO_SHAPES.king_size;

/* The box width at each breakpoint. On a phone that supports svh the 4:5 box also shrinks on a
   short screen — 100svh minus 33rem, the room the rest of the hero needs, as wide as 4:5 allows,
   never under 14rem — so the headline, line and button stay above the fold on a 390×844 as well
   as a 412×915. svh is the screen with the browser bars showing, so the box never changes size as
   they hide. */
const BOX_KING_LARGE = [
  'w-[min(100%,18rem)] supports-[height:1svh]:w-[min(100%,18rem,max(14rem,calc((100svh-33rem)*0.8)))]',
  'min-[400px]:w-[min(100%,20rem)] min-[400px]:supports-[height:1svh]:w-[min(100%,20rem,max(14rem,calc((100svh-33rem)*0.8)))]',
  'md:w-[min(100%,24rem)] md:supports-[height:1svh]:w-[min(100%,24rem)]',
  'lg:w-full lg:max-w-[30rem] lg:supports-[height:1svh]:w-full',
].join(' ');
/* The other shapes at Large are no taller than the 4:5 one at the same width, so they need no svh clamp. */
const BOX_LARGE = 'w-[min(100%,18rem)] min-[400px]:w-[min(100%,20rem)] md:w-[min(100%,24rem)] lg:w-full lg:max-w-[30rem]';
const BOX_MEDIUM = 'w-[min(100%,15rem)] min-[400px]:w-[min(100%,16rem)] md:w-[min(100%,20rem)] lg:w-full lg:max-w-[24rem]';
const BOX_SMALL = 'w-[min(100%,12rem)] min-[400px]:w-[min(100%,13rem)] md:w-[min(100%,16rem)] lg:w-full lg:max-w-[18rem]';

/** The classes that size the photo box for a layout (Large + King Size = the hero as it has always been). */
export function heroBoxClass(layout) {
  if (layout?.size === 'medium') return BOX_MEDIUM;
  if (layout?.size === 'small') return BOX_SMALL;
  return layout?.layoutVariant && layout.layoutVariant !== 'king_size' ? BOX_LARGE : BOX_KING_LARGE;
}

/* `sizes` for the smaller boxes (Large keeps HERO_PHOTO.sizes in HomeClient): the box width at each breakpoint. */
const SIZES_MEDIUM = '(min-width: 1024px) min(384px, calc((100vw - 112px) / 2)), (min-width: 768px) 320px, (min-width: 400px) 256px, 240px';
const SIZES_SMALL = '(min-width: 1024px) min(288px, calc((100vw - 112px) / 2)), (min-width: 768px) 256px, (min-width: 400px) 208px, 192px';
export const heroSizesFor = (layout, large) => (layout?.size === 'medium' ? SIZES_MEDIUM : layout?.size === 'small' ? SIZES_SMALL : large);

/**
 * How a saved crop is drawn. Cloudinary does the crop for the preset gravities (it is told where to
 * look); a custom point is cropped by the browser (the whole photo is fetched, object-fit: cover
 * centres on the point), and a zoom scales the photo about that point. The default crop returns
 * nothing, so an untouched photo is requested and drawn exactly as before.
 * @param {{ gravity?: string, x?: number, y?: number, zoom?: number } | null | undefined} focus
 * @returns {{ gravity: string|undefined, cropped: boolean, style: object|undefined }}
 */
export function heroCrop(focus) {
  const f = focus && typeof focus === 'object' ? focus : null;
  if (!f) return { gravity: undefined, cropped: true, style: undefined };
  const custom = f.gravity === 'custom';
  return {
    gravity: ['face', 'center', 'north', 'south'].includes(f.gravity) ? f.gravity : undefined,
    cropped: !custom,
    style: custom || f.zoom > 1 ? focusStyle(f) : undefined,
  };
}

const idle = (fn) => (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(fn, { timeout: 3000 }) : window.setTimeout(fn, 1200));

/**
 * The hero slider: the photos side by side in the frame, scroll-snapped (swipe, arrows, dots), moving on
 * by itself every 5 seconds unless the visitor prefers reduced motion, is pointing at it or has focus in it.
 *
 * Only the first photo is in the server's HTML, and it is the one the browser is told to fetch first;
 * the others (and the dots and arrows) are added once the page has loaded and the browser is idle, so
 * they never compete with the first photo — and the frame is a fixed-ratio box, so nothing moves when
 * they arrive.
 *
 * @param {{ count: number, renderSlide: (index: number) => import('react').ReactNode, label?: string }} props
 */
export function HeroSlider({ count, renderSlide, label = 'Featured photos' }) {
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(0);
  const track = useRef(null);
  const paused = useRef(false);
  const total = ready ? count : 1;

  useEffect(() => {
    if (count < 2) return undefined;
    let cancelled = false;
    let handle = 0;
    const start = () => { handle = idle(() => { if (!cancelled) setReady(true); }); };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener('load', start);
      if (handle) (typeof window.cancelIdleCallback === 'function' ? window.cancelIdleCallback(handle) : window.clearTimeout(handle));
    };
  }, [count]);

  const go = useCallback((i) => {
    const el = track.current;
    if (!el) return;
    const n = Math.max(1, el.children.length);
    const to = ((i % n) + n) % n;
    el.scrollTo({ left: to * el.clientWidth, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, []);

  /* Follow the scroll to light the right dot. */
  const onScroll = useCallback(() => {
    const el = track.current;
    if (el && el.clientWidth) setActive(Math.round(el.scrollLeft / el.clientWidth));
  }, []);

  useEffect(() => {
    if (!ready || count < 2) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const timer = window.setInterval(() => {
      if (paused.current || document.hidden) return;
      const el = track.current;
      if (el) go(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)) + 1);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [ready, count, go]);

  const pause = () => { paused.current = true; };
  const resume = () => { paused.current = false; };

  return (
    <div
      role="group"
      aria-roledescription="carousel"
      aria-label={label}
      className="absolute inset-0"
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
      onTouchStart={pause}
      onTouchEnd={resume}
    >
      <div ref={track} onScroll={onScroll} className="flex h-full w-full snap-x snap-mandatory overflow-x-auto scrollbar-hide">
        {Array.from({ length: total }, (_, i) => (
          <div key={i} role="group" aria-roledescription="slide" aria-label={`Photo ${i + 1} of ${count}`} className="relative h-full w-full flex-none snap-center">
            {renderSlide(i)}
          </div>
        ))}
      </div>
      {ready && count > 1 && (
        <>
          <button type="button" onClick={() => go(active - 1)} aria-label="Previous photo"
            className="absolute left-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-stone-800 shadow transition hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4A1224] md:flex">
            <FiChevronLeft aria-hidden="true" />
          </button>
          <button type="button" onClick={() => go(active + 1)} aria-label="Next photo"
            className="absolute right-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-stone-800 shadow transition hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4A1224] md:flex">
            <FiChevronRight aria-hidden="true" />
          </button>
          <div role="group" aria-label="Choose a photo" className="absolute inset-x-0 bottom-1 flex justify-center">
            {Array.from({ length: count }, (_, i) => (
              <button key={i} type="button" onClick={() => go(i)} aria-label={`Show photo ${i + 1}`} aria-current={i === active ? 'true' : undefined}
                className="group flex h-6 w-6 items-center justify-center focus:outline-none">
                <span className={`block h-2 rounded-full bg-white shadow transition-all motion-reduce:transition-none group-focus-visible:ring-2 group-focus-visible:ring-[#4A1224] ${i === active ? 'w-5 opacity-100' : 'w-2 opacity-70'}`} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
