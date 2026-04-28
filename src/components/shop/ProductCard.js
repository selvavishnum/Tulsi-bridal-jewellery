'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { FiHeart, FiShoppingCart, FiEye } from 'react-icons/fi';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { formatPrice, getDiscountPercentage } from '@/lib/utils';
import toast from 'react-hot-toast';

export default function ProductCard({ product }) {
  const { dispatch } = useCart();
  const { toggle, isWishlisted } = useWishlist();
  const [hovered, setHovered] = useState(false);

  const discount = getDiscountPercentage(product.price, product.discountPrice);
  const displayPrice = product.discountPrice || product.price;

  function addToCart(e) {
    e.preventDefault();
    dispatch({ type: 'ADD_ITEM', payload: product });
    toast.success(`${product.name} added to cart!`);
  }

  function toggleWishlist(e) {
    e.preventDefault();
    toggle(product);
    toast.success(isWishlisted(product._id) ? 'Removed from wishlist' : 'Added to wishlist');
  }

  return (
    <div
      className="group bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Link href={`/product/${product._id}`}>
        <div className="relative aspect-square overflow-hidden bg-gray-50">
          {product.images?.[0] ? (
            <Image
              src={hovered && product.images[1] ? product.images[1] : product.images[0]}
              alt={product.name}
              fill
              className="object-cover transition-all duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-300">
              <span className="text-5xl">💍</span>
            </div>
          )}

          {/* Badges */}
          <div className="absolute top-2 left-2 flex flex-col gap-1">
            {discount > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                -{discount}%
              </span>
            )}
            {product.isAvailableForRent && (
              <span className="bg-gold-600 text-white text-xs font-semibold px-2 py-0.5 rounded-full">
                Rent
              </span>
            )}
            {product.stock === 0 && (
              <span className="bg-gray-500 text-white text-xs font-semibold px-2 py-0.5 rounded-full">
                Sold Out
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="absolute top-2 right-2 flex flex-col gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={toggleWishlist}
              className={`p-2 rounded-full shadow ${isWishlisted(product._id) ? 'bg-red-500 text-white' : 'bg-white text-gray-700 hover:bg-red-500 hover:text-white'} transition`}
            >
              <FiHeart className="text-sm" />
            </button>
            <Link href={`/product/${product._id}`} className="p-2 rounded-full bg-white text-gray-700 hover:bg-maroon-950 hover:text-white shadow transition">
              <FiEye className="text-sm" />
            </Link>
          </div>
        </div>

        <div className="p-3">
          <p className="text-xs text-gold-600 uppercase tracking-wider mb-1 capitalize">{product.category}</p>
          <h3 className="font-serif text-gray-800 text-sm font-semibold line-clamp-2 mb-2 leading-snug">
            {product.name}
          </h3>

          <div className="flex items-center gap-2 mb-3">
            <span className="font-bold text-maroon-950">{formatPrice(displayPrice)}</span>
            {discount > 0 && (
              <span className="text-xs text-gray-400 line-through">{formatPrice(product.price)}</span>
            )}
          </div>

          {product.isAvailableForRent && product.rentalPrice && (
            <p className="text-xs text-gold-600 mb-2">Rent from {formatPrice(product.rentalPrice)}/day</p>
          )}
        </div>
      </Link>

      <div className="px-3 pb-3">
        <button
          onClick={addToCart}
          disabled={product.stock === 0}
          className="w-full py-2 bg-maroon-950 text-white text-sm font-semibold rounded-lg hover:bg-maroon-900 disabled:bg-gray-300 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
        >
          <FiShoppingCart className="text-sm" />
          {product.stock === 0 ? 'Out of Stock' : 'Add to Cart'}
        </button>
      </div>
    </div>
  );
}
