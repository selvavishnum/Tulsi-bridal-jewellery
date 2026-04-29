'use client';

import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FiUser, FiShoppingBag, FiHeart, FiLogOut, FiMail, FiPhone, FiPackage } from 'react-icons/fi';
import { formatPrice } from '@/lib/utils';
import { format } from 'date-fns';
import Badge from '@/components/ui/Badge';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

const STATUS_BADGE = {
  pending: 'warning', confirmed: 'success', processing: 'gold',
  shipped: 'gold', delivered: 'success', cancelled: 'danger',
};

export default function AccountPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [tab, setTab] = useState('orders');

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [status, router]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/orders?limit=20')
      .then((r) => r.json())
      .then((d) => { if (d.success) setOrders(d.data.orders || []); })
      .catch(() => {})
      .finally(() => setLoadingOrders(false));
  }, [status]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (status === 'unauthenticated') return null;

  const user = session?.user;
  const initials = (user?.name || user?.email || 'U').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-maroon-950 text-white py-10">
        <div className="max-w-4xl mx-auto px-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gold-600/30 border-2 border-gold-400/40 flex items-center justify-center flex-shrink-0">
              <span className="text-2xl font-bold text-gold-300">{initials}</span>
            </div>
            <div>
              <h1 className="text-xl font-bold">{user?.name || 'My Account'}</h1>
              <p className="text-maroon-200 text-sm flex items-center gap-1.5 mt-0.5">
                <FiMail className="text-xs" /> {user?.email}
              </p>
              {user?.role === 'admin' && (
                <Link href="/admin" className="inline-flex items-center gap-1 mt-1.5 text-xs bg-gold-600/20 text-gold-300 border border-gold-600/30 px-2.5 py-0.5 rounded-full hover:bg-gold-600/30 transition">
                  Admin Panel →
                </Link>
              )}
            </div>
            <button
              onClick={() => signOut({ callbackUrl: '/' })}
              className="ml-auto flex items-center gap-1.5 text-maroon-200 hover:text-white text-sm transition"
            >
              <FiLogOut /> Sign Out
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Tabs */}
        <div className="flex gap-1 bg-white rounded-xl shadow-sm p-1 mb-6">
          {[
            { id: 'orders', label: 'My Orders', icon: FiShoppingBag },
            { id: 'profile', label: 'Profile',   icon: FiUser },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition ${
                tab === t.id ? 'bg-maroon-950 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <t.icon className="text-base" /> {t.label}
            </button>
          ))}
        </div>

        {/* Orders tab */}
        {tab === 'orders' && (
          <div className="space-y-3">
            {loadingOrders ? (
              <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
            ) : orders.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center shadow-sm">
                <FiPackage className="text-5xl text-gray-200 mx-auto mb-4" />
                <p className="text-gray-500 font-semibold">No orders yet</p>
                <p className="text-gray-400 text-sm mt-1 mb-5">Browse our collection and place your first order</p>
                <Link href="/catalog" className="px-6 py-2.5 bg-maroon-950 text-white text-sm font-semibold rounded-xl hover:bg-maroon-900 transition">
                  Shop Now
                </Link>
              </div>
            ) : orders.map((o) => (
              <div key={o.id || o._id} className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-4 flex items-center justify-between border-b border-gray-50">
                  <div>
                    <p className="font-bold text-gray-800 text-sm">Order #{o.orderNumber}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {o.createdAt ? format(new Date(o.createdAt), 'dd MMM yyyy, hh:mm a') : '—'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-gray-800">{formatPrice(o.total)}</p>
                    <Badge variant={STATUS_BADGE[o.status] || 'default'}>{o.status}</Badge>
                  </div>
                </div>
                <div className="px-5 py-3">
                  {(o.items || []).map((item, i) => (
                    <div key={i} className="flex justify-between text-sm py-1">
                      <span className="text-gray-700">{item.name} × {item.quantity}</span>
                      <span className="font-semibold text-gray-800">{formatPrice((item.price || 0) * item.quantity)}</span>
                    </div>
                  ))}
                </div>
                {o.shippingAddress && (
                  <div className="px-5 py-3 bg-gray-50 text-xs text-gray-500">
                    Delivering to: {o.shippingAddress.name}, {o.shippingAddress.city}, {o.shippingAddress.state}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Profile tab */}
        {tab === 'profile' && (
          <div className="bg-white rounded-xl shadow-sm p-6 space-y-5">
            <h2 className="font-bold text-gray-800">Account Details</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1 flex items-center gap-1"><FiUser /> Name</p>
                <p className="font-semibold text-gray-800">{user?.name || '—'}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1 flex items-center gap-1"><FiMail /> Email</p>
                <p className="font-semibold text-gray-800">{user?.email || '—'}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">Account Type</p>
                <p className="font-semibold text-gray-800 capitalize">{user?.role || 'Customer'}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">Total Orders</p>
                <p className="font-semibold text-gray-800">{orders.length}</p>
              </div>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: '/' })}
              className="flex items-center gap-2 px-5 py-2.5 bg-red-50 text-red-600 border border-red-100 rounded-xl text-sm font-semibold hover:bg-red-100 transition"
            >
              <FiLogOut /> Sign Out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
