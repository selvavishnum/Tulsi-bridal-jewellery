'use client';

import { useState, useEffect } from 'react';
import {
  FiPlus, FiTrash2, FiSave, FiX, FiSearch, FiDollarSign,
  FiFileText, FiPackage, FiChevronDown,
} from 'react-icons/fi';
import toast from 'react-hot-toast';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { formatPrice } from '@/lib/utils';

const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Cheque', 'UPI', 'Credit', 'Other'];

const EMPTY_PAYMENT = {
  date: new Date().toISOString().split('T')[0],
  method: 'Cash',
  transactionId: '',
  amount: '',
  notes: '',
};

const inp = 'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white transition';

export default function PurchaseInwardPage() {
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [supplierId, setSupplierId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [poIndentId, setPoIndentId] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('unpaid');
  const [notes, setNotes] = useState('');
  const [loadingCharges, setLoadingCharges] = useState('');
  const [transportCharges, setTransportCharges] = useState('');
  const [items, setItems] = useState([]);
  const [payments, setPayments] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [indents, setIndents] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSuppliers();
    fetchIndents();
  }, []);

  useEffect(() => {
    if (productSearch.length < 2) { setProductResults([]); return; }
    const t = setTimeout(() => searchProducts(), 400);
    return () => clearTimeout(t);
  }, [productSearch]);

  async function fetchSuppliers() {
    try {
      const res = await fetch('/api/admin/suppliers');
      const d = await res.json();
      if (d.success) setSuppliers(d.data);
    } catch {}
  }

  async function fetchIndents() {
    try {
      const res = await fetch('/api/admin/purchase/indent');
      const d = await res.json();
      if (d.success) setIndents(d.data.filter((i) => i.status !== 'received'));
    } catch {}
  }

  async function searchProducts() {
    setSearching(true);
    try {
      const res = await fetch(`/api/admin/inventory?search=${encodeURIComponent(productSearch)}&limit=20`);
      const d = await res.json();
      if (d.success) setProductResults(d.data);
    } finally { setSearching(false); }
  }

  function addProductToItems(product) {
    const exists = items.find((i) => i.productId === product.id);
    if (exists) { toast('Already in list'); return; }
    setItems((prev) => [
      ...prev,
      {
        productId: product.id,
        name: product.name,
        qty: 1,
        purchasePrice: product.purchasePrice || '',
        mrp: product.price || '',
        taxPct: 3,
        taxAmt: 0,
        lineTotal: 0,
      },
    ]);
    setProductSearch('');
    setProductResults([]);
    setSearchOpen(false);
  }

  function loadFromIndent(indentId) {
    const indent = indents.find((i) => i.id === indentId);
    if (!indent) return;
    setPoIndentId(indentId);
    if (indent.supplierId) { setSupplierId(indent.supplierId); setSupplierName(indent.supplierName || ''); }
    const newItems = (indent.items || []).map((item) => ({
      productId: item.productId,
      name: item.productName,
      qty: item.requestedQty || 1,
      purchasePrice: '',
      mrp: '',
      taxPct: 3,
      taxAmt: 0,
      lineTotal: 0,
    }));
    setItems(newItems);
    toast.success('Loaded items from indent');
  }

  function updateItem(idx, field, value) {
    setItems((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      const item = updated[idx];
      const pp = parseFloat(item.purchasePrice) || 0;
      const qty = parseInt(item.qty) || 0;
      const taxPct = parseFloat(item.taxPct) || 0;
      const base = pp * qty;
      const taxAmt = base * taxPct / 100;
      updated[idx].taxAmt = taxAmt;
      updated[idx].lineTotal = base + taxAmt;
      return updated;
    });
  }

  function removeItem(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function addPayment() {
    setPayments((prev) => [...prev, { ...EMPTY_PAYMENT }]);
  }

  function updatePayment(idx, field, value) {
    setPayments((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      return updated;
    });
  }

  function removePayment(idx) {
    setPayments((prev) => prev.filter((_, i) => i !== idx));
  }

  const subtotal = items.reduce((s, i) => s + (parseFloat(i.purchasePrice) || 0) * (parseInt(i.qty) || 0), 0);
  const totalTax = items.reduce((s, i) => s + (i.taxAmt || 0), 0);
  const grandTotal = subtotal + totalTax + parseFloat(loadingCharges || 0) + parseFloat(transportCharges || 0);

  async function handleSave() {
    if (!invoiceNumber) { toast.error('Invoice number required'); return; }
    if (!supplierId && !supplierName) { toast.error('Supplier required'); return; }
    if (items.length === 0) { toast.error('Add at least one item'); return; }
    setSaving(true);
    try {
      const supplier = suppliers.find((s) => s.id === supplierId);
      const res = await fetch('/api/admin/purchase/inward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceNumber, invoiceDate,
          supplierId,
          supplierName: supplier?.name || supplierName,
          poIndentId: poIndentId || null,
          paymentStatus, items, notes,
          loadingCharges: parseFloat(loadingCharges) || 0,
          transportCharges: parseFloat(transportCharges) || 0,
          subtotal, totalTax, grandTotal, payments,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Purchase inward saved! Stock updated.');
        setInvoiceNumber('');
        setItems([]);
        setPayments([]);
        setSupplierId('');
        setNotes('');
        setPoIndentId('');
        setLoadingCharges('');
        setTransportCharges('');
      } else { toast.error(data.message); }
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Purchase Inward</h1>
        <p className="text-sm text-gray-400 mt-0.5">Record incoming purchase invoices and update stock</p>
      </div>

      {/* Invoice header */}
      <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">
        <h2 className="font-bold text-gray-800 flex items-center gap-2 text-sm uppercase tracking-wide text-gray-500">
          <FiFileText className="text-amber-500" /> Invoice Details
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Invoice Number <span className="text-red-400">*</span>
            </label>
            <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)}
              className={inp} placeholder="INV-2024-001" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Invoice Date
            </label>
            <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={inp} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Load from PO Indent
            </label>
            <select value={poIndentId} onChange={(e) => { if (e.target.value) loadFromIndent(e.target.value); setPoIndentId(e.target.value); }}
              className={inp}
            >
              <option value="">Select Indent (optional)...</option>
              {indents.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.supplierName || 'Unknown'} — {i.createdAt?.split('T')[0]} [{i.status}]
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Supplier <span className="text-red-400">*</span>
            </label>
            {suppliers.length > 0 ? (
              <select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setSupplierName(''); }} className={inp}>
                <option value="">Select Supplier...</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) : (
              <input
                value={supplierName}
                onChange={(e) => { setSupplierName(e.target.value); setSupplierId(''); }}
                className={inp}
                placeholder="Type supplier / wholesaler name"
              />
            )}
            {suppliers.length > 0 && !supplierId && (
              <input
                value={supplierName}
                onChange={(e) => { setSupplierName(e.target.value); setSupplierId(''); }}
                className={`${inp} mt-2`}
                placeholder="Or type supplier name manually"
              />
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Payment Status
            </label>
            <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} className={inp}>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className={`${inp} resize-none`} placeholder="Any notes for this inward entry..." />
        </div>
      </div>

      {/* Purchase Items */}
      <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-800 flex items-center gap-2">
            <FiPackage className="text-amber-500" /> Purchase Items
          </h2>
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-maroon-950 text-white text-sm font-bold rounded-xl hover:bg-maroon-900 transition"
          >
            <FiPlus /> Add Product
          </button>
        </div>

        {/* Product search dropdown */}
        {searchOpen && (
          <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs" />
                <input
                  autoFocus
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Type product name or SKU..."
                  className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                />
              </div>
              <button onClick={() => { setSearchOpen(false); setProductSearch(''); setProductResults([]); }}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition"
              >
                <FiX />
              </button>
            </div>
            {searching && <div className="flex justify-center py-3"><LoadingSpinner /></div>}
            {productResults.length > 0 && (
              <div className="max-h-40 overflow-y-auto divide-y divide-gray-100 rounded-lg bg-white border border-gray-200">
                {productResults.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => addProductToItems(p)}
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-amber-50 transition text-left"
                  >
                    <div>
                      <p className="font-medium text-gray-800 text-sm">{p.name}</p>
                      <p className="text-xs text-gray-400">{p.sku || '—'} · Stock: {p.stock || 0}</p>
                    </div>
                    <span className="text-xs text-amber-600 font-semibold">{formatPrice(p.price || 0)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {items.length === 0 ? (
          <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center">
            <FiPackage className="text-4xl text-gray-200 mx-auto mb-2" />
            <p className="text-gray-400 text-sm">No items yet. Click "Add Product" to search.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2.5 text-left">#</th>
                  <th className="px-3 py-2.5 text-left">Product</th>
                  <th className="px-3 py-2.5 text-center">Qty</th>
                  <th className="px-3 py-2.5 text-center">Purchase Price</th>
                  <th className="px-3 py-2.5 text-center">MRP</th>
                  <th className="px-3 py-2.5 text-center">Tax %</th>
                  <th className="px-3 py-2.5 text-center">Tax Amt</th>
                  <th className="px-3 py-2.5 text-right">Line Total</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map((item, idx) => (
                  <tr key={item.productId + idx} className="hover:bg-gray-50">
                    <td className="px-3 py-2.5 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="px-3 py-2.5 font-medium text-gray-800 text-sm">{item.name}</td>
                    <td className="px-3 py-2.5">
                      <input type="number" min="1" value={item.qty}
                        onChange={(e) => updateItem(idx, 'qty', e.target.value)}
                        className="w-16 px-2 py-1 border border-gray-200 rounded-lg text-sm text-center outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <input type="number" min="0" value={item.purchasePrice} placeholder="₹"
                        onChange={(e) => updateItem(idx, 'purchasePrice', e.target.value)}
                        className="w-24 px-2 py-1 border border-gray-200 rounded-lg text-sm text-center outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <input type="number" min="0" value={item.mrp} placeholder="₹"
                        onChange={(e) => updateItem(idx, 'mrp', e.target.value)}
                        className="w-24 px-2 py-1 border border-gray-200 rounded-lg text-sm text-center outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <input type="number" min="0" max="100" value={item.taxPct}
                        onChange={(e) => updateItem(idx, 'taxPct', e.target.value)}
                        className="w-16 px-2 py-1 border border-gray-200 rounded-lg text-sm text-center outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </td>
                    <td className="px-3 py-2.5 text-center text-gray-500 text-xs">
                      {item.taxAmt ? formatPrice(item.taxAmt) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-gray-800">
                      {item.lineTotal ? formatPrice(item.lineTotal) : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <button onClick={() => removeItem(idx)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition">
                        <FiTrash2 className="text-sm" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Totals */}
        {items.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Loading Charges</label>
                  <input type="number" min="0" value={loadingCharges} onChange={(e) => setLoadingCharges(e.target.value)}
                    className={inp} placeholder="₹0" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Transport Charges</label>
                  <input type="number" min="0" value={transportCharges} onChange={(e) => setTransportCharges(e.target.value)}
                    className={inp} placeholder="₹0" />
                </div>
              </div>
            </div>
            <div className="bg-amber-50 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span className="font-medium">{formatPrice(subtotal)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Total Tax</span>
                <span className="font-medium">{formatPrice(totalTax)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Loading + Transport</span>
                <span className="font-medium">{formatPrice((parseFloat(loadingCharges) || 0) + (parseFloat(transportCharges) || 0))}</span>
              </div>
              <div className="flex justify-between font-bold text-gray-800 text-base border-t border-amber-200 pt-2">
                <span>Grand Total</span>
                <span className="text-maroon-950">{formatPrice(grandTotal)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Payments */}
      <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-800 flex items-center gap-2">
            <FiDollarSign className="text-amber-500" /> Payment Entries
          </h2>
          <button onClick={addPayment}
            className="flex items-center gap-2 px-4 py-2 border-2 border-dashed border-gray-300 text-gray-600 text-sm font-semibold rounded-xl hover:border-amber-400 hover:text-amber-600 transition"
          >
            <FiPlus /> Add Payment
          </button>
        </div>

        {payments.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-4">No payments recorded. The full amount will be marked as {paymentStatus}.</p>
        ) : (
          <div className="space-y-3">
            {payments.map((pay, idx) => (
              <div key={idx} className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end p-3 bg-gray-50 rounded-xl">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Date</label>
                  <input type="date" value={pay.date} onChange={(e) => updatePayment(idx, 'date', e.target.value)} className={inp} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Method</label>
                  <select value={pay.method} onChange={(e) => updatePayment(idx, 'method', e.target.value)} className={inp}>
                    {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Transaction ID</label>
                  <input value={pay.transactionId} onChange={(e) => updatePayment(idx, 'transactionId', e.target.value)}
                    className={inp} placeholder="Optional" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Amount (₹)</label>
                  <input type="number" min="0" value={pay.amount} onChange={(e) => updatePayment(idx, 'amount', e.target.value)}
                    className={inp} placeholder="0" />
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Notes</label>
                    <input value={pay.notes} onChange={(e) => updatePayment(idx, 'notes', e.target.value)}
                      className={inp} placeholder="Optional" />
                  </div>
                  <button onClick={() => removePayment(idx)} className="p-2.5 text-red-500 hover:bg-red-50 rounded-lg transition flex-shrink-0">
                    <FiTrash2 className="text-sm" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 pb-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-8 py-3 bg-maroon-950 text-white text-sm font-bold rounded-xl hover:bg-maroon-900 disabled:opacity-50 transition shadow-sm"
        >
          {saving ? <LoadingSpinner size="sm" /> : <FiSave />}
          Save & Update Stock
        </button>
        <button
          onClick={() => {
            if (confirm('Clear all fields?')) {
              setInvoiceNumber(''); setItems([]); setPayments([]);
              setSupplierId(''); setNotes(''); setPoIndentId('');
              setLoadingCharges(''); setTransportCharges('');
            }
          }}
          className="px-6 py-3 border border-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-50 transition"
        >
          Close / Reset
        </button>
      </div>
    </div>
  );
}
