'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { FiSearch, FiX, FiPhone, FiMail, FiUser, FiUsers, FiStar, FiGift, FiClock, FiShoppingBag, FiEye } from 'react-icons/fi';
import Badge from '@/components/ui/Badge';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { format, differenceInDays, parseISO, isValid } from 'date-fns';
import { formatPrice } from '@/lib/utils';

function Avatar({ name, size = 'md' }) {
  const initials = (name || '?').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  const colors = ['bg-maroon-100 text-maroon-800', 'bg-blue-100 text-blue-800', 'bg-green-100 text-green-800', 'bg-purple-100 text-purple-800', 'bg-gold-100 text-gold-800'];
  const color = colors[initials.charCodeAt(0) % colors.length];
  const sz = size === 'lg' ? 'w-14 h-14 text-xl' : size === 'md' ? 'w-9 h-9 text-sm' : 'w-8 h-8 text-xs';
  return (
    <div className={`${sz} ${color} rounded-full flex items-center justify-center font-bold flex-shrink-0`}>{initials}</div>
  );
}

function getCustomerBadge(c) {
  if (c.weddingDate) return { label: '👑 Bride', color: 'bg-pink-100 text-pink-800' };
  if ((c.totalSpent || 0) >= 5000) return { label: '💎 VIP', color: 'bg-yellow-100 text-yellow-800' };
  if ((c.totalOrders || 0) >= 2) return { label: '🔄 Repeat', color: 'bg-blue-100 text-blue-800' };
  if ((c.loginCount || 0) >= 5 && (c.totalOrders || 0) === 0) return { label: '🛍️ Window Shopper', color: 'bg-purple-100 text-purple-800' };
  if ((c.totalOrders || 0) === 0) return { label: '🆕 New', color: 'bg-green-100 text-green-800' };
  return null;
}

function isUpcomingDate(dateStr, daysAhead) {
  if (!dateStr) return false;
  try {
    const d = parseISO(dateStr);
    if (!isValid(d)) return false;
    const today = new Date();
    const thisYear = new Date(today.getFullYear(), d.getMonth(), d.getDate());
    const diff = differenceInDays(thisYear, today);
    return diff >= 0 && diff <= daysAhead;
  } catch { return false; }
}

function isInactive(c, days = 45) {
  const ref = c.lastSeen || c.createdAt;
  if (!ref) return false;
  return differenceInDays(new Date(), parseISO(ref)) >= days;
}

function safeDate(str) {
  if (!str) return '—';
  try { return format(parseISO(str), 'dd MMM yyyy'); } catch { return str; }
}

const WA_TEMPLATES = {
  birthday: (name) => `Hi ${name}! 🎂 Wishing you a very Happy Birthday from Tulsi Bridal Jewellery! Here's a special birthday gift for you — use code BDAY10 for 10% off your next order. Valid for 3 days! 💛`,
  wedding: (name) => `Hi ${name}! 💍 Your big day is almost here! Congratulations from Tulsi Bridal Jewellery. We have the perfect jewellery to make you shine. Visit us for exclusive bridal collections! 👑`,
  inactive: (name) => `Hi ${name}! We miss you at Tulsi Bridal Jewellery 💛 New collections have arrived — check them out! Use code WELCOME100 for ₹100 off your next order. Shop now: tulsibridal.com`,
  vip: (name) => `Hi ${name}! 💎 As one of our most valued customers, you get early access to our new collection before anyone else! Visit us this week for exclusive VIP offers. Thank you for your loyalty! 🙏`,
};

