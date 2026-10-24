'use client';

import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  FiShoppingCart, FiHeart, FiShare2, FiStar,
  FiCalendar, FiShield, FiCheckCircle, FiTruck, FiRefreshCw,
  FiUser, FiSend, FiCamera,
} from 'react-icons/fi';
import { useCart } from '@/context/CartContext';
import { freeShippingLine } from '@/lib/storeCharges';
import { useWishlist } from '@/context/WishlistContext';
import { formatPrice, getDiscountPercentage } from '@/lib/utils';
import { IMAGE_WIDTHS, cldBase, cldZoom } from '@/lib/cloudinaryImage';
import CloudinaryPicture from '@/components/ui/CloudinaryPicture';
import ImageZoomModal from '@/components/shop/ImageZoomModal';
import { useProductTracking } from '@/hooks/useProductTracking';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import toast from 'react-hot-toast';
import ChatWithSeller from '@/components/chat/ChatWithSeller';
import { tryOnKind } from '@/lib/tryOn';
import { absoluteUrl } from '@/lib/seoSchema';
import StockBadge from '@/components/product/StockBadge';
import LiveViewersBadge from '@/components/product/LiveViewersBadge';
import OrderOnWhatsApp from '@/components/product/OrderOnWhatsApp';
import WhatsAppIcon from '@/components/product/WhatsAppIcon';
import useStoreWhatsApp from '@/components/product/useStoreWhatsApp';
import useBuyNowReturn from '@/components/product/useBuyNowReturn';
import { buyNowLoadFailure } from '@/components/checkout/checkoutRules';

const TryOnModal = lazy(() => import('@/components/ar/TryOnModal'));

/* The Buy Now checkout (form, payments) loads only when it's wanted —
   fetched as the shopper reaches for the button, so it opens instantly.
   Not React.lazy: a chunk that fails to load (flaky data, or a tab left
   open across a deploy) would throw during render and take the whole
   product page down. Trying import() again in the same page doesn't help
   either — Turbopack's runtime keeps the failed chunk load and returns it
   to every later import() — so a failed load reloads the page with Buy
   Now reopened (?buynow=<qty>, the page's other parameters kept, see
   buyNowLoadFailure); a page that was itself that reload asks for a
   refresh instead of looping. */
let loadedBuyNowDrawer = null;
function loadBuyNowDrawer() {
  if (loadedBuyNowDrawer) return Promise.resolve(loadedBuyNowDrawer);
  return import('@/components/checkout/BuyNowDrawer').then((m) => {
    loadedBuyNowDrawer = m.default;
    return loadedBuyNowDrawer;
  });
}
function preloadBuyNowDrawer() { loadBuyNowDrawer().catch(() => {}); }

/* Shown for the moment the drawer's code is still arriving. */
function BuyNowLoading() {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" role="status" aria-label="Opening checkout">
      <LoadingSpinner size="lg" />
    </div>
  );
}

const TRUST_ITEMS = [
  { icon: FiShield,      label: 'Certified Authentic' },
  { icon: FiTruck,       label: 'FREE_DELIVERY' }, // filled from the store's shipping settings
  { icon: FiRefreshCw,   label: '7-Day Returns' },
  { icon: FiCheckCircle, label: 'Secure Payment' },
];

/* ── Gallery photos ──
   The page draws the same photo twice: a full-width one for phones
   (`lg:hidden`) and a half-width one beside the details on desktops
   (`hidden lg:block`). CSS hides one copy, but a hidden <img> is still
   downloaded — so the desktop copy says when it is visible (`showWhen`) and
   the phone copy says when it is hidden (`hideWhen`), both with Tailwind's
   own `lg` query. Everywhere the photo is hidden, a 1×1 pixel is fetched
   instead. One query for both means the two are exact complements at every
   width: a hand-written `max-width: 1023.99px` for the phone copy still
   matches at exactly 1024px (browsers round fractional widths), where both
   copies would download. */
const LG_AND_UP = '(min-width: 1024px)';

/* `sizes`: how wide each copy is drawn, which the browser needs before any
   CSS has loaded to choose a file from the srcset. Measured from the layout,
   not guessed:
   - phone: the photo box spans the viewport;
   - desktop: half of the page container (max-w-7xl = 1280px, px-8) minus the
     gallery column's p-8 and the box's 1px border = 50vw − 98px, which stops
     growing at 542px (a 1280px viewport and up — a 1920px screen still draws
     542px). IMAGE_SIZES.gallery says 50vw, i.e. 960px at 1920 — about 1.8×
     the pixels this box can show.
   The two strings must differ: React merges preload hints that have the same
   srcset AND sizes, which would leave one twin without its own preload. */
