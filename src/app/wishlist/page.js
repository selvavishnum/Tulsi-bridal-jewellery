'use client';

import { useWishlist } from '@/context/WishlistContext';
import { useCart } from '@/context/CartContext';
import Link from 'next/link';
import Image from 'next/image';
import { FiHeart, FiShoppingCart, FiTrash2, FiArrowRight } from 'react-icons/fi';
import { formatPrice, getDiscountPercentage } from '@/lib/utils';
import toast from 'react-hot-toast';

function getId(p) { return p?.id || p?._id || null; }

export default function WishlistPage() {
  const { items, remove } = useWishlist();
  const { dispatch } = useCart();

  function addToCart(product) {
    dispatch({ type: 'ADD_ITEM', payload: product });
    toast.success(`${product.name} added to cart!`);
  }

  function removeItem(id) {
    remove(id);
    toast.success('Removed from wishlist');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-br from-maroon-950 to-maroon-800 text-white py-12">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <FiHeart className="text-4xl mx-auto mb-3 text-gold-300" />
          <h1 className="font-serif text-3xl font-bold mb-1">My Wishlist</h1>
          <p className="text-maroon-200 text-sm">{items.length} {items.length === 1 ? 'item' : 'items'} saved</p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-10">
        {items.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-16 text-center">
            <FiHeart className="text-6xl text-gray-200 mx-auto mb-5" />
            <p className="text-gray-500 font-semibold text-lg mb-2">Your wishlist is empty</p>
            <p className="text-gray-400 text-sm mb-7">Save jewellery you love and come back to them anytime</p>
            <Link
              href="/catalog"
              className="inline-flex items-center gap-2 px-7 py-3 bg-maroon-950 text-white font-semibold rounded-xl hover:bg-maroon-900 transition"
            >
              Browse Collection <FiArrowRight />
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {items.map((product) => {
                const pid = getId(product);
                const discount = getDiscountPercentage(product.price, product.discountPrice);
                const displayPrice = product.discountPrice || product.price;

                return (
                  <div key={pid} className="bg-white rounded-xl shadow-sm overflow-hidden group">
                    {/* Image */}
                    <Link href={`/product/${pid}`} className="block relative aspect-square overflow-hidden bg-gray-50">
                      {product.images?.[0] ? (
                        <Image
                          src={product.images[0]}
                          alt={product.name}
                          fill
                          className="object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-5xl">💍</div>
                      )}
                      {discount > 0 && (
                        <span className="absolute top-2 left-2 bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                          -{discount}%
                        </span>
                      )}
                      {/* Remove button */}
                      <button
                        onClick={(e) => { e.preventDefault(); removeItem(pid); }}
                        className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition hover:bg-red-600"
                        title="Remove from wishlist"
                      >
                        <FiTrash2 className="text-xs" />
                      </button>
                    </Link>

                    {/* Info */}
                    <div className="p-3">
                      <p className="text-xs text-gold-600 uppercase tracking-wider mb-1 capitalize">{product.category}</p>
                      <Link href={`/product/${pid}`}>
                        <h3 className="font-serif text-gray-800 text-sm font-semibold line-clamp-2 leading-snug hover:text-maroon-950 transition">
                          {product.name}
                        </h3>
                      </Link>
                      <div className="flex items-center gap-1.5 mt-1.5 mb-3">
                        <span className="font-bold text-maroon-950 text-sm">{formatPrice(displayPrice)}</span>
                        {discount > 0 && (
                          <span className="text-xs text-gray-400 line-through">{formatPrice(product.price)}</span>
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => addToCart(product)}
                          disabled={product.stock === 0}
                          className="flex-1 py-2 bg-maroon-950 text-white text-xs font-semibold rounded-lg hover:bg-maroon-900 disabled:bg-gray-200 disabled:text-gray-400 transition flex items-center justify-center gap-1"
                        >
                          <FiShoppingCart className="text-xs" />
                          {product.stock === 0 ? 'Out of Stock' : 'Add to Cart'}
                        </button>
                        <button
                          onClick={() => removeItem(pid)}
                          className="p-2 border border-gray-200 text-gray-400 rounded-lg hover:border-red-300 hover:text-red-500 transition"
                          title="Remove"
                        >
                          <FiTrash2 className="text-xs" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-8 text-center">
              <Link
                href="/catalog"
                className="inline-flex items-center gap-2 text-maroon-950 font-semibold hover:underline text-sm"
              >
                Continue Shopping <FiArrowRight />
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
