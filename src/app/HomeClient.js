'use client';

import { useState, useEffect, useRef, useCallback } from 'react';import Link from 'next/link';
import Image from 'next/image';
import {
  FiShoppingCart, FiShield, FiRefreshCw,
  FiLock, FiStar, FiCalendar, FiArrowRight, FiChevronLeft, FiChevronRight,
  FiInstagram, FiExternalLink, FiFilter,
} from 'react-icons/fi';
import { useCart } from '@/context/CartContext';
import { cacheGet, cacheSet } from '@/lib/clientCache';
import ProductCard from '@/components/shop/ProductCard';

function getCookie(name) {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}
function setCookie(name, val, days) {
  document.cookie = `${name}=${encodeURIComponent(val)}; max-age=${days * 86400}; path=/; SameSite=Lax`;
}

const DEFAULT_WA = '917695868787';

/* Default slides shown when admin hasn't configured hero banners */
const DEFAULT_SLIDES = [
  {
    id: '1',
    tag: 'New Bridal Collection',
    title: 'You Are\nThe Occasion',
    subtitle: 'Jewellery Crafted for Brides',
    ctaText: 'Shop Collection',
    ctaLink: '/shop',
    cta2Text: 'Book Rental',
    cta2Link: '/rentals',
    bg: 'from-wine-900 via-wine-800 to-velvet-900',
    imageUrl: '',
  },
  {
    id: '2',
    tag: 'Premium Rental Jewellery',
    title: 'Rent. Wear.\nShine.',
    subtitle: 'Date-wise booking · Doorstep delivery',
    ctaText: 'Browse Rentals',
    ctaLink: '/rentals',
    cta2Text: 'Know More',
    cta2Link: '/about',
    bg: 'from-velvet-900 via-wine-900 to-wine-800',
    imageUrl: '',
  },
];

const CATEGORIES = [
  { key: 'necklace',    label: 'Necklaces',   href: '/catalog?category=necklace',    emoji: '📿', color: 'from-rose-50 to-pink-50' },
  { key: 'earrings',   label: 'Earrings',    href: '/catalog?category=earrings',    emoji: '✨', color: 'from-amber-50 to-yellow-50' },
  { key: 'bangles',    label: 'Bangles',     href: '/catalog?category=bangles',     emoji: '🟡', color: 'from-orange-50 to-amber-50' },
  { key: 'maang-tikka', label: 'Maang Tikka', href: '/catalog?category=maang-tikka', emoji: '👑', color: 'from-purple-50 to-violet-50' },
  { key: 'set',        label: 'Bridal Sets', href: '/catalog?category=set',         emoji: '💍', color: 'from-red-50 to-rose-50' },
  { key: 'rentals',    label: 'Rentals',     href: '/rentals',                      emoji: '🗓️', color: 'from-gold-50 to-amber-50' },
];

const BROWSE_CATS = [
  { key: '',              label: 'All' },
  { key: 'necklace',     label: 'Necklace' },
  { key: 'earrings',     label: 'Earrings' },
  { key: 'bangles',      label: 'Bangles' },
  { key: 'bracelet',     label: 'Bracelet' },
  { key: 'ring',         label: 'Ring' },
  { key: 'set',          label: 'Bridal Set' },
  { key: 'maang-tikka',  label: 'Maang Tikka' },
  { key: 'jhumka',       label: 'Jhumka' },
  { key: 'mangalsutra',  label: 'Mangalsutra' },
  { key: 'anklet',       label: 'Anklet' },
  { key: 'kada',         label: 'Kada' },
  { key: 'pendant',      label: 'Pendant' },
];

const SORT_OPTIONS = [
  { value: 'createdAt:desc',      label: 'Newest First' },
  { value: 'price:asc',           label: 'Price: Low to High' },
  { value: 'price:desc',          label: 'Price: High to Low' },
  { value: 'ratings.average:desc',label: 'Top Rated' },
];

const BROWSE_LIMIT = 12;

