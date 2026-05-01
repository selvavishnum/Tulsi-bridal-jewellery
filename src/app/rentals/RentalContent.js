'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { FiCalendar, FiTag, FiSearch, FiX } from 'react-icons/fi';
import { formatPrice } from '@/lib/utils';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

const CATEGORIES = ['necklace', 'earrings', 'bangles', 'bracelet', 'ring', 'maang-tikka', 'set'];

export default function RentalContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  const category = searchParams.get('category') || '';
  const search = searchParams.get('search') || '';
  const page = parseInt(searchParams.get('page') || '1');

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ rental: 'true', limit: '12', page: page.toString() });
    if (category) params.set('category', category);
    if (search) params.set('search', search);
    try {
      const res = await fetch(`/api/products?${params}`);
      const data = await res.json();
      if (data.success) { setProducts(data.data.products); setTotal(data.data.total); }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [category, search, page]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  function updateParam(key, value) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    params.delete('page');
    router.push(`/rentals?${params.toString()}`);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero */}
      <div className="bg-gradient-to-br from-maroon-950 via-maroon-900 to-velvet-800 text-white py-14">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 bg-gold-600/20 border border-gold-500/30 text-gold-300 text-xs font-semibold px-3 py-1.5 rounded-full mb-4">
            <FiCalendar /> Rental Jewellery Collection
          </div>
          <h1 className="font-serif text-4xl font-bold mb-3">Rent Bridal Jewellery</h1>
          <p className="text-maroon-200 max-w-xl mx-auto text-sm leading-relaxed">
            Wear the finest jewellery for your special day — without the full purchase cost. Rent by the day, delivered to your door.
          </p>
          <p className="text-gold-300 font-semibold mt-3 text-sm">{total} pieces available for rent</p>
        </div>
      </div>

      {/* How it works */}
      <div className="bg-white border-b border-gray-100 py-6">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            {[
              { icon: '🔍', step: '1', text: 'Browse & Select' },
              { icon: '📅', step: '2', text: 'Pick Your Dates' },
              { icon: '🚚', step: '3', text: 'Get it Delivered' },
              { icon: '📦', step: '4', text: 'Return After Use' },
            ].map((s) => (
              <div key={s.step} className="flex flex-col items-center gap-1.5">
                <span className="text-2xl">{s.icon}</span>
                <span className="text-xs text-gray-500 font-medium">{s.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
            <input
              defaultValue={search}
              onKeyDown={(e) => e.key === 'Enter' && updateParam('search', e.target.value)}
              placeholder="Search rental jewellery…"
              className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-500 bg-white"
            />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => updateParam('category', '')}
              className={`px-3 py-2 rounded-lg text-xs font-semibold transition ${!category ? 'bg-maroon-950 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >All</button>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => updateParam('category', category === cat ? '' : cat)}
                className={`px-3 py-2 rounded-lg text-xs font-semibold capitalize transition ${category === cat ? 'bg-maroon-950 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              >{cat.replace('-', ' ')}</button>
            ))}
          </div>
        </div>

        {/* Product grid */}
        {loading ? (
          <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
        ) : products.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">💍</div>
            <p className="text-gray-500 font-semibold">No rental jewellery found</p>
            <p className="text-gray-400 text-sm mt-1">Try a different category or search term</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {products.map((product) => {
              const pid = product.id || product._id;
              return (
                <div key={pid} className="bg-white rounded-xl shadow-sm overflow-hidden group">
                  <Link href={`/product/${pid}`} className="block relative aspect-square overflow-hidden bg-gray-50">
                    {product.images?.[0] ? (
                      <Image src={product.images[0]} alt={product.name} fill className="object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-5xl">💍</div>
                    )}
                    <div className="absolute top-2 left-2">
                      <span className="bg-gold-600 text-white text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                        <FiCalendar className="text-[10px]" /> Rental
                      </span>
                    </div>
                    {product.rentalStock <= 0 && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <span className="bg-white text-gray-700 text-xs font-bold px-3 py-1 rounded-full">Not Available</span>
                      </div>
                    )}
                  </Link>
                  <div className="p-3">
                    <p className="text-xs text-gold-600 uppercase tracking-wider mb-1 capitalize">{product.category}</p>
                    <Link href={`/product/${pid}`}>
                      <h3 className="font-serif text-gray-800 text-sm font-semibold line-clamp-2 leading-snug hover:text-maroon-950 transition mb-2">{product.name}</h3>
                    </Link>
                    <div className="flex items-center gap-1 mb-1">
                      <FiTag className="text-gold-600 text-xs" />
                      <span className="text-sm font-bold text-maroon-950">{formatPrice(product.rentalPrice)}</span>
                      <span className="text-xs text-gray-400">/ day</span>
                    </div>
                    {product.price && (
                      <p className="text-xs text-gray-400 mb-3">Security deposit: {formatPrice(Math.round(product.price * 0.3))}</p>
                    )}
                    <Link
                      href={product.rentalStock > 0 ? `/rental-booking/${pid}` : '#'}
                      className={`block w-full py-2 text-center text-xs font-bold rounded-lg transition ${
                        product.rentalStock > 0
                          ? 'bg-maroon-950 text-white hover:bg-maroon-900'
                          : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      }`}
                    >
                      <FiCalendar className="inline mr-1 text-xs" />
                      {product.rentalStock > 0 ? 'Book Now' : 'Unavailable'}
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
