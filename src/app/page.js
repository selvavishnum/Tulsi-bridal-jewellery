'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { FiHeart, FiShoppingCart, FiShield, FiTruck, FiRefreshCw, FiLock, FiStar } from 'react-icons/fi';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { formatPrice, getDiscountPercentage } from '@/lib/utils';
import toast from 'react-hot-toast';

const WA_NUMBER = '919876543210';

const CATEGORIES = [
  { label: 'Necklaces',   href: '/catalog?category=necklace',    emoji: '📿' },
  { label: 'Earrings',    href: '/catalog?category=earrings',    emoji: '✨' },
  { label: 'Bangles',     href: '/catalog?category=bangles',     emoji: '🟡' },
  { label: 'Maang Tikka', href: '/catalog?category=maang-tikka', emoji: '👑' },
  { label: 'Bridal Sets', href: '/catalog?category=set',         emoji: '💍' },
  { label: 'Rentals',     href: '/catalog?rental=true',          emoji: '🗓️' },
];

const TRUST = [
  { icon: FiShield,     title: '100% Authentic',    desc: 'Certified genuine jewellery' },
  { icon: FiStar,       title: 'Expert Craftsmanship', desc: 'Handpicked artisan designs' },
  { icon: FiRefreshCw,  title: 'Easy Returns',      desc: '7-day hassle-free policy' },
  { icon: FiLock,       title: 'Secure Payment',    desc: 'Razorpay encrypted checkout' },
];

const TESTIMONIALS = [
  { name: 'Priya Sharma', event: 'Wedding 2024', text: 'Absolutely stunning bridal set! Everyone at the wedding was in awe. The jewellery was exactly as described — premium quality and worth every rupee.' },
  { name: 'Anita Reddy',  event: 'Engagement 2024', text: 'Rented the kundan necklace set for my engagement. The quality was exceptional and the rental process was so easy. Highly recommend!' },
  { name: 'Kavitha Nair', event: 'Reception 2025', text: 'Tulsi Bridal has the most beautiful collection I\'ve seen. Fast delivery, perfect packaging, and the jewellery looked gorgeous in photos.' },
];

/* ── Product Card ── */
function ProductCard({ product }) {
  const { dispatch } = useCart();
  const { toggle, isWishlisted } = useWishlist();
  const discount = getDiscountPercentage(product.price, product.discountPrice);
  const displayPrice = product.discountPrice || product.price;
  const wishlisted = isWishlisted(product._id || product.id);

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
    <Link href={`/product/${product._id || product.id}`} className="group block">
      {/* Image */}
      <div className="relative overflow-hidden bg-cream-100 aspect-square">
        {product.images?.[0] ? (
          <Image
            src={product.images[0]}
            alt={product.name}
            fill
            className="object-cover transition-transform duration-700 group-hover:scale-110"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-5xl text-gray-300">💍</div>
        )}

        {/* Badges */}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {discount > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5">-{discount}%</span>
          )}
          {product.isAvailableForRent && (
            <span className="bg-gold-600 text-white text-[10px] font-bold px-2 py-0.5">RENT</span>
          )}
        </div>

        {/* Wishlist */}
        <button
          onClick={toggleWish}
          className={`absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-sm transition-all ${
            wishlisted ? 'bg-red-500 text-white' : 'bg-white/80 text-gray-500 hover:bg-red-500 hover:text-white'
          }`}
        >
          <FiHeart className={`text-xs ${wishlisted ? 'fill-current' : ''}`} />
        </button>

        {/* Quick Add — slides up on hover */}
        {product.stock > 0 && (
          <div className="absolute bottom-0 left-0 right-0 translate-y-full group-hover:translate-y-0 transition-transform duration-300">
            <button
              onClick={addToCart}
              className="w-full py-2.5 bg-maroon-950 text-white text-[10px] font-bold tracking-[0.2em] uppercase flex items-center justify-center gap-2 hover:bg-maroon-900 transition-colors"
            >
              <FiShoppingCart className="text-xs" /> Add to Cart
            </button>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="pt-3 pb-4">
        <p className="text-[10px] text-gold-600 uppercase tracking-[0.2em] font-semibold mb-0.5 capitalize">{product.category}</p>
        <p className="font-serif text-sm text-gray-900 font-semibold leading-tight line-clamp-2 group-hover:text-maroon-950 transition-colors">{product.name}</p>
        <div className="flex items-baseline gap-2 mt-1.5">
          <span className="font-bold text-maroon-950 text-sm">{formatPrice(displayPrice)}</span>
          {discount > 0 && (
            <span className="text-xs text-gray-400 line-through">{formatPrice(product.price)}</span>
          )}
        </div>
      </div>
    </Link>
  );
}

