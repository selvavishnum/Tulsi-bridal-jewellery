'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  FiHeart, FiShoppingCart, FiShield, FiTruck, FiRefreshCw,
  FiLock, FiStar, FiCalendar, FiArrowRight,
} from 'react-icons/fi';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { formatPrice, getDiscountPercentage } from '@/lib/utils';
import toast from 'react-hot-toast';

const DEFAULT_WA = '919876543210';

const CATEGORIES = [
  { label: 'Necklaces',   href: '/catalog?category=necklace',    img: null, emoji: '📿' },
  { label: 'Earrings',    href: '/catalog?category=earrings',    img: null, emoji: '✨' },
  { label: 'Bangles',     href: '/catalog?category=bangles',     img: null, emoji: '🟡' },
  { label: 'Maang Tikka', href: '/catalog?category=maang-tikka', img: null, emoji: '👑' },
  { label: 'Bridal Sets', href: '/catalog?category=set',         img: null, emoji: '💍' },
  { label: 'Rentals',     href: '/rentals',                      img: null, emoji: '🗓️' },
];

const TRUST = [
  { icon: FiShield,    title: '100% Authentic',       desc: 'Certified genuine jewellery' },
  { icon: FiStar,      title: 'Expert Craftsmanship', desc: 'Handpicked artisan designs' },
  { icon: FiRefreshCw, title: 'Easy Returns',         desc: '7-day hassle-free policy' },
  { icon: FiLock,      title: 'Secure Payment',       desc: 'Razorpay encrypted checkout' },
];

const TESTIMONIALS = [
  { name: 'Priya Sharma', event: 'Wedding 2024', text: 'Absolutely stunning bridal set! Everyone at the wedding was in awe. Premium quality and worth every rupee.' },
  { name: 'Anita Reddy',  event: 'Engagement 2024', text: 'Rented the kundan necklace set for my engagement. Exceptional quality and the rental process was so easy.' },
  { name: 'Kavitha Nair', event: 'Reception 2025', text: 'The most beautiful collection I\'ve seen. Fast delivery, perfect packaging, and gorgeous in photos.' },
];

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
      <div className="relative overflow-hidden bg-ivory-200 aspect-square rounded-t-2xl">
        {product.images?.[0] ? (
          <Image
            src={product.images[0]}
            alt={product.name}
            fill
            className="object-cover transition-transform duration-700 group-hover:scale-108"
            style={{ transform: 'scale(1)', transition: 'transform 700ms ease' }}
            onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.08)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-5xl text-stone-300">💍</div>
        )}

        {/* Badges */}
        <div className="absolute top-3 left-3 flex flex-col gap-1.5">
          {discount > 0 && (
            <span className="badge-sale">-{discount}%</span>
          )}
          {product.isAvailableForRent && (
            <span className="badge-rental"><FiCalendar className="text-[9px]" /> Rent</span>
          )}
        </div>

        {/* Wishlist btn */}
        <button
          onClick={toggleWish}
          className={`absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-sm transition-all duration-200 shadow-sm ${
            wishlisted
              ? 'bg-wine-700 text-white'
              : 'bg-white/90 text-stone-400 hover:bg-wine-700 hover:text-white'
          }`}
        >
          <FiHeart className={`text-sm ${wishlisted ? 'fill-current' : ''}`} />
        </button>

        {/* Quick Add */}
        {product.stock > 0 && (
          <div className="absolute bottom-0 left-0 right-0 translate-y-full group-hover:translate-y-0 transition-transform duration-300">
            <button
              onClick={addToCart}
              className="w-full py-3 bg-wine-700 text-white text-xs font-semibold tracking-luxury uppercase flex items-center justify-center gap-2 hover:bg-wine-800 transition-colors"
            >
              <FiShoppingCart className="text-xs" /> Add to Cart
            </button>
          </div>
        )}
      </div>

      <div className="pt-3 pb-4 px-1">
        <p className="text-2xs text-gold-600 uppercase tracking-widest font-semibold mb-1 capitalize">{product.category}</p>
        <p className="font-serif text-base text-stone-800 font-semibold leading-snug line-clamp-2 group-hover:text-wine-700 transition-colors">{product.name}</p>
        <div className="flex items-baseline gap-2 mt-2">
          <span className="font-serif font-bold text-wine-700 text-base">{formatPrice(displayPrice)}</span>
          {discount > 0 && (
            <span className="text-xs text-stone-400 line-through">{formatPrice(product.price)}</span>
          )}
        </div>
      </div>
    </Link>
  );
}

