'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import CatalogProductItem from '@/components/catalog/CatalogProductItem';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { FiSearch, FiX } from 'react-icons/fi';
import Link from 'next/link';

const CATEGORIES = [
  { label: 'All', value: '' },
  { label: 'Necklaces', value: 'necklace' },
  { label: 'Earrings', value: 'earrings' },
  { label: 'Bangles', value: 'bangles' },
  { label: 'Rings', value: 'ring' },
  { label: 'Maang Tikka', value: 'maang-tikka' },
  { label: 'Bridal Sets', value: 'set' },
  { label: 'Anklets', value: 'anklet' },
  { label: 'Bracelets', value: 'bracelet' },
  { label: 'Other', value: 'other' },
];

/* Group products by category for section headings */
function groupByCategory(products) {
  const groups = {};
  products.forEach((p) => {
    const cat = p.category || 'other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(p);
  });
  return groups;
}

function labelForCategory(slug) {
  const found = CATEGORIES.find((c) => c.value === slug);
  return found ? found.label : slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function CatalogContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');

  const category = searchParams.get('category') || '';
  const search = searchParams.get('search') || '';
  const rental = searchParams.get('rental') || '';

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '100' });
    if (category) params.set('category', category);
    if (search) params.set('search', search);
    if (rental) params.set('rental', 'true');
    try {
      const res = await fetch(`/api/products?${params}`);
      const data = await res.json();
      if (data.success) setProducts(data.data.products);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [category, search, rental]);

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

  const grouped = category || search ? null : groupByCategory(products);

  return (
    <div className="min-h-screen bg-white">
      {/* Catalog header bar */}
      <div className="border-b border-gray-200 bg-white sticky top-0 z-30 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          {/* Category pills */}
          <div className="flex items-center gap-1.5 flex-wrap flex-1">
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                onClick={() => setParam('category', c.value)}
                className={`px-3 py-1 text-xs font-semibold uppercase tracking-wide border transition rounded-sm ${
                  category === c.value
                    ? 'bg-velvet-800 text-white border-velvet-800'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-velvet-700 hover:text-velvet-800'
                }`}
              >
                {c.label}
              </button>
            ))}
            <button
              onClick={() => setParam('rental', rental ? '' : 'true')}
              className={`px-3 py-1 text-xs font-semibold uppercase tracking-wide border transition rounded-sm ${
                rental ? 'bg-gold-600 text-white border-gold-600' : 'bg-white text-gray-600 border-gray-300 hover:border-gold-500 hover:text-gold-700'
              }`}
            >
              Rental Only
            </button>
          </div>

          {/* Search */}
          <form onSubmit={handleSearch} className="flex items-center border border-gray-300 rounded overflow-hidden">
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search catalogue…"
              className="px-3 py-1.5 text-xs outline-none w-40"
            />
            <button type="submit" className="px-2 py-1.5 bg-gray-100 hover:bg-gray-200 transition">
              <FiSearch className="text-gray-500 text-sm" />
            </button>
            {search && (
              <button type="button" onClick={() => { setSearchInput(''); setParam('search', ''); }} className="px-2 py-1.5 bg-gray-100 hover:bg-red-100 transition">
                <FiX className="text-red-400 text-sm" />
              </button>
            )}
          </form>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="max-w-5xl mx-auto px-4 pt-4 pb-1 text-xs text-gray-400 tracking-wide">
        <Link href="/" className="hover:text-wine transition">Home</Link>
        <span className="mx-1.5">/</span>
        <span className="text-gray-600">{category ? labelForCategory(category) : 'Full Catalogue'}</span>
        {search && <><span className="mx-1.5">/</span><span className="text-gray-600">Search: &ldquo;{search}&rdquo;</span></>}
      </div>

      {loading ? (
        <div className="flex justify-center py-24"><LoadingSpinner size="lg" /></div>
      ) : products.length === 0 ? (
        <div className="text-center py-24">
          <div className="text-6xl mb-4">💍</div>
          <p className="text-gray-500 text-lg">No items found</p>
          <button onClick={() => router.push('/catalog')} className="mt-4 text-sm text-wine hover:underline">
            Clear filters
          </button>
        </div>
      ) : category || search ? (
        /* Single-category view — no section headings, just list */
        <div>
          {category && (
            <div className="max-w-5xl mx-auto px-4 pt-5 pb-2">
              <h2 className="text-xs tracking-[0.3em] uppercase text-gray-400">
                {labelForCategory(category)}
                <span className="ml-3 text-gray-300">({products.length} items)</span>
              </h2>
            </div>
          )}
          {products.map((p) => <CatalogProductItem key={p._id} product={p} />)}
        </div>
      ) : (
        /* Full catalogue — grouped by category with section headings */
        Object.entries(grouped).map(([cat, items]) => (
          <div key={cat}>
            {/* Category section heading — exactly like Swastik "ANTIQUE BANGLES" etc. */}
            <div className="max-w-5xl mx-auto px-4 pt-8 pb-1 flex items-center gap-4">
              <div className="h-px flex-1 bg-gray-200" />
              <h2 className="text-xs font-bold tracking-[0.35em] uppercase text-wine whitespace-nowrap">
                {labelForCategory(cat)}
              </h2>
              <div className="h-px flex-1 bg-gray-200" />
            </div>

            {items.map((p) => <CatalogProductItem key={p._id} product={p} />)}
          </div>
        ))
      )}

      {/* Bottom padding */}
      <div className="h-12" />
    </div>
  );
}
