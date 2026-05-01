'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import ProductCard from '@/components/shop/ProductCard';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { FiX } from 'react-icons/fi';

const CATEGORIES = ['necklace', 'earrings', 'bangles', 'bracelet', 'ring', 'maang-tikka', 'nose-ring', 'anklet', 'set', 'other'];
const SORT_OPTIONS = [
  { label: 'Newest', value: 'createdAt-desc' },
  { label: 'Price: Low to High', value: 'price-asc' },
  { label: 'Price: High to Low', value: 'price-desc' },
  { label: 'Most Popular', value: 'ratings.average-desc' },
];

export default function ShopContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  const category = searchParams.get('category') || '';
  const search = searchParams.get('search') || '';
  const rental = searchParams.get('rental') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const sort = searchParams.get('sort') || 'createdAt-desc';
  const [sortField, sortOrder] = sort.split('-');

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: page.toString(), limit: '12', sort: sortField, order: sortOrder, rental: 'false' });
    if (category) params.set('category', category);
    if (search) params.set('search', search);
    try {
      const res = await fetch(`/api/products?${params}`);
      const data = await res.json();
      if (data.success) { setProducts(data.data.products); setTotal(data.data.total); setPages(data.data.pages); }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [category, search, rental, page, sortField, sortOrder]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  function updateParam(key, value) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    params.delete('page');
    router.push(`/shop?${params.toString()}`);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-maroon-950 text-white py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="font-serif text-3xl font-bold mb-1">
            {category ? category.replace('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : search ? `Search: "${search}"` : 'Buy Jewellery'}
          </h1>
          <p className="text-gray-300 text-sm">{total} pieces found</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => updateParam('category', category === cat ? '' : cat)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize transition ${category === cat ? 'bg-maroon-950 text-white' : 'bg-white text-gray-600 hover:bg-maroon-50 border border-gray-200'}`}
              >
                {cat.replace('-', ' ')}
              </button>
            ))}
          </div>
          <select value={sort} onChange={(e) => updateParam('sort', e.target.value)} className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white outline-none focus:ring-2 focus:ring-gold-500">
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {(category || rental || search) && (
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span className="text-sm text-gray-500">Active filters:</span>
            {category && <span className="flex items-center gap-1 bg-gold-100 text-gold-800 text-xs px-2 py-1 rounded-full capitalize">{category} <button onClick={() => updateParam('category', '')}><FiX /></button></span>}
            {rental && <span className="flex items-center gap-1 bg-gold-100 text-gold-800 text-xs px-2 py-1 rounded-full">Rental Only <button onClick={() => updateParam('rental', '')}><FiX /></button></span>}
            {search && <span className="flex items-center gap-1 bg-gold-100 text-gold-800 text-xs px-2 py-1 rounded-full">&quot;{search}&quot; <button onClick={() => updateParam('search', '')}><FiX /></button></span>}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
        ) : products.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">💍</div>
            <p className="text-gray-500 text-lg mb-2">No products found</p>
            <p className="text-gray-400 text-sm">Try adjusting your filters or search term</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
              {products.map((p) => <ProductCard key={p._id} product={p} />)}
            </div>
            {pages > 1 && (
              <div className="flex justify-center gap-2 mt-8">
                {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                  <button key={p} onClick={() => updateParam('page', p.toString())} className={`w-9 h-9 rounded-lg text-sm font-semibold transition ${p === page ? 'bg-maroon-950 text-white' : 'bg-white text-gray-700 hover:bg-maroon-50 border border-gray-200'}`}>{p}</button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