/* ── Main Page ── */
export default function HomePage() {
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  useEffect(() => {
    fetch('/api/products?featured=true&limit=8')
      .then((r) => r.json())
      .then((d) => { if (d.success) setProducts(d.data.products || []); })
      .catch(() => {})
      .finally(() => setLoadingProducts(false));
  }, []);

  return (
    <div className="min-h-screen bg-white">

      {/* ── HERO ── */}
      <section className="relative min-h-[90vh] bg-gradient-to-br from-velvet-900 via-[#5a0018] to-velvet-800 flex items-center justify-center overflow-hidden">
        {/* Ambient glows */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/3 left-1/3 w-96 h-96 rounded-full bg-gold-400/8 blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-64 h-64 rounded-full bg-maroon-600/20 blur-3xl" />
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold-400/25 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold-400/15 to-transparent" />
          {/* Diamond pattern overlay */}
          <div className="absolute inset-0 opacity-[0.03]" style={{
            backgroundImage: 'repeating-linear-gradient(45deg, #d4922a 0, #d4922a 1px, transparent 0, transparent 50%)',
            backgroundSize: '30px 30px',
          }} />
        </div>

        <div className="relative z-10 text-center px-4 py-24">
          {/* Crown */}
          <div className="flex justify-center mb-8">
            <svg width="72" height="62" viewBox="0 0 52 44" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-lg">
              <path d="M26 2L32 16L44 8L38 24H14L8 8L20 16L26 2Z" fill="#e8b040" stroke="#d4922a" strokeWidth="0.5" />
              <rect x="10" y="26" width="32" height="6" rx="1" fill="#e8b040" />
              <rect x="12" y="34" width="28" height="5" rx="1" fill="#d4922a" />
              <circle cx="26" cy="12" r="2.5" fill="#f5e098" />
              <circle cx="14" cy="14" r="2" fill="#f5e098" />
              <circle cx="38" cy="14" r="2" fill="#f5e098" />
            </svg>
          </div>

          {/* Brand */}
          <h1 className="font-serif text-[5rem] md:text-[8rem] font-bold tracking-[0.18em] text-white leading-none drop-shadow-2xl">
            TULSI
          </h1>

          {/* Decorative divider */}
          <div className="flex items-center justify-center gap-5 my-5">
            <div className="h-px w-24 md:w-36 bg-gradient-to-r from-transparent to-gold-400/60" />
            <p className="text-gold-400 text-xs md:text-sm tracking-[0.55em] uppercase font-medium whitespace-nowrap">
              Bridal Jewellery
            </p>
            <div className="h-px w-24 md:w-36 bg-gradient-to-l from-transparent to-gold-400/60" />
          </div>

          <p className="text-white/40 text-xs tracking-[0.4em] uppercase mb-14">
            Premium Rentals &amp; Exquisite Collections
          </p>

          {/* CTAs */}
          <div className="flex gap-4 justify-center flex-wrap">
            <Link
              href="/catalog"
              className="px-10 py-3.5 bg-gold-600 text-white font-bold tracking-[0.18em] uppercase text-xs hover:bg-gold-500 transition-colors shadow-xl shadow-gold-900/40"
            >
              Shop Collection
            </Link>
            <Link
              href="/catalog?rental=true"
              className="px-10 py-3.5 border border-white/25 text-white font-bold tracking-[0.18em] uppercase text-xs hover:border-gold-400 hover:text-gold-400 transition-colors"
            >
              Book Rental
            </Link>
          </div>

          {/* Scroll hint */}
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-30">
            <div className="w-px h-10 bg-gradient-to-b from-transparent to-white" />
            <span className="text-white text-[9px] tracking-[0.3em] uppercase">Scroll</span>
          </div>
        </div>
      </section>

      {/* ── ANNOUNCEMENT BAR ── */}
      <div className="bg-gold-50 border-y border-gold-100 py-2.5 overflow-hidden">
        <p className="text-center text-xs text-gold-800 tracking-wide font-medium">
          ✨ New Arrivals Every Week &nbsp;·&nbsp; Free Delivery Above ₹2,000 &nbsp;·&nbsp; Cash on Delivery &nbsp;·&nbsp; 100% Authentic Jewellery
        </p>
      </div>

      {/* ── CATEGORIES ── */}
      <section className="py-14 px-4 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <p className="text-gold-600 text-[10px] tracking-[0.45em] uppercase font-bold mb-2">Browse by Type</p>
            <h2 className="font-serif text-2xl md:text-3xl font-bold text-gray-900">Our Categories</h2>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {CATEGORIES.map((cat) => (
              <Link
                key={cat.href}
                href={cat.href}
                className="group flex flex-col items-center gap-2.5 py-5 px-2 rounded-xl border border-gray-100 hover:border-gold-300 hover:bg-gold-50/60 hover:shadow-sm transition-all text-center"
              >
                <span className="text-3xl group-hover:scale-110 transition-transform duration-300">{cat.emoji}</span>
                <span className="text-[11px] font-semibold text-gray-700 group-hover:text-maroon-950 transition-colors leading-tight">{cat.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURED PRODUCTS ── */}
      <section className="py-14 px-4 bg-cream-100">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-end justify-between mb-10">
            <div>
              <p className="text-gold-600 text-[10px] tracking-[0.45em] uppercase font-bold mb-2">Handpicked For You</p>
              <h2 className="font-serif text-2xl md:text-3xl font-bold text-gray-900">Our Collections</h2>
            </div>
            <Link href="/catalog" className="hidden md:inline text-sm text-maroon-950 font-semibold hover:text-maroon-700 transition-colors">
              View All →
            </Link>
          </div>

          {loadingProducts ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="animate-pulse">
                  <div className="aspect-square bg-gray-200 mb-3" />
                  <div className="h-3 bg-gray-200 rounded w-1/3 mb-2" />
                  <div className="h-3 bg-gray-200 rounded w-3/4 mb-1" />
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : products.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
              {products.map((p) => <ProductCard key={p._id || p.id} product={p} />)}
            </div>
          ) : (
            <div className="text-center py-16">
              <p className="text-6xl mb-4">💍</p>
              <p className="text-gray-400 text-sm">Products coming soon. Add products in the admin panel.</p>
            </div>
          )}

          <div className="text-center mt-12">
            <Link
              href="/catalog"
              className="inline-block border border-maroon-950 text-maroon-950 text-[10px] tracking-[0.3em] uppercase px-12 py-3.5 hover:bg-maroon-950 hover:text-white transition-colors font-bold"
            >
              View Full Catalogue
            </Link>
          </div>
        </div>
      </section>

      {/* ── RENTAL PROMO ── */}
      <section className="bg-velvet-800 py-20 px-4 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold-400/20 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold-400/20 to-transparent" />
        </div>
        <div className="max-w-2xl mx-auto text-center relative z-10">
          <div className="w-16 h-px bg-gold-400/40 mx-auto mb-7" />
          <p className="text-gold-400 text-[10px] tracking-[0.45em] uppercase font-bold mb-4">Plan Your Perfect Day</p>
          <h2 className="font-serif text-3xl md:text-4xl font-bold text-white mb-5 leading-snug">
            Premium Bridal Jewellery<br />Available for Rent
          </h2>
          <p className="text-gray-400 text-sm leading-relaxed mb-10 max-w-lg mx-auto">
            Why buy when you can rent? Access our exclusive collection of bridal sets, necklaces, and statement pieces for your special occasion — at a fraction of the purchase price.
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <Link
              href="/catalog?rental=true"
              className="px-9 py-3.5 bg-gold-600 text-white font-bold tracking-[0.18em] uppercase text-xs hover:bg-gold-500 transition-colors shadow-lg shadow-gold-900/30"
            >
              Browse Rentals
            </Link>
            <a
              href={`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent("Hi! I'd like to enquire about bridal jewellery rentals.")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-9 py-3.5 border border-white/25 text-white font-bold tracking-[0.18em] uppercase text-xs hover:border-gold-400 hover:text-gold-400 transition-colors"
            >
              WhatsApp Us
            </a>
          </div>
        </div>
      </section>

      {/* ── TRUST SIGNALS ── */}
      <section className="py-12 px-4 bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
          {TRUST.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="text-center">
              <div className="w-11 h-11 rounded-full bg-gold-50 border border-gold-100 flex items-center justify-center mx-auto mb-3">
                <Icon className="text-gold-600 text-base" />
              </div>
              <p className="font-semibold text-gray-800 text-sm mb-1">{title}</p>
              <p className="text-gray-400 text-xs">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section className="py-14 px-4 bg-cream-100">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <p className="text-gold-600 text-[10px] tracking-[0.45em] uppercase font-bold mb-2">What Brides Say</p>
            <h2 className="font-serif text-2xl md:text-3xl font-bold text-gray-900">Customer Stories</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t) => (
              <div key={t.name} className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
                <div className="flex gap-0.5 mb-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <FiStar key={i} className="text-gold-400 text-sm fill-current" />
                  ))}
                </div>
                <p className="text-gray-600 text-sm leading-relaxed mb-5 italic">"{t.text}"</p>
                <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
                  <div className="w-9 h-9 rounded-full bg-maroon-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-maroon-950 font-bold text-sm">{t.name[0]}</span>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-800 text-sm">{t.name}</p>
                    <p className="text-gold-600 text-xs">{t.event}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA STRIP ── */}
      <section className="bg-maroon-950 py-10 text-center px-4">
        <p className="text-white/70 text-sm tracking-wider mb-5">
          Browse our full collection &amp; enquire for rental pricing
        </p>
        <div className="flex justify-center gap-4 flex-wrap">
          <Link
            href="/catalog"
            className="px-10 py-3 bg-gold-600 text-white text-xs font-bold tracking-[0.2em] uppercase hover:bg-gold-500 transition-colors"
          >
            View Catalogue
          </Link>
          <a
            href={`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent("Hi! I'm interested in your bridal jewellery collection.")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-10 py-3 border border-white/30 text-white text-xs font-bold tracking-[0.2em] uppercase hover:border-white hover:bg-white/10 transition-colors"
          >
            WhatsApp Us
          </a>
        </div>
      </section>

      {/* ── WHATSAPP FLOAT ── */}
      <a
        href={`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent("Hi! I'm interested in your bridal jewellery.")}`}
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-green-500 hover:bg-green-400 text-white rounded-full flex items-center justify-center shadow-2xl shadow-green-900/40 transition-transform hover:scale-110"
        title="Chat on WhatsApp"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
      </a>

    </div>
  );
}
