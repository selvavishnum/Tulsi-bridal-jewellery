'use client';

import { useState, useEffect } from 'react';
import { formatPrice } from '@/lib/utils';
import Badge from '@/components/ui/Badge';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

const STATUS_BADGE = { pending: 'warning', confirmed: 'success', active: 'gold', returned: 'default', cancelled: 'danger', overdue: 'danger' };
const STATUSES = ['pending', 'confirmed', 'active', 'returned', 'cancelled', 'overdue'];

export default function AdminRentalsPage() {
  const [rentals, setRentals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState(null);

  async function fetchRentals() {
    setLoading(true);
    try {
      const res = await fetch(`/api/rentals?limit=100${statusFilter ? `&status=${statusFilter}` : ''}`);
      const data = await res.json();
      if (data.success) setRentals(data.data.rentals);
    } finally { setLoading(false); }
  }

  useEffect(() => { fetchRentals(); }, [statusFilter]);

  async function updateStatus(rentalId, status) {
    const res = await fetch(`/api/rentals/${rentalId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    const data = await res.json();
    if (data.success) { toast.success('Rental updated'); fetchRentals(); setSelected(null); }
    else toast.error(data.message);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-800">Rentals</h1>

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setStatusFilter('')} className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${!statusFilter ? 'bg-maroon-950 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>All</button>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize transition ${statusFilter === s ? 'bg-maroon-950 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>{s}</button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Rental #</th>
                  <th className="px-4 py-3 text-left">Product</th>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="px-4 py-3 text-left">Dates</th>
                  <th className="px-4 py-3 text-left">Total</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rentals.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No rentals found</td></tr>
                ) : rentals.map((r) => (
                  <tr key={r._id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">#{r.rentalNumber}</td>
                    <td className="px-4 py-3 text-gray-700 max-w-32 truncate">{r.productName}</td>
                    <td className="px-4 py-3 text-gray-700">{r.customerDetails?.fullName || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {format(new Date(r.rentalStartDate), 'dd MMM')} – {format(new Date(r.rentalEndDate), 'dd MMM yyyy')}
                      <span className="block text-gray-400">{r.rentalDays}d</span>
                    </td>
                    <td className="px-4 py-3 font-semibold">{formatPrice(r.total)}</td>
                    <td className="px-4 py-3"><Badge variant={STATUS_BADGE[r.status] || 'default'}>{r.status}</Badge></td>
                    <td className="px-4 py-3">
                      <button onClick={() => setSelected(r)} className="text-xs text-blue-500 hover:text-blue-700 font-semibold">Update</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h3 className="font-bold text-gray-800 mb-4">Update Rental #{selected.rentalNumber}</h3>
            <div className="space-y-2">
              {STATUSES.map((s) => (
                <button key={s} onClick={() => updateStatus(selected._id, s)} className={`w-full py-2.5 rounded-lg text-sm font-semibold capitalize transition ${selected.status === s ? 'bg-maroon-950 text-white' : 'bg-gray-100 text-gray-700 hover:bg-maroon-50'}`}>{s}</button>
              ))}
            </div>
            <button onClick={() => setSelected(null)} className="w-full mt-3 py-2.5 border border-gray-200 text-gray-500 text-sm rounded-lg hover:bg-gray-50 transition">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
