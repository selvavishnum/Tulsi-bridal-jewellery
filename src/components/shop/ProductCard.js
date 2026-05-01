'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { FiHeart, FiShoppingCart, FiCalendar } from 'react-icons/fi';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { formatPrice, getDiscountPercentage } from '@/lib/utils';
import toast from 'react-hot-toast';

export default function ProductCard({ product }) {
  const { dispatch } = useCart();
  const { toggle, isWishlisted } = useWishlist();
  const [hovered, setHovered] = useState(false);

  const id = product._id || product.id;
  const discount = getDiscountPercentage(product.price, product.discountPrice);
  const displayPrice = product.discountPrice || product.price;
  const wishlisted = isWishlisted(id);

  function addToCart(e) {
    e.preventDefault();
    e.stopPropagation();
    dispatch({ type: 'ADD_ITEM', payload: product });
    toast.success('Added to cart!');
  }

  function toggleWishlist(e) {
    e.preventDefault();
    e.stopPropagation();
    const wasWishlisted = isWishlisted(id);
    toggle(product);
    toast.success(wasWishlisted ? 'Removed from wishlist' : 'Saved to wishlist');
  }

  return (
    <div
      className="group bg-white rounded-2xl overflow-hidden shadow-card hover:shadow-card-hover transition-all duration-300"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Link href={`/product/${id}`} className="block relative aspect-square overflow-hidden bg-white border border-stone-100 rounded-t-2xl">
        {product.images?.[0] ? (
          <Image
            src={hovered && product.images[1] ? product.images[1] : product.images[0]}
            alt={product.name}
            fill
            className="object-cover transition-transform duration-700 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-stone-300">
            <span className="text-5xl">💍</span>
          </div>
        )}

        {/* Badges */}
        <div className="absolute top-3 left-3 flex flex-col gap-1.5">
          {discount > 0 && (
            <span className="badge-sale">-{discount}%</span>
          )}
          {product.isAvailableForRent && (
            <span className="badge-rental"><FiCalendar className="text-[9px]" /> Rent</span>
          )}
          {product.stock === 0 && (
            <span className="inline-flex items-center bg-stone-500 text-white text-2xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wider">
              Sold Out
            </span>
          )}
        </div>

        {/* Wishlist */}
        <button
          onClick={toggleWishlist}
          className={`absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-sm transition-all duration-200 shadow-sm ${
            wishlisted
              ? 'bg-wine-700 text-white'
              : 'bg-white/90 text-stone-400 opacity-0 group-hover:opacity-100 hover:bg-wine-700 hover:text-white'
          }`}
          aria-label={wishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
        >
          <FiHeart className={`text-sm ${wishlisted ? 'fill-current' : ''}`} />
        </button>

        {/* Quick Add — slides up on hover */}
        {product.stock > 0 && (
          <div className="absolute bottom-0 left-0 right-0 translate-y-full group-hover:translate-y-0 transition-transform duration-300">
            <button
              onClick={addToCart}
              className="w-full py-3 bg-wine-700 hover:bg-wine-800 text-white text-xs font-semibold tracking-luxury uppercase flex items-center justify-center gap-2 transition-colors"
            >
              <FiShoppingCart className="text-xs" /> Add to Cart
            </button>
          </div>
        )}
      </Link>

      <div className="p-4">
        <p className="text-2xs text-gold-600 uppercase tracking-widest font-semibold mb-1.5 capitalize">{product.category}</p>
        <Link href={`/product/${id}`}>
          <h3 className="font-serif text-stone-800 text-base font-semibold line-clamp-2 mb-2.5 leading-snug group-hover:text-wine-700 transition-colors">
            {product.name}
          </h3>
        </Link>

        <div className="flex items-baseline gap-2 mb-2">
          <span className="font-serif font-bold text-wine-700 text-base">{formatPrice(displayPrice)}</span>
          {discount > 0 && (
            <span className="text-xs text-stone-400 line-through">{formatPrice(product.price)}</span>
          )}
        </div>

        {product.isAvailableForRent && product.rentalPrice && (
          <p className="text-xs text-gold-600 font-medium flex items-center gap-1">
            <FiCalendar className="text-[10px]" /> Rent from {formatPrice(product.rentalPrice)}/day
          </p>
        )}
      </div>
    </div>
  );
}
