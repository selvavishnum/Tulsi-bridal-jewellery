'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  FiShoppingCart, FiShield, FiRefreshCw,
  FiLock, FiStar, FiArrowRight,
  FiInstagram, FiExternalLink, FiFilter,
} from 'react-icons/fi';
import { useCart } from '@/context/CartContext';
import { cacheGet, cacheSet } from '@/lib/clientCache';
import ProductCard from '@/components/shop/ProductCard';
import CategoryShowcase from '@/components/home/CategoryShowcase';
import CustomerAvatar from '@/components/ui/CustomerAvatar';
import CloudinaryPicture from '@/components/ui/CloudinaryPicture';
import DeliveryMessage from '@/components/ui/DeliveryMessage';
import { normalizeShowcase } from '@/lib/categoryShowcase';
import CatalogImage from '@/components/ui/CatalogImage';
import { GRID_SIZES, SECTION_CONTAINER, gridSizes } from '@/lib/catalogImages';
import { nextHeroSlides, nextShowcase, nextDeliveryMessage, heroPhotoUrl, currentShipping, shippingBadge, pickTestimonials } from '@/lib/heroSlides';

function getCookie(name) {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}
function setCookie(name, val, days) {
  document.cookie = `${name}=${encodeURIComponent(val)}; max-age=${days * 86400}; path=/; SameSite=Lax`;
}

const DEFAULT_WA = '917695868787';
const WA_TEXT = "Hi! I'm interested in your fashion jewellery.";

/* ── Hero photo ──
   One editorial photo in a fixed 4:5 box (aspect-[4/5] reserves it before a
   byte arrives → no layout shift), centred under the header on a phone and the
   right half of the split on a desktop. Cloudinary crops the stored photo to
   the same 4:5 (`ratio`, g_auto keeps the chains and earrings in frame
   whatever shape the admin uploaded), so nothing is clipped by object-cover.

   The box is as wide as the CSS below makes it, and `sizes` says so — this is
   what the browser needs to pick a file before layout:
     phone      min(100%, 18rem) → 288px;  from 400px wide: 20rem → 320px
     768px up   24rem → 384px
     1024px up  half of max-w-7xl: the column is (100vw − 2·32px padding − 48px gap) / 2,
                capped by the box's 30rem → 480px at 1136px and up
   The ladder tops out at 1200: 480px at 2.5× (a 3× phone shows 288px: 864). It
   skips the full-bleed ladder's 1440–2400 rungs, which nothing here can use.
   'good' quality: shown at ≤ 480 CSS px, where it is indistinguishable from
   'best' at about half the bytes — the same call as the old phone crop. */
export const HERO_PHOTO = Object.freeze({
  ratio: 0.8,
  widths: Object.freeze([320, 480, 640, 828, 960, 1200]),
  sizes: '(min-width: 1024px) min(480px, calc((100vw - 112px) / 2)), (min-width: 768px) 384px, (min-width: 400px) 320px, 288px',
  quality: 'good',
  /* The photo is whatever the owner uploads as the first hero slide, so the alt text
     must not describe what it shows. */
  alt: 'Tulsi Fashion Jewellery — featured styles',
});

/* The box width at each breakpoint: keep in step with HERO_PHOTO.sizes (those
   are its widest case). On a phone that supports svh the box also shrinks on a
   short screen — 100svh minus 33rem, the room the rest of the hero needs, as
   wide as 4:5 allows, never under 14rem — so the headline, line and button
   stay above the fold on a 390×844 as well as a 412×915. svh is the screen
   with the browser bars showing, so the box never changes size as they hide. */
const PHOTO_BOX = [
  'w-[min(100%,18rem)] supports-[height:1svh]:w-[min(100%,18rem,max(14rem,calc((100svh-33rem)*0.8)))]',
  'min-[400px]:w-[min(100%,20rem)] min-[400px]:supports-[height:1svh]:w-[min(100%,20rem,max(14rem,calc((100svh-33rem)*0.8)))]',
  'md:w-[min(100%,24rem)] md:supports-[height:1svh]:w-[min(100%,24rem)]',
  'lg:w-full lg:max-w-[30rem] lg:supports-[height:1svh]:w-full',
].join(' ');

/* Shown when no hero photo is set (or its link fails): layered delicate chains
   with a pendant and a pair of drop earrings on the cream — the brand's own
   picture rather than an empty gap or a broken-image icon. Decorative. */
