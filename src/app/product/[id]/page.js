'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import {
  FiShoppingCart, FiHeart, FiShare2, FiStar, FiArrowLeft,
  FiCalendar, FiShield, FiCheckCircle, FiTruck, FiRefreshCw,
} from 'react-icons/fi';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { formatPrice, getDiscountPercentage, calculateRentalDays } from '@/lib/utils';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import toast from 'react-hot-toast';

const WA_NUMBER = '919876543210';

const TRUST_ITEMS = [
  { icon: FiShield,      label: 'Certified Authentic' },
  { icon: FiTruck,       label: 'Free Delivery ₹2000+' },
  { icon: FiRefreshCw,   label: '7-Day Returns' },
  { icon: FiCheckCircle, label: 'Secure Payment' },
];

export default function ProductDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { dispatch } = useCart();
  const { toggle, isWishlisted } = useWishlist();

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState(0);
  const [rentalDates, setRentalDates] = useState({ start: '', end: '' });
  const [showRental, setShowRental] = useState(false);
  const [qty, setQty] = useState(1);

  useEffect(() => {
    fetch(`/api/products/${id}`)
      .then((r) => r.json())
      .then((d) => { if (d.success) setProduct(d.data); else router.push('/shop'); })
      .catch(() => router.push('/shop'))
      .finally(() => setLoading(false));
  }, [id, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <LoadingSpinner size="lg" />
      </div>
    );
  }
  if (!product) return null;

  const discount = getDiscountPercentage(product.price, product.discountPrice);
  const displayPrice = product.discountPrice || product.price;
  const wishlisted = isWishlisted(product._id || product.id);

  const rentalDays = rentalDates.start && rentalDates.end
    ? calculateRentalDays(rentalDates.start, rentalDates.end)
    : 0;

  const waEnquiryUrl = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(
    `Hi! I'm interested in "${product.name}" (${formatPrice(displayPrice)}). Please let me know about availability.`
  )}`;

  function addToCart() {
    for (let i = 0; i < qty; i++) dispatch({ type: 'ADD_ITEM', payload: product });
    toast.success(`${product.name} added to cart!`);
  }

  function share() {
    if (navigator.share) {
      navigator.share({ title: product.name, url: window.location.href });
    } else {
      navigator.clipboard.writeText(window.location.href);
      toast.success('Link copied!');
    }
  }

  const SPECS = [
    product.category && { label: 'Category', value: product.category.replace(/-/g, ' ') },
    product.material  && { label: 'Material', value: product.material.replace(/-/g, ' ') },
    product.weight    && { label: 'Weight',   value: `${product.weight}g` },
    product.purity    && { label: 'Purity',   value: product.purity },
    product.sku       && { label: 'SKU',      value: product.sku },
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Breadcrumb */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-2 text-xs text-gray-400">
          <Link href="/" className="hover:text-maroon-950 transition">Home</Link>
          <span>/</span>
          <Link href="/catalog" className="hover:text-maroon-950 transition">Catalogue</Link>
          <span>/</span>
          <span className="text-gray-700 capitalize">{product.category}</span>
          <span>/</span>
          <span className="text-gray-500 line-clamp-1">{product.name}</span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">

        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-gray-400 hover:text-maroon-950 mb-6 transition text-sm"
        >
          <FiArrowLeft className="text-base" /> Back
        </button>

        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="grid lg:grid-cols-2 gap-0">

            {/* ── IMAGE GALLERY ── */}
            <div className="p-6 lg:p-8 bg-gray-50/60">
              {/* Main image */}
              <div className="relative aspect-square rounded-xl overflow-hidden bg-cream-100 mb-3 group">
                {product.images?.[selectedImage] ? (
                  <Image
                    src={product.images[selectedImage]}
                    alt={product.name}
                    fill
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-8xl text-gray-300">💍</div>
                )}
                {discount > 0 && (
                  <span className="absolute top-3 left-3 bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow">
                    -{discount}% OFF
                  </span>
                )}
                {/* Share */}
                <button
                  onClick={share}
                  className="absolute top-3 right-3 w-9 h-9 bg-white/80 backdrop-blur-sm rounded-full flex items-center justify-center text-gray-500 hover:text-maroon-950 shadow transition"
                >
                  <FiShare2 className="text-sm" />
                </button>
              </div>

              {/* Thumbnails */}
              {product.images?.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {product.images.map((img, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedImage(i)}
                      className={`relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 border-2 transition ${
                        selectedImage === i ? 'border-gold-600 shadow-sm' : 'border-transparent hover:border-gray-300'
                      }`}
                    >
                      <Image src={img} alt={`View ${i + 1}`} fill className="object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── PRODUCT INFO ── */}
            <div className="p-6 lg:p-8 flex flex-col">

              {/* Category tag */}
              <p className="text-gold-600 text-xs uppercase tracking-widest font-semibold mb-2 capitalize">
                {product.category?.replace(/-/g, ' ')}
              </p>

              {/* Name */}
              <h1 className="font-serif text-2xl md:text-3xl font-bold text-gray-900 leading-snug mb-3">
                {product.name}
              </h1>

              {/* Rating */}
              {product.ratings?.count > 0 && (
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <FiStar
                        key={i}
                        className={`text-sm ${i < Math.round(product.ratings.average) ? 'fill-gold-400 text-gold-400' : 'text-gray-200'}`}
                      />
                    ))}
                  </div>
                  <span className="text-sm text-gray-400">({product.ratings.count} reviews)</span>
                </div>
              )}

              {/* Price */}
              <div className="flex items-baseline gap-3 mb-5 pb-5 border-b border-gray-100">
                <span className="text-3xl font-bold text-maroon-950">{formatPrice(displayPrice)}</span>
                {discount > 0 && (
                  <>
                    <span className="text-lg text-gray-300 line-through">{formatPrice(product.price)}</span>
                    <span className="text-sm font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                      Save {formatPrice(product.price - displayPrice)}
                    </span>
                  </>
                )}
              </div>

              {/* Description */}
              <p className="text-gray-500 leading-relaxed text-sm mb-5">{product.description}</p>

              {/* Specs grid */}
              {SPECS.length > 0 && (
                <div className="grid grid-cols-2 gap-2 mb-5">
                  {SPECS.map(({ label, value }) => (
                    <div key={label} className="bg-gray-50 rounded-lg px-3 py-2">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">{label}</p>
                      <p className="text-sm font-semibold text-gray-700 capitalize">{value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Stock badge */}
              <div className="flex items-center gap-2 mb-6">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                  product.stock > 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${product.stock > 0 ? 'bg-green-500' : 'bg-red-500'}`} />
                  {product.stock > 0 ? `In Stock (${product.stock} available)` : 'Out of Stock'}
                </span>
                {product.isAvailableForRent && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-gold-50 text-gold-700">
                    <FiCalendar className="text-xs" /> Available for Rent
                  </span>
                )}
              </div>

              {/* Quantity + Add to Cart */}
              <div className="flex gap-3 mb-3">
                <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setQty(Math.max(1, qty - 1))}
                    className="w-10 h-11 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition text-lg font-light"
                  >
                    −
                  </button>
                  <span className="w-10 text-center text-sm font-semibold">{qty}</span>
                  <button
                    onClick={() => setQty(Math.min(product.stock, qty + 1))}
                    className="w-10 h-11 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition text-lg font-light"
                  >
                    +
                  </button>
                </div>
                <button
                  onClick={addToCart}
                  disabled={product.stock === 0}
                  className="flex-1 py-3 bg-maroon-950 text-white font-bold rounded-xl hover:bg-maroon-900 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition flex items-center justify-center gap-2 text-sm"
                >
                  <FiShoppingCart /> Add to Cart
                </button>
                <button
                  onClick={() => toggle(product)}
                  className={`p-3 rounded-xl border-2 transition ${
                    wishlisted ? 'bg-red-500 border-red-500 text-white' : 'border-gray-200 text-gray-500 hover:border-red-400 hover:text-red-500'
                  }`}
                >
                  <FiHeart className={wishlisted ? 'fill-current' : ''} />
                </button>
              </div>

              {/* WhatsApp Enquiry */}
              <a
                href={waEnquiryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3 bg-green-500 hover:bg-green-400 text-white font-bold rounded-xl transition flex items-center justify-center gap-2 text-sm mb-4"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
                Enquire on WhatsApp
              </a>

              {/* Rental booking */}
              {product.isAvailableForRent && product.rentalPrice && (
                <>
                  <button
                    onClick={() => setShowRental(!showRental)}
                    className="w-full py-3 border-2 border-gold-500 text-gold-700 font-bold rounded-xl hover:bg-gold-50 transition flex items-center justify-center gap-2 text-sm"
                  >
                    <FiCalendar /> Rent from {formatPrice(product.rentalPrice)}/day
                  </button>

                  {showRental && (
                    <div className="mt-3 p-4 bg-gold-50 rounded-xl border border-gold-200">
                      <h3 className="font-semibold text-maroon-950 mb-3 text-sm">Select Rental Dates</h3>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <label className="text-xs text-gray-500 mb-1 block">Start Date</label>
                          <input
                            type="date"
                            value={rentalDates.start}
                            onChange={(e) => setRentalDates({ ...rentalDates, start: e.target.value })}
                            min={new Date().toISOString().split('T')[0]}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400 bg-white"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 mb-1 block">End Date</label>
                          <input
                            type="date"
                            value={rentalDates.end}
                            onChange={(e) => setRentalDates({ ...rentalDates, end: e.target.value })}
                            min={rentalDates.start || new Date().toISOString().split('T')[0]}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400 bg-white"
                          />
                        </div>
                      </div>
                      {rentalDays > 0 && (
                        <div className="flex items-center justify-between bg-white rounded-lg px-3 py-2 mb-3 text-sm">
                          <span className="text-gray-500">{rentalDays} day{rentalDays > 1 ? 's' : ''} × {formatPrice(product.rentalPrice)}</span>
                          <span className="font-bold text-maroon-950">{formatPrice(rentalDays * product.rentalPrice)}</span>
                        </div>
                      )}
                      {rentalDates.start && rentalDates.end && (
                        <Link
                          href={`/checkout?rental=true&productId=${product._id || product.id}&start=${rentalDates.start}&end=${rentalDates.end}`}
                          className="block w-full py-2.5 bg-gold-600 text-white text-center font-bold rounded-lg hover:bg-gold-500 transition text-sm"
                        >
                          Proceed to Rent — {formatPrice(rentalDays * (product.rentalPrice || 0))}
                        </Link>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Trust strip */}
              <div className="mt-5 pt-5 border-t border-gray-100 grid grid-cols-2 gap-2">
                {TRUST_ITEMS.map(({ icon: Icon, label }) => (
                  <div key={label} className="flex items-center gap-2 text-xs text-gray-500">
                    <Icon className="text-green-500 flex-shrink-0" />
                    <span>{label}</span>
                  </div>
                ))}
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