export default function AdminCustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [segment, setSegment]     = useState('all');
  const [selected, setSelected]   = useState(null);
  const [waTemplate, setWaTemplate] = useState('');

  useEffect(() => {
    fetch('/api/admin/customers')
      .then((r) => r.json())
      .then((d) => { if (d.success) setCustomers(d.data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const customers_only = useMemo(() => customers.filter((c) => c.role !== 'admin'), [customers]);

  const alerts = useMemo(() => ({
    birthdays:   customers_only.filter((c) => isUpcomingDate(c.birthday, 7)),
    weddings:    customers_only.filter((c) => isUpcomingDate(c.weddingDate, 30)),
    inactive:    customers_only.filter((c) => isInactive(c, 45)),
  }), [customers_only]);

  const filtered = useMemo(() => {
    let list = customers;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) => c.name?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q) || c.phone?.includes(q));
    }
    switch (segment) {
      case 'new':      list = list.filter((c) => (c.totalOrders || 0) === 0); break;
      case 'repeat':   list = list.filter((c) => (c.totalOrders || 0) >= 2); break;
      case 'vip':      list = list.filter((c) => (c.totalSpent || 0) >= 5000); break;
      case 'bride':    list = list.filter((c) => !!c.weddingDate); break;
      case 'inactive': list = list.filter((c) => isInactive(c, 45)); break;
      default: break;
    }
    return list;
  }, [customers, search, segment]);

  const stats = useMemo(() => ({
    total:   customers.length,
    active:  customers.filter((c) => c.isActive).length,
    vip:     customers_only.filter((c) => (c.totalSpent || 0) >= 5000).length,
    brides:  customers_only.filter((c) => !!c.weddingDate).length,
  }), [customers, customers_only]);

  const segments = [
    { key: 'all', label: 'All' },
    { key: 'new', label: '🆕 New' },
    { key: 'repeat', label: '🔄 Repeat' },
    { key: 'vip', label: '💎 VIP' },
    { key: 'bride', label: '👑 Bride' },
    { key: 'inactive', label: '😴 Inactive 45d' },
  ];

  function openDetail(c) {
    setSelected(c);
    setWaTemplate('');
  }

  function buildWaMsg(type) {
    return WA_TEMPLATES[type]?.(selected?.name?.split(' ')[0] || 'Customer') || '';
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Customers</h1>
        <p className="text-sm text-gray-400 mt-0.5">{filtered.length} of {customers.length} customers</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total',  value: stats.total,  icon: '👥', color: 'bg-blue-50 text-blue-700' },
          { label: 'Active', value: stats.active,  icon: '✅', color: 'bg-green-50 text-green-700' },
          { label: 'VIP',    value: stats.vip,     icon: '💎', color: 'bg-yellow-50 text-yellow-700' },
          { label: 'Brides', value: stats.brides,  icon: '👑', color: 'bg-pink-50 text-pink-700' },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl px-4 py-3 flex items-center gap-3 ${s.color}`}>
            <span className="text-xl">{s.icon}</span>
            <div>
              <p className="text-2xl font-bold leading-none">{s.value}</p>
              <p className="text-xs font-medium opacity-60 mt-0.5">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Marketing Alerts */}
      {(alerts.birthdays.length > 0 || alerts.weddings.length > 0 || alerts.inactive.length > 0) && (
        <div className="grid sm:grid-cols-3 gap-3">
          {alerts.birthdays.length > 0 && (
            <div className="bg-pink-50 border border-pink-200 rounded-xl p-4">
              <p className="text-sm font-bold text-pink-800 mb-2">🎂 Birthdays (7 days)</p>
              {alerts.birthdays.map((c) => (
                <div key={c.id} className="flex items-center justify-between py-1">
                  <p className="text-xs text-pink-700 font-medium">{c.name}</p>
                  {c.phone && (
                    <a href={`https://wa.me/91${c.phone.replace(/\D/g,'')}?text=${encodeURIComponent(WA_TEMPLATES.birthday(c.name?.split(' ')[0]))}`}
                      target="_blank" rel="noopener noreferrer" className="text-xs bg-green-500 text-white px-2 py-0.5 rounded-full hover:bg-green-600 transition">
                      WhatsApp
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
          {alerts.weddings.length > 0 && (
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
              <p className="text-sm font-bold text-purple-800 mb-2">💍 Weddings (30 days)</p>
              {alerts.weddings.map((c) => (
                <div key={c.id} className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-xs text-purple-700 font-medium">{c.name}</p>
                    <p className="text-xs text-purple-500">{safeDate(c.weddingDate)}</p>
                  </div>
                  {c.phone && (
                    <a href={`https://wa.me/91${c.phone.replace(/\D/g,'')}?text=${encodeURIComponent(WA_TEMPLATES.wedding(c.name?.split(' ')[0]))}`}
                      target="_blank" rel="noopener noreferrer" className="text-xs bg-green-500 text-white px-2 py-0.5 rounded-full hover:bg-green-600 transition">
                      WhatsApp
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
          {alerts.inactive.length > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
              <p className="text-sm font-bold text-orange-800 mb-2">😴 Inactive ({alerts.inactive.length})</p>
              {alerts.inactive.slice(0, 3).map((c) => (
                <div key={c.id} className="flex items-center justify-between py-1">
                  <p className="text-xs text-orange-700 font-medium">{c.name}</p>
                  {c.phone && (
                    <a href={`https://wa.me/91${c.phone.replace(/\D/g,'')}?text=${encodeURIComponent(WA_TEMPLATES.inactive(c.name?.split(' ')[0]))}`}
                      target="_blank" rel="noopener noreferrer" className="text-xs bg-green-500 text-white px-2 py-0.5 rounded-full hover:bg-green-600 transition">
                      WhatsApp
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Segment Tabs + Search */}
      <div className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          {segments.map((s) => (
            <button key={s.key} onClick={() => setSegment(s.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${segment === s.key ? 'bg-maroon-950 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, email or phone…"
            className="w-full pl-9 pr-9 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400 bg-white" />
          {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><FiX className="text-sm" /></button>}
        </div>
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
                  <th className="px-4 py-3 text-left hidden sm:table-cell">Badge</th>
                  <th className="px-4 py-3 text-left hidden md:table-cell">Orders</th>
                  <th className="px-4 py-3 text-left hidden md:table-cell">Spent</th>
                  <th className="px-4 py-3 text-left hidden lg:table-cell">Last Seen</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">No customers found.</td></tr>
                ) : filtered.map((c) => {
                  const badge = getCustomerBadge(c);
                  return (
                    <tr key={c.id || c._id} className="hover:bg-gray-50/70 transition cursor-pointer" onClick={() => openDetail(c)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={c.name} />
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-800 truncate">{c.name || '—'}</p>
                            <p className="text-xs text-gray-400 truncate">{c.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        {badge && <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${badge.color}`}>{badge.label}</span>}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-gray-600 font-semibold">{c.totalOrders || 0}</td>
                      <td className="px-4 py-3 hidden md:table-cell text-gray-600">{c.totalSpent ? formatPrice(c.totalSpent) : '—'}</td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-gray-400">{safeDate(c.lastSeen || c.createdAt)}</td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          {c.phone && (
                            <a href={`https://wa.me/91${c.phone.replace(/\D/g,'')}?text=${encodeURIComponent(`Hi ${c.name}! Greetings from Tulsi Bridal Jewellery 💛`)}`}
                              target="_blank" rel="noopener noreferrer"
                              className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition" title="WhatsApp">
                              <FiPhone className="text-sm" />
                            </a>
                          )}
                          <a href={`mailto:${c.email}`} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition" title="Email">
                            <FiMail className="text-sm" />
                          </a>
                          <Link href={`/admin/customers/${c.id || c._id}`}
                            className="p-1.5 text-amber-500 hover:bg-amber-50 rounded-lg transition" title="View Full Profile">
                            <FiEye className="text-sm" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Customer Detail Slide-over */}
      {selected && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={() => setSelected(null)} />
          <div className="w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl">
            <div className="px-6 py-5 border-b flex items-center justify-between">
              <h3 className="font-bold text-gray-800">Customer Profile</h3>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-700 transition"><FiX className="text-lg" /></button>
            </div>
            <div className="px-6 py-6 space-y-5">
              {/* Avatar + badge */}
              <div className="flex items-center gap-4">
                <Avatar name={selected.name} size="lg" />
                <div>
                  <p className="font-bold text-gray-900 text-lg">{selected.name || '—'}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    {(() => { const b = getCustomerBadge(selected); return b ? <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${b.color}`}>{b.label}</span> : null; })()}
                    <Badge variant={selected.isActive ? 'success' : 'danger'}>{selected.isActive ? 'Active' : 'Inactive'}</Badge>
                  </div>
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-400 mb-0.5">Orders</p>
                  <p className="font-bold text-gray-800">{selected.totalOrders || 0}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-400 mb-0.5">Spent</p>
                  <p className="font-bold text-gray-800">{selected.totalSpent ? formatPrice(selected.totalSpent) : '—'}</p>
                </div>
                <div className="bg-yellow-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-yellow-600 mb-0.5">🏆 Points</p>
                  <p className="font-bold text-yellow-700">{selected.loyaltyPoints || 0}</p>
                </div>
              </div>

              {/* Contact */}
              <div className="space-y-2">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Contact</p>
                <div className="flex items-center gap-3 text-sm"><FiMail className="text-gray-400 flex-shrink-0" /><a href={`mailto:${selected.email}`} className="text-blue-500 hover:underline">{selected.email}</a></div>
                {selected.phone && <div className="flex items-center gap-3 text-sm"><FiPhone className="text-gray-400 flex-shrink-0" /><span className="text-gray-700">{selected.phone}</span></div>}
                {selected.city && <div className="flex items-center gap-3 text-sm"><FiUser className="text-gray-400 flex-shrink-0" /><span className="text-gray-700">{selected.city}</span></div>}
              </div>

              {/* Personal dates */}
              {(selected.birthday || selected.weddingDate) && (
                <div className="grid grid-cols-2 gap-2">
                  {selected.birthday && (
                    <div className="bg-pink-50 rounded-lg p-3">
                      <p className="text-xs text-pink-500 mb-0.5">🎂 Birthday</p>
                      <p className="text-sm font-semibold text-pink-800">{safeDate(selected.birthday)}</p>
                    </div>
                  )}
                  {selected.weddingDate && (
                    <div className="bg-purple-50 rounded-lg p-3">
                      <p className="text-xs text-purple-500 mb-0.5">💍 Wedding</p>
                      <p className="text-sm font-semibold text-purple-800">{safeDate(selected.weddingDate)}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Activity */}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-0.5">Login Count</p>
                  <p className="font-semibold text-gray-700">{selected.loginCount || 0} times</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-0.5">Last Seen</p>
                  <p className="font-semibold text-gray-700 text-xs">{safeDate(selected.lastSeen || selected.createdAt)}</p>
                </div>
              </div>

              {/* WhatsApp Templates */}
              {selected.phone && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Marketing Messages</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { key: 'birthday', label: '🎂 Birthday Wish' },
                      { key: 'wedding', label: '💍 Wedding Offer' },
                      { key: 'inactive', label: '💛 Win Back' },
                      { key: 'vip', label: '💎 VIP Offer' },
                    ].map(({ key, label }) => (
                      <button key={key} onClick={() => setWaTemplate(waTemplate === key ? '' : key)}
                        className={`px-3 py-2 rounded-lg text-xs font-semibold border transition ${waTemplate === key ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {waTemplate && (
                    <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                      <p className="text-xs text-gray-600 mb-2 leading-relaxed">{buildWaMsg(waTemplate)}</p>
                      <a href={`https://wa.me/91${selected.phone.replace(/\D/g,'')}?text=${encodeURIComponent(buildWaMsg(waTemplate))}`}
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full py-2.5 bg-green-500 hover:bg-green-400 text-white font-semibold rounded-lg text-sm transition">
                        <FiPhone /> Send on WhatsApp
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* Generic actions */}
              <div className="space-y-2">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Quick Actions</p>
                <Link href={`/admin/customers/${selected.id || selected._id}`}
                  className="flex items-center gap-3 w-full px-4 py-3 bg-amber-500 hover:bg-amber-400 text-white font-semibold rounded-xl text-sm transition">
                  <FiEye /> Full Profile &amp; Analytics
                </Link>
                {selected.phone && (
                  <a href={`https://wa.me/91${selected.phone.replace(/\D/g,'')}?text=${encodeURIComponent(`Hi ${selected.name}! Greetings from Tulsi Bridal Jewellery 💛`)}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 w-full px-4 py-3 bg-green-500 hover:bg-green-400 text-white font-semibold rounded-xl text-sm transition">
                    <FiPhone /> WhatsApp Message
                  </a>
                )}
                <a href={`mailto:${selected.email}?subject=Greetings from Tulsi Bridal Jewellery`}
                  className="flex items-center gap-3 w-full px-4 py-3 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded-xl text-sm transition">
                  <FiMail /> Send Email
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
