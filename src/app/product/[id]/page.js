'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { FiShoppingCart, FiHeart, FiShare2, FiStar, FiArrowLeft, FiCalendar } from 'react-icons/fi';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { formatPrice, getDiscountPercentage } from '@/lib/utils';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import toast from 'react-hot-toast';

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

  useEffect(() => {
    fetch(`/api/products/${id}`)
      .then((r) => r.json())
      .then((d) => { if (d.success) setProduct(d.data); else router.push('/shop'); })
      .catch(() => router.push('/shop'))
      .finally(() => setLoading(false));
  }, [id, router]);

  if (loading) return <div className="min-h-screen flex items-center justify-center"><LoadingSpinner size="lg" /></div>;
  if (!product) return null;

  const discount = getDiscountPercentage(product.price, product.discountPrice);
  const displayPrice = product.discountPrice || product.price;

  function addToCart() {
    dispatch({ type: 'ADD_ITEM', payload: product });
    toast.success(`${product.name} added to cart!`);
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-500 hover:text-maroon-950 mb-6 transition text-sm">
          <FiArrowLeft /> Back
        </button>

        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="grid md:grid-cols-2 gap-0">
            {/* Images */}
            <div className="p-6">
              <div className="relative aspect-square rounded-xl overflow-hidden bg-gray-50 mb-3">
                {product.images?.[selectedImage] ? (
                  <Image src={product.images[selectedImage]} alt={product.name} fill className="object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-8xl">💍</div>
                )}
                {discount > 0 && (
                  <span className="absolute top-3 left-3 bg-red-500 text-white text-sm font-bold px-3 py-1 rounded-full">-{discount}%</span>
                )}
              </div>
              {product.images?.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {product.images.map((img, i) => (
                    <button key={i} onClick={() => setSelectedImage(i)} className={`relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 border-2 ${selectedImage === i ? 'border-gold-600' : 'border-transparent'}`}>
                      <Image src={img} alt={`View ${i + 1}`} fill className="object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Details */}
            <div className="p-6 md:p-8 flex flex-col">
              <p className="text-gold-600 text-sm uppercase tracking-wider capitalize mb-1">{product.category}</p>
              <h1 className="font-serif text-2xl md:text-3xl font-bold text-gray-900 mb-3">{product.name}</h1>

              {product.ratings?.count > 0 && (
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <FiStar key={i} className={`text-sm ${i < Math.round(product.ratings.average) ? 'fill-gold-400 text-gold-400' : 'text-gray-300'}`} />
                    ))}
                  </div>
                  <span className="text-sm text-gray-500">({product.ratings.count} reviews)</span>
                </div>
              )}

              <div className="flex items-baseline gap-3 mb-4">
                <span className="text-3xl font-bold text-maroon-950">{formatPrice(displayPrice)}</span>
                {discount > 0 && <span className="text-lg text-gray-400 line-through">{formatPrice(product.price)}</span>}
              </div>

              <p className="text-gray-600 leading-relaxed mb-4 text-sm">{product.description}</p>

              {product.material && (
                <div className="grid grid-cols-2 gap-2 mb-4 text-sm">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-gray-400 text-xs">Material</p>
                    <p className="font-semibold capitalize">{product.material.replace('-', ' ')}</p>
                  </div>
                  {product.weight && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-gray-400 text-xs">Weight</p>
                      <p className="font-semibold">{product.weight}g</p>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2 mb-6">
                <span className={`px-2 py-1 rounded-full text-xs font-semibold ${product.stock > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {product.stock > 0 ? `In Stock (${product.stock})` : 'Out of Stock'}
                </span>
                {product.isAvailableForRent && <span className="px-2 py-1 rounded-full text-xs font-semibold bg-gold-100 text-gold-700">Available for Rent</span>}
              </div>

              <div className="flex gap-3 mb-4">
                <button
                  onClick={addToCart}
                  disabled={product.stock === 0}
                  className="flex-1 py-3 bg-maroon-950 text-white font-semibold rounded-xl hover:bg-maroon-900 disabled:bg-gray-300 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
                >
                  <FiShoppingCart /> Add to Cart
                </button>
                <button
                  onClick={() => toggle(product)}
                  className={`p-3 rounded-xl border-2 transition ${isWishlisted(product._id) ? 'bg-red-500 border-red-500 text-white' : 'border-gray-200 text-gray-600 hover:border-red-500 hover:text-red-500'}`}
                >
                  <FiHeart />
                </button>
              </div>

              {product.isAvailableForRent && product.rentalPrice && (
                <button
                  onClick={() => setShowRental(!showRental)}
                  className="w-full py-3 border-2 border-gold-600 text-gold-700 font-semibold rounded-xl hover:bg-gold-50 transition flex items-center justify-center gap-2"
                >
                  <FiCalendar /> Rent from {formatPrice(product.rentalPrice)}/day
                </button>
              )}

              {showRental && (
                <div className="mt-4 p-4 bg-gold-50 rounded-xl border border-gold-200">
                  <h3 className="font-semibold text-maroon-950 mb-3">Select Rental Dates</h3>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Start Date</label>
                      <input type="date" value={rentalDates.start} onChange={(e) => setRentalDates({ ...rentalDates, start: e.target.value })} min={new Date().toISOString().split('T')[0]} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">End Date</label>
                      <input type="date" value={rentalDates.end} onChange={(e) => setRentalDates({ ...rentalDates, end: e.target.value })} min={rentalDates.start || new Date().toISOString().split('T')[0]} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                    </div>
                  </div>
                  {rentalDates.start && rentalDates.end && (
                    <Link
                      href={`/checkout?rental=true&productId=${product._id}&start=${rentalDates.start}&end=${rentalDates.end}`}
                      className="block w-full py-2.5 bg-gold-600 text-white text-center font-semibold rounded-lg hover:bg-gold-700 transition text-sm"
                    >
                      Proceed to Rent
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
