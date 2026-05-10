'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import ProductCard from '@/components/shop/ProductCard';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { FiSearch, FiX, FiSliders } from 'react-icons/fi';

const CATEGORIES = [
  { label: 'All',          value: '' },
  { label: 'Necklaces',    value: 'necklace' },
  { label: 'Earrings',     value: 'earrings' },
  { label: 'Bangles',      value: 'bangles' },
  { label: 'Rings',        value: 'ring' },
  { label: 'Maang Tikka',  value: 'maang-tikka' },
  { label: 'Bridal Sets',  value: 'set' },
  { label: 'Anklets',      value: 'anklet' },
  { label: 'Bracelets',    value: 'bracelet' },
  { label: 'Other',        value: 'other' },
];

const SORT_OPTIONS = [
  { label: 'Newest',            value: 'createdAt-desc' },
  { label: 'Price: Low → High', value: 'price-asc' },
  { label: 'Price: High → Low', value: 'price-desc' },
];

function categoryTitle(slug) {
  if (!slug) return 'All Jewellery';
  const found = CATEGORIES.find((c) => c.value === slug);
  return found ? found.label : slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function CatalogContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [products, setProducts]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [total, setTotal]           = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const category = searchParams.get('category') || '';
  const search   = searchParams.get('search')   || '';
  const rental   = searchParams.get('rental')   || '';
  const sort     = searchParams.get('sort')     || 'createdAt-desc';
  const [sortField, sortOrder] = sort.split('-');

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '100', sort: sortField, order: sortOrder });
    if (category) params.set('category', category);
    if (search)   params.set('search', search);
    if (rental)   params.set('rental', 'true');
    try {
      const res  = await fetch(`/api/products?${params}`);
      const data = await res.json();
      if (data.success) {
        setProducts(data.data.products);
        setTotal(data.data.total);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [category, search, rental, sortField, sortOrder]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  function setParam(key, value) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    router.push(`/catalog?${params.toString()}`);
  }

  function handleSearch(e) {
    e.preventDefault();
    setParam('search', searchInput.trim());
  }

  return (
    <div className="min-h-screen bg-white">

      {/* ── Title header — arshis.in style ── */}
      <div className="bg-[#f5ede6] py-7 text-center border-b border-stone-200">
        <h1 className="font-serif text-3xl font-bold text-stone-800 tracking-wide">
          {search ? `"${search}"` : categoryTitle(category)}
        </h1>
      </div>

      {/* ── Filter bar ── */}
      <div className="max-w-3xl mx-auto px-3 py-3">
        <div className="flex items-center justify-between mb-3 pb-3 border-b border-stone-100">
          <button
            onClick={() => setShowFilters((v) => !v)}
            className="flex items-center gap-1.5 text-sm text-stone-600 font-medium">
            <FiSliders size={14} /> Filter and sort
          </button>
          <span className="text-sm text-stone-500">{total || products.length} products</span>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="mb-4 space-y-3 pb-4 border-b border-stone-100">
            {/* Search */}
            <form onSubmit={handleSearch} className="flex items-center border border-stone-200 rounded-lg overflow-hidden">
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search catalogue…"
                className="flex-1 px-3 py-2 text-sm outline-none text-stone-700"
              />
              <button type="submit" className="px-3 py-2 bg-stone-100 hover:bg-stone-200 transition">
                <FiSearch className="text-stone-500 text-sm" />
              </button>
              {search && (
                <button type="button" onClick={() => { setSearchInput(''); setParam('search', ''); }}
                  className="px-2 py-2 bg-stone-100 hover:bg-red-100 transition">
                  <FiX className="text-red-400 text-sm" />
                </button>
              )}
            </form>

            {/* Sort */}
            <select value={sort} onChange={(e) => setParam('sort', e.target.value)}
              className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 bg-white outline-none text-stone-600">
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            {/* Rental toggle */}
            <button onClick={() => setParam('rental', rental ? '' : 'true')}
              className={`w-full py-2 rounded-lg text-sm font-semibold border transition ${rental ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'}`}>
              {rental ? '✓ Rental Only' : 'Show Rental Only'}
            </button>
          </div>
        )}

        {/* Category pills */}
        <div className="flex items-center gap-1.5 flex-wrap mb-4">
          {CATEGORIES.map((c) => (
            <button key={c.value} onClick={() => setParam('category', c.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize transition border ${
                category === c.value
                  ? 'bg-stone-800 text-white border-stone-800'
                  : 'bg-white text-stone-600 hover:bg-stone-50 border-stone-200'
              }`}>
              {c.label}
            </button>
          ))}
        </div>

        {/* Product grid */}
        {loading ? (
          <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
        ) : products.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">💍</div>
            <p className="text-stone-500 text-lg mb-2">No products found</p>
            <button onClick={() => router.push('/catalog')} className="text-sm text-stone-400 hover:underline mt-1">
              Clear filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-2 gap-y-6">
            {products.map((p) => <ProductCard key={p._id || p.id} product={p} />)}
          </div>
        )}
      </div>
    </div>
  );
}
