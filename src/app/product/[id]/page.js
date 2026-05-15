'use client';

import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import Link from 'next/link';
import {
  FiShoppingCart, FiHeart, FiShare2, FiStar, FiArrowLeft,
  FiCalendar, FiShield, FiCheckCircle, FiTruck, FiRefreshCw,
  FiUser, FiSend, FiCamera,
} from 'react-icons/fi';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { formatPrice, getDiscountPercentage } from '@/lib/utils';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import toast from 'react-hot-toast';

const TryOnModal = lazy(() => import('@/components/ar/TryOnModal'));

const WA_NUMBER = '917695868787';

const TRUST_ITEMS = [
  { icon: FiShield,      label: 'Certified Authentic' },
  { icon: FiTruck,       label: 'Free Delivery ₹2000+' },
  { icon: FiRefreshCw,   label: '7-Day Returns' },
  { icon: FiCheckCircle, label: 'Secure Payment' },
];

/* ── Star Picker ── */
function StarPicker({ value, onChange }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(star)}
          className="transition-transform hover:scale-110"
        >
          <FiStar
            className={`text-2xl transition-colors ${
              star <= (hovered || value) ? 'fill-gold-400 text-gold-400' : 'text-stone-200'
            }`}
          />
        </button>
      ))}
    </div>
  );
}

/* ── Stars display ── */
function Stars({ rating, size = 'sm' }) {
  const sz = size === 'sm' ? 'text-sm' : 'text-base';
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <FiStar key={i} className={`${sz} ${i <= Math.round(rating) ? 'fill-gold-400 text-gold-400' : 'text-stone-200'}`} />
      ))}
    </div>
  );
}

/* ── Review Card ── */
function ReviewCard({ review }) {
  const date = new Date(review.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <div className="border border-stone-100 rounded-xl p-5 bg-white">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-wine-100 flex items-center justify-center flex-shrink-0">
            <span className="font-serif font-bold text-wine-700 text-base">{(review.reviewerName || 'A')[0].toUpperCase()}</span>
          </div>
          <div>
            <p className="font-semibold text-stone-800 text-sm">{review.reviewerName || 'Anonymous'}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <Stars rating={review.rating} size="sm" />
              {review.status === 'approved' && (
                <span className="text-[10px] text-green-600 font-semibold flex items-center gap-1">
                  <FiCheckCircle className="text-[10px]" /> Verified Purchase
                </span>
              )}
            </div>
          </div>
        </div>
        <span className="text-xs text-stone-400 flex-shrink-0">{date}</span>
      </div>
      <p className="text-stone-500 text-sm leading-relaxed">{review.comment}</p>
    </div>
  );
}

