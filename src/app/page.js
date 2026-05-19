'use client';

import { useState, useEffect, useRef, useCallback } from 'react';import Link from 'next/link';
import Image from 'next/image';
import {
  FiHeart, FiShoppingCart, FiShield, FiRefreshCw,
  FiLock, FiStar, FiCalendar, FiArrowRight, FiChevronLeft, FiChevronRight,
  FiInstagram, FiExternalLink, FiFilter,
} from 'react-icons/fi';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { formatPrice, getDiscountPercentage } from '@/lib/utils';
import { cacheGet, cacheSet } from '@/lib/clientCache';
import toast from 'react-hot-toast';

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
    <section className="relative w-full overflow-hidden bg-stone-100" style={{ height: 'calc(100vh - 88px)', minHeight: '520px', maxHeight: '860px' }}>
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
        {slide.imageUrl && (
          <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/20 to-transparent md:via-black/10" />
        )}
      </div>

      {/* Slide text content */}
      <div className={`relative z-10 h-full flex items-center transition-opacity duration-500 ${transitioning ? 'opacity-0' : 'opacity-100'}`}>
        <div className="section-container w-full">
          <div className={`max-w-lg ${slide.imageUrl ? 'text-white' : 'text-white'}`}>
            {slide.tag && (
              <span className="inline-block text-xs tracking-[0.35em] uppercase font-semibold text-gold-400 mb-4 border border-gold-400/40 px-3 py-1 rounded-full">
                {slide.tag}
              </span>
            )}
            <h1 className="font-serif font-bold text-white leading-tight mb-4 whitespace-pre-line"
              style={{ fontSize: 'clamp(2.4rem, 6vw, 5rem)', textShadow: slide.imageUrl ? '0 2px 20px rgba(0,0,0,0.4)' : 'none' }}>
              {slide.title}
            </h1>
            {slide.subtitle && (
              <p className="text-white/70 text-base md:text-lg mb-8 font-light tracking-wide">
                {slide.subtitle}
              </p>
            )}
            <div className="flex gap-3 flex-wrap">
              {slide.ctaText && (
                <Link href={slide.ctaLink || '/shop'} className="inline-flex items-center gap-2 px-7 py-3.5 bg-gold-500 hover:bg-gold-400 text-white font-semibold text-sm tracking-luxury uppercase transition-all duration-300 shadow-gold group">
                  {slide.ctaText} <FiArrowRight className="group-hover:translate-x-1 transition-transform" />
                </Link>
              )}
              {slide.cta2Text && (
                <Link href={slide.cta2Link || '/rentals'} className="inline-flex items-center gap-2 px-7 py-3.5 border border-white/40 hover:border-gold-400 text-white hover:text-gold-400 font-semibold text-sm tracking-luxury uppercase transition-all duration-300">
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

/* ── Product Card ── */
function ProductCard({ product }) {
  const { dispatch } = useCart();
  const { toggle, isWishlisted } = useWishlist();
  const discount = getDiscountPercentage(product.price, product.discountPrice);
  const displayPrice = product.discountPrice || product.price;
  const id = product._id || product.id;
  const wishlisted = isWishlisted(id);

  function addToCart(e) {
    e.preventDefault();
    e.stopPropagation();
    dispatch({ type: 'ADD_ITEM', payload: product });
    toast.success('Added to cart!');
  }

  function toggleWish(e) {
    e.preventDefault();
    e.stopPropagation();
    toggle(product);
  }

  return (
    <Link href={`/product/${id}`} className="group block">
      <div className="relative overflow-hidden bg-white aspect-square rounded-t-2xl border border-stone-100">
        {product.images?.[0] ? (
          <Image
            src={product.images[0]}
            alt={product.name}
            fill
            className="object-cover transition-transform duration-700 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-stone-200 text-6xl">💍</div>
        )}

        {/* Badges */}
        <div className="absolute top-3 left-3 flex flex-col gap-1.5">
          {discount > 0 && <span className="badge-sale">-{discount}%</span>}
          {product.isAvailableForRent && <span className="badge-rental"><FiCalendar className="text-[9px]" /> Rent</span>}
        </div>

        {/* Wishlist */}
        <button onClick={toggleWish} className={`absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-sm transition-all duration-200 shadow-sm ${wishlisted ? 'bg-wine-700 text-white' : 'bg-white/90 text-stone-400 hover:bg-wine-700 hover:text-white'}`}>
          <FiHeart className={`text-sm ${wishlisted ? 'fill-current' : ''}`} />
        </button>

        {/* Quick Add */}
        {product.stock > 0 && (
          <div className="absolute bottom-0 left-0 right-0 translate-y-full group-hover:translate-y-0 transition-transform duration-300">
            <button onClick={addToCart} className="w-full py-3 bg-wine-700 text-white text-xs font-semibold tracking-luxury uppercase flex items-center justify-center gap-2 hover:bg-wine-800 transition-colors">
              <FiShoppingCart className="text-xs" /> Add to Cart
            </button>
          </div>
        )}
      </div>

      <div className="pt-3 pb-4 px-0.5">
        <p className="text-2xs text-gold-600 uppercase tracking-widest font-semibold mb-1 capitalize">{product.category}</p>
        <p className="font-serif text-base text-stone-800 font-semibold leading-snug line-clamp-2 group-hover:text-wine-700 transition-colors">{product.name}</p>
        <div className="flex items-baseline gap-2 mt-2">
          <span className="font-serif font-bold text-wine-700 text-base">{formatPrice(displayPrice)}</span>
          {discount > 0 && <span className="text-xs text-stone-400 line-through">{formatPrice(product.price)}</span>}
        </div>
      </div>
    </Link>
  );
}

/* ── Main Page ── */
export default function HomePage() {
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

  return (
    <div className="min-h-screen bg-white">

      {/* ── HERO SLIDER ── */}
      <HeroSlider slides={heroSlides} />

      {/* ── ANNOUNCEMENT STRIP ── */}
      <div className="bg-stone-50 border-b border-stone-100 py-3">
        <div className="flex items-center justify-center gap-4 md:gap-8 flex-wrap px-4">
          {['✦ New Arrivals Every Week', 'Free Delivery Above ₹2,000', 'Cash on Delivery', '100% Authentic Jewellery ✦'].map((item) => (
            <span key={item} className="text-xs text-stone-500 tracking-wider font-medium whitespace-nowrap">{item}</span>
          ))}
        </div>
      </div>

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
            <section className="py-12 bg-white">
              <div className="section-container">
                <h2 className="text-center text-xs font-bold tracking-[0.35em] uppercase text-wine-700 mb-8">Top Categories</h2>
                <div className={`grid ${cols} gap-3 md:gap-4`}>
                  {CATEGORIES.map((cat) => {
                    const photo = categoryImages[cat.key];
                    return (
                      <Link key={cat.href} href={cat.href}
                        className={`group relative ${aspect} overflow-hidden ${radius} bg-gradient-to-br ${cat.color} border border-stone-100 hover:shadow-lg transition-all duration-300`}>
                        {photo ? (
                          <img src={photo} alt={cat.label} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className={size === 'small' ? 'text-3xl' : size === 'medium' ? 'text-5xl' : 'text-6xl'}>{cat.emoji}</span>
                          </div>
                        )}
                        {/* Bottom name overlay */}
                        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/65 via-black/20 to-transparent pt-10 pb-3 px-3">
                          <span className={`text-white font-bold drop-shadow ${size === 'small' ? 'text-xs' : size === 'medium' ? 'text-sm' : 'text-base'}`}>{cat.label}</span>
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
          <section className="py-12 bg-white">
            <div className="section-container">
              <h2 className="text-center text-xs font-bold tracking-[0.35em] uppercase text-wine-700 mb-8">Top Categories</h2>
              <div className={`grid ${cols} gap-4 md:gap-6`}>
                {CATEGORIES.map((cat) => {
                  const photo = categoryImages[cat.key];
                  return (
                    <Link key={cat.href} href={cat.href} className="group flex flex-col items-center gap-3">
                      <div className={`${imgSz} rounded-full overflow-hidden border-2 border-gold-200 group-hover:border-gold-500 group-hover:shadow-md flex items-center justify-center bg-gradient-to-br ${cat.color} transition-all duration-300`}>
                        {photo ? (
                          <img src={photo} alt={cat.label} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                        ) : (
                          <span className={size === 'small' ? 'text-2xl' : size === 'medium' ? 'text-3xl' : 'text-4xl'}>{cat.emoji}</span>
                        )}
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
      <section className="py-10 bg-stone-50" id="shop">
        <div className="section-container">
          {/* Header */}
          <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
            <div>
              <p className="text-xs font-bold tracking-[0.35em] uppercase text-wine-700 mb-1">Our Collection</p>
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
              {Array.from({ length: BROWSE_LIMIT }).map((_, i) => (
                <div key={i}>
                  <div className="aspect-square skeleton rounded-2xl mb-3" />
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
                {browseProducts.map((p) => (
                  <ProductCard key={(p._id || p.id) + browseCat} product={p} />
                ))}
              </div>

              {/* Loading skeletons for next batch */}
              {browseLoading && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5 mt-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i}>
                      <div className="aspect-square skeleton rounded-2xl mb-3" />
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
      <section className="relative py-20 overflow-hidden bg-luxury-gradient">
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: 'repeating-linear-gradient(45deg, #c9973a 0, #c9973a 1px, transparent 0, transparent 40px)',
        }} />
        <div className="section-container relative z-10">
          <div className="max-w-xl mx-auto text-center">
            <span className="inline-block text-xs tracking-[0.4em] uppercase font-semibold text-gold-400 mb-5 border border-gold-400/40 px-3 py-1 rounded-full">
              Crafted for Your Special Day
            </span>
            <h2 className="font-serif text-4xl md:text-5xl font-bold text-white mb-5 leading-tight">
              Exquisite Bridal<br /><span className="text-gold-400">Jewellery Collection</span>
            </h2>
            <p className="text-white/50 text-sm leading-relaxed mb-10">
              Discover our exclusive collection of handcrafted bridal jewellery — timeless designs for your most memorable moments.
            </p>
            <div className="grid grid-cols-3 gap-6 mb-10 max-w-xs mx-auto">
              {[['500+', 'Designs'], ['100%', 'Authentic'], ['Free', 'Above ₹2000']].map(([val, label]) => (
                <div key={label}>
                  <p className="font-serif text-2xl font-bold text-gold-400">{val}</p>
                  <p className="text-white/40 text-xs tracking-wider">{label}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-4 justify-center flex-wrap">
              <Link href="/shop" className="inline-flex items-center gap-2 px-8 py-3.5 bg-gold-500 hover:bg-gold-400 text-white font-semibold text-sm tracking-luxury uppercase transition-all duration-300 shadow-gold">
                <FiShoppingCart /> Shop Now
              </Link>
              <a href={`https://wa.me/${waNumber}?text=${encodeURIComponent("Hi! I'd like to enquire about your bridal jewellery collection.")}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-8 py-3.5 border border-white/30 hover:border-gold-400 text-white hover:text-gold-400 font-semibold text-sm tracking-luxury uppercase transition-all duration-300">
                WhatsApp Us
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── TRUST SIGNALS ── */}
      <section className="py-14 bg-white border-b border-stone-100">
        <div className="section-container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {TRUST.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="text-center">
                <div className="w-14 h-14 rounded-2xl bg-stone-50 border border-stone-100 flex items-center justify-center mx-auto mb-4">
                  <Icon className="text-gold-600 text-xl" />
                </div>
                <p className="font-serif font-semibold text-stone-800 text-base mb-1">{title}</p>
                <p className="text-stone-400 text-xs">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HAPPY CUSTOMERS ── */}
      <section className="py-16 bg-stone-50">
        <div className="section-container">
          <div className="text-center mb-10">
            <p className="text-xs font-bold tracking-[0.35em] uppercase text-wine-700 mb-3">What Our Brides Say</p>
            <h2 className="font-serif text-3xl font-bold text-stone-800">Happy Customers</h2>
          </div>
          {/* Mobile: horizontal scroll; Desktop: 3-column grid */}
          <div className="flex gap-5 overflow-x-auto pb-3 md:overflow-visible md:grid md:grid-cols-3 md:pb-0 snap-x snap-mandatory md:snap-none scrollbar-hide">
            {testimonials.map((t, i) => (
              <div key={i} className="bg-white rounded-2xl p-6 shadow-card border border-stone-100 flex-shrink-0 w-[80vw] max-w-xs md:w-auto md:max-w-none snap-start flex flex-col">
                {/* Customer photo + info at top */}
                <div className="flex items-center gap-3 mb-4">
                  {t.photo ? (
                    <div className="relative w-14 h-14 rounded-full overflow-hidden flex-shrink-0 border-2 border-gold-300 shadow-sm">
                      <Image src={t.photo} alt={t.name} fill className="object-cover" />
                    </div>
                  ) : (
                    <div className="w-14 h-14 rounded-full bg-wine-100 flex items-center justify-center flex-shrink-0 border-2 border-gold-300 shadow-sm">
                      <span className="text-wine-700 font-serif font-bold text-xl">{(t.name || 'C')[0].toUpperCase()}</span>
                    </div>
                  )}
                  <div>
                    <p className="font-semibold text-stone-800 text-sm">{t.name}</p>
                    {t.location && <p className="text-gold-600 text-xs font-medium">{t.location}</p>}
                    {/* Star rating */}
                    <div className="flex gap-0.5 mt-1">
                      {Array.from({ length: 5 }).map((_, si) => (
                        <FiStar key={si} className={`text-xs ${si < (t.rating || 5) ? 'text-gold-400 fill-current' : 'text-stone-200 fill-current'}`} />
                      ))}
                    </div>
                  </div>
                </div>
                {/* Review text */}
                <p className="font-serif text-stone-500 text-sm leading-relaxed italic flex-1">"{t.review || t.text}"</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── INSTAGRAM FEED ── */}
      <section className="py-16 bg-white border-t border-stone-100">
        <div className="section-container">
          <div className="text-center mb-10">
            <p className="text-xs font-bold tracking-[0.35em] uppercase text-wine-700 mb-3">
              {siteSettings.instagram ? `@${siteSettings.instagram.replace(/^https?:\/\/(www\.)?instagram\.com\/?/, '').replace(/\/$/, '')}` : '@tulsibridal'}
            </p>
            <h2 className="font-serif text-3xl font-bold text-stone-800">Follow Us on Instagram</h2>
          </div>

          {instagramFeed.length > 0 ? (
            <div className="grid grid-cols-3 gap-2 md:gap-3 mb-8">
              {instagramFeed.slice(0, 6).map((post, i) => (
                <a
                  key={i}
                  href={post.postUrl || siteSettings.instagram || 'https://instagram.com/tulsibridal'}
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
                href={siteSettings.instagram || 'https://instagram.com/tulsibridal'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-wine-700 font-semibold text-sm hover:underline"
              >
                @tulsibridal
              </a>
            </div>
          )}

          {/* Follow button */}
          <div className="text-center">
            <a
              href={siteSettings.instagram || 'https://instagram.com/tulsibridal'}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2.5 px-8 py-3.5 bg-gradient-to-r from-purple-600 via-pink-600 to-orange-500 text-white font-semibold text-sm tracking-luxury uppercase rounded-full hover:shadow-lg hover:scale-105 transition-all duration-300"
            >
              <FiInstagram className="text-base" />
              Follow @{siteSettings.instagram ? siteSettings.instagram.replace(/^https?:\/\/(www\.)?instagram\.com\/?/, '').replace(/\/$/, '') : 'tulsibridal'} on Instagram
            </a>
          </div>
        </div>
      </section>

      {/* ── CTA STRIP ── */}
      <section className="bg-wine-900 py-14 text-center px-4">
        <p className="text-xs tracking-[0.35em] uppercase text-wine-300 font-semibold mb-3">Begin Your Bridal Journey</p>
        <h2 className="font-serif text-3xl font-bold text-white mb-8">Find Your Perfect Jewellery</h2>
        <div className="flex justify-center gap-4 flex-wrap">
          <Link href="/catalog" className="inline-flex items-center gap-2 px-9 py-3.5 bg-gold-gradient text-white font-semibold text-sm tracking-luxury uppercase rounded-xl hover:shadow-gold transition-all duration-300">
            View Catalogue
          </Link>
          <a href={`https://wa.me/${waNumber}?text=${encodeURIComponent("Hi! I'm interested in your bridal jewellery collection.")}`} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-9 py-3.5 border border-white/25 hover:border-white/60 text-white font-semibold text-sm tracking-luxury uppercase rounded-xl transition-all duration-300">
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
