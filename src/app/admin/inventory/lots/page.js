'use client';

import { useState, useEffect } from 'react';
import { FiLayers, FiBarChart2, FiSearch, FiPrinter, FiPackage } from 'react-icons/fi';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import Badge from '@/components/ui/Badge';
import { formatPrice } from '@/lib/utils';

const TABS = ['Stock Lots', 'Valuation Report'];

function statusVariant(s) {
  if (s === 'active') return 'success';
  if (s === 'partial') return 'warning';
  return 'default';
}

export default function StockLotsPage() {
  const [tab, setTab] = useState('Stock Lots');
  const [lots, setLots] = useState([]);
  const [valuation, setValuation] = useState([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => { fetchLots(); }, []);

  async function fetchLots() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/inventory/lots');
      const data = await res.json();
      if (data.success) {
        setLots(data.data.lots || []);
        setValuation(data.data.valuation || []);
        setGrandTotal(data.data.grandTotal || 0);
      }
    } finally { setLoading(false); }
  }

  // Sort lots FIFO order (oldest first) for display
  const sortedLots = [...lots].sort((a, b) => {
    if (a.purchaseDate < b.purchaseDate) return -1;
    if (a.purchaseDate > b.purchaseDate) return 1;
    return a.createdAt < b.createdAt ? -1 : 1;
  });

  const filteredLots = sortedLots.filter((l) => {
    const q = search.toLowerCase();
    const matchSearch = !search
      || l.productName?.toLowerCase().includes(q)
      || l.sku?.toLowerCase().includes(q)
      || l.lotNumber?.toLowerCase().includes(q)
      || l.supplierName?.toLowerCase().includes(q)
      || l.invoiceNumber?.toLowerCase().includes(q);
    const matchStatus = statusFilter === 'all' || l.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const filteredValuation = valuation.filter((v) => {
    const q = search.toLowerCase();
    return !search
      || v.productName?.toLowerCase().includes(q)
      || v.sku?.toLowerCase().includes(q);
  });

  const activeLots = lots.filter((l) => l.status !== 'consumed').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <FiLayers className="text-amber-500" /> Stock Lots (FIFO)
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Track each purchase batch — oldest stock consumed first
          </p>
        </div>
        {tab === 'Valuation Report' && (
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-50 transition"
          >
            <FiPrinter /> Print Report
          </button>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl shadow-sm p-5">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Total Lots</p>
          <p className="text-2xl font-bold text-gray-800 mt-1">{lots.length}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-5">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Active Lots</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{activeLots}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-5">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Products Tracked</p>
          <p className="text-2xl font-bold text-gray-800 mt-1">{valuation.length}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-5">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">FIFO Inventory Value</p>
          <p className="text-2xl font-bold text-maroon-950 mt-1">{formatPrice(grandTotal)}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="border-b border-gray-100 px-5 flex gap-1 pt-3">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-t-lg border-b-2 transition ${
                tab === t
                  ? 'border-amber-400 text-amber-600 bg-amber-50/50'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'Stock Lots' ? <FiPackage className="text-sm" /> : <FiBarChart2 className="text-sm" />}
              {t}
            </button>
          ))}
        </div>

        {/* Search & Filter */}
        <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-48">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === 'Stock Lots' ? 'Search by product, SKU, lot#, supplier…' : 'Search by product or SKU…'}
              className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          {tab === 'Stock Lots' && (
            <div className="flex gap-1">
              {['all', 'active', 'partial', 'consumed'].map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition ${
                    statusFilter === s
                      ? 'bg-maroon-950 text-white'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><LoadingSpinner /></div>
        ) : tab === 'Stock Lots' ? (
          /* ── Stock Lots Tab ── */
          filteredLots.length === 0 ? (
            <div className="text-center py-16 px-4">
              <FiLayers className="text-5xl text-gray-200 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">No lots found</p>
              <p className="text-gray-400 text-sm mt-1">
                {lots.length === 0
                  ? 'Lots are created automatically when you save a Purchase Inward entry.'
                  : 'Try adjusting your search or filter.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left">Lot #</th>
                    <th className="px-4 py-3 text-left">Purchase Date</th>
                    <th className="px-4 py-3 text-left">Invoice</th>
                    <th className="px-4 py-3 text-left">Supplier</th>
                    <th className="px-4 py-3 text-left">Product</th>
                    <th className="px-4 py-3 text-center">Qty Bought</th>
                    <th className="px-4 py-3 text-center">Qty Left</th>
                    <th className="px-4 py-3 text-right">Cost / pc</th>
                    <th className="px-4 py-3 text-right">Lot Value</th>
                    <th className="px-4 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredLots.map((lot) => (
                    <tr key={lot.id} className="hover:bg-gray-50 transition">
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded font-semibold">
                          {lot.lotNumber}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{lot.purchaseDate || '—'}</td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-gray-500">{lot.invoiceNumber || '—'}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{lot.supplierName || '—'}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-800">{lot.productName}</p>
                        {lot.sku && <p className="text-xs text-gray-400">{lot.sku}</p>}
                      </td>
                      <td className="px-4 py-3 text-center font-semibold text-gray-700">{lot.originalQty}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-bold text-sm ${
                          lot.remainingQty === 0 ? 'text-gray-400'
                          : lot.remainingQty < lot.originalQty ? 'text-amber-600'
                          : 'text-green-600'
                        }`}>
                          {lot.remainingQty}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">{formatPrice(lot.purchasePrice || 0)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-800">
                        {formatPrice((lot.remainingQty || 0) * (lot.purchasePrice || 0))}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant={statusVariant(lot.status)}>
                          {lot.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          /* ── Valuation Report Tab ── */
          filteredValuation.length === 0 ? (
            <div className="text-center py-16 px-4">
              <FiBarChart2 className="text-5xl text-gray-200 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">No valuation data</p>
              <p className="text-gray-400 text-sm mt-1">Add purchase inward entries to generate FIFO valuation.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left">#</th>
                    <th className="px-4 py-3 text-left">Product Name</th>
                    <th className="px-4 py-3 text-left">SKU</th>
                    <th className="px-4 py-3 text-center">Stock (pcs)</th>
                    <th className="px-4 py-3 text-right">FIFO Cost / pc</th>
                    <th className="px-4 py-3 text-right">Total Value (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredValuation.map((v, idx) => (
                    <tr key={v.productId} className="hover:bg-gray-50 transition">
                      <td className="px-4 py-3 text-gray-400 text-xs">{idx + 1}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{v.productName}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs font-mono">{v.sku || '—'}</td>
                      <td className="px-4 py-3 text-center font-bold text-gray-700">{v.fifoQty}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{formatPrice(v.avgCost)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-800">{formatPrice(v.fifoValue)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-amber-50 border-t-2 border-amber-200">
                    <td colSpan={5} className="px-4 py-3 font-bold text-gray-700 text-right text-sm uppercase tracking-wide">
                      Grand Total (FIFO Inventory Value)
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-maroon-950 text-base">
                      {formatPrice(grandTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
