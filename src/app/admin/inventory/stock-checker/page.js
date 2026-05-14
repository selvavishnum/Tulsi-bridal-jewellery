'use client';

import { useState, useEffect, useRef } from 'react';
import {
  FiSearch, FiPrinter, FiRefreshCw, FiFilter, FiPackage,
} from 'react-icons/fi';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { formatPrice } from '@/lib/utils';

const CATEGORIES = [
  '', 'necklace', 'earrings', 'bangles', 'bracelet', 'ring', 'maang-tikka',
  'nose-ring', 'anklet', 'set', 'mala', 'haar', 'jhumka', 'kada', 'choker',
  'pendant', 'mangalsutra', 'other',
];

export default function StockCheckerPage() {
  const [allProducts, setAllProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [minQty, setMinQty] = useState('0');
  const [maxQty, setMaxQty] = useState('20');
  const [mainCat, setMainCat] = useState('');
  const [search, setSearch] = useState('');
  const tableRef = useRef(null);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/products');
      const data = await res.json();
      if (data.success) setAllProducts(data.data.products || []);
    } catch {}
    finally { setLoading(false); }
  }

  const filtered = allProducts.filter((p) => {
    const stock = p.stock || 0;
    const min = parseInt(minQty);
    const max = parseInt(maxQty);
    if (!isNaN(min) && stock < min) return false;
    if (!isNaN(max) && stock > max) return false;
    if (mainCat && p.category !== mainCat) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!p.name?.toLowerCase().includes(q) && !p.sku?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  function handlePrint() {
    const rows = filtered.map((p) => {
      const disc = p.price && p.discountPrice
        ? Math.round(((p.price - p.discountPrice) / p.price) * 100)
        : 0;
      const sp = p.discountPrice || p.price || 0;
      return `
        <tr>
          <td>${p.name}</td>
          <td>₹${(p.price || 0).toLocaleString('en-IN')}</td>
          <td>${disc > 0 ? disc + '%' : '—'}</td>
          <td>₹${sp.toLocaleString('en-IN')}</td>
          <td style="color:${(p.stock || 0) <= 3 ? '#dc2626' : '#16a34a'};font-weight:600">${p.stock || 0}</td>
        </tr>
      `;
    }).join('');

    const html = `<!DOCTYPE html><html>
<head>
  <title>Stock Checker Report</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 12px; margin: 20px; }
    h2 { color: #7f1d1d; margin-bottom: 4px; }
    p { color: #6b7280; font-size: 11px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f3f4f6; padding: 8px 10px; text-align: left; font-size: 10px; text-transform: uppercase; border-bottom: 2px solid #e5e7eb; }
    td { padding: 7px 10px; border-bottom: 1px solid #f3f4f6; }
    tr:hover td { background: #fef9ee; }
    @media print { body { margin: 10px; } }
  </style>
</head>
<body>
  <h2>Tulsi Bridal Jewellery — Stock Report</h2>
  <p>Generated: ${new Date().toLocaleString('en-IN')} &nbsp;|&nbsp; Showing qty ${minQty || 0}–${maxQty || '∞'} ${mainCat ? '| Category: ' + mainCat : ''} | ${filtered.length} products</p>
  <table>
    <thead><tr><th>Product Name</th><th>MRP</th><th>Disc%</th><th>S.Price</th><th>In Stock</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body></html>`;

    const win = window.open('', '_blank', 'width=900,height=600');
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 500);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">In-Stock Checker</h1>
          <p className="text-sm text-gray-400 mt-0.5">Filter products by stock quantity and print reports</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchAll}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-50 transition"
          >
            <FiRefreshCw className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={handlePrint}
            className="flex items-center gap-2 px-5 py-2.5 bg-maroon-950 text-white text-sm font-bold rounded-xl hover:bg-maroon-900 transition shadow-sm"
          >
            <FiPrinter /> Print Report
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm p-4 flex gap-3 flex-wrap items-end">
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
            Min Qty
          </label>
          <input
            type="number" value={minQty} onChange={(e) => setMinQty(e.target.value)}
            className="w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white"
            min="0" placeholder="0"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
            Max Qty
          </label>
          <input
            type="number" value={maxQty} onChange={(e) => setMaxQty(e.target.value)}
            className="w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white"
            min="0" placeholder="20"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
            Category
          </label>
          <select value={mainCat} onChange={(e) => setMainCat(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white capitalize"
          >
            <option value="">All Categories</option>
            {CATEGORIES.filter(Boolean).map((c) => (
              <option key={c} value={c} className="capitalize">{c.replace(/-/g, ' ')}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-40">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Search</label>
          <div className="relative">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs" />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or SKU..."
              className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white"
            />
          </div>
        </div>
        <div className="text-sm text-gray-500 font-medium pb-2">
          {filtered.length} results
        </div>
      </div>

      {/* Results table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden" ref={tableRef}>
        {loading ? (
          <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <FiPackage className="text-5xl text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">No products match current filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">Product Name</th>
                  <th className="px-4 py-3 text-left hidden md:table-cell">Category</th>
                  <th className="px-4 py-3 text-left hidden sm:table-cell">SKU</th>
                  <th className="px-4 py-3 text-right">MRP</th>
                  <th className="px-4 py-3 text-center">Disc %</th>
                  <th className="px-4 py-3 text-right">S.Price</th>
                  <th className="px-4 py-3 text-center">In Stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((p, idx) => {
                  const disc = p.price && p.discountPrice
                    ? Math.round(((p.price - p.discountPrice) / p.price) * 100)
                    : 0;
                  const sp = p.discountPrice || p.price || 0;
                  const stock = p.stock || 0;
                  return (
                    <tr key={p.id || p._id} className="hover:bg-gray-50/70 transition">
                      <td className="px-4 py-3 text-gray-400 text-xs">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-800">{p.name}</p>
                      </td>
                      <td className="px-4 py-3 capitalize text-gray-500 text-xs hidden md:table-cell">
                        {p.category?.replace(/-/g, ' ')}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs font-mono hidden sm:table-cell">
                        {p.sku || '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-700">
                        {formatPrice(p.price || 0)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {disc > 0 ? (
                          <span className="text-green-600 font-semibold text-xs">{disc}%</span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-gray-800">
                        {formatPrice(sp)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-sm font-bold ${stock <= 3 ? 'text-red-500' : stock <= 10 ? 'text-orange-500' : 'text-green-600'}`}>
                          {stock}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-50 border-t-2 border-gray-100">
                <tr>
                  <td colSpan={6} className="px-4 py-3 text-sm font-semibold text-gray-600">
                    Total Products: {filtered.length}
                  </td>
                  <td colSpan={2} className="px-4 py-3 text-sm font-bold text-gray-800 text-right">
                    Total Stock: {filtered.reduce((s, p) => s + (p.stock || 0), 0)} pcs
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
