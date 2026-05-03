/* ─────────────────────────────────────────────────────────────────
   CatalogProductItem
   Exact Swastik layout per product:

   ┌────────────────────────────────────────────────────────────┐
   │  NAME (uppercase wine)                                     │
   │  CODE : TBJ101  (small gray)                               │
   │                                                            │
   │  ┌──────┬──────┐   ┌────────────────────────────────────┐  │
   │  │ img1 │ img2 │   │                                    │  │
   │  ├──────┼──────┤   │   Large close-up / detail image   │  │
   │  │ img3 │      │   │                                    │  │
   │  └──────┴──────┘   └────────────────────────────────────┘  │
   │  LEFT half            RIGHT half                           │
   └────────────────────────────────────────────────────────────┘

   • Left  = 2 small square thumbnails (stacked 2×1 grid)
   • Right = 1 large portrait/square image (close-up)
   • "Enquire on WhatsApp" or rental CTA button at bottom
   ────────────────────────────────────────────────────────────── */
'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { FiShoppingCart, FiHeart, FiMessageCircle } from 'react-icons/fi';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { formatPrice } from '@/lib/utils';
import toast from 'react-hot-toast';

export default function CatalogProductItem({ product, showPrice = false }) {
  const { dispatch } = useCart();
  const { toggle, isWishlisted } = useWishlist();
  const [activeThumb, setActiveThumb] = useState(0);

  const images = product.images || [];
  /* small thumbnails = first 2 images; large = 3rd if available else 2nd else 1st */
  const thumbs = images.slice(0, 2);
  const largeImg = images[2] || images[1] || images[0];
  const productCode = product.sku || `TBJ${String(product._id).slice(-4).toUpperCase()}`;

  function addToCart(e) {
    e.preventDefault();
    dispatch({ type: 'ADD_ITEM', payload: product });
    toast.success(`${product.name} added to cart!`);
  }

  const whatsappMsg = encodeURIComponent(
    `Hi, I'm interested in *${product.name}* (Code: ${productCode}). Please confirm availability.`
  );

  return (
    <div className="py-7 border-b border-gray-100">
      {/* Product name + code */}
      <div className="max-w-5xl mx-auto px-4 mb-3">
        <h3 className="text-sm md:text-base font-bold tracking-catalog uppercase text-wine leading-tight">
          {product.name}
        </h3>
        <p className="text-[10px] tracking-[0.2em] text-gray-400 mt-0.5 uppercase">
          Code&nbsp;:&nbsp;{productCode}
        </p>
        {showPrice && product.price && (
          <p className="text-sm text-gray-600 mt-0.5">
            {product.discountPrice ? (
              <>
                <span className="font-semibold text-velvet-700">{formatPrice(product.discountPrice)}</span>
                <span className="line-through text-gray-400 ml-2 text-xs">{formatPrice(product.price)}</span>
              </>
            ) : (
              <span className="font-semibold text-velvet-700">{formatPrice(product.price)}</span>
            )}
            {product.isAvailableForRent && product.rentalPrice && (
              <span className="ml-3 text-xs text-gold-600">Rent: {formatPrice(product.rentalPrice)}/day</span>
            )}
          </p>
        )}
      </div>

      {/* Image layout — left thumbnails + right large */}
      <div className="max-w-5xl mx-auto px-4">
        <div className="grid grid-cols-2 gap-1 md:gap-2">
          {/* LEFT — up to 2 thumbnails stacked */}
          <div className="grid grid-rows-2 gap-1 md:gap-2">
            {[0, 1].map((idx) => (
              <Link
                key={idx}
                href={`/product/${product._id}`}
                className="relative aspect-square bg-velvet-800 overflow-hidden block group"
              >
                {images[idx] ? (
                  <Image
                    src={images[idx]}
                    alt={`${product.name} view ${idx + 1}`}
                    fill
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <EmptyTile />
                )}
              </Link>
            ))}
          </div>

          {/* RIGHT — 1 large image */}
          <Link
            href={`/product/${product._id}`}
            className="relative bg-velvet-800 overflow-hidden block group"
            style={{ aspectRatio: '1/2.05' }}
          >
            {largeImg ? (
              <Image
                src={largeImg}
                alt={`${product.name} detail`}
                fill
                className="object-cover transition-transform duration-500 group-hover:scale-105"
              />
            ) : (
              <EmptyTile large />
            )}
            {/* Wishlist button */}
            <button
              onClick={(e) => {
                e.preventDefault();
                toggle(product);
                toast.success(isWishlisted(product._id) ? 'Removed from wishlist' : 'Added to wishlist');
              }}
              className={`absolute top-2 right-2 p-1.5 rounded-full transition z-10 ${isWishlisted(product._id) ? 'bg-red-500 text-white' : 'bg-white/80 text-gray-700 hover:bg-red-500 hover:text-white'}`}
            >
              <FiHeart className="text-xs" />
            </button>
          </Link>
        </div>

        {/* Action row */}
        <div className="flex gap-2 mt-3">
          {/* WhatsApp enquiry */}
          <a
            href={`https://wa.me/917695868787?text=${whatsappMsg}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-green-600 text-white text-xs font-semibold tracking-wide hover:bg-green-700 transition rounded"
          >
            <FiMessageCircle className="text-sm" />
            Enquire on WhatsApp
          </a>

          {/* Add to cart (only shown if stock > 0) */}
          {product.stock > 0 && (
            <button
              onClick={addToCart}
              className="px-4 py-2 bg-velvet-800 text-white text-xs font-semibold hover:bg-velvet-900 transition rounded flex items-center gap-1.5"
            >
              <FiShoppingCart className="text-sm" /> Add to Cart
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyTile({ large }) {
  return (
    <div className="w-full h-full bg-velvet-700 flex items-center justify-center">
      <span className={`opacity-20 ${large ? 'text-5xl' : 'text-3xl'}`}>💍</span>
    </div>
  );
}
