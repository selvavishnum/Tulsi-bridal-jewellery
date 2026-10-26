'use client';

/* A row of cards you swipe (scroll-snap) or step through with the arrows (from 768px). Used by the
   homepage reviews and Instagram posts and by the advertisement banners when "Slider" is chosen. The
   cards size themselves (give each `flex-none snap-start` and a width), so the row never changes height
   when it hydrates. */
import { useRef } from 'react';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';

const arrow = 'absolute top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-stone-800 shadow-md ring-1 ring-black/5 transition hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4A1224] md:flex';

/**
 * @param {{ children: import('react').ReactNode, label?: string, className?: string }} props
 */
export default function SliderRow({ children, label = 'Slider', className = '' }) {
  const row = useRef(null);
  const step = (dir) => {
    const el = row.current;
    if (!el) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * Math.max(200, Math.round(el.clientWidth * 0.85)), behavior: reduced ? 'auto' : 'smooth' });
  };
  return (
    <div className="relative">
      <div ref={row} role="group" aria-roledescription="carousel" aria-label={label}
        className={`flex snap-x snap-mandatory overflow-x-auto scrollbar-hide ${className}`.trim()}>
        {children}
      </div>
      <button type="button" onClick={() => step(-1)} aria-label={`${label}: previous`} className={`left-2 ${arrow}`}><FiChevronLeft aria-hidden="true" /></button>
      <button type="button" onClick={() => step(1)} aria-label={`${label}: next`} className={`right-2 ${arrow}`}><FiChevronRight aria-hidden="true" /></button>
    </div>
  );
}
