'use client';

import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  FiUser, FiShoppingBag, FiLogOut, FiMail, FiPackage,
  FiChevronDown, FiChevronUp, FiCheckCircle, FiTruck, FiBox, FiClock, FiXCircle,
} from 'react-icons/fi';
import { formatPrice } from '@/lib/utils';
import { format } from 'date-fns';
import Badge from '@/components/ui/Badge';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

const STATUS_BADGE = {
  pending: 'warning', confirmed: 'success', processing: 'gold',
  shipped: 'gold', delivered: 'success', cancelled: 'danger',
};

const STEPS = [
  { key: 'pending',    label: 'Order Received',  icon: FiClock,        desc: 'We have received your order' },
  { key: 'confirmed',  label: 'Order Confirmed', icon: FiCheckCircle,  desc: 'Your order is confirmed' },
  { key: 'processing', label: 'Being Prepared',  icon: FiBox,          desc: 'We are preparing your jewellery' },
  { key: 'shipped',    label: 'Out for Delivery', icon: FiTruck,       desc: 'Your order is on the way' },
  { key: 'delivered',  label: 'Delivered',        icon: FiCheckCircle, desc: 'Order delivered successfully' },
];
const STEP_ORDER = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];

function OrderTimeline({ order }) {
  const currentIdx = STEP_ORDER.indexOf(order.status);
  const isCancelled = order.status === 'cancelled';

  if (isCancelled) {
    return (
      <div className="flex items-center gap-3 bg-red-50 border border-red-100 rounded-xl p-4">
        <FiXCircle className="text-red-500 text-2xl flex-shrink-0" />
        <div>
          <p className="font-semibold text-red-700">Order Cancelled</p>
          <p className="text-sm text-red-500">This order has been cancelled. Contact us for help.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="absolute left-5 top-5 bottom-5 w-0.5 bg-gray-100" />
      <div className="space-y-5">
        {STEPS.map((step, index) => {
          const done    = index <= currentIdx;
          const current = index === currentIdx;
          const Icon    = step.icon;
          return (
            <div key={step.key} className="relative flex items-start gap-4">
              <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-all ${
                done
                  ? current
                    ? 'bg-maroon-950 border-maroon-950 text-white shadow-md scale-110'
                    : 'bg-green-500 border-green-500 text-white'
                  : 'bg-white border-gray-200 text-gray-300'
              }`}>
                <Icon className="text-base" />
              </div>
              <div className="pt-1.5">
                <p className={`font-semibold text-sm ${done ? (current ? 'text-maroon-950' : 'text-green-700') : 'text-gray-400'}`}>
                  {step.label}
                  {current && <span className="ml-2 text-xs bg-maroon-100 text-maroon-700 px-2 py-0.5 rounded-full">Now</span>}
                </p>
                <p className={`text-xs mt-0.5 ${done ? 'text-gray-500' : 'text-gray-300'}`}>{step.desc}</p>
                {step.key === 'delivered' && order.deliveredAt && (
                  <p className="text-xs text-green-600 mt-0.5">{format(new Date(order.deliveredAt), 'dd MMM yyyy, hh:mm a')}</p>
                )}
                {step.key === 'shipped' && order.trackingNumber && (
                  <p className="text-xs text-blue-600 mt-0.5">Tracking: <span className="font-mono">{order.trackingNumber}</span></p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AccountPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [orders, setOrders]           = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [tab, setTab]                 = useState('orders');
  const [expandedId, setExpandedId]   = useState(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [status, router]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/orders?limit=50')
      .then((r) => r.json())
      .then((d) => { if (d.success) setOrders(d.data.orders || []); })
      .catch(() => {})
      .finally(() => setLoadingOrders(false));
  }, [status]);

  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center"><LoadingSpinner size="lg" /></div>;
  }
  if (status === 'unauthenticated') return null;

  const user = session?.user;
  const initials = (user?.name || user?.email || 'U').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  function toggleOrder(id) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

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
            <button onClick={() => signOut({ callbackUrl: '/' })} className="ml-auto flex items-center gap-1.5 text-maroon-200 hover:text-white text-sm transition">
              <FiLogOut /> Sign Out
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Tabs */}
        <div className="flex gap-1 bg-white rounded-xl shadow-sm p-1 mb-6">
          {[
            { id: 'orders',  label: 'My Orders', icon: FiShoppingBag },
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
            ) : orders.map((o) => {
              const oid       = o.id || o._id;
              const isOpen    = expandedId === oid;

              return (
                <div key={oid} className="bg-white rounded-xl shadow-sm overflow-hidden">
                  {/* Clickable header row */}
                  <button
                    onClick={() => toggleOrder(oid)}
                    className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50/60 transition text-left"
                  >
                    <div>
                      <p className="font-bold text-gray-800 text-sm">Order #{o.orderNumber}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {o.createdAt ? format(new Date(o.createdAt), 'dd MMM yyyy, hh:mm a') : '—'}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="font-bold text-gray-800">{formatPrice(o.total)}</p>
                        <Badge variant={STATUS_BADGE[o.status] || 'default'}>{o.status}</Badge>
                      </div>
                      {isOpen
                        ? <FiChevronUp className="text-gray-400 text-lg flex-shrink-0" />
                        : <FiChevronDown className="text-gray-400 text-lg flex-shrink-0" />}
                    </div>
                  </button>

                  {/* Collapsed: show items summary */}
                  {!isOpen && (
                    <div className="px-5 pb-4 border-t border-gray-50">
                      {(o.items || []).map((item, i) => (
                        <div key={i} className="flex justify-between text-sm py-1">
                          <span className="text-gray-600">{item.name} × {item.quantity}</span>
                          <span className="font-semibold text-gray-800">{formatPrice((item.price || 0) * item.quantity)}</span>
                        </div>
                      ))}
                      {o.shippingAddress?.city && (
                        <p className="text-xs text-gray-400 mt-2">
                          Delivering to: {o.shippingAddress.name || o.shippingAddress.fullName}, {o.shippingAddress.city}, {o.shippingAddress.state}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Expanded: full timeline + details */}
                  {isOpen && (
                    <div className="border-t border-gray-100">
                      {/* Status timeline */}
                      <div className="px-5 py-5">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">Order Status</p>
                        <OrderTimeline order={o} />
                      </div>

                      {/* Items detail */}
                      <div className="px-5 py-4 bg-gray-50/60 border-t border-gray-100">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Items Ordered</p>
                        <div className="space-y-2">
                          {(o.items || []).map((item, i) => (
                            <div key={i} className="flex items-center gap-3">
                              {item.image && (
                                <img src={item.image} alt={item.name} className="w-10 h-10 object-cover rounded-lg bg-gray-200 flex-shrink-0" />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-800 text-sm truncate">{item.name}</p>
                                <p className="text-xs text-gray-400">Qty: {item.quantity}</p>
                              </div>
                              <p className="font-semibold text-gray-800 text-sm">{formatPrice((item.price || 0) * item.quantity)}</p>
                            </div>
                          ))}
                        </div>
                        <div className="border-t border-gray-200 mt-3 pt-3 space-y-1 text-sm">
                          {o.discount > 0 && (
                            <div className="flex justify-between text-green-600">
                              <span>Discount</span><span>-{formatPrice(o.discount)}</span>
                            </div>
                          )}
                          <div className="flex justify-between text-gray-500">
                            <span>Shipping</span>
                            <span>{o.shippingCost === 0 ? 'FREE' : formatPrice(o.shippingCost)}</span>
                          </div>
                          <div className="flex justify-between font-bold text-gray-800">
                            <span>Total</span><span>{formatPrice(o.total)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Delivery address + payment */}
                      <div className="px-5 py-4 border-t border-gray-100 flex flex-col sm:flex-row gap-4">
                        {o.shippingAddress?.city && (
                          <div className="flex-1">
                            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Delivering To</p>
                            <p className="text-sm text-gray-700 leading-relaxed">
                              <span className="font-semibold">{o.shippingAddress.name || o.shippingAddress.fullName}</span><br />
                              {o.shippingAddress.street && <>{o.shippingAddress.street}<br /></>}
                              {o.shippingAddress.city}, {o.shippingAddress.state} – {o.shippingAddress.pincode}
                            </p>
                          </div>
                        )}
                        <div className="flex-1">
                          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Payment</p>
                          <p className="text-sm text-gray-700 capitalize">
                            {o.payment?.method === 'cod' ? 'Cash on Delivery' : 'Online (Razorpay)'}
                          </p>
                          <p className={`text-xs mt-0.5 font-semibold ${o.payment?.status === 'paid' ? 'text-green-600' : 'text-yellow-600'}`}>
                            {o.payment?.status === 'paid' ? 'Payment Received' : 'Payment Pending'}
                          </p>
                        </div>
                      </div>

                      {/* Help link */}
                      <div className="px-5 py-3 border-t border-gray-100 bg-gold-50/50 flex items-center justify-between">
                        <p className="text-xs text-gray-500">Need help with this order?</p>
                        <Link href="/contact" className="text-xs font-semibold text-maroon-950 hover:underline">Contact Us →</Link>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
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
