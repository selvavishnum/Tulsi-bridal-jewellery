'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  FiPlus, FiSearch, FiTrash2, FiSave, FiX, FiShoppingCart,
  FiPackage, FiCheckCircle, FiClock, FiAlertCircle, FiChevronDown,
  FiChevronUp, FiFileText, FiExternalLink,
} from 'react-icons/fi';
import Link from 'next/link';
import toast from 'react-hot-toast';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import Badge from '@/components/ui/Badge';
import { formatPrice } from '@/lib/utils';

const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Cheque', 'UPI', 'Credit', 'Other'];
const STATUS_FILTER_OPTIONS = ['all', 'unpaid', 'partial', 'paid'];

const EMPTY_ITEM = { productId: '', name: '', qty: 1, purchasePrice: '' };

function statusVariant(s) {
  if (s === 'paid') return 'success';
  if (s === 'partial') return 'gold';
  return 'warning';
}

function StatCard({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-5 flex items-start gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon className="text-lg" />
      </div>
      <div>
        <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold text-gray-800 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function PurchaseDashboardPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [markingPaid, setMarkingPaid] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [showModal, setShowModal] = useState(false);

  // Quick Purchase modal state
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [supplierNameManual, setSupplierNameManual] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentStatus, setPaymentStatus] = useState('unpaid');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState([]);
  const [searchingProducts, setSearchingProducts] = useState(false);
  const [activeItemIdx, setActiveItemIdx] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchOrders();
    fetchSuppliers();
  }, []);

  useEffect(() => {
    if (productSearch.length < 2) { setProductResults([]); return; }
    const t = setTimeout(searchProducts, 350);
    return () => clearTimeout(t);
  }, [productSearch]);

  async function fetchOrders() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/purchase/inward');
      const data = await res.json();
      if (data.success) setOrders(data.data);
    } finally { setLoading(false); }
  }

  async function fetchSuppliers() {
    try {
      const res = await fetch('/api/admin/suppliers');
      const data = await res.json();
      if (data.success) setSuppliers(data.data);
    } catch {}
  }

  async function searchProducts() {
    setSearchingProducts(true);
    try {
      const res = await fetch(`/api/admin/inventory?search=${encodeURIComponent(productSearch)}&limit=15`);
      const data = await res.json();
      if (data.success) setProductResults(data.data);
    } finally { setSearchingProducts(false); }
  }

  function selectProduct(product) {
    if (activeItemIdx === null) return;
    setItems((prev) => {
      const updated = [...prev];
      updated[activeItemIdx] = {
        ...updated[activeItemIdx],
        productId: product.id,
        name: product.name,
        purchasePrice: product.purchasePrice || '',
      };
      return updated;
    });
    setProductSearch('');
    setProductResults([]);
    setActiveItemIdx(null);
  }

  function updateItem(idx, field, value) {
    setItems((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      return updated;
    });
  }

  function addItemRow() {
    setItems((prev) => [...prev, { ...EMPTY_ITEM }]);
  }

  function removeItemRow(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function resetModal() {
    setSupplierId('');
    setSupplierNameManual('');
    setInvoiceNumber('');
    setInvoiceDate(new Date().toISOString().split('T')[0]);
    setPaymentStatus('unpaid');
    setPaymentMethod('Cash');
    setNotes('');
    setItems([{ ...EMPTY_ITEM }]);
    setProductSearch('');
    setProductResults([]);
    setActiveItemIdx(null);
  }

  async function handleSave() {
    const supplier = suppliers.find((s) => s.id === supplierId);
    const resolvedSupplierName = supplier?.name || supplierNameManual;
    if (!resolvedSupplierName) { toast.error('Please select or enter a supplier'); return; }
    const validItems = items.filter((i) => i.productId && i.name && parseInt(i.qty) > 0);
    if (validItems.length === 0) { toast.error('Add at least one product with quantity'); return; }

    const subtotal = validItems.reduce((s, i) => s + (parseFloat(i.purchasePrice) || 0) * (parseInt(i.qty) || 0), 0);
    const payload = {
      invoiceNumber: invoiceNumber || `QP-${Date.now()}`,
      invoiceDate,
      supplierId: supplierId || '',
      supplierName: resolvedSupplierName,
      poIndentId: null,
      paymentStatus,
      payments: paymentStatus === 'paid'
        ? [{ date: invoiceDate, method: paymentMethod, transactionId: '', amount: subtotal, notes: '' }]
        : [],
      items: validItems.map((i) => ({
        productId: i.productId,
        name: i.name,
        qty: parseInt(i.qty),
        purchasePrice: parseFloat(i.purchasePrice) || 0,
        mrp: 0,
        taxPct: 0,
        taxAmt: 0,
        lineTotal: (parseFloat(i.purchasePrice) || 0) * parseInt(i.qty),
      })),
      loadingCharges: 0,
      transportCharges: 0,
      subtotal,
      totalTax: 0,
      grandTotal: subtotal,
      notes,
    };

    setSaving(true);
    try {
      const res = await fetch('/api/admin/purchase/inward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Purchase saved! Stock updated.');
        setShowModal(false);
        resetModal();
        fetchOrders();
      } else {
        toast.error(data.message || 'Failed to save');
      }
    } finally { setSaving(false); }
  }

  async function markAsPaid(order) {
    setMarkingPaid(order.id);
    try {
      const res = await fetch('/api/admin/purchase/inward', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: order.id, paymentStatus: 'paid' }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Marked as paid');
        setOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, paymentStatus: 'paid' } : o));
      } else {
        toast.error(data.message);
      }
    } finally { setMarkingPaid(null); }
  }

  async function deleteOrder(id) {
    if (!confirm('Delete this purchase record?')) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/admin/purchase/inward?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success('Deleted');
        setOrders((prev) => prev.filter((o) => o.id !== id));
      } else {
        toast.error(data.message);
      }
    } finally { setDeleting(null); }
  }

  const filtered = orders.filter((o) => {
    const matchSearch = !search
      || (o.supplierName || '').toLowerCase().includes(search.toLowerCase())
      || (o.invoiceNumber || '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || o.paymentStatus === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalSpent = orders.reduce((s, o) => s + (o.grandTotal || 0), 0);
  const pendingPayment = orders.filter((o) => o.paymentStatus !== 'paid').length;
  const thisMonth = orders.filter((o) => {
    if (!o.createdAt) return false;
    const d = new Date(o.createdAt);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  const inp = 'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white transition';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Stock Purchases</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage incoming stock and supplier purchases</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link
            href="/admin/purchase/indent"
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-50 transition"
          >
            <FiFileText className="text-sm" /> Purchase Indent
          </Link>
          <Link
            href="/admin/purchase/inward"
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-50 transition"
          >
            <FiExternalLink className="text-sm" /> Full Invoice
          </Link>
          <button
            onClick={() => { resetModal(); setShowModal(true); }}
            className="flex items-center gap-2 px-5 py-2.5 bg-maroon-950 text-white text-sm font-bold rounded-xl hover:bg-maroon-900 transition shadow-sm"
          >
            <FiPlus /> Quick Purchase
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={FiShoppingCart} label="Total Orders" value={orders.length} color="bg-blue-50 text-blue-500" />
        <StatCard icon={FiClock} label="This Month" value={thisMonth} sub="new entries" color="bg-amber-50 text-amber-500" />
        <StatCard icon={FiAlertCircle} label="Pending Payment" value={pendingPayment} sub="orders" color="bg-red-50 text-red-500" />
        <StatCard icon={FiCheckCircle} label="Total Spent" value={formatPrice(totalSpent)} color="bg-green-50 text-green-500" />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm px-5 py-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by supplier or invoice…"
            className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {STATUS_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => setStatusFilter(opt)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition ${
                statusFilter === opt
                  ? 'bg-maroon-950 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {opt === 'all' ? 'All' : opt}
            </button>
          ))}
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><LoadingSpinner /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 px-4">
            <FiPackage className="text-5xl text-gray-200 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No purchases found</p>
            <p className="text-gray-400 text-sm mt-1">
              {orders.length === 0
                ? 'Click "+ Quick Purchase" above to record your first stock entry.'
                : 'Try adjusting your search or filter.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">Invoice</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Supplier</th>
                  <th className="px-4 py-3 text-center">Items</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-center">Payment</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((order, idx) => (
                  <>
                    <tr
                      key={order.id}
                      className="hover:bg-gray-50 transition cursor-pointer"
                      onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
                    >
                      <td className="px-4 py-3 text-gray-400 text-xs">{filtered.length - idx}</td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-700">
                          {order.invoiceNumber || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {order.invoiceDate || order.createdAt?.split('T')[0] || '—'}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-800">{order.supplierName || '—'}</td>
                      <td className="px-4 py-3 text-center text-gray-500">{(order.items || []).length}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-800">
                        {formatPrice(order.grandTotal || 0)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant={statusVariant(order.paymentStatus)}>
                          {order.paymentStatus || 'unpaid'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {order.paymentStatus !== 'paid' && (
                            <button
                              onClick={() => markAsPaid(order)}
                              disabled={markingPaid === order.id}
                              title="Mark as Paid"
                              className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition disabled:opacity-50"
                            >
                              {markingPaid === order.id ? <LoadingSpinner size="sm" /> : <FiCheckCircle />}
                            </button>
                          )}
                          <button
                            onClick={() => deleteOrder(order.id)}
                            disabled={deleting === order.id}
                            title="Delete"
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition disabled:opacity-50"
                          >
                            {deleting === order.id ? <LoadingSpinner size="sm" /> : <FiTrash2 />}
                          </button>
                          <button
                            onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
                            className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition"
                          >
                            {expandedId === order.id ? <FiChevronUp /> : <FiChevronDown />}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedId === order.id && (
                      <tr key={`${order.id}-detail`} className="bg-amber-50/40">
                        <td colSpan={8} className="px-6 py-4">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Items Received</p>
                          <div className="space-y-1">
                            {(order.items || []).map((item, i) => (
                              <div key={i} className="flex items-center justify-between text-sm py-1 border-b border-amber-100 last:border-0">
                                <span className="text-gray-700 font-medium">{item.name || item.productName}</span>
                                <div className="flex items-center gap-6 text-gray-500">
                                  <span>Qty: <b className="text-gray-700">{item.qty}</b></span>
                                  <span>Cost: <b className="text-gray-700">{formatPrice(item.purchasePrice || 0)}/pc</b></span>
                                  <span>Total: <b className="text-gray-700">{formatPrice((item.purchasePrice || 0) * item.qty)}</b></span>
                                </div>
                              </div>
                            ))}
                          </div>
                          {order.notes && (
                            <p className="text-xs text-gray-400 mt-3 italic">Note: {order.notes}</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick Purchase Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <div>
                <h2 className="font-bold text-gray-800 text-lg">Quick Purchase</h2>
                <p className="text-xs text-gray-400 mt-0.5">Add stock — fills automatically on save</p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition"
              >
                <FiX />
              </button>
            </div>

            {/* Modal Body */}
            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
              {/* Supplier & Date */}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    Supplier <span className="text-red-400">*</span>
                  </label>
                  {suppliers.length > 0 ? (
                    <select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setSupplierNameManual(''); }} className={inp}>
                      <option value="">Select Supplier…</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  ) : null}
                  {(!supplierId) && (
                    <input
                      value={supplierNameManual}
                      onChange={(e) => { setSupplierNameManual(e.target.value); setSupplierId(''); }}
                      className={suppliers.length > 0 ? `${inp} mt-2` : inp}
                      placeholder={suppliers.length > 0 ? 'Or type supplier name manually' : 'Supplier name'}
                    />
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Invoice # (optional)</label>
                  <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className={inp} placeholder="INV-001" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Date</label>
                  <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={inp} />
                </div>
              </div>

              {/* Products */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Products <span className="text-red-400">*</span>
                  </label>
                  <button
                    onClick={addItemRow}
                    className="text-xs text-amber-600 hover:text-amber-700 font-semibold flex items-center gap-1 transition"
                  >
                    <FiPlus className="text-xs" /> Add Row
                  </button>
                </div>
                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <div key={idx} className="relative">
                      <div className="flex gap-2 items-start">
                        {/* Product search input */}
                        <div className="flex-1 relative">
                          <input
                            value={activeItemIdx === idx ? productSearch : item.name}
                            onChange={(e) => {
                              setActiveItemIdx(idx);
                              setProductSearch(e.target.value);
                              if (!e.target.value) updateItem(idx, 'name', '');
                            }}
                            onFocus={() => { setActiveItemIdx(idx); setProductSearch(item.name || ''); }}
                            placeholder="Search product…"
                            className={`${inp} pr-2`}
                          />
                          {activeItemIdx === idx && (searchingProducts || productResults.length > 0) && (
                            <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg max-h-44 overflow-y-auto">
                              {searchingProducts && (
                                <div className="flex justify-center py-3"><LoadingSpinner /></div>
                              )}
                              {productResults.map((p) => (
                                <button
                                  key={p.id}
                                  onMouseDown={() => selectProduct(p)}
                                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-amber-50 transition text-left text-sm"
                                >
                                  <div>
                                    <p className="font-medium text-gray-800">{p.name}</p>
                                    <p className="text-xs text-gray-400">{p.sku || '—'} · Stock: {p.stock || 0}</p>
                                  </div>
                                  <span className="text-xs text-amber-600 font-semibold ml-2">{formatPrice(p.price || 0)}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        {/* Qty */}
                        <input
                          type="number" min="1"
                          value={item.qty}
                          onChange={(e) => updateItem(idx, 'qty', e.target.value)}
                          placeholder="Qty"
                          className="w-16 px-2 py-2.5 border border-gray-200 rounded-lg text-sm text-center outline-none focus:ring-2 focus:ring-amber-400"
                        />
                        {/* Purchase price */}
                        <input
                          type="number" min="0"
                          value={item.purchasePrice}
                          onChange={(e) => updateItem(idx, 'purchasePrice', e.target.value)}
                          placeholder="₹ Cost"
                          className="w-24 px-2 py-2.5 border border-gray-200 rounded-lg text-sm text-center outline-none focus:ring-2 focus:ring-amber-400"
                        />
                        {/* Remove */}
                        {items.length > 1 && (
                          <button
                            onClick={() => removeItemRow(idx)}
                            className="p-2.5 text-red-500 hover:bg-red-50 rounded-lg transition flex-shrink-0"
                          >
                            <FiTrash2 className="text-sm" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {/* Subtotal preview */}
                {items.some((i) => i.purchasePrice && i.qty) && (
                  <div className="mt-3 flex justify-end">
                    <span className="text-xs text-gray-500">Subtotal: </span>
                    <span className="text-sm font-bold text-gray-800 ml-2">
                      {formatPrice(items.reduce((s, i) => s + (parseFloat(i.purchasePrice) || 0) * (parseInt(i.qty) || 0), 0))}
                    </span>
                  </div>
                )}
              </div>

              {/* Payment & Notes */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Payment Status</label>
                  <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} className={inp}>
                    <option value="unpaid">Unpaid</option>
                    <option value="partial">Partial</option>
                    <option value="paid">Paid</option>
                  </select>
                </div>
                {paymentStatus === 'paid' && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Payment Method</label>
                    <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inp}>
                      {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className={`${inp} resize-none`}
                  placeholder="Any additional notes…"
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-maroon-950 text-white text-sm font-bold rounded-xl hover:bg-maroon-900 disabled:opacity-50 transition shadow-sm"
              >
                {saving ? <LoadingSpinner size="sm" /> : <FiSave />}
                Save & Update Stock
              </button>
              <button
                onClick={() => setShowModal(false)}
                className="px-5 py-2.5 border border-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
