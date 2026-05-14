'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  FiPlus, FiRefreshCw, FiBarChart2, FiSearch, FiX, FiEdit2,
  FiTrash2, FiSave, FiPackage, FiEye, FiEyeOff,
} from 'react-icons/fi';
import toast from 'react-hot-toast';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import Badge from '@/components/ui/Badge';
import { formatPrice } from '@/lib/utils';

const CATEGORIES = [
  '', 'necklace', 'earrings', 'bangles', 'bracelet', 'ring', 'maang-tikka',
  'nose-ring', 'anklet', 'set', 'mala', 'haar', 'jhumka', 'kada', 'choker',
  'pendant', 'mangalsutra', 'other',
];

const LIMITS = [25, 50, 100];

export default function InventoryPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [mainCat, setMainCat] = useState('');
  const [showMe, setShowMe] = useState('');
  const [limit, setLimit] = useState(50);
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState({});

  async function fetchInventory() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (mainCat) params.set('mainCategory', mainCat);
      if (showMe) params.set('showMe', showMe);
      params.set('limit', limit.toString());
      const res = await fetch(`/api/admin/inventory?${params}`);
      const data = await res.json();
      if (data.success) {
        setProducts(data.data);
        setDrafts({});
      }
    } catch { toast.error('Failed to load inventory'); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchInventory(); }, [search, mainCat, showMe, limit]);

  function startDraft(product) {
    setDrafts((prev) => ({
      ...prev,
      [product.id]: {
        sku: product.sku || '',
        mrp: product.price || '',
        discPct: product.discPct || (product.price && product.discountPrice
          ? Math.round(((product.price - product.discountPrice) / product.price) * 100)
          : 0),
        inStock: product.stock ?? 0,
        showMe: product.showMe !== false,
      },
    }));
  }

  function updateDraft(id, field, value) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  async function saveCard(product) {
    const draft = drafts[product.id];
    if (!draft) return;
    setSaving((prev) => ({ ...prev, [product.id]: true }));
    try {
      const res = await fetch('/api/admin/inventory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: product.id,
          sku: draft.sku,
          mrp: parseFloat(draft.mrp) || 0,
          discPct: parseFloat(draft.discPct) || 0,
          inStock: parseInt(draft.inStock) || 0,
          showMe: draft.showMe,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Saved!');
        setDrafts((prev) => { const n = { ...prev }; delete n[product.id]; return n; });
        fetchInventory();
      } else { toast.error(data.message); }
    } finally {
      setSaving((prev) => { const n = { ...prev }; delete n[product.id]; return n; });
    }
  }

  async function handleDelete(product) {
    if (!confirm(`Delete "${product.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/inventory?id=${product.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) { toast.success('Deleted'); fetchInventory(); }
      else toast.error(data.message);
    } catch { toast.error('Delete failed'); }
  }

  const totalValue = products.reduce((s, p) => s + (p.price || 0) * (p.stock || 0), 0);
  const lowStockCount = products.filter((p) => (p.stock || 0) <= 3).length;

  const inp = 'w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white transition';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Product Inventory</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {products.length} products · Inventory value: {formatPrice(totalValue)}
            {lowStockCount > 0 && (
              <span className="ml-3 text-orange-500 font-semibold">{lowStockCount} low stock</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/products"
            className="flex items-center gap-2 px-4 py-2.5 bg-maroon-950 text-white text-sm font-bold rounded-xl hover:bg-maroon-900 transition shadow-sm"
          >
            <FiPlus /> Add Product
          </Link>
          <button onClick={fetchInventory}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-50 transition"
          >
            <FiRefreshCw className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <Link href="/admin/inventory/stock-checker"
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-50 transition"
          >
            <FiBarChart2 /> Stock Checker
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap bg-white rounded-xl p-3 shadow-sm">
        <div className="relative flex-1 min-w-40">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products..."
            className="w-full pl-8 pr-8 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              <FiX className="text-sm" />
            </button>
          )}
        </div>
        <select value={mainCat} onChange={(e) => setMainCat(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white capitalize"
        >
          <option value="">All Categories</option>
          {CATEGORIES.filter(Boolean).map((c) => (
            <option key={c} value={c} className="capitalize">{c.replace(/-/g, ' ')}</option>
          ))}
        </select>
        <select value={showMe} onChange={(e) => setShowMe(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white"
        >
          <option value="">All Visibility</option>
          <option value="visible">Visible Only</option>
          <option value="hidden">Hidden Only</option>
        </select>
        <select value={limit} onChange={(e) => setLimit(parseInt(e.target.value))}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white"
        >
          {LIMITS.map((l) => <option key={l} value={l}>{l} per page</option>)}
        </select>
      </div>

      {/* Product cards */}
      {loading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : products.length === 0 ? (
        <div className="bg-white rounded-xl p-16 text-center shadow-sm">
          <FiPackage className="text-5xl text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400">No products found.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {products.map((product) => {
            const draft = drafts[product.id];
            const isDirty = !!draft;
            const isSaving = saving[product.id];
            const currentStock = isDirty ? parseInt(draft.inStock) || 0 : (product.stock || 0);
            const sellingPrice = product.discountPrice || product.price || 0;

            return (
              <div key={product.id}
                className={`bg-white rounded-xl shadow-sm overflow-hidden transition-all ${isDirty ? 'ring-2 ring-amber-400' : 'hover:shadow-md'}`}
              >
                {/* Image */}
                <div className="relative h-36 bg-gray-100">
                  {product.images?.[0] ? (
                    <Image src={product.images[0]} alt={product.name} fill className="object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-3xl">💍</div>
                  )}
                  <div className="absolute top-2 right-2 flex gap-1">
                    <span className={`w-5 h-5 rounded-full text-xs flex items-center justify-center ${(product.showMe !== false) ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                      {(product.showMe !== false) ? <FiEye className="text-[10px]" /> : <FiEyeOff className="text-[10px]" />}
                    </span>
                  </div>
                  {currentStock <= 3 && (
                    <div className="absolute bottom-2 left-2">
                      <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">LOW</span>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-3 space-y-2.5">
                  <p className="font-semibold text-gray-800 text-sm leading-tight line-clamp-2">{product.name}</p>

                  {/* SKU */}
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">SKU</label>
                    {isDirty ? (
                      <input value={draft.sku} onChange={(e) => updateDraft(product.id, 'sku', e.target.value)}
                        className={inp} placeholder="SKU-001" />
                    ) : (
                      <p className="text-xs text-gray-500 font-mono">{product.sku || '—'}</p>
                    )}
                  </div>

                  {/* Price row */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">MRP (₹)</label>
                      {isDirty ? (
                        <input type="number" value={draft.mrp} onChange={(e) => updateDraft(product.id, 'mrp', e.target.value)}
                          className={inp} placeholder="0" min="0" />
                      ) : (
                        <p className="text-sm font-bold text-gray-800">{formatPrice(product.price || 0)}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Disc %</label>
                      {isDirty ? (
                        <input type="number" value={draft.discPct} onChange={(e) => updateDraft(product.id, 'discPct', e.target.value)}
                          className={inp} placeholder="0" min="0" max="100" />
                      ) : (
                        <p className="text-sm text-green-600 font-semibold">
                          {product.discountPrice && product.price
                            ? `${Math.round(((product.price - product.discountPrice) / product.price) * 100)}%`
                            : '0%'}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Selling price */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Selling Price</span>
                    <span className="text-base font-bold text-maroon-950">{formatPrice(sellingPrice)}</span>
                  </div>

                  {/* In Stock */}
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">In Stock</label>
                    {isDirty ? (
                      <input type="number" value={draft.inStock} onChange={(e) => updateDraft(product.id, 'inStock', e.target.value)}
                        className={inp} placeholder="0" min="0" />
                    ) : (
                      <span className={`text-sm font-bold ${currentStock <= 3 ? 'text-red-500' : currentStock <= 10 ? 'text-orange-500' : 'text-gray-700'}`}>
                        {currentStock} pcs
                      </span>
                    )}
                  </div>

                  {/* ShowMe toggle */}
                  {isDirty && (
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => updateDraft(product.id, 'showMe', !draft.showMe)}
                        className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${draft.showMe ? 'bg-amber-500' : 'bg-gray-200'}`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${draft.showMe ? 'right-0.5' : 'left-0.5'}`} />
                      </button>
                      <span className="text-xs text-gray-500">{draft.showMe ? 'Visible' : 'Hidden'}</span>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 pt-1">
                    {isDirty ? (
                      <>
                        <button onClick={() => saveCard(product)} disabled={isSaving}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-maroon-950 text-white text-xs font-bold rounded-lg hover:bg-maroon-900 disabled:opacity-50 transition"
                        >
                          {isSaving ? <LoadingSpinner size="sm" /> : <FiSave className="text-xs" />} Save
                        </button>
                        <button onClick={() => setDrafts((p) => { const n = { ...p }; delete n[product.id]; return n; })}
                          className="px-3 py-2 border border-gray-200 text-gray-500 text-xs rounded-lg hover:bg-gray-50 transition"
                        >
                          <FiX className="text-xs" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startDraft(product)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-amber-200 text-amber-700 text-xs font-semibold rounded-lg hover:bg-amber-50 transition"
                        >
                          <FiEdit2 className="text-xs" /> Edit
                        </button>
                        <Link href="/admin/products"
                          className="px-3 py-2 border border-gray-200 text-gray-500 text-xs rounded-lg hover:bg-gray-50 transition"
                          title="Full edit"
                        >
                          <FiEdit2 className="text-xs" />
                        </Link>
                        <button onClick={() => handleDelete(product)}
                          className="px-3 py-2 text-red-500 hover:bg-red-50 rounded-lg transition"
                        >
                          <FiTrash2 className="text-xs" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
