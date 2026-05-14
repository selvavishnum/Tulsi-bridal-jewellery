'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  FiSearch, FiX, FiUsers, FiRefreshCw, FiDownload,
  FiShoppingBag, FiEye,
} from 'react-icons/fi';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { format, parseISO } from 'date-fns';
import { formatPrice } from '@/lib/utils';
import toast from 'react-hot-toast';

function safeFormat(str) {
  if (!str) return '—';
  try { return format(parseISO(str), 'dd MMM yyyy'); } catch { return str; }
}

function isRegistered(u) {
  return !!(u.role || (u.loginCount && u.loginCount > 0));
}

export default function AdminCustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');

  function fetchCustomers() {
    setLoading(true);
    fetch('/api/admin/customers')
      .then((r) => r.json())
      .then((d) => { if (d.success) setCustomers(d.data); })
      .catch(() => toast.error('Failed to load customers'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchCustomers(); }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return customers;
    const q = search.toLowerCase();
    return customers.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.phone?.includes(q),
    );
  }, [customers, search]);

  const stats = useMemo(() => {
    const registered = customers.filter(isRegistered);
    const guests = customers.filter((c) => !isRegistered(c));
    const totalPoints = customers.reduce((s, c) => s + (c.loyaltyPoints || 0), 0);
    return { total: customers.length, registered: registered.length, guests: guests.length, totalPoints };
  }, [customers]);

  function downloadCSV() {
    const header = ['Name', 'Email', 'Phone', 'Type', 'Points Earned', 'Points Redeemed', 'Joined', 'Total Orders', 'Total Spent'];
    const rows = filtered.map((c) => [
      c.name || '',
      c.email || '',
      c.phone || '',
      isRegistered(c) ? 'Registered' : 'Guest',
      c.loyaltyPoints || 0,
      c.pointsRedeemed || 0,
      safeFormat(c.createdAt),
      c.totalOrders || 0,
      c.totalSpent || 0,
    ]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `customers-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV downloaded');
  }

  const statCards = [
    { label: 'Total Customers',    value: stats.total,       color: 'bg-blue-50 text-blue-700' },
    { label: 'Registered',         value: stats.registered,  color: 'bg-green-50 text-green-700' },
    { label: 'Guests',             value: stats.guests,      color: 'bg-gray-50 text-gray-700' },
    { label: 'Total Points Issued', value: stats.totalPoints, color: 'bg-amber-50 text-amber-700' },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Customer Database</h1>
          <p className="text-sm text-gray-400 mt-0.5">All registered and guest customer information</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchCustomers}
            className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition"
          >
            <FiRefreshCw className={`text-sm ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={downloadCSV}
            className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-white bg-amber-500 rounded-xl hover:bg-amber-400 transition"
          >
            <FiDownload className="text-sm" />
            Download CSV
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statCards.map((s) => (
          <div key={s.label} className={`rounded-xl px-4 py-3 flex items-center gap-3 ${s.color}`}>
            <FiUsers className="text-xl flex-shrink-0 opacity-60" />
            <div>
              <p className="text-2xl font-bold leading-none">{s.value}</p>
              <p className="text-xs font-medium opacity-70 mt-0.5">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, phone or email..."
          className="w-full pl-9 pr-9 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <FiX className="text-sm" />
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm overflow-x-auto">
        {loading ? (
          <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left w-10">#</th>
                <th className="px-4 py-3 text-left">Customer</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left hidden md:table-cell">Points</th>
                <th className="px-4 py-3 text-left hidden sm:table-cell">Joined</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                    No customers found.
                  </td>
                </tr>
              ) : (
                filtered.map((c, i) => {
                  const reg = isRegistered(c);
                  const id = c.id || c._id;
                  return (
                    <tr key={id} className="hover:bg-amber-50/40 transition">
                      <td className="px-4 py-3 text-gray-400 text-xs">{i + 1}</td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-800">{c.name || '—'}</p>
                        {c.phone && <p className="text-xs text-gray-400">{c.phone}</p>}
                        <p className="text-xs text-gray-400">{c.email || '—'}</p>
                      </td>
                      <td className="px-4 py-3">
                        {reg ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                            Registered
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
                            Guest
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <p className="text-xs text-gray-600">Earned: <span className="font-semibold">{c.loyaltyPoints || 0}</span></p>
                        <p className="text-xs text-gray-400">Redeemed: {c.pointsRedeemed || 0}</p>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-xs text-gray-500">
                        {safeFormat(c.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={`/admin/orders?customer=${id}`}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition"
                            title="Orders"
                          >
                            <FiShoppingBag className="text-xs" />
                            Orders
                          </Link>
                          <Link
                            href={`/admin/customers/${id}`}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
                            title="View"
                          >
                            <FiEye className="text-xs" />
                            View
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