/* Ornament divider */
function Ornament({ className = '' }) {
  return (
    <div className={`flex items-center justify-center gap-4 ${className}`}>
      <div className="h-px flex-1 bg-gradient-to-r from-transparent to-gold-300/50" />
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 0L9.5 6.5L16 8L9.5 9.5L8 16L6.5 9.5L0 8L6.5 6.5L8 0Z" fill="#c9973a" opacity="0.7" />
      </svg>
      <div className="h-px flex-1 bg-gradient-to-l from-transparent to-gold-300/50" />
    </div>
  );
}

export default function HomePage() {
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [siteSettings, setSiteSettings] = useState({});

  const waNumber = (siteSettings.whatsapp || siteSettings.phone || DEFAULT_WA).replace(/\D/g, '');

  useEffect(() => {
    fetch('/api/products?limit=8')
      .then((r) => r.json())
      .then((d) => { if (d.success) setProducts(d.data.products || []); })
      .catch(() => {})
      .finally(() => setLoadingProducts(false));

    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((d) => { if (d.success && d.data) setSiteSettings(d.data); })
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-ivory">

      {/* ── HERO ── */}
      <section className="relative min-h-[92vh] bg-luxury-gradient flex items-center justify-center overflow-hidden">
        {/* Texture overlay */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute inset-0 opacity-[0.04]" style={{
            backgroundImage: 'repeating-linear-gradient(45deg, #c9973a 0, #c9973a 1px, transparent 0, transparent 40px)',
          }} />
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold-400/30 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold-400/20 to-transparent" />
          <div className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full bg-wine-600/10 blur-3xl" />
          <div className="absolute -bottom-20 -right-20 w-[400px] h-[400px] rounded-full bg-gold-500/8 blur-3xl" />
        </div>

        <div className="relative z-10 text-center px-4 max-w-3xl mx-auto">
          {/* Crown icon */}
          <div className="flex justify-center mb-10">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-gold-400/20 blur-xl scale-150" />
              <svg width="64" height="56" viewBox="0 0 52 44" fill="none" className="relative drop-shadow-lg">
                <path d="M26 2L32 16L44 8L38 24H14L8 8L20 16L26 2Z" fill="#e4b040" stroke="#c9973a" strokeWidth="1"/>
                <rect x="10" y="26" width="32" height="6" rx="1" fill="#e4b040"/>
                <rect x="12" y="34" width="28" height="5" rx="1" fill="#c9973a"/>
                <circle cx="26" cy="11" r="2.5" fill="#fdf9ee" opacity="0.9"/>
                <circle cx="14" cy="13" r="2" fill="#fdf9ee" opacity="0.7"/>
                <circle cx="38" cy="13" r="2" fill="#fdf9ee" opacity="0.7"/>
              </svg>
            </div>
          </div>

          {/* Eyebrow */}
          <p className="text-gold-400 text-xs tracking-[0.55em] uppercase font-medium mb-6">
            Handcrafted Bridal Jewellery
          </p>

          {/* Main heading */}
          <h1 className="font-serif font-bold text-white leading-none tracking-wide mb-4" style={{ fontSize: 'clamp(3.5rem, 10vw, 8rem)' }}>
            TULSI
          </h1>
          <h2 className="font-serif text-xl md:text-2xl text-gold-300/80 font-light tracking-[0.35em] uppercase mb-8">
            Bridal Jewellery
          </h2>

          <Ornament className="mb-8 max-w-xs mx-auto" />

          <p className="text-white/50 text-sm md:text-base leading-relaxed mb-12 max-w-lg mx-auto">
            Discover exquisite collections curated for the modern bride. Buy to keep or rent for your special day.
          </p>

          {/* CTAs */}
          <div className="flex gap-4 justify-center flex-wrap">
            <Link
              href="/shop"
              className="group px-9 py-3.5 bg-gold-500 hover:bg-gold-400 text-white font-semibold text-sm tracking-luxury uppercase transition-all duration-300 shadow-gold flex items-center gap-2"
            >
              Shop Collection <FiArrowRight className="group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              href="/rentals"
              className="px-9 py-3.5 border border-white/25 hover:border-gold-400 text-white hover:text-gold-400 font-semibold text-sm tracking-luxury uppercase transition-all duration-300 flex items-center gap-2"
            >
              <FiCalendar className="text-base" /> Book Rental
            </Link>
          </div>

          {/* Scroll indicator */}
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-25">
            <div className="w-px h-12 bg-gradient-to-b from-transparent to-white/80" />
            <span className="text-white text-[8px] tracking-[0.35em] uppercase">Scroll</span>
          </div>
        </div>
      </section>

      {/* ── ANNOUNCEMENT STRIP ── */}
      <div className="bg-ivory-300 border-y border-ivory-400 py-3">
        <div className="flex items-center justify-center gap-6 flex-wrap px-4">
          {['✦ New Arrivals Every Week', 'Free Delivery Above ₹2,000', 'Cash on Delivery Available', '100% Authentic Jewellery ✦'].map((item) => (
            <span key={item} className="text-xs text-stone-500 tracking-wider font-medium whitespace-nowrap">{item}</span>
          ))}
        </div>
      </div>

      {/* ── CATEGORIES ── */}
      <section className="py-20 bg-white">
        <div className="section-container">
          <div className="text-center mb-12">
            <p className="subheading mb-3">Browse by Type</p>
            <h2 className="heading-section">Our Collections</h2>
            <Ornament className="max-w-xs mx-auto mt-5" />
          </div>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3 md:gap-4">
            {CATEGORIES.map((cat) => (
              <Link
                key={cat.href}
                href={cat.href}
                className="group flex flex-col items-center gap-3 py-6 px-3 rounded-2xl border border-stone-100 hover:border-gold-300 hover:bg-ivory-100 hover:shadow-card transition-all duration-300 text-center"
              >
                <span className="text-3xl group-hover:scale-110 transition-transform duration-300">{cat.emoji}</span>
                <span className="text-xs font-semibold text-stone-600 group-hover:text-wine-700 transition-colors leading-tight">{cat.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURED PRODUCTS ── */}
      <section className="py-20 bg-ivory">
        <div className="section-container">
          <div className="flex items-end justify-between mb-12">
            <div>
              <p className="subheading mb-3">Handpicked for You</p>
              <h2 className="heading-section">Featured Pieces</h2>
            </div>
            <Link href="/catalog" className="hidden md:flex items-center gap-2 text-sm font-semibold text-wine-700 hover:text-wine-800 transition-colors">
              View All <FiArrowRight />
            </Link>
          </div>

          {loadingProducts ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i}>
                  <div className="aspect-square skeleton rounded-2xl mb-3" />
                  <div className="h-2.5 skeleton rounded w-1/3 mb-2" />
                  <div className="h-3 skeleton rounded w-3/4 mb-1.5" />
                  <div className="h-3 skeleton rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : products.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
              {products.map((p) => <ProductCard key={p._id || p.id} product={p} />)}
            </div>
          ) : (
            <div className="text-center py-20">
              <p className="text-6xl mb-5">💍</p>
              <p className="text-stone-400 text-sm font-medium">Products coming soon. Add products in the admin panel.</p>
            </div>
          )}

          <div className="text-center mt-14">
            <Link href="/catalog" className="btn-outline">
              View Full Catalogue
            </Link>
          </div>
        </div>
      </section>

      {/* ── RENTAL PROMO ── */}
      <section className="relative py-24 overflow-hidden bg-luxury-gradient">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute inset-0 opacity-[0.04]" style={{
            backgroundImage: 'repeating-linear-gradient(45deg, #c9973a 0, #c9973a 1px, transparent 0, transparent 40px)',
          }} />
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold-400/25 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold-400/15 to-transparent" />
        </div>

        <div className="section-container relative z-10">
          <div className="max-w-2xl mx-auto text-center">
            <p className="text-gold-400 text-xs tracking-[0.5em] uppercase font-medium mb-5">Plan Your Perfect Day</p>
            <h2 className="font-serif text-4xl md:text-5xl font-bold text-white mb-6 leading-tight">
              Rent Exquisite<br />
              <span className="text-gold-400">Bridal Jewellery</span>
            </h2>
            <Ornament className="max-w-xs mx-auto mb-6" />
            <p className="text-white/50 text-sm leading-relaxed mb-10 max-w-lg mx-auto">
              Access our exclusive collection of bridal sets, necklaces, and statement pieces for your special occasion — at a fraction of the purchase price. Date-wise booking with doorstep delivery.
            </p>

            <div className="grid grid-cols-3 gap-6 mb-10 max-w-sm mx-auto">
              {[['500+', 'Pieces'], ['₹299', 'From/Day'], ['48h', 'Delivery']].map(([val, label]) => (
                <div key={label} className="text-center">
                  <p className="font-serif text-2xl font-bold text-gold-400">{val}</p>
                  <p className="text-white/50 text-xs tracking-wider">{label}</p>
                </div>
              ))}
            </div>

            <div className="flex gap-4 justify-center flex-wrap">
              <Link href="/rentals" className="group px-9 py-3.5 bg-gold-500 hover:bg-gold-400 text-white font-semibold text-sm tracking-luxury uppercase transition-all duration-300 shadow-gold flex items-center gap-2">
                <FiCalendar /> Browse Rentals <FiArrowRight className="group-hover:translate-x-1 transition-transform" />
              </Link>
              <a
                href={`https://wa.me/${waNumber}?text=${encodeURIComponent("Hi! I'd like to enquire about bridal jewellery rentals.")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-9 py-3.5 border border-white/25 hover:border-gold-400 text-white hover:text-gold-400 font-semibold text-sm tracking-luxury uppercase transition-all duration-300"
              >
                WhatsApp Us
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── TRUST SIGNALS ── */}
      <section className="py-16 bg-white border-b border-stone-100">
        <div className="section-container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
            {TRUST.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="text-center group">
                <div className="w-14 h-14 rounded-2xl bg-ivory border border-ivory-300 flex items-center justify-center mx-auto mb-4 group-hover:border-gold-300 group-hover:bg-gold-50 transition-all duration-300">
                  <Icon className="text-gold-600 text-xl" />
                </div>
                <p className="font-serif font-semibold text-stone-800 text-base mb-1.5">{title}</p>
                <p className="text-stone-400 text-xs leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section className="py-20 bg-ivory">
        <div className="section-container">
          <div className="text-center mb-12">
            <p className="subheading mb-3">What Brides Say</p>
            <h2 className="heading-section">Customer Stories</h2>
            <Ornament className="max-w-xs mx-auto mt-5" />
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t) => (
              <div key={t.name} className="card p-7 group hover:shadow-luxury transition-shadow duration-300">
                <div className="flex gap-0.5 mb-5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <FiStar key={i} className="text-gold-400 text-sm fill-current" />
                  ))}
                </div>
                <p className="text-stone-500 text-sm leading-relaxed mb-6 italic font-serif text-base">"{t.text}"</p>
                <div className="flex items-center gap-3 pt-5 border-t border-stone-100">
                  <div className="w-10 h-10 rounded-full bg-wine-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-wine-700 font-serif font-bold text-base">{t.name[0]}</span>
                  </div>
                  <div>
                    <p className="font-semibold text-stone-800 text-sm">{t.name}</p>
                    <p className="text-gold-600 text-xs font-medium">{t.event}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA STRIP ── */}
      <section className="bg-wine-900 py-14 text-center px-4">
        <p className="subheading text-wine-300 mb-4">Begin Your Bridal Journey</p>
        <h2 className="font-serif text-3xl font-bold text-white mb-8">
          Find Your Perfect Jewellery
        </h2>
        <div className="flex justify-center gap-4 flex-wrap">
          <Link href="/catalog" className="btn-gold">
            View Catalogue
          </Link>
          <a
            href={`https://wa.me/${waNumber}?text=${encodeURIComponent("Hi! I'm interested in your bridal jewellery collection.")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-9 py-3.5 border border-white/25 hover:border-white/60 text-white font-semibold text-sm tracking-luxury uppercase rounded-xl transition-all duration-300"
          >
            WhatsApp Us
          </a>
        </div>
      </section>

      {/* ── WHATSAPP FLOAT ── */}
      <a
        href={`https://wa.me/${waNumber}?text=${encodeURIComponent("Hi! I'm interested in your bridal jewellery.")}`}
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-green-500 hover:bg-green-400 text-white rounded-full flex items-center justify-center shadow-2xl shadow-green-900/30 transition-all duration-200 hover:scale-110"
        title="Chat on WhatsApp"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
      </a>
    </div>
  );
}
