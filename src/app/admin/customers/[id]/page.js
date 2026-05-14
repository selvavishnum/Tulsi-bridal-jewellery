'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { format, parseISO, isValid } from 'date-fns';
import {
  FiArrowLeft, FiPhone, FiMail, FiUser, FiShoppingBag,
  FiClock, FiEye, FiShoppingCart, FiExternalLink,
} from 'react-icons/fi';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import Badge from '@/components/ui/Badge';
import { formatPrice } from '@/lib/utils';

function Avatar({ name, size = 'md' }) {
  const initials = (name || '?').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  const colors = ['bg-maroon-100 text-maroon-800', 'bg-blue-100 text-blue-800', 'bg-green-100 text-green-800', 'bg-purple-100 text-purple-800', 'bg-gold-100 text-gold-800'];
  const color = colors[initials.charCodeAt(0) % colors.length];
  const sz = size === 'lg' ? 'w-16 h-16 text-2xl' : size === 'md' ? 'w-10 h-10 text-sm' : 'w-8 h-8 text-xs';
  return (
    <div className={`${sz} ${color} rounded-full flex items-center justify-center font-bold flex-shrink-0`}>{initials}</div>
  );
}

function getSegmentBadge(user, totalOrders, totalSpent) {
  if (user.weddingDate) return { label: '👑 Bride', color: 'bg-pink-100 text-pink-800' };
  if ((totalSpent || 0) >= 5000) return { label: '💎 VIP', color: 'bg-yellow-100 text-yellow-800' };
  if ((totalOrders || 0) >= 2) return { label: '🔄 Repeat', color: 'bg-blue-100 text-blue-800' };
  if ((user.loginCount || 0) >= 5 && (totalOrders || 0) === 0) return { label: '🛍️ Window Shopper', color: 'bg-purple-100 text-purple-800' };
  if ((totalOrders || 0) === 0) return { label: '🆕 New', color: 'bg-green-100 text-green-800' };
  return null;
}

function safeFormat(str, fmt = 'dd MMM yyyy, hh:mm a') {
  if (!str) return '—';
  try {
    const d = parseISO(str);
    if (!isValid(d)) return str;
    return format(d, fmt);
  } catch {
    return str;
  }
}