export function HeroIllustration() {
  const sparkle = (x, y, s = 1) => `M${x} ${y - 9 * s} Q${x + 1.2 * s} ${y - 1.2 * s} ${x + 9 * s} ${y} Q${x + 1.2 * s} ${y + 1.2 * s} ${x} ${y + 9 * s} Q${x - 1.2 * s} ${y + 1.2 * s} ${x - 9 * s} ${y} Q${x - 1.2 * s} ${y - 1.2 * s} ${x} ${y - 9 * s}Z`;
  const chains = ['M96 28 C112 176 288 176 304 28', 'M72 20 C92 270 308 270 328 20', 'M52 12 C74 360 326 360 348 12'];
  const earring = (x) => (
    <g transform={`translate(${x} 372)`}>
      <circle r="5" fill="url(#tj-hero-gold)" />
      <path d="M0 5 V30" stroke="url(#tj-hero-gold)" strokeWidth="1.6" />
      <path d="M0 30 C-9 44 -12 52 -12 58 A12 12 0 0 0 12 58 C12 52 9 44 0 30Z" fill="url(#tj-hero-gold)" />
      <circle cx="-3.5" cy="55" r="3" fill="#fff" opacity=".5" />
    </g>
  );
  return (
    <svg viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="tj-hero-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#F8F3EA" /><stop offset="1" stopColor="#EBE0CE" /></linearGradient>
        <linearGradient id="tj-hero-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ecc96b" /><stop offset=".55" stopColor="#c9973a" /><stop offset="1" stopColor="#9a6220" /></linearGradient>
        <radialGradient id="tj-hero-glow" cx=".5" cy=".36" r=".62"><stop offset="0" stopColor="#fff" stopOpacity=".9" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="400" height="500" fill="url(#tj-hero-bg)" />
      <rect width="400" height="500" fill="url(#tj-hero-glow)" />
      <g fill="none" stroke="url(#tj-hero-gold)" strokeLinecap="round">
        {chains.map((d) => (
          <g key={d}>
            <path d={d} strokeWidth="1.8" />
            <path d={d} strokeWidth="4.2" strokeDasharray="0.1 7.5" />
          </g>
        ))}
      </g>
      <circle cx="200" cy="207" r="4.5" fill="url(#tj-hero-gold)" />
      <path d="M200 273 V284" stroke="url(#tj-hero-gold)" strokeWidth="2" strokeLinecap="round" />
      <path d="M200 284 C190 298 186 306 186 312 A14 14 0 0 0 214 312 C214 306 210 298 200 284Z" fill="url(#tj-hero-gold)" />
      <circle cx="195" cy="309" r="3.4" fill="#fff" opacity=".5" />
      {earring(124)}
      {earring(276)}
      <g fill="url(#tj-hero-gold)" opacity=".75">
        <path d={sparkle(68, 118)} />
        <path d={sparkle(338, 98, .8)} />
        <path d={sparkle(322, 330, 1.1)} />
        <path d={sparkle(76, 292, .7)} />
      </g>
    </svg>
  );
}

/* The photo, or the illustration when there is none or it cannot load. */
export function HeroArt({ photoUrl }) {
  /* The link that failed, so a new photo gets its own chance. */
  const [failed, setFailed] = useState('');
  const broken = useCallback(() => setFailed(photoUrl), [photoUrl]);
  /* The server-rendered <img> can finish (and fail) loading before React
     attaches onError, so look once at what it already did. */
  const checkLoaded = useCallback((el) => {
    if (el && el.complete && el.naturalWidth === 0) broken();
  }, [broken]);
  if (!photoUrl || failed === photoUrl) return <HeroIllustration />;
  return (
    <CloudinaryPicture
      src={photoUrl}
      alt={HERO_PHOTO.alt}
      fill
      priority
      ratio={HERO_PHOTO.ratio}
      sizes={HERO_PHOTO.sizes}
      widths={HERO_PHOTO.widths}
      quality={HERO_PHOTO.quality}
      className="object-cover object-[50%_30%]"
      onError={broken}
      ref={checkLoaded}
    />
  );
}

/* A trust badge of the hero: one line, 24px tall. <DeliveryMessage surface="badge"/> draws the
   first badge in this very row, whatever shape the owner picks. (The one exception is words longer
   than WRAP_AFTER characters in deliveryMessageStyle.js: a phone cannot hold them on one line and
   the hero's overflow-hidden would cut them off, so that badge may wrap. The server-seeded HTML is
   already final, so even then nothing moves after the first paint.) */
