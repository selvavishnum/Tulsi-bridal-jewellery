'use client';
/* Catalog card — pure white, hairline border, jewellery shown whole.
   Used by every product grid (home, shop, catalog, featured).

   Image: a square white well with the piece `object-contain`ed inside
   generous padding, so fine chains, pendants and stones are never
   cropped or touching the edge. Cloudinary serves a srcset (320–1600px,
   c_limit) so each device gets retina-sharp pixels without over-fetching;
   a ~1KB blurred preview and a shimmer show while the sharp tile loads.
   Desktop hover: gentle zoom, and the second photo fades in if there is
   one. Touch: swipe between photos. */
import Image from 'next/image';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { FiHeart, FiShoppingBag, FiStar, FiCalendar } from 'react-icons/fi';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { formatPrice, getDiscountPercentage } from '@/lib/utils';
import { cldCard, cldPlaceholder, isCloudinary } from '@/lib/cloudinaryImage';
import toast from 'react-hot-toast';

const SIZES = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw';
/* next/image asks the loader for each srcset width; cap at 1600 (800px @2×). */
const cloudinaryLoader = ({ src, width }) => cldCard(src, Math.min(width, 1600));

function CardImage({ src, alt, priority, className = '', onLoad }) {
  const cld = isCloudinary(src);
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={SIZES}
      /* Top-fold cards load first; the rest wait until scrolled near. */
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      {...(cld ? { loader: cloudinaryLoader } : { unoptimized: true })}
      onLoad={onLoad}
      draggable={false}
      /* Studio backgrounds are rarely exactly #FFF (#FAF9F7 is typical):
         lift near-white to white and multiply onto the white card so the
         photo edge disappears. Jewellery tones shift by only ~2%. */
      className={`object-contain p-4 sm:p-5 mix-blend-multiply [filter:brightness(1.02)_contrast(1.03)] will-change-transform ${className}`}
    />
  );
}