const MAIN_SIZES_PHONE = '100vw';
const MAIN_SIZES_DESKTOP = '(min-width: 1280px) 542px, calc(50vw - 98px)';
/* Thumbnails: w-14 / w-16 minus their 2px borders. */
const THUMB_SIZES_PHONE = '52px';
const THUMB_SIZES_DESKTOP = '60px';

/**
 * The big photo, in one of the two layouts. Fills the aspect-square box its
 * parent already reserves (so nothing moves when it arrives); object-contain
 * keeps the whole piece in view whatever the photo's proportions.
 * `first` = the photo the page opened on: the LCP element, so it is preloaded
 * and fetched at high priority. A photo picked later is not preloaded (the
 * shopper just asked for it, so it is simply eager + high priority — `loading`
 * and `fetchPriority` here override the picture's lazy default).
 * Quality stays 'best': this is the hero shot of a high-value piece.
 * (width/height 1×1 only state the square ratio — `fill` sizes it to the box.)
 * @param {{ url: string, name: string, phone?: boolean, first: boolean, imgRef?: import('react').Ref<HTMLImageElement> }} props
 */
function MainPhoto({ url, name, phone = false, first, imgRef }) {
  return (
    <CloudinaryPicture
      ref={imgRef}
      src={url}
      alt={name}
      width={1}
      height={1}
      fill
      widths={IMAGE_WIDTHS.gallery}
      sizes={phone ? MAIN_SIZES_PHONE : MAIN_SIZES_DESKTOP}
      quality="best"
      fallbackFormat="jpg"
      {...(phone ? { hideWhen: LG_AND_UP } : { showWhen: LG_AND_UP })}
      priority={first}
      {...(!first && { loading: 'eager', fetchPriority: 'high' })}
      className="object-contain"
    />
  );
}

/**
 * A thumbnail in the selector strip: lazy and decoded off the main thread
 * (the picture's defaults), a srcset that tops out at 320px (a 60px
 * thumbnail at 3× needs 180), 'good' quality — perceptually lossless at this
 * size. Fills its fixed w-14 / w-16 button, so the strip never shifts.
 * @param {{ url: string, index: number, phone?: boolean }} props
 */
function ThumbPhoto({ url, index, phone = false }) {
  return (
    <CloudinaryPicture
      src={url}
      alt={`View ${index + 1}`}
      width={1}
      height={1}
      fill
      widths={IMAGE_WIDTHS.thumb}
      sizes={phone ? THUMB_SIZES_PHONE : THUMB_SIZES_DESKTOP}
      quality="good"
      fallbackFormat="jpg"
      {...(phone ? { hideWhen: LG_AND_UP } : { showWhen: LG_AND_UP })}
      className="object-cover"
    />
  );
}

/* The file a gallery <img> has actually downloaded (the srcset pick for this
   screen) — the loupe and the full-screen viewer start from it, so neither
   has to fetch a second copy of a photo that is already on screen. null while
   the img is not in the page yet, or is the hidden twin's 1×1 pixel. */
function shownFile(img, index) {
  const src = img?.currentSrc;
  return src && !src.startsWith('data:') ? { index, src } : null;
}

/* The rating shown above the price. The review endpoint keeps product.ratings
   in step with the reviews, so it is in the first HTML — otherwise the row
   would appear after hydration and push the price and buttons down. */
function ratingOf(product) {
  const count = Math.max(0, Math.floor(Number(product?.ratings?.count) || 0));
  return { average: count > 0 ? Number(product.ratings.average) || 0 : 0, count };
}

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

/* ── Main Page ── */
/* `initialProduct` comes from the server page, so the product renders in
   the first HTML response — search engines and AI crawlers that don't run
   JavaScript see the full listing. It's refreshed client-side after. */
