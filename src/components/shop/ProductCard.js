'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, useRef } from 'react';
import { FiHeart, FiStar } from 'react-icons/fi';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { formatPrice, getDiscountPercentage } from '@/lib/utils';
import toast from 'react-hot-toast';

export default function ProductCard({ product }) {
  const { dispatch } = useCart();
  const { toggle, isWishlisted } = useWishlist();
  const [imgIdx, setImgIdx] = useState(0);
  const touchStartX = useRef(null);

  const id          = product._id || product.id;
  const images      = product.images?.filter(Boolean) || [];
  const discount    = getDiscountPercentage(product.price, product.discountPrice);
  const displayPrice = product.discountPrice || product.price;
  const wishlisted  = isWishlisted(id);
  const rating      = product.ratings?.average || 0;
  const reviewCount = product.ratings?.count || 0;

  function addToCart(e) {
    e.preventDefault();
    e.stopPropagation();
    dispatch({ type: 'ADD_ITEM', payload: product });
    toast.success('Added to cart!');
  }

  function toggleWishlist(e) {
    e.preventDefault();
    e.stopPropagation();
    toggle(product);
    toast.success(isWishlisted(id) ? 'Removed from wishlist' : 'Saved to wishlist');
  }

  function onTouchStart(e) {
    touchStartX.current = e.touches[0].clientX;
  }

  function onTouchEnd(e) {
    if (touchStartX.current === null || images.length < 2) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    if (delta < -40) setImgIdx((i) => Math.min(images.length - 1, i + 1));
    if (delta >  40) setImgIdx((i) => Math.max(0, i - 1));
    touchStartX.current = null;
  }

  function onClickImage(e) {
    if (images.length < 2) return;
    e.preventDefault();
    e.stopPropagation();
    setImgIdx((i) => (i + 1) % images.length);
  }

  return (
    <div className="group bg-white">

      {/* ── Image area ── */}
      <div
        className="relative aspect-square overflow-hidden bg-stone-50 mb-2.5 cursor-pointer"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onClick={images.length > 1 ? onClickImage : undefined}
      >
        <Link href={`/product/${id}`} onClick={(e) => images.length > 1 && e.preventDefault()}>
          {images[imgIdx] ? (
            <Image
              src={images[imgIdx]}
              alt={product.name}
              fill
              className="object-cover transition-opacity duration-300"
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-stone-200">
              <span className="text-5xl">💍</span>
            </div>
          )}
        </Link>

        {/* Badges — bottom left, like arshis */}
        <div className="absolute bottom-2 left-2 flex flex-col gap-1">
          {discount > 0 && product.stock > 0 && (
            <span className="bg-[#b5451b] text-white text-[9px] font-bold px-2 py-0.5 tracking-wide">Sale</span>
          )}
          {product.stock === 0 && (
            <span className="bg-stone-500 text-white text-[9px] font-bold px-2 py-0.5 tracking-wide">Sold out</span>
          )}
        </div>

        {/* Image dots — if multiple images */}
        {images.length > 1 && (
          <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1 pointer-events-none">
            {images.map((_, i) => (
              <span key={i} className={`w-1.5 h-1.5 rounded-full transition-all ${i === imgIdx ? 'bg-white scale-125' : 'bg-white/50'}`} />
            ))}
          </div>
        )}

        {/* Wishlist */}
        <button
          onClick={toggleWishlist}
          className={`absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center transition-all shadow-sm ${
            wishlisted ? 'bg-wine-700 text-white' : 'bg-white/90 text-stone-400 hover:text-wine-700'
          }`}
          aria-label="Wishlist"
        >
          <FiHeart className={`text-xs ${wishlisted ? 'fill-current' : ''}`} />
        </button>

        {/* Slide hint on desktop hover */}
        {images.length > 1 && (
          <div className="absolute inset-0 hidden group-hover:flex items-center justify-between px-2 pointer-events-none">
            <span className="w-6 h-6 bg-black/30 rounded-full flex items-center justify-center text-white text-xs">‹</span>
            <span className="w-6 h-6 bg-black/30 rounded-full flex items-center justify-center text-white text-xs">›</span>
          </div>
        )}
      </div>

      {/* ── Text below ── */}
      <Link href={`/product/${id}`} className="block px-0.5">
        <h3 className="text-stone-800 text-sm font-medium leading-snug mb-1.5 line-clamp-3" style={{ fontFamily: 'inherit' }}>
          {product.name}
        </h3>

        {/* Stars */}
        <div className="flex items-center gap-1 mb-1.5">
          {[1, 2, 3, 4, 5].map((s) => (
            <FiStar key={s} className={`text-[11px] ${s <= Math.round(rating) ? 'fill-amber-400 text-amber-400' : 'text-stone-200 fill-stone-200'}`} />
          ))}
          {reviewCount > 0 && <span className="text-[11px] text-stone-400 ml-0.5">({reviewCount})</span>}
        </div>

        {/* Price */}
        <div className="flex items-baseline gap-1.5 flex-wrap">
          {discount > 0 && (
            <span className="text-[11px] text-stone-400 line-through">{formatPrice(product.price)}</span>
          )}
          <span className="text-sm font-bold text-stone-800">{formatPrice(displayPrice)}</span>
        </div>
      </Link>
    </div>
  );
}