const TRUST = [
  { icon: FiShield,    title: '100% Authentic',       desc: 'Certified genuine pieces' },
  { icon: FiStar,      title: 'Expert Craftsmanship', desc: 'Handpicked artisan designs' },
  { icon: FiRefreshCw, title: 'Easy Returns',         desc: '7-day hassle-free policy' },
  { icon: FiLock,      title: 'Secure Payment',       desc: 'Razorpay encrypted checkout' },
];

const DEFAULT_TESTIMONIALS = [
  { name: 'Priya Sharma', location: 'Chennai', rating: 5, review: 'Absolutely beautiful jewellery! The quality is amazing and the delivery was super fast. Wore it for my wedding and got so many compliments!', photo: '' },
  { name: 'Deepa Krishnan', location: 'Coimbatore', rating: 5, review: "Rented the bridal set for my sister's wedding. The pieces were stunning and everyone loved them. Will definitely come back!", photo: '' },
  { name: 'Anitha Rajan', location: 'Madurai', rating: 5, review: "Best quality imitation jewellery I've seen. The stone work is so detailed. Great value for money!", photo: '' },
];

/* ── Gold Particle Canvas ── */
function HeroParticles() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const setSize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    setSize();
    window.addEventListener('resize', setSize);

    const ctx = canvas.getContext('2d');
    const GOLD = [[228,176,64],[201,151,58],[244,223,160]];
    const pts = Array.from({ length: 55 }, () => ({
      x:   Math.random() * canvas.width,
      y:   Math.random() * canvas.height,
      r:   Math.random() * 1.6 + 0.4,
      vy:  -(Math.random() * 0.45 + 0.15),
      vx:  (Math.random() - 0.5) * 0.22,
      a:   Math.random() * 0.55 + 0.08,
      c:   GOLD[Math.floor(Math.random() * GOLD.length)],
    }));

    let raf;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pts.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${p.a})`;
        ctx.fill();
        p.x += p.vx;
        p.y += p.vy;
        p.a -= 0.0004;
        if (p.y < -8 || p.a <= 0.01) {
          p.x = Math.random() * canvas.width;
          p.y = canvas.height + 8;
          p.a = Math.random() * 0.55 + 0.08;
          p.r = Math.random() * 1.6 + 0.4;
        }
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', setSize); };
  }, []);
  return <canvas ref={canvasRef} className="hero-canvas" />;
}

/* ── Hero Slider ── */
function HeroSlider({ slides }) {
  const [current, setCurrent] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const timerRef = useRef(null);
  const displaySlides = slides.length > 0 ? slides : DEFAULT_SLIDES;

  const goTo = useCallback((idx) => {
    if (transitioning) return;
    setTransitioning(true);
    setTimeout(() => {
      setCurrent(idx);
      setTransitioning(false);
    }, 300);
  }, [transitioning]);

  const next = useCallback(() => goTo((current + 1) % displaySlides.length), [current, displaySlides.length, goTo]);
  const prev = useCallback(() => goTo((current - 1 + displaySlides.length) % displaySlides.length), [current, displaySlides.length, goTo]);

  useEffect(() => {
    timerRef.current = setInterval(next, 5000);
    return () => clearInterval(timerRef.current);
  }, [next]);

  const slide = displaySlides[current];

  return (
    <section className="relative w-full overflow-hidden bg-stone-100 hero-viewport">
      {/* Slide image / gradient background */}
      <div className={`absolute inset-0 transition-opacity duration-500 ${transitioning ? 'opacity-0' : 'opacity-100'}`}>
        {slide.imageUrl ? (
          <Image
            src={slide.imageUrl}
            alt={slide.title || 'Bridal jewellery'}
            fill
            priority
            className="object-cover object-top"
            sizes="100vw"
          />
        ) : (
          <div className={`w-full h-full bg-gradient-to-br ${slide.bg}`}>
            {/* Decorative texture */}
            <div className="absolute inset-0 opacity-[0.04]" style={{
              backgroundImage: 'repeating-linear-gradient(45deg, #c9973a 0, #c9973a 1px, transparent 0, transparent 40px)',
            }} />
            {/* Brand crown */}
            <div className="absolute inset-0 flex items-center justify-end pr-12 md:pr-24">
              <div className="opacity-10">
                <svg width="320" height="280" viewBox="0 0 52 44" fill="none">
                  <path d="M26 2L32 16L44 8L38 24H14L8 8L20 16L26 2Z" fill="#c9973a"/>
                  <rect x="10" y="26" width="32" height="6" rx="1" fill="#c9973a"/>
                  <rect x="12" y="34" width="28" height="5" rx="1" fill="#b87d2a"/>
                </svg>
              </div>
            </div>
          </div>
        )}

        {/* Overlay gradient for text readability */}
        {slide.imageUrl ? (
          <div className="absolute inset-0 bg-gradient-to-r from-black/65 via-black/25 to-transparent" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
        )}
      </div>

      {/* Gold dust particles */}
      <HeroParticles />

      {/* Slide text content */}
      <div className={`relative z-10 h-full flex items-center transition-opacity duration-500 ${transitioning ? 'opacity-0' : 'opacity-100'}`}>
        <div className="section-container w-full">
          <div className="max-w-xl text-white">
            {slide.tag && (
              <div className="luxury-label mb-5 text-gold-400">{slide.tag}</div>
            )}
            <h1 className="font-serif font-bold text-white leading-[1.05] mb-5 whitespace-pre-line text-balance"
              style={{ fontSize: 'clamp(2.8rem, 7vw, 5.5rem)', textShadow: '0 2px 32px rgba(0,0,0,0.35)', letterSpacing: '-0.01em' }}>
              {slide.title}
            </h1>
            {slide.subtitle && (
              <p className="text-white/65 text-sm md:text-base mb-9 font-light tracking-widest uppercase" style={{ letterSpacing: '0.14em' }}>
                {slide.subtitle}
              </p>
            )}
            <div className="flex gap-3 flex-wrap">
              {slide.ctaText && (
                <Link href={slide.ctaLink || '/shop'} className="inline-flex items-center gap-2.5 px-8 py-3.5 bg-gold-gradient text-white font-semibold text-xs tracking-[0.18em] uppercase transition-all duration-300 shadow-gold hover:shadow-lg hover:-translate-y-0.5 group">
                  {slide.ctaText} <FiArrowRight className="group-hover:translate-x-1 transition-transform duration-200" />
                </Link>
              )}
              {slide.cta2Text && (
                <Link href={slide.cta2Link || '/rentals'} className="inline-flex items-center gap-2.5 px-8 py-3.5 border border-white/30 hover:border-gold-400/70 text-white/80 hover:text-gold-300 font-semibold text-xs tracking-[0.18em] uppercase transition-all duration-300 backdrop-blur-sm">
                  <FiCalendar className="text-sm" /> {slide.cta2Text}
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Arrow navigation */}
      {displaySlides.length > 1 && (
        <>
          <button onClick={prev} className="absolute left-4 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 backdrop-blur-sm flex items-center justify-center text-white transition-all duration-200 hover:scale-110">
            <FiChevronLeft className="text-xl" />
          </button>
          <button onClick={next} className="absolute right-4 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 backdrop-blur-sm flex items-center justify-center text-white transition-all duration-200 hover:scale-110">
            <FiChevronRight className="text-xl" />
          </button>
        </>
      )}

      {/* Dot indicators */}
      {displaySlides.length > 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex gap-2">
          {displaySlides.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={`transition-all duration-300 rounded-full ${i === current ? 'w-7 h-2.5 bg-gold-400' : 'w-2.5 h-2.5 bg-white/40 hover:bg-white/70'}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/* Instagram handle from whatever was saved in settings: a profile link
   (often with a share-tracking "?igsh=…" tail), "@handle" or "handle". */