export default function ProductDetail({ initialProduct = null }) {
  const { id } = useParams();
  const router = useRouter();
  const { dispatch, charges } = useCart();
  const { toggle, isWishlisted } = useWishlist();
  const waPhone = useStoreWhatsApp();

  const [product, setProduct] = useState(initialProduct);
  const [loading, setLoading] = useState(!initialProduct);
  /* The client refresh has finished (fresh stock), success or not. */
  const [refreshed, setRefreshed] = useState(false);
  const [selectedImage, setSelectedImageRaw] = useState(0);
  const [qty, setQty] = useState(1);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [zoomIndex, setZoomIndex] = useState(0);
  /* The file the gallery is showing when the full-screen viewer opens. */
  const [zoomShown, setZoomShown] = useState(null);
  /* The two layouts' main <img> elements: read for the file they loaded. */
  const mobileImgRef = useRef(null);
  const desktopImgRef = useRef(null);
  const [buyNowOpen, setBuyNowOpen] = useState(false);
  /* The drawer component once its code has arrived (see loadBuyNowDrawer). */
  const [BuyNowDrawer, setBuyNowDrawer] = useState(() => loadedBuyNowDrawer);
  const [buyNowLoading, setBuyNowLoading] = useState(false);
  const buyNowLoadingRef = useRef(false);
  /* This page load came with ?buynow (back from sign-in, or the reload
     after a failed load) — read before useBuyNowReturn drops it. */
  const openedWithBuyNow = useRef(false);
  useEffect(() => {
    try { openedWithBuyNow.current = new URLSearchParams(window.location?.search || '').has('buynow'); } catch { /* no URL to read */ }
  }, []);
  const showBuyNow = useCallback((productId, wantedQty) => {
    if (loadedBuyNowDrawer) {
      setBuyNowDrawer(() => loadedBuyNowDrawer);
      setBuyNowOpen(true);
      return;
    }
    if (buyNowLoadingRef.current) return;
    buyNowLoadingRef.current = true;
    setBuyNowLoading(true);
    loadBuyNowDrawer()
      .then((Drawer) => { setBuyNowDrawer(() => Drawer); setBuyNowOpen(true); })
      .catch(() => {
        const next = buyNowLoadFailure({ productId, qty: wantedQty, openedWithBuyNow: openedWithBuyNow.current, search: window.location.search });
        if (next.reloadTo) {
          toast(next.message);
          window.location.assign(next.reloadTo);
        } else {
          toast.error(next.message);
        }
      })
      .finally(() => { buyNowLoadingRef.current = false; setBuyNowLoading(false); });
  }, []);

  /* Back from sign-in (?buynow=<qty>): reopen Buy Now for that quantity. */
  const reopenBuyNow = useCallback((n) => { setQty(n); showBuyNow(id, n); }, [showBuyNow, id]);
  const buyNowSoldOut = useCallback(() => toast.error('Sorry — this piece has just sold out.'), []);
  useBuyNowReturn({ product, ready: refreshed, router, onOpen: reopenBuyNow, onSoldOut: buyNowSoldOut });

  const { recordCarouselClick, recordZoomInteraction } = useProductTracking(product);
  function setSelectedImage(next) { recordCarouselClick(); setSelectedImageRaw(next); }

  const [reviews, setReviews] = useState([]);
  const [reviewStats, setReviewStats] = useState(() => ratingOf(initialProduct));
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [tryOnOpen, setTryOnOpen] = useState(false);
  const mobileSwipeX = useRef(null);

  /* Desktop hover loupe — a magnified, cursor-following crop of the main
     image. The w_4000 tier for whichever image is showing is fetched only
     once the shopper actually hovers it (never on page load, never for the
     images they haven't looked at), and only once per image per visit. */
  const [loupeHover, setLoupeHover] = useState(false);
  /* What the loupe shows before that sharper tier arrives: the file the
     gallery already downloaded, captured as the cursor enters. */
  const [loupeBase, setLoupeBase] = useState(null);
  const [loupePos, setLoupePos] = useState({ x: 50, y: 50 });
  const [loupeHiResLoaded, setLoupeHiResLoaded] = useState(() => new Set());

  useEffect(() => {
    if (!loupeHover || !product?.images?.[selectedImage]) return;
    if (loupeHiResLoaded.has(selectedImage)) return;
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => { if (!cancelled) setLoupeHiResLoaded((s) => new Set(s).add(selectedImage)); };
    img.src = cldZoom(product.images[selectedImage]);
    return () => { cancelled = true; };
  }, [loupeHover, selectedImage, product?.images, loupeHiResLoaded]);

  function onLoupeMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    setLoupePos({
      x: Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)),
    });
  }

  function onMobileSwipeStart(e) { mobileSwipeX.current = e.touches[0].clientX; }
  function onMobileSwipeEnd(e) {
    if (mobileSwipeX.current === null) return;
    const delta = e.changedTouches[0].clientX - mobileSwipeX.current;
    const imgs = product?.images || [];
    if (delta < -50 && selectedImage < imgs.length - 1) setSelectedImage((i) => i + 1);
    if (delta >  50 && selectedImage > 0)               setSelectedImage((i) => i - 1);
    mobileSwipeX.current = null;
  }

  useEffect(() => {
    fetch(`/api/products/${id}`)
      .then((r) => r.json())
      .then((d) => { if (d.success) setProduct(d.data); else if (!initialProduct) router.push('/shop'); })
      .catch(() => { if (!initialProduct) router.push('/shop'); })
      .finally(() => { setLoading(false); setRefreshed(true); });
  }, [id, router, initialProduct]);

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
  /* Real stock (a missing figure counts as none, as the order endpoint does). */
  const stockLeft = Math.max(0, Math.floor(Number(product.stock) || 0));
  const soldOut = stockLeft < 1;

  function addToCart() {
    /* One action carrying the quantity (one "add to cart" in analytics). */
    dispatch({ type: 'ADD_ITEM', payload: product, qty });
    toast.success(`Added to cart!`);
  }

  /* Buy Now: checkout for just this piece in a slide-over — the cart is
     left alone. Sign-in (if needed) happens inside the drawer. */
  function openBuyNow() {
    if (soldOut) return;
    showBuyNow(id || product._id || product.id, qty); // this page's own URL
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

  const tryOnType = tryOnKind(product);
  const isTryOn   = !!tryOnType;

  return (
    <div className="min-h-screen bg-stone-50">
      {zoomOpen && product.images?.length > 0 && (
        <ImageZoomModal
          images={product.images}
          startIndex={zoomIndex}
          productName={product.name}
          shown={zoomShown}
          onClose={() => setZoomOpen(false)}
        />
      )}
      {tryOnOpen && isTryOn && (
        <Suspense fallback={null}>
          <TryOnModal
            productId={id}
            productImage={product.tryOnImage || product.images?.[selectedImage] || product.images?.[0]}
            cutoutReady={!!product.tryOnImage}
            productName={product.name}
            category={tryOnType}
            productUrl={absoluteUrl(`/product/${id}`)}
            inStock={product.stock > 0}
            onAddToCart={() => { addToCart(); setTryOnOpen(false); }}
            onClose={() => setTryOnOpen(false)}
          />
        </Suspense>
      )}
      {buyNowLoading && <BuyNowLoading />}
      {buyNowOpen && BuyNowDrawer && (
        <BuyNowDrawer open product={product} qty={qty} onClose={() => setBuyNowOpen(false)} />
      )}

      {/* ── MOBILE FULL-WIDTH IMAGE GALLERY ── */}
      {product.images?.length > 0 && (
        <div className="lg:hidden bg-white">
          <div
            className="relative w-full aspect-square overflow-hidden bg-white cursor-zoom-in"
            onClick={() => { recordZoomInteraction(); setZoomShown(shownFile(mobileImgRef.current, selectedImage)); setZoomIndex(selectedImage); setZoomOpen(true); }}
            onTouchStart={onMobileSwipeStart}
            onTouchEnd={onMobileSwipeEnd}
          >
            <MainPhoto url={product.images[selectedImage]} name={product.name} phone first={selectedImage === 0} imgRef={mobileImgRef} />
            {discount > 0 && (
              <span className="absolute top-4 left-4 badge-sale text-sm px-3 py-1.5 z-10">-{discount}% OFF</span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); share(); }}
              className="absolute top-4 right-4 w-9 h-9 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center text-stone-500 hover:text-wine-700 shadow-sm transition z-10"
            >
              <FiShare2 className="text-sm" />
            </button>
            <span className="absolute bottom-3 right-3 bg-black/45 text-white text-[10px] px-2.5 py-1 rounded-full pointer-events-none z-10">
              Tap to zoom
            </span>
            {product.images.length > 1 && (
              <span className="absolute bottom-3 left-3 bg-black/45 text-white text-[10px] px-2.5 py-1 rounded-full pointer-events-none z-10">
                {selectedImage + 1} / {product.images.length}
              </span>
            )}
          </div>
          {/* Dot indicators */}
          {product.images.length > 1 && (
            <div className="flex items-center gap-3 px-4 py-3 bg-white">
              <div className="flex gap-1.5 flex-1 justify-center">
                {product.images.map((_, i) => (
                  <button key={i} onClick={() => setSelectedImage(i)}
                    className={`rounded-full transition-all duration-300 ${i === selectedImage ? 'w-5 h-1.5 bg-wine-700' : 'w-1.5 h-1.5 bg-stone-300'}`} />
                ))}
              </div>
            </div>
          )}
          {/* Thumbnail strip */}
          {product.images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-hide">
              {product.images.map((img, i) => (
                <button key={i} onClick={() => setSelectedImage(i)}
                  className={`relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 border-2 transition-all ${selectedImage === i ? 'border-wine-600 shadow-sm' : 'border-transparent opacity-55 hover:opacity-90'}`}>
                  <ThumbPhoto url={img} index={i} phone />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="section-container py-8">

        <div className="bg-white rounded-2xl shadow-card overflow-hidden mb-8">
          <div className="grid lg:grid-cols-2">

            {/* ── IMAGE GALLERY — desktop only (mobile shown full-width above) ── */}
            <div className="hidden lg:block p-8 bg-stone-50/60">
              {/* Main image with slide arrows */}
              <div
                className="relative aspect-square rounded-2xl overflow-hidden bg-white border border-stone-100 mb-3 group cursor-zoom-in"
                onClick={() => { if (product.images?.[selectedImage]) { recordZoomInteraction(); setZoomShown(shownFile(desktopImgRef.current, selectedImage)); setZoomIndex(selectedImage); setZoomOpen(true); } }}
                onMouseEnter={() => { recordZoomInteraction(); setLoupeBase(shownFile(desktopImgRef.current, selectedImage)); setLoupeHover(true); }}
                onMouseLeave={() => setLoupeHover(false)}
                onMouseMove={onLoupeMove}
              >
                {product.images?.[selectedImage] ? (
                  <MainPhoto url={product.images[selectedImage]} name={product.name} first={selectedImage === 0} imgRef={desktopImgRef} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-8xl text-stone-200">💍</div>
                )}

                {/* Hover loupe — magnified, cursor-following crop. Starts
                   from the file the gallery already loaded (captured as the
                   cursor entered, so no blank flash and no second download),
                   then sharpens to the w_3000 q_90 tier once that finishes
                   loading in the background. If the photo was changed while
                   hovering, there is no loaded file for the new one and the
                   w_1400 tier stands in until the sharper one arrives. */}
                {loupeHover && product.images?.[selectedImage] && (
                  <div
                    className="absolute inset-0 pointer-events-none bg-white"
                    style={{
                      backgroundImage: `url(${loupeHiResLoaded.has(selectedImage) ? cldZoom(product.images[selectedImage]) : (loupeBase?.index === selectedImage ? loupeBase.src : cldBase(product.images[selectedImage]))})`,
                      backgroundPosition: `${loupePos.x}% ${loupePos.y}%`,
                      backgroundSize: '220%',
                      backgroundRepeat: 'no-repeat',
                    }}
                  >
                    {!loupeHiResLoaded.has(selectedImage) && (
                      <span className="absolute top-3 right-3 bg-black/60 text-white text-[10px] px-2.5 py-1 rounded-full flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        Loading HD zoom…
                      </span>
                    )}
                  </div>
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
                      <ThumbPhoto url={img} index={i} />
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

              {/* Price + real stock / live-viewer badges */}
              <div className="mb-5 pb-5 border-b border-stone-100">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
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
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <StockBadge stock={product.stock} />
                  {product.isAvailableForRent && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-gold-50 text-gold-700 ring-1 ring-gold-100">
                      <FiCalendar className="text-xs" aria-hidden="true" /> Available to Rent
                    </span>
                  )}
                  <LiveViewersBadge productId={id} />
                </div>
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

              {/* Quantity + wishlist */}
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Qty</span>
                  <div className="flex items-center border border-stone-200 rounded-xl overflow-hidden" role="group" aria-label="Quantity">
                    <button
                      type="button"
                      onClick={() => setQty(Math.max(1, qty - 1))}
                      disabled={soldOut || qty <= 1}
                      aria-label="Decrease quantity"
                      className="w-11 h-11 flex items-center justify-center text-stone-500 hover:bg-stone-50 disabled:text-stone-300 disabled:hover:bg-transparent transition text-lg font-light"
                    >−</button>
                    <span className="w-10 text-center text-sm font-semibold" aria-live="polite">{qty}</span>
                    <button
                      type="button"
                      onClick={() => setQty(Math.max(1, Math.min(stockLeft, qty + 1)))}
                      disabled={soldOut || qty >= stockLeft}
                      aria-label="Increase quantity"
                      className="w-11 h-11 flex items-center justify-center text-stone-500 hover:bg-stone-50 disabled:text-stone-300 disabled:hover:bg-transparent transition text-lg font-light"
                    >+</button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(product)}
                  aria-pressed={wishlisted}
                  aria-label={wishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
                  className={`w-11 h-11 flex items-center justify-center rounded-xl border-2 transition ${wishlisted ? 'bg-wine-700 border-wine-700 text-white' : 'border-stone-200 text-stone-500 hover:border-wine-500 hover:text-wine-700'}`}
                >
                  <FiHeart className={wishlisted ? 'fill-current' : ''} />
                </button>
              </div>

              {/* Add to Cart (secondary) + Buy Now (primary): side by side at
                 every width — two ~150px buttons fit a 390px phone. */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <button
                  type="button"
                  onClick={addToCart}
                  disabled={soldOut}
                  className="min-h-[48px] px-2 sm:px-3 rounded-xl border-2 border-wine-700 bg-white text-wine-700 hover:bg-wine-50 active:bg-wine-100 font-bold text-sm whitespace-nowrap flex items-center justify-center gap-2 transition disabled:border-stone-200 disabled:bg-stone-50 disabled:text-stone-400 disabled:cursor-not-allowed"
                >
                  {/* Icon dropped on the narrowest phones (320px) so the label fits. */}
                  <FiShoppingCart className="hidden min-[360px]:block flex-shrink-0" aria-hidden="true" /> Add to Cart
                </button>
                <button
                  type="button"
                  onClick={openBuyNow}
                  onPointerEnter={preloadBuyNowDrawer}
                  onTouchStart={preloadBuyNowDrawer}
                  onFocus={preloadBuyNowDrawer}
                  disabled={soldOut}
                  aria-haspopup="dialog"
                  className="min-h-[48px] px-2 sm:px-3 rounded-xl bg-wine-700 hover:bg-wine-800 active:bg-wine-900 text-white font-bold text-sm whitespace-nowrap flex items-center justify-center gap-1.5 shadow-luxury ring-1 ring-inset ring-gold-400/50 transition disabled:bg-stone-200 disabled:text-stone-400 disabled:shadow-none disabled:ring-0 disabled:cursor-not-allowed"
                >
                  <span aria-hidden="true" className="text-gold-300">⚡</span> Buy Now
                </button>
              </div>

              {/* Secondary: order by chat */}
              <OrderOnWhatsApp phone={waPhone} product={product} productId={id} qty={qty} className="mb-4" />

              {product.sellerChat && <ChatWithSeller product={product} />}

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
                    href={`https://wa.me/${waPhone}?text=${encodeURIComponent(`Hi! I'm interested in renting *${product.name}*.\nRental price: ₹${product.rentalPrice}/day\nPlease let me know about availability and rental details.`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full min-h-[44px] py-2.5 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition text-sm"
                  >
                    <WhatsAppIcon />
                    Enquire on WhatsApp for Rental
                  </a>
                </div>
              )}

              {/* Trust */}
              <div className="mt-5 pt-5 border-t border-stone-100 grid grid-cols-2 gap-2">
                {TRUST_ITEMS.map(({ icon: Icon, label: rawLabel }) => ({ Icon, label: rawLabel === 'FREE_DELIVERY' ? freeShippingLine(charges) : rawLabel })).map(({ Icon, label }) => (
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
                  See it on an AI model in your skin tone, or live on your own face with the camera
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

          {/* Rating summary — the breakdown is counted from the reviews, so it
             waits for them (the average above the price does not). */}
          {reviewStats.count > 0 && reviews.length > 0 && (
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