/* ── Review Form ── */
function ReviewForm({ productId, onSubmitted }) {
  const { data: session } = useSession();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!rating) return toast.error('Please select a star rating');
    if (!comment.trim()) return toast.error('Please write a review');
    if (!session && !guestName.trim()) return toast.error('Please enter your name');

    setSubmitting(true);
    try {
      const res = await fetch(`/api/products/${productId}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment, guestName, guestEmail }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Review submitted! Thank you.');
        setRating(0);
        setComment('');
        setGuestName('');
        setGuestEmail('');
        onSubmitted();
      } else {
        toast.error(data.message || 'Failed to submit review');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="bg-ivory-100 border border-stone-200 rounded-2xl p-6 space-y-4">
      <h3 className="font-serif text-lg font-bold text-stone-800">Write a Review</h3>

      <div>
        <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2 block">Your Rating *</label>
        <StarPicker value={rating} onChange={setRating} />
      </div>

      {!session && (
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5 block">Name *</label>
            <input
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Your name"
              className="input-field"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5 block">Email (optional)</label>
            <input
              type="email"
              value={guestEmail}
              onChange={(e) => setGuestEmail(e.target.value)}
              placeholder="your@email.com"
              className="input-field"
            />
          </div>
        </div>
      )}

      <div>
        <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5 block">Review *</label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Share your experience with this product…"
          rows={4}
          className="input-field resize-none"
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="flex items-center gap-2 px-6 py-2.5 bg-wine-700 text-white text-sm font-semibold rounded-xl hover:bg-wine-800 disabled:opacity-60 transition-colors"
      >
        <FiSend className="text-sm" /> {submitting ? 'Submitting…' : 'Submit Review'}
      </button>
    </form>
  );
}

/* ── Image Zoom Modal ── */
function ImageZoomModal({ images, startIndex, productName, onClose }) {
  const [current, setCurrent] = useState(startIndex);
  const touchStartX = useRef(null);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setCurrent((c) => Math.min(images.length - 1, c + 1));
      if (e.key === 'ArrowLeft')  setCurrent((c) => Math.max(0, c - 1));
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [images.length, onClose]);

  function onTouchStart(e) { touchStartX.current = e.touches[0].clientX; }
  function onTouchEnd(e) {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    if (delta < -50) setCurrent((c) => Math.min(images.length - 1, c + 1));
    if (delta >  50) setCurrent((c) => Math.max(0, c - 1));
    touchStartX.current = null;
  }

  const prev = () => setCurrent((c) => Math.max(0, c - 1));
  const next = () => setCurrent((c) => Math.min(images.length - 1, c + 1));

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white" onClick={onClose}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 bg-white z-10" onClick={(e) => e.stopPropagation()}>
        <div>
          <p className="font-serif font-bold text-stone-800 text-base leading-tight">{productName}</p>
          <p className="text-xs text-stone-400 mt-0.5">{current + 1} / {images.length}</p>
        </div>
        <button onClick={onClose} className="w-10 h-10 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-600 text-lg font-light transition">
          ×
        </button>
      </div>

      {/* Main image */}
      <div
        className="flex-1 relative flex items-center justify-center bg-white px-4"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="relative w-full max-w-lg aspect-square">
          <Image
            src={images[current]}
            alt={`${productName} — image ${current + 1}`}
            fill
            className="object-contain"
            sizes="(max-width: 768px) 100vw, 600px"
            priority
          />
        </div>

        {/* Prev arrow */}
        {current > 0 && (
          <button onClick={prev}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-11 h-11 bg-white shadow-lg rounded-full flex items-center justify-center text-stone-700 hover:bg-stone-50 border border-stone-100 transition text-xl z-10">
            ‹
          </button>
        )}
        {/* Next arrow */}
        {current < images.length - 1 && (
          <button onClick={next}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 bg-white shadow-lg rounded-full flex items-center justify-center text-stone-700 hover:bg-stone-50 border border-stone-100 transition text-xl z-10">
            ›
          </button>
        )}
      </div>

      {/* Thumbnail strip */}
      {images.length > 1 && (
        <div className="bg-white border-t border-stone-100 px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex gap-2 overflow-x-auto justify-center">
            {images.map((img, i) => (
              <button key={i} onClick={() => setCurrent(i)}
                className={`relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 border-2 transition-all ${i === current ? 'border-wine-600 shadow-sm scale-105' : 'border-stone-200 opacity-60 hover:opacity-100'}`}>
                <Image src={img} alt={`Thumb ${i + 1}`} fill className="object-cover" />
              </button>
            ))}
          </div>
          {/* Dot indicators */}
          <div className="flex justify-center gap-1.5 mt-2.5">
            {images.map((_, i) => (
              <span key={i} className={`w-1.5 h-1.5 rounded-full transition-all ${i === current ? 'bg-wine-600 scale-125' : 'bg-stone-300'}`} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main Page ── */
export default function ProductDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const { dispatch } = useCart();
  const { toggle, isWishlisted } = useWishlist();

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState(0);
  const [qty, setQty] = useState(1);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [zoomIndex, setZoomIndex] = useState(0);

  const [reviews, setReviews] = useState([]);
  const [reviewStats, setReviewStats] = useState({ average: 0, count: 0 });
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [tryOnOpen, setTryOnOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/products/${id}`)
      .then((r) => r.json())
      .then((d) => { if (d.success) setProduct(d.data); else router.push('/shop'); })
      .catch(() => router.push('/shop'))
      .finally(() => setLoading(false));
  }, [id, router]);

  function loadReviews() {
    setReviewsLoading(true);
    fetch(`/api/products/${id}/reviews`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setReviews(d.data.reviews);
          setReviewStats({ average: d.data.average, count: d.data.count });
        }
      })
      .catch(() => {})
      .finally(() => setReviewsLoading(false));
  }

  useEffect(() => { loadReviews(); }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ivory">
        <LoadingSpinner size="lg" />
      </div>
    );
  }
  if (!product) return null;

  const discount = getDiscountPercentage(product.price, product.discountPrice);
  const displayPrice = product.discountPrice || product.price;
  const wishlisted = isWishlisted(product._id || product.id);

  const waEnquiryUrl = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(
    `Hi! I'm interested in "${product.name}" (${formatPrice(displayPrice)}). Please let me know about availability.`
  )}`;

  function addToCart() {
    for (let i = 0; i < qty; i++) dispatch({ type: 'ADD_ITEM', payload: product });
    toast.success(`Added to cart!`);
  }

  function buyNow() {
    if (!session) {
      router.push(`/login?callbackUrl=/product/${id}`);
      return;
    }
    // Add to cart then go straight to checkout
    dispatch({ type: 'ADD_ITEM', payload: { ...product, quantity: qty } });
    for (let i = 1; i < qty; i++) dispatch({ type: 'ADD_ITEM', payload: product });
    router.push('/checkout');
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
    product.category  && { label: 'Category',   value: product.category.replace(/-/g, ' ') },
    product.material  && { label: 'Material',   value: product.material.replace(/-/g, ' ') },
    product.metalType && { label: 'Metal Type', value: product.metalType },
    product.stoneType && { label: 'Stone Type', value: product.stoneType },
    product.color     && { label: 'Color',      value: product.color },
    product.weight    && { label: 'Weight',     value: `${product.weight}g` },
    product.purity    && { label: 'Purity',     value: product.purity },
    product.sku       && { label: 'SKU',        value: product.sku },
  ].filter(Boolean);

  /* Rating breakdown */
  const ratingBreakdown = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((r) => r.rating === star).length,
  }));

  const isEarring  = product.category?.toLowerCase().includes('earring');
  const isNecklace = product.category?.toLowerCase().includes('necklace');
  const isTryOn    = isEarring || isNecklace;
  const tryOnType  = isEarring ? 'earring' : 'necklace';

  return (
    <div className="min-h-screen bg-stone-50">
      {zoomOpen && product.images?.length > 0 && (
        <ImageZoomModal
          images={product.images}
          startIndex={zoomIndex}
          productName={product.name}
          onClose={() => setZoomOpen(false)}
        />
      )}
      {tryOnOpen && isTryOn && (
        <Suspense fallback={null}>
          <TryOnModal
            productImage={product.tryOnImage || product.images?.[selectedImage] || product.images?.[0]}
            productName={product.name}
            category={tryOnType}
            onClose={() => setTryOnOpen(false)}
          />
        </Suspense>
      )}

      {/* Breadcrumb */}
      <div className="bg-white border-b border-stone-100">
        <div className="section-container py-3 flex items-center gap-2 text-xs text-stone-400">
          <Link href="/" className="hover:text-wine-700 transition">Home</Link>
          <span>/</span>
          <Link href="/shop" className="hover:text-wine-700 transition">Shop</Link>
          <span>/</span>
          <span className="text-stone-600 capitalize">{product.category}</span>
          <span>/</span>
          <span className="text-stone-400 line-clamp-1">{product.name}</span>
        </div>
      </div>

      <div className="section-container py-8">

        <button onClick={() => router.back()} className="flex items-center gap-2 text-stone-400 hover:text-wine-700 mb-6 transition text-sm font-medium">
          <FiArrowLeft /> Back
        </button>

        <div className="bg-white rounded-2xl shadow-card overflow-hidden mb-8">
          <div className="grid lg:grid-cols-2">

            {/* ── IMAGE GALLERY ── */}
            <div className="p-6 lg:p-8 bg-stone-50/60">
              {/* Main image with slide arrows */}
              <div
                className="relative aspect-square rounded-2xl overflow-hidden bg-white border border-stone-100 mb-3 group cursor-zoom-in"
                onClick={() => { if (product.images?.[selectedImage]) { setZoomIndex(selectedImage); setZoomOpen(true); } }}
              >
                {product.images?.[selectedImage] ? (
                  <Image
                    src={product.images[selectedImage]}
                    alt={product.name}
                    fill
                    priority
                    className="object-contain transition-opacity duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-8xl text-stone-200">💍</div>
                )}

                {/* Slide arrows */}
                {product.images?.length > 1 && selectedImage > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectedImage((i) => i - 1); }}
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 bg-white/90 hover:bg-white shadow-md rounded-full flex items-center justify-center text-stone-700 text-xl transition z-10 opacity-0 group-hover:opacity-100">
                    ‹
                  </button>
                )}
                {product.images?.length > 1 && selectedImage < product.images.length - 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectedImage((i) => i + 1); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 bg-white/90 hover:bg-white shadow-md rounded-full flex items-center justify-center text-stone-700 text-xl transition z-10 opacity-0 group-hover:opacity-100">
                    ›
                  </button>
                )}

                {discount > 0 && (
                  <span className="absolute top-3 left-3 badge-sale text-sm px-3 py-1">-{discount}% OFF</span>
                )}
                <button onClick={(e) => { e.stopPropagation(); share(); }}
                  className="absolute top-3 right-3 w-9 h-9 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center text-stone-500 hover:text-wine-700 shadow-sm transition">
                  <FiShare2 className="text-sm" />
                </button>
                {product.images?.[selectedImage] && (
                  <span className="absolute bottom-3 right-3 bg-black/40 text-white text-[10px] px-2 py-1 rounded-full pointer-events-none">Tap to zoom</span>
                )}
                {/* Image counter dot */}
                {product.images?.length > 1 && (
                  <span className="absolute bottom-3 left-3 bg-black/40 text-white text-[10px] px-2 py-1 rounded-full pointer-events-none">
                    {selectedImage + 1} / {product.images.length}
                  </span>
                )}
              </div>

              {/* Thumbnail strip */}
              {product.images?.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {product.images.map((img, i) => (
                    <button key={i} onClick={() => setSelectedImage(i)}
                      className={`relative w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 border-2 transition-all ${selectedImage === i ? 'border-wine-600 shadow-sm scale-105' : 'border-transparent opacity-60 hover:opacity-100 hover:border-stone-200'}`}>
                      <Image src={img} alt={`View ${i + 1}`} fill className="object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── PRODUCT INFO ── */}
            <div className="p-6 lg:p-8 flex flex-col">

              <p className="text-gold-600 text-2xs uppercase tracking-widest font-semibold mb-2 capitalize">
                {product.category?.replace(/-/g, ' ')}
              </p>

              <h1 className="font-serif text-2xl md:text-3xl font-bold text-stone-900 leading-snug mb-3">
                {product.name}
              </h1>

              {/* Aggregate rating */}
              {reviewStats.count > 0 && (
                <div className="flex items-center gap-2 mb-4">
                  <Stars rating={reviewStats.average} />
                  <span className="text-sm font-semibold text-stone-700">{reviewStats.average}</span>
                  <span className="text-sm text-stone-400">({reviewStats.count} review{reviewStats.count !== 1 ? 's' : ''})</span>
                </div>
              )}

              {/* Price */}
              <div className="flex items-baseline gap-3 mb-5 pb-5 border-b border-stone-100">
                <span className="font-serif text-3xl font-bold text-wine-700">{formatPrice(displayPrice)}</span>
                {discount > 0 && (
                  <>
                    <span className="text-lg text-stone-300 line-through">{formatPrice(product.price)}</span>
                    <span className="text-xs font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                      Save {formatPrice(product.price - displayPrice)}
                    </span>
                  </>
                )}
              </div>

              <p className="text-stone-500 leading-relaxed text-sm mb-5">{product.description}</p>

              {SPECS.length > 0 && (
                <div className="grid grid-cols-2 gap-2 mb-5">
                  {SPECS.map(({ label, value }) => (
                    <div key={label} className="bg-stone-50 rounded-xl px-3 py-2.5">
                      <p className="text-2xs text-stone-400 uppercase tracking-wider mb-0.5">{label}</p>
                      <p className="text-sm font-semibold text-stone-700 capitalize">{value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Care Instructions */}
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 mb-5">
                <h3 className="font-semibold text-stone-700 text-sm mb-2 flex items-center gap-2">⚠️ Care Instructions</h3>
                <ul className="text-xs text-stone-500 space-y-1">
                  {product.usageInstructions ? (
                    <li>{product.usageInstructions}</li>
                  ) : (
                    <>
                      <li>• Avoid contact with water — remove before bathing or swimming</li>
                      <li>• Keep away from perfume, deodorant, and cosmetics</li>
                      <li>• Store in the provided box or a soft pouch</li>
                      <li>• Wipe gently with a dry cloth after use</li>
                    </>
                  )}
                </ul>
              </div>

              {/* Stock */}
              <div className="flex items-center gap-2 mb-6">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${product.stock > 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${product.stock > 0 ? 'bg-green-500' : 'bg-red-500'}`} />
                  {product.stock > 0 ? `In Stock (${product.stock} available)` : 'Out of Stock'}
                </span>
                {product.isAvailableForRent && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-gold-50 text-gold-700">
                    <FiCalendar className="text-xs" /> Available to Rent
                  </span>
                )}
              </div>

              {/* Qty + Add to Cart */}
              <div className="flex gap-3 mb-3">
                <div className="flex items-center border border-stone-200 rounded-xl overflow-hidden">
                  <button onClick={() => setQty(Math.max(1, qty - 1))} className="w-10 h-11 flex items-center justify-center text-stone-500 hover:bg-stone-50 transition text-lg font-light">−</button>
                  <span className="w-10 text-center text-sm font-semibold">{qty}</span>
                  <button onClick={() => setQty(Math.min(product.stock, qty + 1))} className="w-10 h-11 flex items-center justify-center text-stone-500 hover:bg-stone-50 transition text-lg font-light">+</button>
                </div>
                <button
                  onClick={addToCart}
                  disabled={product.stock === 0}
                  className="flex-1 py-3 bg-wine-700 hover:bg-wine-800 text-white font-bold rounded-xl disabled:bg-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed transition flex items-center justify-center gap-2 text-sm"
                >
                  <FiShoppingCart /> Add to Cart
                </button>
                <button onClick={() => toggle(product)}
                  className={`p-3 rounded-xl border-2 transition ${wishlisted ? 'bg-wine-700 border-wine-700 text-white' : 'border-stone-200 text-stone-500 hover:border-wine-500 hover:text-wine-700'}`}>
                  <FiHeart className={wishlisted ? 'fill-current' : ''} />
                </button>
              </div>

              {/* Buy Now */}
              <button
                onClick={buyNow}
                disabled={product.stock === 0}
                className="w-full py-3 bg-amber-400 hover:bg-amber-500 text-stone-900 font-bold rounded-xl disabled:bg-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed transition flex items-center justify-center gap-2 text-sm mb-4 shadow-sm"
              >
                {session ? '⚡ Buy Now' : '⚡ Buy Now — Login to continue'}
              </button>

              {/* Rental enquiry */}
              {product.isAvailableForRent && product.rentalPrice && (
                <div className="rounded-xl border border-gold-200 bg-gold-50 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <FiCalendar className="text-gold-600" />
                      <span className="text-sm font-semibold text-stone-700">Available to Rent</span>
                    </div>
                    <span className="text-sm font-bold text-wine-700">{formatPrice(product.rentalPrice)}<span className="text-xs font-normal text-stone-400">/day</span></span>
                  </div>
                  <p className="text-xs text-stone-500 mb-3">Contact us on WhatsApp to check availability and confirm your rental dates.</p>
                  <a
                    href={`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(`Hi! I'm interested in renting *${product.name}*.\nRental price: ₹${product.rentalPrice}/day\nPlease let me know about availability and rental details.`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full py-2.5 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition text-sm"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.133.558 4.133 1.535 5.867L.057 23.428a.5.5 0 00.617.611l5.762-1.505A11.95 11.95 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.797 9.797 0 01-5.028-1.386l-.361-.214-3.718.971.997-3.618-.234-.371A9.797 9.797 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z"/></svg>
                    Enquire on WhatsApp for Rental
                  </a>
                </div>
              )}

              {/* Trust */}
              <div className="mt-5 pt-5 border-t border-stone-100 grid grid-cols-2 gap-2">
                {TRUST_ITEMS.map(({ icon: Icon, label }) => (
                  <div key={label} className="flex items-center gap-2 text-xs text-stone-500">
                    <Icon className="text-green-500 flex-shrink-0" /> <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── VIRTUAL TRY-ON BANNER — earrings & necklaces ── */}
        {isTryOn && (
          <div className="mb-8 rounded-2xl overflow-hidden bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 shadow-lg">
            <div className="flex items-center justify-between px-6 py-5">
              <div>
                <p className="text-white font-bold text-lg leading-tight">✨ Virtual Try-On</p>
                <p className="text-purple-200 text-sm mt-1">
                  {isEarring
                    ? 'Try these earrings on your face live using your camera — AR powered'
                    : 'Try this necklace on your neck live using your camera — AR powered'}
                </p>
              </div>
              <button
                onClick={() => setTryOnOpen(true)}
                className="flex-shrink-0 ml-4 px-5 py-3 bg-white text-purple-700 font-bold rounded-xl hover:bg-purple-50 transition text-sm shadow-md flex items-center gap-2"
              >
                <FiCamera size={16} /> Try On
              </button>
            </div>
          </div>
        )}

        {/* ── REVIEWS SECTION ── */}
        <div className="bg-white rounded-2xl shadow-card p-8">
          <div className="flex items-center justify-between mb-8">
            <h2 className="font-serif text-2xl font-bold text-stone-800">
              Customer Reviews
              {reviewStats.count > 0 && <span className="text-stone-400 text-base font-normal ml-2">({reviewStats.count})</span>}
            </h2>
            <button
              onClick={() => setShowReviewForm(!showReviewForm)}
              className="flex items-center gap-2 px-4 py-2 bg-wine-700 text-white text-sm font-semibold rounded-xl hover:bg-wine-800 transition"
            >
              <FiStar className="text-sm" /> Write a Review
            </button>
          </div>

          {/* Rating summary */}
          {reviewStats.count > 0 && (
            <div className="flex flex-col sm:flex-row gap-6 mb-8 p-6 bg-stone-50 rounded-2xl">
              <div className="text-center sm:w-36 flex-shrink-0">
                <p className="font-serif text-6xl font-bold text-stone-800">{reviewStats.average}</p>
                <Stars rating={reviewStats.average} size="base" />
                <p className="text-stone-400 text-sm mt-1">{reviewStats.count} reviews</p>
              </div>
              <div className="flex-1 space-y-2">
                {ratingBreakdown.map(({ star, count }) => (
                  <div key={star} className="flex items-center gap-3">
                    <div className="flex items-center gap-1 w-10 flex-shrink-0">
                      <span className="text-sm text-stone-600">{star}</span>
                      <FiStar className="text-gold-400 text-xs fill-current" />
                    </div>
                    <div className="flex-1 bg-stone-200 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-gold-400 h-full rounded-full transition-all duration-500"
                        style={{ width: reviewStats.count > 0 ? `${(count / reviewStats.count) * 100}%` : '0%' }}
                      />
                    </div>
                    <span className="text-xs text-stone-400 w-6 flex-shrink-0">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Review Form */}
          {showReviewForm && (
            <div className="mb-8">
              <ReviewForm productId={product._id || product.id} onSubmitted={() => { loadReviews(); setShowReviewForm(false); }} />
            </div>
          )}

          {/* Review list */}
          {reviewsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="border border-stone-100 rounded-xl p-5">
                  <div className="flex gap-3 mb-3">
                    <div className="w-9 h-9 rounded-full skeleton" />
                    <div className="space-y-2 flex-1">
                      <div className="h-3 skeleton rounded w-1/4" />
                      <div className="h-3 skeleton rounded w-1/3" />
                    </div>
                  </div>
                  <div className="h-3 skeleton rounded w-full mb-2" />
                  <div className="h-3 skeleton rounded w-4/5" />
                </div>
              ))}
            </div>
          ) : reviews.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-2xl bg-stone-50 flex items-center justify-center mx-auto mb-4">
                <FiStar className="text-stone-300 text-2xl" />
              </div>
              <p className="text-stone-500 font-medium mb-1">No reviews yet</p>
              <p className="text-stone-400 text-sm">Be the first to review this product</p>
              <button onClick={() => setShowReviewForm(true)} className="mt-4 px-5 py-2 bg-wine-700 text-white text-sm font-semibold rounded-xl hover:bg-wine-800 transition">
                Write a Review
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {reviews.map((r) => <ReviewCard key={r.id} review={r} />)}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
