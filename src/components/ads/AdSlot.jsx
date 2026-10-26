/* ─────────────────────────────────────────────
   One website-advertisement slot: the banner(s) an admin placed on a page
   (Admin → Settings → Marketing → Website Advertisements).

   Usage, on a server page / layout (nothing here needs the browser):

     const ads = adsForPlacement(await getAdvertisements(), 'shop');
     <AdSlot placement="shop" ads={ads} />

   Draws nothing when there is no visible ad, so a page without ads is exactly the page it was.
   The banners are in the server's HTML, in a box with a fixed shape, so a banner never pushes
   anything when the page loads. Several ads are a grid or — "Slider" — one swipeable row.
   Each banner is a link (a path on this site, or an https link in a new tab), with the owner's
   optional title and button text over a dark scrim so they read on any photo.

   Class strings are written out in full: Tailwind only ships classes it can see in source.
   ───────────────────────────────────────────── */
import Link from 'next/link';
import { normalizeLayout, isExternalLink } from '@/lib/marketing';
import FocusPhoto from '@/components/home/FocusPhoto';
import SliderRow from '@/components/home/SliderRow';

/**
 * @typedef {object} AdSlotProps
 * @property {'home'|'shop'|'category'|'product'|'cart'|'checkout'|'order-success'|'track-order'} placement
 *   which page the slot is on (one of PLACEMENT_VALUES in src/lib/marketing.js)
 * @property {{ layout: { layoutVariant: string, displayMode: string, size: string }, items: object[] }} [ads]
 *   what adsForPlacement(ads, placement) returned: the visible ads of this page, in order, and the
 *   layout. Omitted (or no items) → nothing is drawn.
 * @property {boolean} [priority]  the slot is at the top of the page: its first banner is fetched at once
 * @property {string} [className]  extra classes for the slot's wrapper (spacing around it)
 */

const FRAME = {
  circle: 'aspect-square rounded-full',
  square: 'aspect-square rounded-2xl',
  king_size: 'aspect-[4/5] rounded-2xl',
  wide: 'aspect-video rounded-2xl',
};
/* The most one banner is wide, so a single 16:9 banner is not a screenful on a desktop. */
const SINGLE_MAX = { large: 'max-w-4xl', medium: 'max-w-2xl', small: 'max-w-md' };
const GRID = {
  large: 'mx-auto grid max-w-4xl grid-cols-1 gap-4',
  medium: 'mx-auto grid max-w-5xl grid-cols-1 gap-4 md:grid-cols-2',
  small: 'mx-auto grid max-w-6xl grid-cols-2 gap-3 md:grid-cols-3',
};
const SLIDE = {
  large: 'w-[88vw] max-w-3xl md:w-[640px]',
  medium: 'w-[72vw] max-w-md md:w-96',
  small: 'w-[56vw] max-w-xs md:w-72',
};
/* How wide a banner is drawn, so the browser fetches the right file. */
const SIZES_GRID = {
  large: '(min-width: 896px) 896px, 100vw',
  medium: '(min-width: 1024px) 512px, (min-width: 768px) 50vw, 100vw',
  small: '(min-width: 1152px) 384px, (min-width: 768px) 33vw, 50vw',
};
const SIZES_SINGLE = { large: '(min-width: 896px) 896px, 100vw', medium: '(min-width: 672px) 672px, 100vw', small: '(min-width: 448px) 448px, 100vw' };
const SIZES_SLIDE = {
  large: '(min-width: 768px) 640px, 88vw',
  medium: '(min-width: 768px) 384px, 72vw',
  small: '(min-width: 768px) 288px, 56vw',
};
const WIDTHS = [480, 720, 960, 1280];

function Banner({ ad, layout, size, sizes, priority, slide }) {
  const frame = FRAME[layout.layoutVariant] || FRAME.wide;
  const hasText = !!(ad.title || ad.buttonText);
  const inner = (
    <>
      <FocusPhoto src={ad.image} alt={ad.title || 'Special offer'} variant={layout.layoutVariant} focus={ad.focus} widths={WIDTHS} sizes={sizes} priority={priority} />
      {hasText && (
        <span className="absolute inset-x-0 bottom-0 flex flex-col items-start gap-2 bg-gradient-to-t from-black/70 via-black/25 to-transparent px-4 pb-4 pt-12 sm:px-6 sm:pb-5">
          {ad.title && <span className="font-serif text-xl font-bold leading-tight text-white drop-shadow md:text-2xl">{ad.title}</span>}
          {ad.buttonText && (
            <span className="inline-flex min-h-9 items-center rounded-full bg-gold-500 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-stone-900 shadow">{ad.buttonText}</span>
          )}
        </span>
      )}
    </>
  );
  const cls = `group relative block overflow-hidden bg-stone-100 shadow-sm ring-1 ring-black/5 ${frame} ${slide ? `flex-none snap-start ${SLIDE[size]}` : ''} focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4A1224] focus-visible:ring-offset-2`;
  if (!ad.link) return <div className={cls}>{inner}</div>;
  return isExternalLink(ad.link)
    ? <a href={ad.link} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a>
    : <Link href={ad.link} className={cls}>{inner}</Link>;
}

/** @param {AdSlotProps} props */
export function AdSlot({ placement, ads, priority = false, className = '' }) {
  const items = Array.isArray(ads?.items) ? ads.items : [];
  if (items.length === 0) return null;
  const layout = normalizeLayout(ads.layout, 'ads');
  const size = SINGLE_MAX[layout.size] ? layout.size : 'large';
  const slider = layout.displayMode === 'slider' && items.length > 1;
  const single = items.length === 1;
  return (
    <section aria-label="Offers" data-ad-slot={placement} className={`section-container ${className}`.trim()}>
      {slider ? (
        <SliderRow label="Offers" className="gap-3 pb-1">
          {items.map((ad, i) => <Banner key={ad.id || i} ad={ad} layout={layout} size={size} sizes={SIZES_SLIDE[size]} priority={priority && i === 0} slide />)}
        </SliderRow>
      ) : single ? (
        <div className={`mx-auto ${SINGLE_MAX[size]}`}>
          <Banner ad={items[0]} layout={layout} size={size} sizes={SIZES_SINGLE[size]} priority={priority} />
        </div>
      ) : (
        <div className={GRID[size]}>
          {items.map((ad, i) => <Banner key={ad.id || i} ad={ad} layout={layout} size={size} sizes={SIZES_GRID[size]} priority={priority && i === 0} />)}
        </div>
      )}
    </section>
  );
}

export default AdSlot;