export default function ProductCard({ product, priority = false, showCategory = false }) {
  const { dispatch } = useCart();
  const { toggle, isWishlisted } = useWishlist();
  const [imgIdx, setImgIdx] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const touchStartX = useRef(null);

  const id = product._id || product.id;
  const href = `/product/${id}`;
  const images = product.images?.filter(Boolean) || [];
  const main = images[imgIdx];
  const hoverImg = imgIdx === 0 ? images[1] : null;
  const discount = getDiscountPercentage(product.price, product.discountPrice);
  const displayPrice = product.discountPrice || product.price;
  const wishlisted = isWishlisted(id);
  const soldOut = product.stock === 0;
  const rating = product.ratings?.average || 0;
  const reviewCount = product.ratings?.count || 0;
  const lqip = main ? cldPlaceholder(main) : null;

  function addToCart(e) {
    e.preventDefault();
    e.stopPropagation();
    dispatch({ type: 'ADD_ITEM', payload: product });
    toast.success('Added to cart');
  }

  function toggleWishlist(e) {
    e.preventDefault();
    e.stopPropagation();
    toast.success(wishlisted ? 'Removed from wishlist' : 'Saved to wishlist');
    toggle(product);
  }

  function onTouchStart(e) { touchStartX.current = e.touches[0].clientX; }
  function onTouchEnd(e) {
    if (touchStartX.current === null || images.length < 2) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 40) return;
    setLoaded(false);
    setImgIdx((i) => (delta < 0 ? Math.min(images.length - 1, i + 1) : Math.max(0, i - 1)));
  }

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border border-gray-100 bg-white transition-[box-shadow,border-color] duration-300 ease-out hover:border-gray-200 hover:shadow-sm">
      {/* Image well */}
      <Link href={href} aria-label={product.name} className="relative block aspect-square overflow-hidden bg-white"
        onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {main ? (
          <>
            {/* LQIP + shimmer until the sharp tile arrives */}
            {!loaded && (
              <div aria-hidden className="absolute inset-0">
                {lqip && <div className="absolute inset-4 bg-contain bg-center bg-no-repeat opacity-60 blur-md" style={{ backgroundImage: `url("${lqip}")` }} />}
                <div className="absolute inset-0 skeleton opacity-40" />
              </div>
            )}
            <CardImage key={main} src={main} alt={product.name} priority={priority} onLoad={() => setLoaded(true)}
              className={`transition-[transform,opacity] duration-300 ease-out ${loaded ? 'opacity-100' : 'opacity-0'} [@media(hover:hover)]:group-hover:scale-105 ${hoverImg ? '[@media(hover:hover)]:group-hover:opacity-0' : ''}`} />
            {/* Second photo fades in on desktop hover */}
            {hoverImg && (
              <CardImage src={hoverImg} alt="" className="opacity-0 transition-[transform,opacity] duration-300 ease-out [@media(hover:hover)]:group-hover:scale-105 [@media(hover:hover)]:group-hover:opacity-100" />
            )}
          </>
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-5xl text-stone-200" aria-hidden>💍</span>
        )}

        {/* Badges */}
        <div className="pointer-events-none absolute left-2.5 top-2.5 flex flex-col items-start gap-1">
          {discount > 0 && !soldOut && (
            <span className="rounded-full bg-wine-700 px-2 py-0.5 text-[10px] font-semibold leading-4 tracking-wide text-white tabular-nums">−{discount}%</span>
          )}
          {soldOut && (
            <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold leading-4 tracking-wide text-stone-500">Sold out</span>
          )}
          {product.isAvailableForRent && (
            <span className="inline-flex items-center gap-1 rounded-full border border-gold-200 bg-white px-2 py-0.5 text-[10px] font-semibold leading-4 tracking-wide text-gold-700">
              <FiCalendar className="text-[9px]" aria-hidden /> Rent
            </span>
          )}
        </div>

        {/* Photo dots (touch) */}
        {images.length > 1 && (
          <div className="pointer-events-none absolute bottom-2 left-0 right-0 flex justify-center gap-1 [@media(hover:hover)]:hidden" aria-hidden>
            {images.slice(0, 5).map((_, i) => (
              <span key={i} className={`h-1 rounded-full transition-all duration-300 ${i === imgIdx ? 'w-3 bg-stone-700' : 'w-1 bg-stone-300'}`} />
            ))}
          </div>
        )}
      </Link>

      {/* Wishlist */}
      <button type="button" onClick={toggleWishlist} aria-pressed={wishlisted} aria-label={wishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
        className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-stone-500 shadow-[0_1px_2px_rgba(0,0,0,0.06)] backdrop-blur-sm transition-transform duration-200 hover:text-wine-700 active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-wine-600">
        <FiHeart className={`h-4 w-4 transition-[fill,color] duration-300 ${wishlisted ? 'fill-wine-700 text-wine-700' : 'fill-transparent'}`} strokeWidth={1.75} />
      </button>

      {/* Details */}
      <div className="flex flex-1 flex-col px-3 pb-3 pt-2.5">
        {showCategory && product.category && (
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-gold-700">{product.category}</p>
        )}
        <Link href={href} className="block">
          <h3 className="line-clamp-2 min-h-[2.5rem] font-serif text-[15px] font-semibold leading-5 text-stone-900 transition-colors group-hover:text-wine-700">
            {product.name}
          </h3>
        </Link>

        {reviewCount > 0 && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-stone-500" aria-label={`Rated ${rating.toFixed(1)} out of 5`}>
            <FiStar className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden />
            <span className="font-medium text-stone-700 tabular-nums">{rating.toFixed(1)}</span>
            <span className="tabular-nums">({reviewCount})</span>
          </div>
        )}

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <p className="flex flex-wrap items-baseline gap-x-1.5 leading-none">
            <span className="text-[15px] font-semibold text-stone-900 tabular-nums">{formatPrice(displayPrice)}</span>
            {discount > 0 && <span className="text-[11px] text-stone-400 line-through tabular-nums">{formatPrice(product.price)}</span>}
          </p>
          {!soldOut && (
            <button type="button" onClick={addToCart} aria-label={`Add ${product.name} to cart`}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-gray-200 text-stone-700 transition-colors duration-200 hover:border-wine-700 hover:bg-wine-700 hover:text-white active:scale-95">
              <FiShoppingBag className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
