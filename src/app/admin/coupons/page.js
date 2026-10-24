'use client';

import { useState, useEffect } from 'react';
import { FiPlus, FiTrash2, FiX, FiEdit2 } from 'react-icons/fi';
import { formatPrice } from '@/lib/utils';
import Badge from '@/components/ui/Badge';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

const EMPTY = {
  code: '', description: '', type: 'percentage', value: '',
  minOrderAmount: '', maxDiscount: '', usageLimit: '',
  validFrom: '', validUntil: '', isActive: true, firstOrderOnly: false,
};

/* The start date in India (stored as the instant midnight IST begins). */
const IST_MS = 330 * 60_000;
function istDate(iso) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : new Date(t + IST_MS).toISOString().slice(0, 10);
}
const startsLater = (c) => !!c.startsAt && new Date(c.startsAt) > new Date();
const isLive = (c) => c.isActive && (!c.expiresAt || new Date(c.expiresAt) > new Date()) && !startsLater(c);

/* A stored coupon → the form (edit). */
function toForm(c) {
  const until = c.expiresAt || c.validUntil;
  const limit = Number(c.maxUses ?? c.usageLimit) || 0;
  return {
    ...EMPTY,
    code: c.code || '',
    description: c.description || '',
    type: c.type || 'percentage',
    value: c.value ?? '',
    minOrderAmount: c.minOrderAmount ? String(c.minOrderAmount) : '',
    maxDiscount: Number(c.maxDiscount) > 0 ? String(c.maxDiscount) : '',
    usageLimit: limit > 0 ? String(limit) : '', // 0 = unlimited
    validFrom: c.startsAt ? istDate(c.startsAt) : '',
    validUntil: until ? String(until).slice(0, 10) : '',
    isActive: c.isActive !== false,
    firstOrderOnly: c.firstOrderOnly === true,
  };
}

/* The form → the API. A cleared field is sent as '' (JSON drops undefined,
   so an edit could never clear it): blank limit = unlimited, blank cap =
   none, blank start = straight away, blank expiry = never. */
function toPayload(form) {
  const num = (v) => (String(v ?? '').trim() === '' ? '' : Number(v));
  return {
    ...form,
    value: parseFloat(form.value),
    minOrderAmount: form.minOrderAmount ? parseFloat(form.minOrderAmount) : 0,
    maxDiscount: num(form.maxDiscount),
    usageLimit: num(form.usageLimit),
    validFrom: form.validFrom || '',
    validUntil: form.validUntil || '',
    firstOrderOnly: form.firstOrderOnly === true,
  };
}

