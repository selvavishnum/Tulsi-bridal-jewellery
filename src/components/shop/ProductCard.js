'use client';
/* Catalog card — image-first. Used by every product grid (home, shop,
   catalog, featured).

   The photo fills the card edge to edge in a 3:4 frame (~81% of the card's
   height); Cloudinary crops it with content-aware gravity (g_auto) so the
   jewellery sits large and centred. A compact strip below carries the
   category, a one-line title, the price and a small cart button. The
   discount pill and wishlist heart float over the photo.

   Images: Cloudinary srcset 400–2000px (a 1000px tile at 2×), so each
   device gets retina-sharp pixels from the 8000px masters without
   over-fetching. Shimmer + blurred preview while the sharp tile streams
   in. Off-screen cards skip rendering (content-visibility: auto) for
   smooth scrolling on phones. Desktop hover: gentle zoom and the second
   photo fades in. Touch: swipe between photos. */
import Image from 'next/image';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { FiHeart, FiShoppingBag, FiCalendar } from 'react-icons/fi';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { formatPrice, getDiscountPercentage } from '@/lib/utils';
import { cldCard, cldPlaceholder, isCloudinary } from '@/lib/cloudinaryImage';
import toast from 'react-hot-toast';

const SIZES = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw';
/* next/image asks the loader for each srcset width; cap at 2000 (1000px @2×). */
const cloudinaryLoader = ({ src, width }) => cldCard(src, Math.min(width, 2000));

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
      className={`object-cover will-change-transform ${className}`}
    />
  );
}

export default function ProductCard({ product, priority = false, showCategory = true }) {
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
    <article className="group relative flex flex-col overflow-hidden rounded-lg border border-gray-100 bg-white transition-shadow duration-300 ease-out hover:shadow-sm [content-visibility:auto] [contain-intrinsic-size:auto_300px]">
      {/* Photo — edge to edge, 3:4 */}
      <Link href={href} aria-label={product.name} className="relative block aspect-[3/4] overflow-hidden bg-stone-100"
        onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {main ? (
          <>
            {/* Shimmer + blurred preview until the sharp tile arrives */}
            {!loaded && (
              <div aria-hidden className="absolute inset-0">
                {lqip && <div className="absolute inset-0 scale-110 bg-cover bg-center blur-lg" style={{ backgroundImage: `url("${lqip}")` }} />}
                <div className="absolute inset-0 skeleton opacity-50" />
              </div>
            )}
            <CardImage key={main} src={main} alt={product.name} priority={priority} onLoad={() => setLoaded(true)}
              className={`transition-[transform,opacity] duration-300 ease-out ${loaded ? 'opacity-100' : 'opacity-0'} [@media(hover:hover)]:group-hover:scale-105 ${hoverImg ? '[@media(hover:hover)]:group-hover:opacity-0' : ''}`} />
            {hoverImg && (
              <CardImage src={hoverImg} alt="" className="opacity-0 transition-[transform,opacity] duration-300 ease-out [@media(hover:hover)]:group-hover:scale-105 [@media(hover:hover)]:group-hover:opacity-100" />
            )}
          </>
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-5xl text-stone-300" aria-hidden>💍</span>
        )}

        {/* Top-left pills, over the photo */}
        <div className="pointer-events-none absolute left-2 top-2 flex flex-col items-start gap-1">
          {discount > 0 && !soldOut && (
            <span className="rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-wine-700 shadow-[0_1px_2px_rgba(0,0,0,0.08)] backdrop-blur-sm tabular-nums">−{discount}%</span>
          )}
          {soldOut && (
            <span className="rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-stone-600 backdrop-blur-sm">Sold out</span>
          )}
          {product.isAvailableForRent && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-gold-700 backdrop-blur-sm">
              <FiCalendar className="h-2.5 w-2.5" aria-hidden /> Rent
            </span>
          )}
        </div>

        {/* Photo dots (touch) */}
        {images.length > 1 && (
          <div className="pointer-events-none absolute bottom-1.5 left-0 right-0 flex justify-center gap-1 [@media(hover:hover)]:hidden" aria-hidden>
            {images.slice(0, 5).map((_, i) => (
              <span key={i} className={`h-1 rounded-full shadow-[0_0_2px_rgba(0,0,0,0.3)] transition-all duration-300 ${i === imgIdx ? 'w-3 bg-white' : 'w-1 bg-white/60'}`} />
            ))}
          </div>
        )}
      </Link>

      {/* Wishlist — top-right, over the photo */}
      <button type="button" onClick={toggleWishlist} aria-pressed={wishlisted} aria-label={wishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/85 text-stone-600 shadow-[0_1px_2px_rgba(0,0,0,0.08)] backdrop-blur-sm transition-transform duration-200 hover:text-wine-700 active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-wine-600">
        <FiHeart className={`h-3.5 w-3.5 transition-[fill,color] duration-300 ${wishlisted ? 'fill-wine-700 text-wine-700' : 'fill-transparent'}`} strokeWidth={2} />
      </button>

      {/* Compact details strip */}
      <div className="px-2 pb-1 pt-0.5">
        {showCategory && product.category && (
          <p className="truncate text-[10px] font-medium uppercase leading-3 tracking-wider text-stone-600 opacity-70">{product.category}</p>
        )}
        <Link href={href} className="block">
          <h3 className="truncate font-sans text-xs font-medium leading-4 text-stone-900 group-hover:text-wine-700">{product.name}</h3>
        </Link>
        <div className="flex h-5 items-center justify-between gap-1.5">
          <p className="flex min-w-0 items-baseline gap-1 leading-none">
            <span className="text-xs font-semibold text-stone-900 tabular-nums">{formatPrice(displayPrice)}</span>
            {discount > 0 && <span className="truncate text-[10px] text-stone-400 line-through tabular-nums">{formatPrice(product.price)}</span>}
          </p>
          {!soldOut && (
            <button type="button" onClick={addToCart} aria-label={`Add ${product.name} to cart`}
              className="relative flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-gray-200 text-stone-700 transition-colors duration-200 before:absolute before:-inset-2 before:content-[''] hover:border-wine-700 hover:bg-wine-700 hover:text-white active:scale-95">
              <FiShoppingBag className="h-2.5 w-2.5" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
