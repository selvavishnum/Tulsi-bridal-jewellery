'use client';

import { useState, useEffect, useMemo } from 'react';
import { FiSearch, FiX, FiPhone, FiMail, FiUser, FiUsers, FiStar } from 'react-icons/fi';
import Badge from '@/components/ui/Badge';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { format } from 'date-fns';

const WA_NUMBER_FALLBACK = '919876543210';

function Avatar({ name, size = 'md' }) {
  const initials = (name || '?').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  const colors = ['bg-maroon-100 text-maroon-800', 'bg-blue-100 text-blue-800', 'bg-green-100 text-green-800', 'bg-purple-100 text-purple-800', 'bg-gold-100 text-gold-800'];
  const color = colors[initials.charCodeAt(0) % colors.length];
  const sz = size === 'md' ? 'w-9 h-9 text-sm' : 'w-8 h-8 text-xs';
  return (
    <div className={`${sz} ${color} rounded-full flex items-center justify-center font-bold flex-shrink-0`}>
      {initials}
    </div>
  );
}

export default function AdminCustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [roleFilter, setRole]     = useState('');
  const [selected, setSelected]   = useState(null);

  useEffect(() => {
    fetch('/api/admin/customers')
      .then((r) => r.json())
      .then((d) => { if (d.success) setCustomers(d.data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = customers;
    if (roleFilter) list = list.filter((c) => c.role === roleFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) =>
        c.name?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.phone?.includes(q)
      );
    }
    return list;
  }, [customers, search, roleFilter]);

  const stats = useMemo(() => ({
    total:    customers.length,
    active:   customers.filter((c) => c.isActive).length,
    admins:   customers.filter((c) => c.role === 'admin').length,
  }), [customers]);

  return (
    <div className="space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Customers</h1>
        <p className="text-sm text-gray-400 mt-0.5">{filtered.length} of {customers.length} customers</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total',  value: stats.total,  icon: FiUsers, color: 'bg-blue-50 text-blue-700' },
          { label: 'Active', value: stats.active,  icon: FiUser,  color: 'bg-green-50 text-green-700' },
          { label: 'Admins', value: stats.admins,  icon: FiStar,  color: 'bg-maroon-50 text-maroon-700' },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl px-4 py-3 flex items-center gap-3 ${s.color}`}>
            <s.icon className="text-xl opacity-60" />
            <div>
              <p className="text-2xl font-bold leading-none">{s.value}</p>
              <p className="text-xs font-medium opacity-60 mt-0.5">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email or phone…"
            className="w-full pl-9 pr-9 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400 bg-white"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <FiX className="text-sm" />
            </button>
          )}
        </div>
        {['', 'customer', 'admin'].map((r) => (
          <button
            key={r}
            onClick={() => setRole(r)}
            className={`px-4 py-2.5 rounded-lg text-xs font-semibold capitalize transition ${roleFilter === r ? 'bg-maroon-950 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
          >
            {r || 'All Roles'}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="px-4 py-3 text-left hidden md:table-cell">Email</th>
                  <th className="px-4 py-3 text-left hidden lg:table-cell">Phone</th>
                  <th className="px-4 py-3 text-left">Role</th>
                  <th className="px-4 py-3 text-left hidden md:table-cell">Joined</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                      {search ? 'No customers match your search.' : 'No customers yet.'}
                    </td>
                  </tr>
                ) : filtered.map((c) => (
                  <tr
                    key={c._id || c.id}
                    className="hover:bg-gray-50/70 transition cursor-pointer"
                    onClick={() => setSelected(c)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={c.name} />
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-800 truncate">{c.name || '—'}</p>
                          <p className="text-xs text-gray-400 md:hidden truncate">{c.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden md:table-cell">
                      <a href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()} className="hover:text-maroon-950 transition">
                        {c.email}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">{c.phone || '—'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={c.role === 'admin' ? 'maroon' : 'default'}>{c.role}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 hidden md:table-cell">
                      {c.createdAt ? format(new Date(c.createdAt), 'dd MMM yyyy') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={c.isActive ? 'success' : 'danger'}>
                        {c.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        {c.phone && (
                          <a
                            href={`https://wa.me/91${c.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi ${c.name}! Thank you for shopping at Tulsi Bridal Jewellery.`)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition"
                            title="WhatsApp"
                          >
                            <FiPhone className="text-sm" />
                          </a>
                        )}
                        <a
                          href={`mailto:${c.email}`}
                          className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition"
                          title="Email"
                        >
                          <FiMail className="text-sm" />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Customer detail slide-over */}
      {selected && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={() => setSelected(null)} />
          <div className="w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl">
            {/* Header */}
            <div className="px-6 py-5 border-b flex items-center justify-between">
              <h3 className="font-bold text-gray-800">Customer Profile</h3>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-700 transition">
                <FiX className="text-lg" />
              </button>
            </div>

            <div className="px-6 py-6 space-y-6">
              {/* Avatar + name */}
              <div className="flex items-center gap-4">
                <Avatar name={selected.name} size="lg" />
                <div>
                  <p className="font-bold text-gray-900 text-lg">{selected.name || '—'}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant={selected.role === 'admin' ? 'maroon' : 'default'}>{selected.role}</Badge>
                    <Badge variant={selected.isActive ? 'success' : 'danger'}>
                      {selected.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Contact info */}
              <div className="space-y-3">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Contact</p>
                <div className="space-y-2">
                  <div className="flex items-center gap-3 text-sm">
                    <FiMail className="text-gray-400 flex-shrink-0" />
                    <a href={`mailto:${selected.email}`} className="text-blue-500 hover:underline">{selected.email}</a>
                  </div>
                  {selected.phone && (
                    <div className="flex items-center gap-3 text-sm">
                      <FiPhone className="text-gray-400 flex-shrink-0" />
                      <span className="text-gray-700">{selected.phone}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Account details */}
              <div className="space-y-3">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Account</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-1">Joined</p>
                    <p className="text-sm font-semibold text-gray-700">
                      {selected.createdAt ? format(new Date(selected.createdAt), 'dd MMM yyyy') : '—'}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-1">Login Method</p>
                    <p className="text-sm font-semibold text-gray-700 capitalize">
                      {selected.googleId ? 'Google' : 'Email'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Quick actions */}
              <div className="space-y-3">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Quick Actions</p>
                <div className="space-y-2">
                  {selected.phone && (
                    <a
                      href={`https://wa.me/91${selected.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi ${selected.name}! Greetings from Tulsi Bridal Jewellery. 💛`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 w-full px-4 py-3 bg-green-500 hover:bg-green-400 text-white font-semibold rounded-xl text-sm transition"
                    >
                      <FiPhone /> WhatsApp Message
                    </a>
                  )}
                  <a
                    href={`mailto:${selected.email}?subject=Greetings from Tulsi Bridal Jewellery`}
                    className="flex items-center gap-3 w-full px-4 py-3 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded-xl text-sm transition"
                  >
                    <FiMail /> Send Email
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
