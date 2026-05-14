'use client';

import { useState, useEffect } from 'react';
import {
  FiSearch, FiPlus, FiTrash2, FiSave, FiSend, FiPackage,
  FiChevronRight, FiX, FiFilter,
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

export default function PurchaseIndentPage() {
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [suppliers, setSuppliers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [indentItems, setIndentItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchSuppliers();
    fetchWarehouses();
    fetchProducts();
  }, []);

  useEffect(() => { fetchProducts(); }, [search, catFilter, onlyInStock]);

  async function fetchProducts() {
    setLoadingProducts(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (catFilter) params.set('mainCategory', catFilter);
      params.set('limit', '100');
      const res = await fetch(`/api/admin/inventory?${params}`);
      const data = await res.json();
      if (data.success) {
        let list = data.data;
        if (onlyInStock) list = list.filter((p) => (p.stock || 0) > 0);
        setProducts(list);
      }
    } finally { setLoadingProducts(false); }
  }

  async function fetchSuppliers() {
    try {
      const res = await fetch('/api/admin/suppliers');
      const data = await res.json();
      if (data.success) setSuppliers(data.data);
    } catch {}
  }

  async function fetchWarehouses() {
    try {
      const res = await fetch('/api/admin/warehouses');
      const data = await res.json();
      if (data.success) setWarehouses(data.data);
    } catch {}
  }

  function addItem(product) {
    const exists = indentItems.find((i) => i.productId === product.id);
    if (exists) { toast('Already added'); return; }
    setIndentItems((prev) => [
      ...prev,
      {
        productId: product.id,
        productName: product.name,
        unit: product.unit || 'pcs',
        requestedQty: 1,
        currentStock: product.stock || 0,
      },
    ]);
    toast.success(`Added: ${product.name}`);
  }

  function updateQty(productId, qty) {
    setIndentItems((prev) =>
      prev.map((i) => i.productId === productId ? { ...i, requestedQty: parseInt(qty) || 1 } : i),
    );
  }

  function removeItem(productId) {
    setIndentItems((prev) => prev.filter((i) => i.productId !== productId));
  }

  async function saveIndent(status = 'draft') {
    if (!supplierId) { toast.error('Please select a supplier'); return; }
    if (!warehouseId) { toast.error('Please select a warehouse'); return; }
    if (indentItems.length === 0) { toast.error('Add at least one product'); return; }

    const supplier = suppliers.find((s) => s.id === supplierId);
    const warehouse = warehouses.find((w) => w.id === warehouseId);

    const fn = status === 'submitted' ? setSubmitting : setSaving;
    fn(true);
    try {
      const res = await fetch('/api/admin/purchase/indent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId,
          supplierName: supplier?.name || '',
          warehouseId,
          warehouseName: warehouse?.name || '',
          items: indentItems,
          notes,
          status,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(status === 'submitted' ? 'Indent submitted!' : 'Indent saved as draft!');
        setIndentItems([]);
        setSupplierId('');
        setWarehouseId('');
        setNotes('');
      } else { toast.error(data.message); }
    } finally { fn(false); }
  }

  const inp = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white transition';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Purchase Indent</h1>
        <p className="text-sm text-gray-400 mt-0.5">Create purchase indent / requisition for supplier</p>
      </div>

      {/* TOP HALF: Product search */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 font-semibold text-gray-700 text-sm">
            <FiSearch /> Search Products
          </div>
          <div className="flex-1 flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-40">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or SKU..."
                className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white"
              />
            </div>
            <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white capitalize"
            >
              <option value="">All Categories</option>
              {CATEGORIES.filter(Boolean).map((c) => (
                <option key={c} value={c} className="capitalize">{c.replace(/-/g, ' ')}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
              <input type="checkbox" checked={onlyInStock} onChange={(e) => setOnlyInStock(e.target.checked)}
                className="rounded text-amber-500" />
              Only InStock
            </label>
          </div>
        </div>

        <div className="overflow-x-auto max-h-64">
          {loadingProducts ? (
            <div className="flex justify-center py-8"><LoadingSpinner /></div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0">
                <tr>
                  <th className="px-4 py-2.5 text-left">Product Name</th>
                  <th className="px-4 py-2.5 text-left">Category</th>
                  <th className="px-4 py-2.5 text-center">In Stock</th>
                  <th className="px-4 py-2.5 text-left">Unit</th>
                  <th className="px-4 py-2.5 text-right">Price</th>
                  <th className="px-4 py-2.5 text-center">Add</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {products.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-sm">No products found</td></tr>
                ) : products.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-800">{p.name}</div>
                      <div className="text-xs text-gray-400">{p.sku || '—'}</div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 capitalize text-xs">{p.category?.replace(/-/g, ' ')}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-sm font-bold ${(p.stock || 0) > 5 ? 'text-green-600' : (p.stock || 0) > 0 ? 'text-amber-600' : 'text-red-500'}`}>
                        {p.stock || 0}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{p.unit || 'pcs'}</td>
                    <td className="px-4 py-2.5 text-right font-medium">{formatPrice(p.price || 0)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => addItem(p)}
                        disabled={indentItems.some((i) => i.productId === p.id)}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-maroon-950 text-white text-xs rounded-lg hover:bg-maroon-900 disabled:opacity-40 transition"
                      >
                        <FiChevronRight /> Add
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* BOTTOM HALF: Indent form */}
      <div className="bg-white rounded-xl shadow-sm p-5 space-y-5">
        <h2 className="font-bold text-gray-800 flex items-center gap-2">
          <FiPackage className="text-amber-500" /> Purchase Indent Form
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Supplier <span className="text-red-400">*</span>
            </label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inp}>
              <option value="">Select Supplier...</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Warehouse <span className="text-red-400">*</span>
            </label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={inp}>
              <option value="">Select Warehouse...</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        </div>

        {/* Added items */}
        {indentItems.length > 0 ? (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Indent Items ({indentItems.length})
            </h3>
            <div className="border border-gray-100 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-2.5 text-left">#</th>
                    <th className="px-4 py-2.5 text-left">Product</th>
                    <th className="px-4 py-2.5 text-center">Current Stock</th>
                    <th className="px-4 py-2.5 text-center">Requested Qty</th>
                    <th className="px-4 py-2.5 text-center">Unit</th>
                    <th className="px-4 py-2.5 text-center">Remove</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {indentItems.map((item, idx) => (
                    <tr key={item.productId}>
                      <td className="px-4 py-2.5 text-gray-400 text-xs">{idx + 1}</td>
                      <td className="px-4 py-2.5 font-medium text-gray-800">{item.productName}</td>
                      <td className="px-4 py-2.5 text-center">
                        <Badge variant={item.currentStock > 5 ? 'success' : item.currentStock > 0 ? 'warning' : 'danger'}>
                          {item.currentStock}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <input
                          type="number"
                          min="1"
                          value={item.requestedQty}
                          onChange={(e) => updateQty(item.productId, e.target.value)}
                          className="w-20 px-2 py-1 border border-gray-200 rounded-lg text-sm text-center outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </td>
                      <td className="px-4 py-2.5 text-center text-xs text-gray-500">{item.unit}</td>
                      <td className="px-4 py-2.5 text-center">
                        <button onClick={() => removeItem(item.productId)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition">
                          <FiTrash2 className="text-sm" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center">
            <FiPackage className="text-4xl text-gray-200 mx-auto mb-2" />
            <p className="text-gray-400 text-sm">No items added yet. Search and add products above.</p>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className={`${inp} resize-none`}
            placeholder="Additional notes for this indent..."
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={() => saveIndent('draft')}
            disabled={saving || submitting}
            className="flex items-center gap-2 px-6 py-2.5 border-2 border-gray-300 text-gray-700 text-sm font-bold rounded-xl hover:bg-gray-50 disabled:opacity-50 transition"
          >
            {saving ? <LoadingSpinner size="sm" /> : <FiSave />}
            Save as Draft
          </button>
          <button
            onClick={() => saveIndent('submitted')}
            disabled={saving || submitting}
            className="flex items-center gap-2 px-6 py-2.5 bg-maroon-950 text-white text-sm font-bold rounded-xl hover:bg-maroon-900 disabled:opacity-50 transition shadow-sm"
          >
            {submitting ? <LoadingSpinner size="sm" /> : <FiSend />}
            Submit Indent
          </button>
        </div>
      </div>
    </div>
  );
}
