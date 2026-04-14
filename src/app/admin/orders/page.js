'use client';

import { useState, useEffect } from 'react';
import { FiSearch } from 'react-icons/fi';
import { formatPrice } from '@/lib/utils';
import Badge from '@/components/ui/Badge';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

const STATUS_BADGE = { pending: 'warning', confirmed: 'success', processing: 'gold', shipped: 'gold', delivered: 'success', cancelled: 'danger', returned: 'danger' };
const STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState(null);

  async function fetchOrders() {
    setLoading(true);
    try {
      const res = await fetch(`/api/orders?limit=100${statusFilter ? `&status=${statusFilter}` : ''}`);
      const data = await res.json();
      if (data.success) setOrders(data.data.orders);
    } finally { setLoading(false); }
  }

  useEffect(() => { fetchOrders(); }, [statusFilter]);

  async function updateStatus(orderId, status) {
    const res = await fetch(`/api/orders/${orderId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    const data = await res.json();
    if (data.success) { toast.success('Order updated'); fetchOrders(); setSelected(null); }
    else toast.error(data.message);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-800">Orders</h1>

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
                  <th className="px-4 py-3 text-left">Order #</th>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="px-4 py-3 text-left">Items</th>
                  <th className="px-4 py-3 text-left">Total</th>
                  <th className="px-4 py-3 text-left">Payment</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {orders.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No orders found</td></tr>
                ) : orders.map((o) => (
                  <tr key={o._id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">#{o.orderNumber}</td>
                    <td className="px-4 py-3 text-gray-700">{o.user?.name || o.guestEmail || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{o.items?.length || 0} items</td>
                    <td className="px-4 py-3 font-semibold">{formatPrice(o.total)}</td>
                    <td className="px-4 py-3"><Badge variant={o.payment?.status === 'paid' ? 'success' : 'warning'}>{o.payment?.status}</Badge></td>
                    <td className="px-4 py-3"><Badge variant={STATUS_BADGE[o.status] || 'default'}>{o.status}</Badge></td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{format(new Date(o.createdAt), 'dd MMM yyyy')}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => setSelected(o)} className="text-xs text-blue-500 hover:text-blue-700 font-semibold">Update</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Status update modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h3 className="font-bold text-gray-800 mb-4">Update Order #{selected.orderNumber}</h3>
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