const BADGE_ROW = 'inline-flex h-6 items-center gap-2 whitespace-nowrap text-[13px] font-medium text-stone-700';

/* The two badges that are fixed words: "COD Available" and the anti-tarnish line (there is
   no store setting that switches COD off for the whole shop, and "100% Anti-Tarnish Finish"
   is the owner's product claim). */
const FIXED_BADGES = [
  ['💵', 'COD Available'],
  ['🛡️', '100% Anti-Tarnish Finish'],
];

/* ── Hero: split screen ──
   Content left, photo right from 1024px; on a phone the photo comes first
   (centred), then the pill, headline, line and button, then the trust badges.
   Static: no timer, no animation, nothing that moves after the first paint.
   Exactly one <h1>.

   The first badge is the delivery message the owner manages (Admin → Settings →
   Marketing → Delivery message): `shippingLabel` is its words — '' when it must
   not be shown (switched off, or, in the default "smart" mode, shipping is not
   free on every order: shippingBadge decides) — and `deliveryMessage` is how it
   is drawn (icon, font, shape, colours). Without words another true badge takes
   its place, so the row never advertises "free above ₹N" and is never short of
   a badge. */
export function HeroSection({ photoUrl = '', shippingLabel = '', deliveryMessage = null }) {
  const delivery = typeof shippingLabel === 'string' ? shippingLabel.trim() : '';
  return (
    <section
      aria-labelledby="hero-heading"
      className="relative overflow-hidden bg-[#FAF8F5] bg-[radial-gradient(ellipse_at_85%_0%,rgba(236,201,107,0.16),transparent_55%),radial-gradient(ellipse_at_0%_100%,rgba(74,18,36,0.05),transparent_50%)] py-6 max-sm:[@media(max-height:720px)]:py-3 sm:py-10 lg:min-h-[40rem] lg:py-14"
    >
      <div className="section-container grid grid-cols-1 items-center gap-6 max-sm:[@media(max-height:720px)]:gap-3 lg:grid-cols-2 lg:gap-12">
        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <p className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-gold-300 bg-white/70 px-3.5 py-1.5 text-[10.5px] font-semibold tracking-[0.14em] text-gold-800 sm:px-4 sm:text-[11px] sm:tracking-[0.2em]">
            <span aria-hidden="true">✨</span> NEW CASUAL &amp; FESTIVE COLLECTION
          </p>
          <h1 id="hero-heading" className="mt-4 max-sm:[@media(max-height:720px)]:mt-2.5 font-serif text-[clamp(2.1rem,9.2vw,2.75rem)] font-bold leading-[1.05] tracking-tight text-stone-900 text-balance sm:text-5xl lg:mt-5 lg:text-[clamp(2.75rem,4.3vw,3.6rem)]">
            <span className="block">You Are The Occasion.</span>{' '}
            <span className="block text-[#4A1224]">Wear Your Style.</span>
          </h1>
          <p className="mt-4 max-sm:[@media(max-height:720px)]:mt-2.5 max-w-md text-[15px] leading-relaxed text-stone-600 max-sm:[@media(max-height:720px)]:text-sm max-sm:[@media(max-height:720px)]:leading-snug sm:text-base">
            Trending chains, necklaces, and daily-wear fashion jewellery crafted to make your everyday look unforgettable.
          </p>
          <Link
            href="/shop"
            className="group mt-6 max-sm:[@media(max-height:720px)]:mt-3.5 inline-flex min-h-12 min-w-[16rem] items-center justify-center gap-2.5 rounded-full bg-[#4A1224] px-7 py-3 text-[13px] font-semibold tracking-[0.1em] text-white shadow-lg shadow-[#4A1224]/20 transition-colors duration-300 hover:bg-gold-500 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A1224] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAF8F5] motion-reduce:transition-none lg:mt-8"
          >
            <span aria-hidden="true">⚡</span> Explore Collection
            <FiArrowRight aria-hidden="true" className="transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transition-none" />
          </Link>
          <ul role="list" className="mt-6 max-sm:[@media(max-height:720px)]:mt-3 flex flex-wrap justify-center gap-x-5 gap-y-2 lg:mt-8 lg:justify-start">
            {delivery ? (
              <DeliveryMessage as="li" surface="badge" text={delivery} config={deliveryMessage} />
            ) : (
              <li className={BADGE_ROW}>
                <span aria-hidden="true" className="text-base leading-none">🔒</span>Secure Checkout
              </li>
            )}
            {FIXED_BADGES.map(([icon, label]) => (
              <li key={icon} className={BADGE_ROW}>
                <span aria-hidden="true" className="text-base leading-none">{icon}</span>{label}
              </li>
            ))}
          </ul>
        </div>

        {/* Photo: above the words on a phone, right of them from 1024px — the words come first in the HTML (reading order). */}
        <div className="order-first flex justify-center lg:order-last">
          <div className={`relative ${PHOTO_BOX}`}>
            <div aria-hidden="true" className="absolute inset-0 translate-x-3 translate-y-3 rounded-[1.75rem] border border-gold-400/60" />
            <div className="relative aspect-[4/5] overflow-hidden rounded-[1.75rem] bg-ivory-200 shadow-[0_28px_60px_-30px_rgba(74,18,36,0.5)]">
              <HeroArt photoUrl={photoUrl} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const BROWSE_CATS = [
  { key: '',              label: 'All' },
  { key: 'chain',        label: 'Chains' },
  { key: 'necklace',     label: 'Necklaces' },
  { key: 'earrings',     label: 'Earrings' },
  { key: 'anklet',       label: 'Anklets' },
  { key: 'bracelet',     label: 'Bracelets' },
  { key: 'ring',         label: 'Rings' },
  { key: 'pendant',      label: 'Pendants' },
  { key: 'bangles',      label: 'Bangles' },
  { key: 'set',          label: 'Sets' },
];

const SORT_OPTIONS = [
  { value: 'createdAt:desc',      label: 'Newest First' },
  { value: 'price:asc',           label: 'Price: Low to High' },
  { value: 'price:desc',          label: 'Price: High to Low' },
  { value: 'ratings.average:desc',label: 'Top Rated' },
];

const BROWSE_LIMIT = 12;

/* The Instagram strip: `grid-cols-3 gap-2 md:gap-3` inside section-container. */
const INSTAGRAM_SIZES = gridSizes({ cols: [[0, 3]], gap: [[0, 8], [768, 12]], ...SECTION_CONTAINER });

const TRUST = [
  { icon: FiShield,    title: 'Anti-Tarnish Finish',  desc: 'Made to keep its shine' },
  { icon: FiStar,      title: 'Trending Styles',      desc: 'Daily-wear to festive looks' },
  { icon: FiRefreshCw, title: '7-Day Returns',        desc: 'For damaged or wrong items' },
  { icon: FiLock,      title: 'Secure Payment',       desc: 'Razorpay encrypted checkout' },
];

/* Instagram handle from whatever was saved in settings: a profile link
   (often with a share-tracking "?igsh=…" tail), "@handle" or "handle". */
export function instagramHandle(value, fallback = 'tulsibridal') {
  const v = String(value || '').trim();
  if (!v) return fallback;
  const m = v.match(/instagram\.com\/([^/?#]+)/i);
  const h = (m ? m[1] : v).replace(/^@/, '').split(/[/?#]/)[0];
  return /^[A-Za-z0-9._]{1,30}$/.test(h) ? h : fallback;
}

/* ── Happy Customers ──
   Only the reviews the admin entered (Admin → Settings → Happy Customers,
   already trimmed by pickTestimonials): with none, nothing is drawn — no
   sample reviews are made up to fill the space. */
export function CustomerReviews({ reviews }) {
  if (!Array.isArray(reviews) || reviews.length === 0) return null;
  return (
    <section className="py-16 bg-white">
      <div className="section-container">
        <div className="text-center mb-10">
          <div className="luxury-label justify-center mb-3">What Our Customers Say</div>
          <h2 className="font-serif text-3xl font-bold text-stone-900">Happy Customers</h2>
        </div>
        {/* Mobile: horizontal scroll; Desktop: 3-column grid */}
        <div className="flex gap-5 overflow-x-auto pb-3 md:overflow-visible md:grid md:grid-cols-3 md:pb-0 snap-x snap-mandatory md:snap-none scrollbar-hide">
          {reviews.map((t, i) => (
            <div key={i} className="bg-white border border-stone-100 shadow-sm rounded-2xl p-6 flex-shrink-0 w-[80vw] max-w-xs md:w-auto md:max-w-none snap-start flex flex-col hover:border-gold-300 transition-colors duration-300">
              {/* Customer photo + info at top */}
              <div className="flex items-center gap-3 mb-4">
                {/* Face-centred round Cloudinary photo; the initial badge if there's
                    no photo or it fails to load — never a broken image. */}
                <CustomerAvatar name={t.name} photo={t.photo} size={56} className="border-2 border-gold-500/60 shadow-sm" />
                <div>
                  <p className="font-semibold text-stone-900 text-sm">{t.name}</p>
                  {t.location && <p className="text-gold-700 text-xs font-medium">{t.location}</p>}
                  <div className="flex gap-0.5 mt-1">
                    {Array.from({ length: 5 }).map((_, si) => (
                      <FiStar key={si} className={`text-xs ${si < t.rating ? 'text-gold-500 fill-current' : 'text-stone-200 fill-current'}`} />
                    ))}
                  </div>
                </div>
              </div>
              {/* Review text */}
              <p className="font-serif text-stone-600 text-sm leading-relaxed italic flex-1">&ldquo;{t.review}&rdquo;</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Main Page ──
   `heroSlides` is what the server rendered into the HTML (src/app/page.js):
   an array (empty = none configured) when it could read the settings, null
   when it could not. `shipping` is the shipping rule it read at the same time
   (null = it could not), so the hero's first badge is true from the first
   paint instead of after the browser has fetched the charges. `deliveryMessage`
   is the owner's delivery message from the same read (null = it could not):
   whether the first badge is shown at all, its words and its look. */
export default function HomeClient({
  heroSlides: serverSlides = null,
  showcase: serverShowcase = null,
  shipping: serverShipping = null,
  deliveryMessage: serverMessage = null,
}) {
  const { charges: liveCharges } = useCart();
  const charges = currentShipping(liveCharges, serverShipping);
  const [siteSettings, setSiteSettings] = useState({});
  const seeded = Array.isArray(serverSlides);
  const [heroSlides, setHeroSlides] = useState(seeded ? serverSlides : []);
  /* The category showcase the server drew (null = it couldn't read the
     settings). Seeded, it is in the first HTML, so it can't pop in later and
     push the page down; unseeded, it waits for the settings as before. */
  const showcaseSeeded = !!serverShowcase;
  const [showcase, setShowcase] = useState(serverShowcase);
  /* The delivery message the server drew (null = it couldn't read the settings:
     the defaults until the browser knows better). Seeded, the badge is in the
     first HTML exactly as it will stay. */
  const messageSeeded = !!serverMessage;
  const [deliveryMessage, setDeliveryMessage] = useState(serverMessage);
  /* Only reviews the admin entered (Admin → Settings → Happy Customers): with
     none, the section is not drawn — no sample reviews are made up. */
  const [testimonials, setTestimonials] = useState([]);
  const [instagramFeed, setInstagramFeed] = useState([]);
  const [settingsReady, setSettingsReady] = useState(false);

  // Infinite scroll state
  const [browseProducts, setBrowseProducts] = useState([]);
  const [browsePage, setBrowsePage] = useState(1);
  const [browseHasMore, setBrowseHasMore] = useState(true);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseInitDone, setBrowseInitDone] = useState(false);
  const [browseCat, setBrowseCat] = useState('');
  const [browseSort, setBrowseSort] = useState('createdAt:desc');
  const sentinelRef = useRef(null);
  const browsePageRef = useRef(1);

  const waNumber = (siteSettings.whatsapp || siteSettings.phone || DEFAULT_WA).replace(/\D/g, '');
  const waLink = `https://wa.me/${waNumber}?text=${encodeURIComponent(WA_TEXT)}`;

  /* The floating WhatsApp button. On a phone's first screen it would sit right
     over the hero's trust badges ("COD Available" at 390×844 and 412×915), so
     below 640px it appears once the page has moved a little; from 640px up it
     covers nothing and is always there. Its initial state is the same on the
     server and in the first client render, and it is position:fixed, so
     neither hydration nor layout is touched. */
  const [pastHero, setPastHero] = useState(false);
  useEffect(() => {
    const onScroll = () => setPastHero(window.scrollY > 160);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    function applySettings(d, { cached = false } = {}) {
      setSiteSettings(d);
      /* Seeded slides are already on screen and newer than a copy this browser
         stored up to an hour ago, so only the fresh fetch may change them — and
         only when it differs: an identical list keeps the very same state, so
         the first photo is neither re-rendered nor re-fetched. */
      setHeroSlides((prev) => nextHeroSlides(prev, d.heroSlides, { stale: cached && seeded }));
      /* Same rule as the slides: a seeded showcase is newer than the copy this
         browser stored, and an identical one keeps its state (no re-render). */
      if (!(cached && showcaseSeeded)) setShowcase((prev) => nextShowcase(prev, normalizeShowcase(d)));
      /* And again for the delivery message: the seeded one beats this browser's
         stored copy, the fresh fetch may change it, an identical one is a no-op. */
      setDeliveryMessage((prev) => nextDeliveryMessage(prev, d, { stale: cached && messageSeeded }));
      if (Array.isArray(d.testimonials)) setTestimonials(pickTestimonials(d.testimonials));
      if (Array.isArray(d.instagramFeed)) setInstagramFeed(d.instagramFeed);
      setSettingsReady(true);
    }
    /* Show the cached copy at once, then always refresh it: an admin's
       change (e.g. hiding a category) shows on the next visit, not an hour
       later. */
    const cached = cacheGet('settings', 60 * 60 * 1000);
    if (cached) applySettings(cached, { cached: true });
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.data) { cacheSet('settings', d.data, 60 * 60 * 1000); applySettings(d.data); }
        else setSettingsReady(true);
      })
      .catch(() => setSettingsReady(true));
  }, [seeded, showcaseSeeded, messageSeeded]);

  // Fetch a page of browse products
  const fetchBrowse = useCallback(async (page, cat, sort, reset = false) => {
    if (browseLoading) return;
    setBrowseLoading(true);
    try {
      const [sortField, sortDir] = sort.split(':');
      const params = new URLSearchParams({ page, limit: BROWSE_LIMIT, sort: sortField, order: sortDir });
      if (cat) params.set('category', cat);
      const res = await fetch(`/api/products?${params}`);
      const data = await res.json();
      if (data.success) {
        const incoming = data.data.products || [];
        setBrowseProducts((prev) => reset ? incoming : [...prev, ...incoming]);
        setBrowseHasMore(page < data.data.pages);
        browsePageRef.current = page;
      }
    } catch {}
    finally { setBrowseLoading(false); setBrowseInitDone(true); }
  }, [browseLoading]);

  // Initial load — restore browse preferences from cookies
  useEffect(() => {
    const savedCat  = getCookie('tulsi-cat');
    const savedSort = getCookie('tulsi-sort') || 'createdAt:desc';
    if (savedCat)  setBrowseCat(savedCat);
    if (savedSort !== 'createdAt:desc') setBrowseSort(savedSort);
    fetchBrowse(1, savedCat, savedSort, true);
  }, []);

  // Cat / sort change → reset
  useEffect(() => {
    if (!browseInitDone) return;
    setBrowseProducts([]);
    setBrowsePage(1);
    setBrowseHasMore(true);
    fetchBrowse(1, browseCat, browseSort, true);
  }, [browseCat, browseSort]);

  // Persist browse preferences in cookies (30 days)
  useEffect(() => { setCookie('tulsi-cat',  browseCat,  30); }, [browseCat]);
  useEffect(() => { setCookie('tulsi-sort', browseSort, 30); }, [browseSort]);

  // IntersectionObserver — load next page when sentinel visible
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && browseHasMore && !browseLoading) {
          const next = browsePageRef.current + 1;
          setBrowsePage(next);
          fetchBrowse(next, browseCat, browseSort, false);
        }
      },
      { rootMargin: '200px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [browseHasMore, browseLoading, browseCat, browseSort, fetchBrowse]);

  const igHandle = instagramHandle(siteSettings.instagram);
  const igUrl = `https://www.instagram.com/${igHandle}/`;
  /* Only posts that actually have a photo — no empty grey tiles. */
  const igPosts = instagramFeed.filter((post) => post && post.imageUrl);

  return (
    <div className="min-h-screen bg-white">

      {/* ── HERO ── */}
      <HeroSection photoUrl={heroPhotoUrl(heroSlides)} shippingLabel={shippingBadge(charges, deliveryMessage)} deliveryMessage={deliveryMessage} />

      {/* ── TOP CATEGORIES (Admin → Settings → Category Showcase) ──
          Rendered once the settings are known, so a hidden category never
          flashes up first. */}
      {showcase && <CategoryShowcase showcase={showcase} />}

      {/* ── BROWSE ALL PRODUCTS (Infinite Scroll) ── */}
      <section className="py-12 bg-white" id="shop">
        <div className="section-container">
          {/* Header */}
          <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
            <div>
              <div className="luxury-label mb-2">Our Collection</div>
              <h2 className="font-serif text-2xl md:text-3xl font-bold text-stone-800">All Products</h2>
            </div>
            {/* Sort dropdown */}
            <div className="relative">
              <select
                aria-label="Sort products"
                value={browseSort}
                onChange={(e) => setBrowseSort(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 text-xs font-semibold border border-stone-200 rounded-xl bg-white text-stone-700 outline-none focus:ring-2 focus:ring-wine-300 cursor-pointer"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <FiFilter className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 text-xs pointer-events-none" />
            </div>
          </div>

          {/* Category filter chips — horizontal scroll on mobile */}
          <div className="flex gap-2 overflow-x-auto pb-3 mb-6 scrollbar-hide snap-x">
            {BROWSE_CATS.map((c) => (
              <button
                key={c.key}
                onClick={() => setBrowseCat(c.key)}
                className={`flex-shrink-0 snap-start px-4 py-1.5 rounded-full text-xs font-semibold transition-all border ${
                  browseCat === c.key
                    ? 'bg-wine-700 text-white border-wine-700 shadow-sm'
                    : 'bg-white text-stone-600 border-stone-200 hover:border-wine-400 hover:text-wine-700'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* Product Grid */}
          {!browseInitDone ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
              {Array.from({ length: BROWSE_LIMIT }).map((_, i) => (
                <div key={i}>
                  <div className="aspect-[3/4] skeleton rounded-lg mb-2" />
                  <div className="h-2.5 skeleton rounded w-1/3 mb-2" />
                  <div className="h-3.5 skeleton rounded w-3/4 mb-1.5" />
                  <div className="h-3 skeleton rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : browseProducts.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-5xl mb-4">💍</p>
              <p className="text-stone-500 text-sm font-medium">No products found in this category.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
                {browseProducts.map((p) => (
                  <ProductCard key={(p._id || p.id) + browseCat} product={p} showCategory sizes={GRID_SIZES.home} />
                ))}
              </div>

              {/* Loading skeletons for next batch */}
              {browseLoading && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 mt-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i}>
                      <div className="aspect-[3/4] skeleton rounded-lg mb-2" />
                      <div className="h-2.5 skeleton rounded w-1/3 mb-2" />
                      <div className="h-3.5 skeleton rounded w-3/4" />
                    </div>
                  ))}
                </div>
              )}

              {/* Sentinel — IntersectionObserver target */}
              {browseHasMore && <div ref={sentinelRef} className="h-10" />}

              {!browseHasMore && browseProducts.length > 0 && (
                <p className="text-center text-stone-500 text-xs mt-8 tracking-widest uppercase">You've seen all products</p>
              )}
            </>
          )}
        </div>
      </section>

      {/* ── SHOP PROMO ── */}
      <section className="relative py-16 bg-white border-y border-stone-100">
        <div className="section-container relative">
          <div className="max-w-xl mx-auto text-center">
            <span className="inline-block text-xs tracking-[0.4em] uppercase font-semibold text-gold-700 mb-5 border border-gold-300 px-3 py-1 rounded-full">
              Casual to Festive
            </span>
            <h2 className="font-serif text-4xl md:text-5xl font-bold text-stone-900 mb-5 leading-tight">
              Trending<br /><span className="text-wine-700">Fashion Jewellery</span>
            </h2>
            <p className="text-stone-500 text-sm leading-relaxed mb-10">
              Layer a delicate chain, add minimalist earrings or finish with an anklet — easy, modern pieces for everyday looks and festive evenings.
            </p>
            <div className="flex gap-4 justify-center flex-wrap">
              <Link href="/shop" className="inline-flex items-center gap-2 px-8 py-3.5 bg-gold-500 hover:bg-gold-400 text-stone-900 font-semibold text-sm tracking-luxury uppercase transition-all duration-300 shadow-gold">
                {/* Dark label on the gold: 6.6:1 (white was 2.6:1; 4.5:1 is the minimum). */}
                <FiShoppingCart aria-hidden="true" /> Shop Now
              </Link>
              <a href={waLink} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-8 py-3.5 border border-stone-300 hover:border-wine-700 text-stone-800 hover:text-wine-700 font-semibold text-sm tracking-luxury uppercase transition-all duration-300">
                WhatsApp Us
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── TRUST SIGNALS ── */}
      <section className="py-14 bg-white border-b border-stone-100">
        <div className="section-container">
          <div className="luxury-label justify-center mb-8">Why Choose Us</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {TRUST.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="text-center group">
                <div className="trust-icon-ring w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
                  <Icon className="text-velvet-800 text-xl" />
                </div>
                <p className="font-serif font-semibold text-stone-800 text-base mb-1">{title}</p>
                <p className="text-stone-500 text-xs">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HAPPY CUSTOMERS ── */}
      <CustomerReviews reviews={testimonials} />

      {/* ── INSTAGRAM FEED ── */}
      <section className="py-16 bg-white border-t border-stone-100">
        <div className="section-container">
          <div className="text-center mb-10">
            <div className="luxury-label justify-center mb-3">
              @{igHandle}
            </div>
            <h2 className="font-serif text-3xl font-bold text-stone-800">Follow Us on Instagram</h2>
          </div>

          {igPosts.length > 0 ? (
            <div className="grid grid-cols-3 gap-2 md:gap-3 mb-8">
              {igPosts.slice(0, 6).map((post, i) => (
                <a
                  key={i}
                  href={post.postUrl || igUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative aspect-square overflow-hidden rounded-xl bg-stone-100 block"
                >
                  {post.imageUrl && (
                    <CatalogImage
                      src={post.imageUrl}
                      alt={post.caption || 'Instagram post'}
                      fill
                      widths={[240, 400, 640]}
                      sizes={INSTAGRAM_SIZES}
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  )}
                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-all duration-300 flex flex-col items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                    {post.caption && (
                      <p className="text-white text-xs text-center px-3 leading-relaxed line-clamp-3">{post.caption}</p>
                    )}
                    <span className="inline-flex items-center gap-1 text-white text-xs font-semibold border border-white/60 px-3 py-1 rounded-full">
                      <FiExternalLink className="text-xs" /> View Post
                    </span>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed border-stone-200 rounded-2xl mb-8">
              <FiInstagram className="text-5xl text-stone-300 mb-4" />
              <p className="text-stone-500 font-medium mb-1">Follow us on Instagram</p>
              <a
                href={igUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-wine-700 font-semibold text-sm hover:underline"
              >
                @{igHandle}
              </a>
            </div>
          )}

          {/* Follow button */}
          <div className="text-center">
            <a
              href={igUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2.5 px-8 py-3.5 bg-gradient-to-r from-purple-600 via-pink-600 to-orange-500 text-white font-semibold text-sm tracking-luxury uppercase rounded-full hover:shadow-lg hover:scale-105 transition-all duration-300"
            >
              <FiInstagram className="text-base" />
              Follow @{igHandle} on Instagram
            </a>
          </div>
        </div>
      </section>

      {/* ── CTA STRIP ── */}
      <section className="bg-white border-t border-stone-100 py-14 text-center px-4">
        <p className="text-xs tracking-[0.35em] uppercase text-gold-700 font-semibold mb-3">Start Styling</p>
        <h2 className="font-serif text-3xl font-bold text-stone-900 mb-8">Find Your Perfect Jewellery</h2>
        <div className="flex justify-center gap-4 flex-wrap">
          <Link href="/catalog" className="inline-flex items-center gap-2 px-9 py-3.5 bg-gold-gradient text-white font-semibold text-sm tracking-luxury uppercase rounded-xl hover:shadow-gold transition-all duration-300">
            View Catalogue
          </Link>
          <a href={waLink} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-9 py-3.5 border border-stone-300 hover:border-wine-700 text-stone-800 hover:text-wine-700 font-semibold text-sm tracking-luxury uppercase rounded-xl transition-all duration-300">
            WhatsApp Us
          </a>
        </div>
      </section>

      {/* ── WHATSAPP FLOAT ── */}
      <a href={waLink} target="_blank" rel="noopener noreferrer" aria-label="Chat with us on WhatsApp"
        className={`fixed bottom-6 right-6 z-50 w-14 h-14 bg-green-500 hover:bg-green-400 text-white rounded-full flex items-center justify-center shadow-2xl shadow-green-900/30 transition-all duration-200 hover:scale-110${pastHero ? '' : ' max-sm:invisible max-sm:opacity-0'}`}>
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7" aria-hidden="true">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
      </a>
    </div>
  );
}
