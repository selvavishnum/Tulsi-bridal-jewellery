'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import ProductCard from '@/components/shop/ProductCard';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { FiX } from 'react-icons/fi';

const CATEGORIES = ['necklace', 'earrings', 'bangles', 'bracelet', 'ring', 'maang-tikka', 'nose-ring', 'anklet', 'set', 'other'];
const COLORS = ['Gold', 'Silver', 'Red', 'Green', 'Blue', 'Pink', 'White', 'Multi-color'];
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

  const [priceMinInput, setPriceMinInput] = useState(searchParams.get('priceMin') || '');
  const [priceMaxInput, setPriceMaxInput] = useState(searchParams.get('priceMax') || '');

  const category = searchParams.get('category') || '';
  const search = searchParams.get('search') || '';
  const rental = searchParams.get('rental') || '';
  const color = searchParams.get('color') || '';
  const priceMin = searchParams.get('priceMin') || '';
  const priceMax = searchParams.get('priceMax') || '';
  const isNew = searchParams.get('isNew') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const sort = searchParams.get('sort') || 'createdAt-desc';
  const [sortField, sortOrder] = sort.split('-');

  useEffect(() => {
    setPriceMinInput(priceMin);
    setPriceMaxInput(priceMax);
  }, [priceMin, priceMax]);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: page.toString(), limit: '12', sort: sortField, order: sortOrder, rental: 'false' });
    if (category) params.set('category', category);
    if (search) params.set('search', search);
    if (color) params.set('color', color);
    if (priceMin) params.set('priceMin', priceMin);
    if (priceMax) params.set('priceMax', priceMax);
    if (isNew) params.set('isNew', isNew);
    try {
      const res = await fetch(`/api/products?${params}`);
      const data = await res.json();
      if (data.success) { setProducts(data.data.products); setTotal(data.data.total); setPages(data.data.pages); }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [category, search, rental, color, priceMin, priceMax, isNew, page, sortField, sortOrder]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  function updateParam(key, value) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    params.delete('page');
    router.push(`/shop?${params.toString()}`);
  }

  function applyPriceRange() {
    const params = new URLSearchParams(searchParams.toString());
    if (priceMinInput) params.set('priceMin', priceMinInput); else params.delete('priceMin');
    if (priceMaxInput) params.set('priceMax', priceMaxInput); else params.delete('priceMax');
    params.delete('page');
    router.push(`/shop?${params.toString()}`);
  }

  const hasActiveFilters = category || rental || search || color || priceMin || priceMax || isNew;

  return (
    <div className="min-h-screen bg-white">

      {/* ── Category title header — arshis.in style ── */}
      <div className="bg-[#f5ede6] py-7 text-center border-b border-stone-200">
        <h1 className="font-serif text-3xl font-bold text-stone-800 tracking-wide">
          {category ? category.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : search ? `"${search}"` : 'All Jewellery'}
        </h1>
      </div>

      <div className="max-w-3xl mx-auto px-3 py-4">

        {/* Filter bar */}
        <div className="flex items-center justify-between mb-3 pb-3 border-b border-stone-100">
          <button className="flex items-center gap-1.5 text-sm text-stone-600 font-medium">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/></svg>
            Filter and sort
          </button>
          <span className="text-sm text-stone-500">{total} products</span>
        </div>

        {/* Category pills */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <button onClick={() => updateParam('category', '')} className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize transition border ${!category ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-stone-600 hover:bg-stone-50 border-stone-200'}`}>All</button>
          {CATEGORIES.map((cat) => (
            <button key={cat} onClick={() => updateParam('category', category === cat ? '' : cat)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize transition border ${category === cat ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-stone-600 hover:bg-stone-50 border-stone-200'}`}>
              {cat.replace(/-/g, ' ')}
            </button>
          ))}
        </div>

        {/* Sort + Price + New */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <select value={sort} onChange={(e) => updateParam('sort', e.target.value)}
            className="text-xs border border-stone-200 rounded-lg px-3 py-1.5 bg-white outline-none focus:ring-1 focus:ring-stone-400 text-stone-600">
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input type="number" value={priceMinInput} onChange={(e) => setPriceMinInput(e.target.value)}
            onBlur={applyPriceRange} onKeyDown={(e) => e.key === 'Enter' && applyPriceRange()}
            placeholder="Min ₹" min="0" className="w-20 px-2 py-1.5 border border-stone-200 rounded-lg text-xs outline-none text-stone-600" />
          <span className="text-stone-400 text-xs">—</span>
          <input type="number" value={priceMaxInput} onChange={(e) => setPriceMaxInput(e.target.value)}
            onBlur={applyPriceRange} onKeyDown={(e) => e.key === 'Enter' && applyPriceRange()}
            placeholder="Max ₹" min="0" className="w-20 px-2 py-1.5 border border-stone-200 rounded-lg text-xs outline-none text-stone-600" />
          <button onClick={() => updateParam('isNew', isNew ? '' : 'true')}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${isNew ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'}`}>
            New
          </button>
        </div>

        {/* Active filter tags */}
        {hasActiveFilters && (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {category && <span className="flex items-center gap-1 bg-stone-100 text-stone-700 text-xs px-2 py-1 rounded-full capitalize">{category.replace(/-/g, ' ')} <button onClick={() => updateParam('category', '')}><FiX className="text-[10px]" /></button></span>}
            {search   && <span className="flex items-center gap-1 bg-stone-100 text-stone-700 text-xs px-2 py-1 rounded-full">&quot;{search}&quot; <button onClick={() => updateParam('search', '')}><FiX className="text-[10px]" /></button></span>}
            {color    && <span className="flex items-center gap-1 bg-stone-100 text-stone-700 text-xs px-2 py-1 rounded-full">Color: {color} <button onClick={() => updateParam('color', '')}><FiX className="text-[10px]" /></button></span>}
            {(priceMin || priceMax) && (
              <span className="flex items-center gap-1 bg-stone-100 text-stone-700 text-xs px-2 py-1 rounded-full">
                {priceMin ? `₹${priceMin}` : '0'} — {priceMax ? `₹${priceMax}` : '∞'}
                <button onClick={() => { setPriceMinInput(''); setPriceMaxInput(''); const p = new URLSearchParams(searchParams.toString()); p.delete('priceMin'); p.delete('priceMax'); p.delete('page'); router.push(`/shop?${p.toString()}`); }}><FiX className="text-[10px]" /></button>
              </span>
            )}
            {isNew && <span className="flex items-center gap-1 bg-stone-100 text-stone-700 text-xs px-2 py-1 rounded-full">New <button onClick={() => updateParam('isNew', '')}><FiX className="text-[10px]" /></button></span>}
          </div>
        )}

        {/* Product grid */}
        {loading ? (
          <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
        ) : products.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">💍</div>
            <p className="text-stone-500 text-lg mb-2">No products found</p>
            <p className="text-stone-400 text-sm">Try adjusting your filters</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-x-2 gap-y-6">
              {products.map((p) => <ProductCard key={p._id} product={p} />)}
            </div>
            {pages > 1 && (
              <div className="flex justify-center gap-2 mt-8">
                {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                  <button key={p} onClick={() => updateParam('page', p.toString())} className={`w-9 h-9 rounded-lg text-sm font-semibold transition ${p === page ? 'bg-stone-800 text-white' : 'bg-white text-stone-700 hover:bg-stone-50 border border-stone-200'}`}>{p}</button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
