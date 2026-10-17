'use client';

/* Homepage "Shop by Category" — rendered from the showcase settings
   (src/lib/categoryShowcase.js): only visible cards, in the admin's order,
   in the chosen shape (Circle / Square / King Size / Wide) as a grid or a
   touch slider; a featured card takes a double-size "king" slot.

   The admin's live preview renders this same component inside an iframe at
   the device's real width, so the preview is exactly what shoppers see. */
import { useRef } from 'react';
import Link from 'next/link';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { visibleItems, showcaseImageUrl, showcaseSrcSet, focusStyle } from '@/lib/categoryShowcase';

/* Full class strings (Tailwind only ships classes it can see in source). */
const GRID_COLS = {
  square: { small: 'grid-cols-3 md:grid-cols-6', medium: 'grid-cols-2 md:grid-cols-4', large: 'grid-cols-2 md:grid-cols-3' },
  king_size: { small: 'grid-cols-3 md:grid-cols-6', medium: 'grid-cols-2 md:grid-cols-4', large: 'grid-cols-2 md:grid-cols-3' },
  wide: { small: 'grid-cols-2 md:grid-cols-3', medium: 'grid-cols-1 md:grid-cols-2', large: 'grid-cols-1 md:grid-cols-2' },
};
/* Approximate rendered width, for srcset `sizes`. */
const GRID_SIZES = {
  square: { small: '(min-width: 768px) 16vw, 33vw', medium: '(min-width: 768px) 25vw, 50vw', large: '(min-width: 768px) 33vw, 50vw' },
  king_size: { small: '(min-width: 768px) 16vw, 33vw', medium: '(min-width: 768px) 25vw, 50vw', large: '(min-width: 768px) 33vw, 50vw' },
  wide: { small: '(min-width: 768px) 33vw, 50vw', medium: '(min-width: 768px) 50vw, 100vw', large: '(min-width: 768px) 50vw, 100vw' },
};
const ASPECT = { circle: 'aspect-square', square: 'aspect-square', king_size: 'aspect-[4/5]', wide: 'aspect-video' };
const FEATURED_SPAN = { square: 'col-span-2 row-span-2', king_size: 'col-span-2 row-span-2', wide: 'col-span-full' };

const CIRCLE = {
  small: 'w-20 h-20 md:w-28 md:h-28',
  medium: 'w-24 h-24 md:w-32 md:h-32',
  large: 'w-28 h-28 md:w-40 md:h-40',
};
const CIRCLE_FEATURED = {
  small: 'w-28 h-28 md:w-36 md:h-36',
  medium: 'w-32 h-32 md:w-44 md:h-44',
  large: 'w-36 h-36 md:w-52 md:h-52',
};
const CIRCLE_PX = { small: 112, medium: 128, large: 160 };

const SLIDE = {
  circle: 'w-24 md:w-36',
  square: 'w-[42vw] max-w-[260px] md:w-60',
  king_size: 'w-[44vw] max-w-[300px] md:w-64',
  wide: 'w-[82vw] max-w-[640px] md:w-[520px]',
};
const SLIDE_FEATURED = {
  circle: 'w-32 md:w-48',
  square: 'w-[68vw] max-w-[420px] md:w-96',
  king_size: 'w-[70vw] max-w-[440px] md:w-[400px]',
  wide: 'w-[90vw] max-w-[760px] md:w-[720px]',
};
const SLIDE_SIZES = {
  circle: '(min-width: 768px) 192px, 128px',
  square: '(min-width: 768px) 384px, 68vw',
  king_size: '(min-width: 768px) 400px, 70vw',
  wide: '(min-width: 768px) 720px, 90vw',
};