export function instagramHandle(value, fallback = 'tulsibridal') {
  const v = String(value || '').trim();
  if (!v) return fallback;
  const m = v.match(/instagram\.com\/([^/?#]+)/i);
  const h = (m ? m[1] : v).replace(/^@/, '').split(/[/?#]/)[0];
  return /^[A-Za-z0-9._]{1,30}$/.test(h) ? h : fallback;
}

/* ── Main Page ── */
export default function HomeClient() {
  const { charges } = useCart();
  const deliveryStat = !charges.enable_shipping_fee
    ? ['Free', 'Delivery']
    : charges.free_shipping_threshold > 0 ? ['Free', `Above ₹${charges.free_shipping_threshold.toLocaleString('en-IN')}`] : [`₹${charges.shipping_fee_amount}`, 'Delivery'];
  const [siteSettings, setSiteSettings] = useState({});
  const [heroSlides, setHeroSlides] = useState([]);
  const [testimonials, setTestimonials] = useState(DEFAULT_TESTIMONIALS);
  const [instagramFeed, setInstagramFeed] = useState([]);
  const [categoryImages, setCategoryImages] = useState({});

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

  useEffect(() => {
    function applySettings(d) {
      setSiteSettings(d);
      if (Array.isArray(d.heroSlides)) setHeroSlides(d.heroSlides);
      if (Array.isArray(d.testimonials) && d.testimonials.length > 0) setTestimonials(d.testimonials);
      if (Array.isArray(d.instagramFeed)) setInstagramFeed(d.instagramFeed);
      if (d.categoryImages && typeof d.categoryImages === 'object') setCategoryImages(d.categoryImages);
    }
    const cached = cacheGet('settings', 60 * 60 * 1000);
    if (cached) { applySettings(cached); return; }
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.data) { cacheSet('settings', d.data, 60 * 60 * 1000); applySettings(d.data); }
      })
      .catch(() => {});
  }, []);

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

      {/* ── HERO SLIDER ── */}
      <HeroSlider slides={heroSlides} />

      {/* ── TOP CATEGORIES ── */}
      {(() => {
        const shape = siteSettings.categoryShape || 'square';
        const size  = siteSettings.categorySize  || 'large';

        /* Square full-image style (Kushal-like) */
        if (shape === 'square') {
          const cols  = size === 'small' ? 'grid-cols-3' : 'grid-cols-2';
          const aspect = size === 'small' ? 'aspect-square' : size === 'medium' ? 'aspect-[3/4]' : 'aspect-[4/5]';
          const radius = 'rounded-2xl';
          return (
            <section className="py-14 bg-white">
              <div className="section-container">
                <div className="text-center mb-8">
                  <div className="luxury-label justify-center mb-3">Shop by Category</div>
                  <h2 className="font-serif text-2xl md:text-3xl font-bold text-stone-800">Discover Our Collections</h2>
                </div>
                <div className={`grid ${cols} gap-3 md:gap-4`}>
                  {CATEGORIES.map((cat) => {
                    const photo = categoryImages[cat.key];
                    return (
                      <Link key={cat.href} href={cat.href}
                        className={`group relative ${aspect} overflow-hidden ${radius} bg-gradient-to-br ${cat.color} border border-stone-100 hover:border-gold-300/60 hover:shadow-luxury transition-all duration-400`}>
                        {photo ? (
                          <Image src={photo} alt={cat.label} fill sizes="(max-width: 768px) 50vw, 25vw" className="object-cover group-hover:scale-105 transition-transform duration-700 ease-out" />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className={size === 'small' ? 'text-3xl' : size === 'medium' ? 'text-5xl' : 'text-6xl'}>{cat.emoji}</span>
                          </div>
                        )}
                        {/* Gold shimmer overlay on hover */}
                        <div className="absolute inset-0 bg-gradient-to-t from-gold-600/0 to-transparent group-hover:from-gold-600/10 transition-all duration-400" />
                        {/* Bottom name overlay */}
                        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent pt-12 pb-3 px-3">
                          <span className={`text-white font-bold drop-shadow-md tracking-wide ${size === 'small' ? 'text-xs' : size === 'medium' ? 'text-sm' : 'text-base'}`}>{cat.label}</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </section>
          );
        }

        /* Circle style */
        const cols   = size === 'large' ? 'grid-cols-3' : size === 'medium' ? 'grid-cols-3' : 'grid-cols-3';
        const imgSz  = size === 'small' ? 'w-20 h-20' : size === 'medium' ? 'w-24 h-24 md:w-28 md:h-28' : 'w-28 h-28 md:w-36 md:h-36';
        const txtSz  = size === 'small' ? 'text-xs' : size === 'medium' ? 'text-xs' : 'text-sm';
        return (
          <section className="py-14 bg-white">
            <div className="section-container">
              <div className="text-center mb-8">
                <div className="luxury-label justify-center mb-3">Shop by Category</div>
                <h2 className="font-serif text-2xl md:text-3xl font-bold text-stone-800">Discover Our Collections</h2>
              </div>
              <div className={`grid ${cols} gap-4 md:gap-6`}>
                {CATEGORIES.map((cat) => {
                  const photo = categoryImages[cat.key];
                  return (
                    <Link key={cat.href} href={cat.href} className="group flex flex-col items-center gap-3">
                      <div className="relative">
                        {/* Gold glow ring on hover */}
                        <div className={`relative ${imgSz} rounded-full overflow-hidden border-2 border-gold-200 group-hover:border-gold-400 group-hover:shadow-gold flex items-center justify-center bg-gradient-to-br ${cat.color} transition-all duration-400`}>
                          {photo ? (
                            <Image src={photo} alt={cat.label} fill sizes="150px" className="object-cover group-hover:scale-108 transition-transform duration-500" />
                          ) : (
                            <span className={size === 'small' ? 'text-2xl' : size === 'medium' ? 'text-3xl' : 'text-4xl'}>{cat.emoji}</span>
                          )}
                        </div>
                      </div>
                      <span className={`${txtSz} font-semibold text-stone-700 group-hover:text-wine-700 transition-colors leading-tight text-center`}>{cat.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </section>
        );
      })()}

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
              <p className="text-stone-400 text-sm font-medium">No products found in this category.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
                {browseProducts.map((p) => (
                  <ProductCard key={(p._id || p.id) + browseCat} product={p} showCategory />
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
                <p className="text-center text-stone-400 text-xs mt-8 tracking-widest uppercase">You've seen all products</p>
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
              Crafted for Your Special Day
            </span>
            <h2 className="font-serif text-4xl md:text-5xl font-bold text-stone-900 mb-5 leading-tight">
              Exquisite Bridal<br /><span className="text-wine-700">Jewellery Collection</span>
            </h2>
            <p className="text-stone-500 text-sm leading-relaxed mb-10">
              Discover our exclusive collection of handcrafted bridal jewellery — timeless designs for your most memorable moments.
            </p>
            <div className="grid grid-cols-3 gap-6 mb-10 max-w-xs mx-auto">
              {[['500+', 'Designs'], ['100%', 'Authentic'], deliveryStat].map(([val, label]) => (
                <div key={label}>
                  <p className="font-serif text-2xl font-bold text-gold-700">{val}</p>
                  <p className="text-stone-500 text-xs tracking-wider">{label}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-4 justify-center flex-wrap">
              <Link href="/shop" className="inline-flex items-center gap-2 px-8 py-3.5 bg-gold-500 hover:bg-gold-400 text-white font-semibold text-sm tracking-luxury uppercase transition-all duration-300 shadow-gold">
                <FiShoppingCart /> Shop Now
              </Link>
              <a href={`https://wa.me/${waNumber}?text=${encodeURIComponent("Hi! I'd like to enquire about your bridal jewellery collection.")}`} target="_blank" rel="noopener noreferrer"
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
          <div className="luxury-label justify-center mb-8">Why Brides Choose Us</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {TRUST.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="text-center group">
                <div className="trust-icon-ring w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
                  <Icon className="text-velvet-800 text-xl" />
                </div>
                <p className="font-serif font-semibold text-stone-800 text-base mb-1">{title}</p>
                <p className="text-stone-400 text-xs">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HAPPY CUSTOMERS ── */}
      <section className="py-16 bg-white">
        <div className="section-container">
          <div className="text-center mb-10">
            <div className="luxury-label justify-center mb-3">What Our Brides Say</div>
            <h2 className="font-serif text-3xl font-bold text-stone-900">Happy Customers</h2>
          </div>
          {/* Mobile: horizontal scroll; Desktop: 3-column grid */}
          <div className="flex gap-5 overflow-x-auto pb-3 md:overflow-visible md:grid md:grid-cols-3 md:pb-0 snap-x snap-mandatory md:snap-none scrollbar-hide">
            {testimonials.map((t, i) => (
              <div key={i} className="bg-white border border-stone-100 shadow-sm rounded-2xl p-6 flex-shrink-0 w-[80vw] max-w-xs md:w-auto md:max-w-none snap-start flex flex-col hover:border-gold-300 transition-colors duration-300">
                {/* Customer photo + info at top */}
                <div className="flex items-center gap-3 mb-4">
                  {t.photo ? (
                    <div className="relative w-12 h-12 rounded-full overflow-hidden flex-shrink-0 border-2 border-gold-500/60 shadow-sm">
                      <Image src={t.photo} alt={t.name} fill className="object-cover" />
                    </div>
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-wine-50 flex items-center justify-center flex-shrink-0 border-2 border-gold-300">
                      <span className="text-wine-700 font-serif font-bold text-lg">{(t.name || 'C')[0].toUpperCase()}</span>
                    </div>
                  )}
                  <div>
                    <p className="font-semibold text-stone-900 text-sm">{t.name}</p>
                    {t.location && <p className="text-gold-700 text-xs font-medium">{t.location}</p>}
                    <div className="flex gap-0.5 mt-1">
                      {Array.from({ length: 5 }).map((_, si) => (
                        <FiStar key={si} className={`text-xs ${si < (t.rating || 5) ? 'text-gold-500 fill-current' : 'text-stone-200 fill-current'}`} />
                      ))}
                    </div>
                  </div>
                </div>
                {/* Review text */}
                <p className="font-serif text-stone-600 text-sm leading-relaxed italic flex-1">"{t.review || t.text}"</p>
              </div>
            ))}
          </div>
        </div>
      </section>

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
                    <Image
                      src={post.imageUrl}
                      alt={post.caption || 'Instagram post'}
                      fill
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
        <p className="text-xs tracking-[0.35em] uppercase text-gold-700 font-semibold mb-3">Begin Your Bridal Journey</p>
        <h2 className="font-serif text-3xl font-bold text-stone-900 mb-8">Find Your Perfect Jewellery</h2>
        <div className="flex justify-center gap-4 flex-wrap">
          <Link href="/catalog" className="inline-flex items-center gap-2 px-9 py-3.5 bg-gold-gradient text-white font-semibold text-sm tracking-luxury uppercase rounded-xl hover:shadow-gold transition-all duration-300">
            View Catalogue
          </Link>
          <a href={`https://wa.me/${waNumber}?text=${encodeURIComponent("Hi! I'm interested in your bridal jewellery collection.")}`} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-9 py-3.5 border border-stone-300 hover:border-wine-700 text-stone-800 hover:text-wine-700 font-semibold text-sm tracking-luxury uppercase rounded-xl transition-all duration-300">
            WhatsApp Us
          </a>
        </div>
      </section>

      {/* ── WHATSAPP FLOAT ── */}
      <a href={`https://wa.me/${waNumber}?text=${encodeURIComponent("Hi! I'm interested in your bridal jewellery.")}`} target="_blank" rel="noopener noreferrer"
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-green-500 hover:bg-green-400 text-white rounded-full flex items-center justify-center shadow-2xl shadow-green-900/30 transition-all duration-200 hover:scale-110">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
      </a>
    </div>
  );
}