export default function AdminCouponsPage() {
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  async function fetchCoupons() {
    setLoading(true);
    try {
      const res = await fetch('/api/coupons');
      const data = await res.json();
      if (data.success) setCoupons(data.data);
    } finally { setLoading(false); }
  }

  useEffect(() => { fetchCoupons(); }, []);

  function openCreate() { setEditingId(null); setForm(EMPTY); setModalOpen(true); }
  function openEdit(c) { setEditingId(c._id || c.id); setForm(toForm(c)); setModalOpen(true); }
  function closeModal() { setModalOpen(false); setEditingId(null); setForm(EMPTY); }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = toPayload(form);
      const res = editingId
        ? await fetch(`/api/coupons/${editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch('/api/coupons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.success) { toast.success(editingId ? 'Coupon updated' : 'Coupon created!'); closeModal(); fetchCoupons(); }
      else toast.error(data.message);
    } finally { setSaving(false); }
  }

  async function deleteCoupon(id) {
    if (!confirm('Delete this coupon?')) return;
    const res = await fetch(`/api/coupons/${id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Coupon deleted'); fetchCoupons(); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Coupons</h1>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-maroon-950 text-white text-sm font-semibold rounded-lg hover:bg-maroon-900 transition">
          <FiPlus /> Add Coupon
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Code</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Value</th>
                  <th className="px-4 py-3 text-left">Min Order</th>
                  <th className="px-4 py-3 text-left">Used</th>
                  <th className="px-4 py-3 text-left">Valid Until</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {coupons.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No coupons yet</td></tr>
                ) : coupons.map((c) => (
                  <tr key={c._id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="font-mono font-bold text-maroon-950">{c.code}</span>
                      {c.firstOrderOnly === true && (
                        <Badge variant="gold" className="ml-2 whitespace-nowrap">First order only</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 capitalize text-gray-600">{c.type}</td>
                    <td className="px-4 py-3">
                      <span className="font-semibold">{c.type === 'percentage' ? `${c.value}%` : formatPrice(c.value)}</span>
                      {Number(c.maxDiscount) > 0 && (
                        <span className="block text-xs text-gray-500 whitespace-nowrap">max {formatPrice(c.maxDiscount)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{formatPrice(c.minOrderAmount || 0)}</td>
                    <td className="px-4 py-3 text-gray-500">{c.usedCount || 0}/{Number(c.maxUses) > 0 ? c.maxUses : '∞'}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {(c.expiresAt || c.validUntil) ? format(new Date(c.expiresAt || c.validUntil), 'dd MMM yyyy') : '—'}
                      {startsLater(c) && <span className="block whitespace-nowrap text-amber-700">from {format(new Date(c.startsAt), 'dd MMM yyyy')}</span>}
                    </td>
                    <td className="px-4 py-3">
                      {c.isActive && startsLater(c) && !(c.expiresAt && new Date(c.expiresAt) <= new Date())
                        ? <Badge variant="warning">Scheduled</Badge>
                        : <Badge variant={isLive(c) ? 'success' : 'danger'}>{isLive(c) ? 'Active' : 'Inactive'}</Badge>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(c)} aria-label={`Edit ${c.code}`} className="p-1.5 text-gray-500 hover:text-maroon-950 hover:bg-gray-100 rounded-lg transition"><FiEdit2 /></button>
                        <button onClick={() => deleteCoupon(c._id)} aria-label={`Delete ${c.code}`} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition"><FiTrash2 /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b">
              <h2 className="font-bold text-gray-800">{editingId ? `Edit ${form.code || 'Coupon'}` : 'Create Coupon'}</h2>
              <button onClick={closeModal} aria-label="Close"><FiX /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 mb-1 block">Code *</label>
                  <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="e.g. BRIDE20" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono uppercase outline-none focus:ring-2 focus:ring-gold-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Type *</label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500">
                    <option value="percentage">Percentage (%)</option>
                    <option value="fixed">Fixed Amount (₹)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Value *</label>
                  <input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder={form.type === 'percentage' ? '10 = 10%' : '500'} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Min Order (₹)</label>
                  <input type="number" value={form.minOrderAmount} onChange={(e) => setForm({ ...form, minOrderAmount: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Max Discount (₹)</label>
                  <input type="number" min="0" value={form.maxDiscount} onChange={(e) => setForm({ ...form, maxDiscount: e.target.value })} placeholder="No cap" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Usage Limit</label>
                  <input type="number" min="0" step="1" value={form.usageLimit} onChange={(e) => setForm({ ...form, usageLimit: e.target.value })} placeholder="Unlimited" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Valid From <span className="text-gray-400">(blank = now)</span></label>
                  <input type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Valid Until <span className="text-gray-400">(blank = no expiry)</span></label>
                  <input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                </div>
                <label className="col-span-2 flex items-start gap-3 p-3 rounded-lg border border-amber-100 bg-amber-50 cursor-pointer">
                  <input type="checkbox" checked={form.firstOrderOnly} onChange={(e) => setForm({ ...form, firstOrderOnly: e.target.checked })} className="mt-0.5 h-4 w-4 accent-amber-600" />
                  <span>
                    <span className="block text-sm font-semibold text-gray-800">First order only</span>
                    <span className="block text-xs text-gray-500 mt-0.5">Checkout refuses this code to customers who already have a paid or cash-on-delivery order. Tick this for the welcome-offer code shown in the top bar.</span>
                  </span>
                </label>
                <label className="col-span-2 flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="h-4 w-4 accent-amber-600" />
                  <span className="text-sm text-gray-700">Active</span>
                </label>
              </div>
            </div>
            <div className="p-5 border-t flex justify-end gap-3">
              <button onClick={closeModal} className="px-4 py-2 border border-gray-200 text-gray-600 text-sm font-semibold rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.code || !form.value} className="px-6 py-2 bg-maroon-950 text-white text-sm font-semibold rounded-lg hover:bg-maroon-900 disabled:opacity-60 transition flex items-center gap-2">
                {saving && <LoadingSpinner size="sm" />} {editingId ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