function Photo({ item, variant, sizes }) {
  if (!item.image) {
    return (
      <div className={`absolute inset-0 flex items-center justify-center bg-gradient-to-br ${item.color}`}>
        <span className="text-4xl md:text-5xl" aria-hidden="true">{item.emoji}</span>
      </div>
    );
  }
  const opts = { variant, focus: item.focus };
  return (
    <div className="absolute inset-0 overflow-hidden motion-safe:transition-transform motion-safe:duration-700 motion-safe:ease-out motion-safe:group-hover:scale-105">
      {/* Cloudinary crops and resizes on its CDN (srcset); next/image would only re-encode. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={showcaseImageUrl(item.image, { ...opts, width: 600 })}
        srcSet={showcaseSrcSet(item.image, opts)}
        sizes={sizes}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        className="h-full w-full"
        style={focusStyle(item.focus)}
      />
    </div>
  );
}

function TileCard({ item, variant, size, slide = false }) {
  const featured = item.isFeatured;
  const sizes = slide ? SLIDE_SIZES[variant] : featured ? GRID_SIZES[variant].medium : GRID_SIZES[variant][size];
  return (
    <Link
      href={item.href}
      className={`group relative block overflow-hidden rounded-2xl border bg-stone-50 transition-shadow duration-300 hover:shadow-luxury focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 ${ASPECT[variant]} ${featured ? 'border-gold-300' : 'border-stone-100 hover:border-gold-300/60'}`}
    >
      <Photo item={item} variant={variant} sizes={sizes} />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent px-3 pb-3 pt-12">
        <span className={`font-bold tracking-wide text-white drop-shadow-md ${featured ? 'text-lg md:text-2xl font-serif' : size === 'small' && !slide ? 'text-xs md:text-sm' : 'text-sm md:text-base'}`}>
          {item.label}
        </span>
      </div>
    </Link>
  );
}

function CircleCard({ item, size, slide = false }) {
  const featured = item.isFeatured;
  const frame = slide ? 'w-full aspect-square' : featured ? CIRCLE_FEATURED[size] : CIRCLE[size];
  return (
    <Link href={item.href} className={`group flex flex-col items-center gap-2.5 focus:outline-none ${slide ? 'w-full' : ''}`}>
      <span
        className={`relative block overflow-hidden rounded-full border-2 transition-shadow duration-300 group-hover:shadow-gold group-focus-visible:ring-2 group-focus-visible:ring-gold-400 ${frame} ${featured ? 'border-gold-400' : 'border-gold-200 group-hover:border-gold-400'}`}
      >
        <Photo item={item} variant="circle" sizes={`${Math.round(CIRCLE_PX[size] * (featured ? 1.4 : 1))}px`} />
      </span>
      <span className={`text-center font-semibold leading-tight text-stone-700 transition-colors group-hover:text-wine-700 ${featured ? 'text-sm md:text-base' : 'text-xs md:text-sm'}`}>
        {item.label}
      </span>
    </Link>
  );
}

function Arrow({ dir, label, Icon, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`absolute top-1/2 z-10 hidden -translate-y-1/2 items-center justify-center rounded-full border border-stone-200 bg-white/95 p-2.5 text-stone-700 shadow-luxury transition hover:border-gold-300 hover:text-wine-700 md:flex ${dir < 0 ? '-left-3' : '-right-3'}`}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}

function Slider({ items, variant }) {
  const track = useRef(null);
  const scroll = (dir) => {
    const el = track.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };
  return (
    <div className="relative">
      <Arrow dir={-1} label="Previous categories" Icon={FiChevronLeft} onClick={() => scroll(-1)} />
      <ul
        ref={track}
        className="-mx-4 flex snap-x snap-mandatory items-start gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 md:mx-0 md:gap-4 md:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => (
          <li key={item.key} className={`shrink-0 snap-start ${item.isFeatured ? SLIDE_FEATURED[variant] : SLIDE[variant]}`}>
            {variant === 'circle'
              ? <CircleCard item={item} size="large" slide />
              : <TileCard item={item} variant={variant} size="large" slide />}
          </li>
        ))}
      </ul>
      <Arrow dir={1} label="Next categories" Icon={FiChevronRight} onClick={() => scroll(1)} />
    </div>
  );
}

/**
 * @param {{ showcase: { layout: object, items: object[] }, headingId?: string }} props
 */
export default function CategoryShowcase({ showcase, headingId = 'shop-by-category' }) {
  const items = visibleItems(showcase);
  if (!items.length) return null;
  const { layoutVariant: variant, displayMode, size } = showcase.layout;

  let body;
  if (displayMode === 'slider') {
    body = <Slider items={items} variant={variant} />;
  } else if (variant === 'circle') {
    body = (
      <ul className="flex flex-wrap items-start justify-center gap-x-4 gap-y-6 md:gap-x-8">
        {items.map((item) => <li key={item.key}><CircleCard item={item} size={size} /></li>)}
      </ul>
    );
  } else {
    body = (
      <ul className={`grid grid-flow-row-dense gap-3 md:gap-4 ${GRID_COLS[variant][size]}`}>
        {items.map((item) => (
          <li key={item.key} className={item.isFeatured ? FEATURED_SPAN[variant] : ''}>
            <TileCard item={item} variant={variant} size={size} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="bg-white py-14" aria-labelledby={headingId}>
      <div className="section-container">
        <div className="mb-8 text-center">
          <div className="luxury-label mb-3 justify-center">Shop by Category</div>
          <h2 id={headingId} className="font-serif text-2xl font-bold text-stone-800 md:text-3xl">Discover Our Collections</h2>
        </div>
        {body}
      </div>
    </section>
  );
}