function formatDuration(totalSeconds) {
  if (!totalSeconds) return '—';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function getOrderStatusColor(status) {
  switch ((status || '').toLowerCase()) {
    case 'delivered': return 'success';
    case 'shipped': return 'info';
    case 'processing': return 'warning';
    case 'cancelled': return 'danger';
    default: return 'default';
  }
}

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`/api/admin/customers/${params.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setUser(d.user);
          setOrders(d.orders || []);
        } else {
          setError(d.message || 'Failed to load customer');
        }
      })
      .catch(() => setError('Failed to load customer'))
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="space-y-4">
        <Link href="/admin/customers" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition">
          <FiArrowLeft /> Back to Customers
        </Link>
        <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-500">
          {error || 'Customer not found'}
        </div>
      </div>
    );
  }

  const totalOrders = orders.length;
  const totalSpent = orders.reduce((s, o) => s + (o.total || 0), 0);
  const avgSessionMinutes = user.sessionCount
    ? Math.round((user.totalSessionSeconds || 0) / user.sessionCount / 60)
    : 0;
  const segmentBadge = getSegmentBadge(user, totalOrders, totalSpent);

  const recentPages = (user.recentPages || []).slice(-10).reverse();
  const categoryInterests = user.categoryInterests || {};
  const topCategories = Object.entries(categoryInterests)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const maxCount = topCategories[0]?.[1] || 1;

  const savedCart = user.savedCart || [];
  const cartReminderMsg = savedCart.length > 0
    ? `Hi ${user.name?.split(' ')[0] || 'there'}! You left some items in your cart at Tulsi Bridal Jewellery:\n${savedCart.map((item) => `• ${item.name} (Qty: ${item.quantity}) — ₹${item.discountPrice || item.price}`).join('\n')}\nComplete your order now! Visit: tulsibridal.com`
    : '';

  const recentOrders = [...orders].slice(0, 5);

  return (
    <div className="space-y-5">
      {/* Back button */}
      <Link
        href="/admin/customers"
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition font-medium"
      >
        <FiArrowLeft /> Back to Customers
      </Link>

      {/* Header card */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-start gap-4">
          <Avatar name={user.name} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-gray-800">{user.name || '—'}</h1>
              {segmentBadge && (
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${segmentBadge.color}`}>
                  {segmentBadge.label}
                </span>
              )}
              <Badge variant={user.isActive ? 'success' : 'danger'}>
                {user.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-4 mt-2 text-sm text-gray-500">
              <a href={`mailto:${user.email}`} className="flex items-center gap-1.5 hover:text-blue-600 transition">
                <FiMail className="flex-shrink-0" /> {user.email}
              </a>
              {user.phone && (
                <span className="flex items-center gap-1.5">
                  <FiPhone className="flex-shrink-0" /> {user.phone}
                </span>
              )}
              {user.city && (
                <span className="flex items-center gap-1.5">
                  <FiUser className="flex-shrink-0" /> {user.city}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 4 Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-xs text-gray-400 mb-1">Total Orders</p>
          <p className="text-2xl font-bold text-gray-800">{totalOrders}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-xs text-gray-400 mb-1">Total Spent</p>
          <p className="text-2xl font-bold text-amber-600">{totalSpent ? formatPrice(totalSpent) : '—'}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-xs text-gray-400 mb-1">Login Count</p>
          <p className="text-2xl font-bold text-gray-800">{user.loginCount || 0}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-xs text-gray-400 mb-1">Avg Session</p>
          <p className="text-2xl font-bold text-gray-800">{avgSessionMinutes ? `${avgSessionMinutes}m` : '—'}</p>
        </div>
      </div>

      {/* Session Info */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <FiClock className="text-amber-500" /> Session Info
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-400 mb-1">Last Login</p>
            <p className="text-sm font-semibold text-gray-700">{safeFormat(user.lastLoginAt)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-400 mb-1">Last Logout</p>
            <p className="text-sm font-semibold text-gray-700">{safeFormat(user.lastLogoutAt)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-400 mb-1">Total Session Time</p>
            <p className="text-sm font-semibold text-gray-700">{formatDuration(user.totalSessionSeconds)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-400 mb-1">Session Count</p>
            <p className="text-sm font-semibold text-gray-700">{user.sessionCount || 0}</p>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* Last Seen Product */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <FiEye className="text-amber-500" /> Last Seen Product
          </h2>
          {user.lastSeenProduct ? (
            <div className="flex items-center gap-4">
              {user.lastSeenProduct.image && (
                <img
                  src={user.lastSeenProduct.image}
                  alt={user.lastSeenProduct.name}
                  className="w-16 h-16 object-cover rounded-lg border border-gray-100 flex-shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-800 truncate">{user.lastSeenProduct.name}</p>
                <p className="text-sm text-amber-600 font-medium">
                  {user.lastSeenProduct.price ? formatPrice(user.lastSeenProduct.price) : '—'}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{safeFormat(user.lastSeenProduct.viewedAt)}</p>
              </div>
              {user.lastSeenProduct.slug && (
                <Link
                  href={`/products/${user.lastSeenProduct.slug}`}
                  target="_blank"
                  className="p-2 text-amber-500 hover:bg-amber-50 rounded-lg transition flex-shrink-0"
                  title="View Product"
                >
                  <FiExternalLink />
                </Link>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No product viewed yet</p>
          )}
        </div>

        {/* Abandoned Cart */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <FiShoppingCart className="text-amber-500" /> Abandoned Cart
          </h2>
          {savedCart.length > 0 ? (
            <>
              {user.cartUpdatedAt && (
                <p className="text-xs text-gray-400 mb-3">Last updated: {safeFormat(user.cartUpdatedAt)}</p>
              )}
              <div className="space-y-2 mb-4">
                {savedCart.map((item, i) => (
                  <div key={item._id || i} className="flex items-center gap-3">
                    {item.image && (
                      <img src={item.image} alt={item.name} className="w-10 h-10 object-cover rounded-lg border border-gray-100 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
                      <p className="text-xs text-gray-400">Qty: {item.quantity} · {formatPrice(item.discountPrice || item.price)}</p>
                    </div>
                  </div>
                ))}
              </div>
              {user.phone && (
                <a
                  href={`https://wa.me/91${user.phone.replace(/\D/g, '')}?text=${encodeURIComponent(cartReminderMsg)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-2.5 bg-green-500 hover:bg-green-400 text-white font-semibold rounded-lg text-sm transition"
                >
                  <FiPhone /> Send WhatsApp Reminder
                </a>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-400">No abandoned cart items</p>
          )}
        </div>
      </div>

      {/* Category Interests */}
      {topCategories.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="font-semibold text-gray-800 mb-4">Category Interests</h2>
          <div className="space-y-3">
            {topCategories.map(([category, count]) => (
              <div key={category} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-700 capitalize">{category}</span>
                  <span className="text-gray-400 text-xs">{count} views</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className="bg-amber-500 h-2 rounded-full transition-all"
                    style={{ width: `${Math.round((count / maxCount) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Pages */}
      {recentPages.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="font-semibold text-gray-800 mb-4">Recent Pages</h2>
          <div className="divide-y divide-gray-50">
            {recentPages.map((page, i) => (
              <div key={i} className="flex items-center justify-between py-2.5">
                <span className="text-sm text-gray-700 font-medium truncate max-w-xs">{page.path}</span>
                <span className="text-xs text-gray-400 flex-shrink-0 ml-4">{safeFormat(page.visitedAt, 'dd MMM, hh:mm a')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Order History */}
      {recentOrders.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <FiShoppingBag className="text-amber-500" /> Order History
          </h2>
          <div className="divide-y divide-gray-50">
            {recentOrders.map((order) => (
              <div key={order.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-semibold text-gray-800">#{(order.id || '').slice(-8).toUpperCase()}</p>
                  <p className="text-xs text-gray-400">{safeFormat(order.createdAt, 'dd MMM yyyy')}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-700">{formatPrice(order.total || 0)}</span>
                  <Badge variant={getOrderStatusColor(order.status)}>
                    {order.status || 'Pending'}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
