'use client';

import { useState, useEffect } from 'react';
import { FiPlus, FiTrash2, FiX } from 'react-icons/fi';
import { formatPrice } from '@/lib/utils';
import Badge from '@/components/ui/Badge';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

const EMPTY = {
  code: '', description: '', type: 'percentage', value: '',
  minOrderAmount: '', maxDiscount: '', usageLimit: '',
  validFrom: '', validUntil: '', isActive: true,
};

export default function AdminCouponsPage() {
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
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

  async function handleSave() {
    setSaving(true);
    try {
      const payload = { ...form, value: parseFloat(form.value), minOrderAmount: form.minOrderAmount ? parseFloat(form.minOrderAmount) : 0, maxDiscount: form.maxDiscount ? parseFloat(form.maxDiscount) : undefined, usageLimit: form.usageLimit ? parseInt(form.usageLimit) : undefined };
      const res = await fetch('/api/coupons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.success) { toast.success('Coupon created!'); setModalOpen(false); fetchCoupons(); setForm(EMPTY); }
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
        <button onClick={() => setModalOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-maroon-950 text-white text-sm font-semibold rounded-lg hover:bg-maroon-900 transition">
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
                    <td className="px-4 py-3 font-mono font-bold text-maroon-950">{c.code}</td>
                    <td className="px-4 py-3 capitalize text-gray-600">{c.type}</td>
                    <td className="px-4 py-3 font-semibold">{c.type === 'percentage' ? `${c.value}%` : formatPrice(c.value)}</td>
                    <td className="px-4 py-3 text-gray-500">{formatPrice(c.minOrderAmount || 0)}</td>
                    <td className="px-4 py-3 text-gray-500">{c.usedCount}/{c.usageLimit || '∞'}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{format(new Date(c.validUntil), 'dd MMM yyyy')}</td>
                    <td className="px-4 py-3"><Badge variant={c.isActive && new Date(c.validUntil) > new Date() ? 'success' : 'danger'}>{c.isActive && new Date(c.validUntil) > new Date() ? 'Active' : 'Inactive'}</Badge></td>
                    <td className="px-4 py-3">
                      <button onClick={() => deleteCoupon(c._id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition"><FiTrash2 /></button>
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
              <h2 className="font-bold text-gray-800">Create Coupon</h2>
              <button onClick={() => setModalOpen(false)}><FiX /></button>
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
                  <input type="number" value={form.maxDiscount} onChange={(e) => setForm({ ...form, maxDiscount: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Usage Limit</label>
                  <input type="number" value={form.usageLimit} onChange={(e) => setForm({ ...form, usageLimit: e.target.value })} placeholder="Unlimited" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Valid From *</label>
                  <input type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Valid Until *</label>
                  <input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                </div>
              </div>
            </div>
            <div className="p-5 border-t flex justify-end gap-3">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 border border-gray-200 text-gray-600 text-sm font-semibold rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.code || !form.value} className="px-6 py-2 bg-maroon-950 text-white text-sm font-semibold rounded-lg hover:bg-maroon-900 disabled:opacity-60 transition flex items-center gap-2">
                {saving && <LoadingSpinner size="sm" />} Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
