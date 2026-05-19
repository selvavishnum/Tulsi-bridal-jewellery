'use client';

import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  FiUser, FiShoppingBag, FiLogOut, FiMail, FiPackage,
  FiChevronDown, FiChevronUp, FiCheckCircle, FiTruck, FiBox, FiClock, FiXCircle, FiAlertTriangle,
  FiRotateCcw,
} from 'react-icons/fi';
import toast from 'react-hot-toast';
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
  const [cancelling, setCancelling]   = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(null);
  const [returnModal, setReturnModal] = useState(null); // orderId
  const [returnReason, setReturnReason] = useState('');
  const [returnDesc, setReturnDesc]   = useState('');
  const [submittingReturn, setSubmittingReturn] = useState(false);
  const [returnedOrders, setReturnedOrders] = useState(new Set());
  const [profile, setProfile]       = useState({ phone: '', city: '', birthday: '', weddingDate: '' });
  const [savingProfile, setSaving]  = useState(false);
  const [loyalty, setLoyalty]       = useState({ points: 0, transactions: [] });
  const [settings, setSettings]     = useState({ loyaltyEnabled: false, referralEnabled: false });
  const [referralCode, setReferralCode] = useState('');
  const [referralInput, setReferralInput] = useState('');
  const [applyingReferral, setApplyingReferral] = useState(false);
  const [copied, setCopied]         = useState(false);

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

  useEffect(() => {
    if (status !== 'authenticated') return;
    // Track session
    fetch('/api/auth/track-session', { method: 'POST' }).catch(() => {});
    // Load loyalty points
    fetch('/api/loyalty').then((r) => r.json()).then((d) => { if (d.success) setLoyalty(d.data); }).catch(() => {});
    // Load site settings (loyalty/referral enabled flags)
    fetch('/api/admin/settings').then((r) => r.json()).then((d) => {
      if (d.success && d.data) setSettings({ loyaltyEnabled: !!d.data.loyaltyEnabled, referralEnabled: !!d.data.referralEnabled });
    }).catch(() => {});
  }, [status]);

  useEffect(() => {
    // Set profile fields and referral code from session
    if (session?.user) {
      setReferralCode(session.user.referralCode || '');
    }
  }, [session]);

  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center"><LoadingSpinner size="lg" /></div>;
  }
  if (status === 'unauthenticated') return null;

  const user = session?.user;
  const initials = (user?.name || user?.email || 'U').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  function toggleOrder(id) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  async function cancelOrder(oid) {
    setCancelling(oid);
    try {
      const res = await fetch(`/api/orders/${oid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Order cancelled successfully');
        setOrders((prev) => prev.map((o) => (o.id === oid || o._id === oid) ? { ...o, status: 'cancelled' } : o));
      } else {
        toast.error(data.message || 'Could not cancel order');
      }
    } catch {
      toast.error('Something went wrong');
    } finally {
      setCancelling(null);
      setConfirmCancel(null);
    }
  }

  function withinReturnWindow(order) {
    const ref = order.deliveredAt || order.updatedAt || order.createdAt;
    if (!ref) return false;
    return Date.now() - new Date(ref).getTime() <= 3 * 24 * 60 * 60 * 1000;
  }

  async function submitReturn(order) {
    if (!returnReason) { toast.error('Please select a reason'); return; }
    setSubmittingReturn(true);
    try {
      const res = await fetch('/api/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id || order._id,
          reason: returnReason,
          description: returnDesc,
          items: order.items,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Return request submitted! We will contact you soon.');
        setReturnedOrders((prev) => new Set([...prev, order.id || order._id]));
        setReturnModal(null);
        setReturnReason('');
        setReturnDesc('');
      } else {
        toast.error(data.message || 'Failed to submit');
      }
    } catch { toast.error('Something went wrong'); }
    finally { setSubmittingReturn(false); }
  }

  async function saveProfile(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/auth/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      const data = await res.json();
      if (data.success) toast.success('Profile updated!');
      else toast.error(data.message);
    } catch { toast.error('Failed to save profile'); }
    finally { setSaving(false); }
  }

  async function applyReferral() {
    if (!referralInput.trim()) return;
    setApplyingReferral(true);
    try {
      const res = await fetch('/api/referral/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referralCode: referralInput.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
        setLoyalty((prev) => ({ ...prev, points: prev.points + 20 }));
        setReferralInput('');
      } else {
        toast.error(data.message);
      }
    } catch { toast.error('Failed to apply referral code'); }
    finally { setApplyingReferral(false); }
  }

  function copyReferralCode() {
    if (!referralCode) return;
    navigator.clipboard.writeText(referralCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
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
            { id: 'orders', label: orders.length ? `My Orders (${orders.length})` : 'My Orders', icon: FiShoppingBag },
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

                      {/* Cancel button — only for pending/confirmed */}
                      {['pending', 'confirmed'].includes(o.status) && (
                        <div className="px-5 py-4 border-t border-gray-100">
                          {confirmCancel === oid ? (
                            <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                              <p className="text-sm font-semibold text-red-700 flex items-center gap-2 mb-1">
                                <FiAlertTriangle /> Cancel this order?
                              </p>
                              <p className="text-xs text-red-500 mb-3">This action cannot be undone. Your order will be cancelled.</p>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => cancelOrder(oid)}
                                  disabled={cancelling === oid}
                                  className="flex-1 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 disabled:opacity-60 transition"
                                >
                                  {cancelling === oid ? 'Cancelling…' : 'Yes, Cancel Order'}
                                </button>
                                <button
                                  onClick={() => setConfirmCancel(null)}
                                  className="flex-1 py-2 border border-gray-200 text-gray-600 text-sm font-semibold rounded-lg hover:bg-gray-50 transition"
                                >
                                  Keep Order
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmCancel(oid)}
                              className="w-full py-2.5 border border-red-200 text-red-600 text-sm font-semibold rounded-xl hover:bg-red-50 transition flex items-center justify-center gap-2"
                            >
                              <FiXCircle /> Cancel Order
                            </button>
                          )}
                        </div>
                      )}

                      {/* Return button — only for delivered orders within 3 days */}
                      {['delivered', 'shipped'].includes(o.status) && withinReturnWindow(o) && !returnedOrders.has(oid) && (
                        <div className="px-5 py-4 border-t border-gray-100">
                          <button
                            onClick={() => { setReturnModal(oid); setReturnReason(''); setReturnDesc(''); }}
                            className="w-full py-2.5 border border-amber-300 text-amber-700 bg-amber-50 text-sm font-semibold rounded-xl hover:bg-amber-100 transition flex items-center justify-center gap-2"
                          >
                            <FiRotateCcw /> Return / Refund Request
                          </button>
                          <p className="text-xs text-gray-400 text-center mt-1.5">Return window closes 3 days after delivery</p>
                        </div>
                      )}
                      {returnedOrders.has(oid) && (
                        <div className="px-5 py-3 border-t border-gray-100">
                          <p className="text-xs text-center text-green-600 font-semibold">✓ Return request submitted — we will contact you soon</p>
                        </div>
                      )}

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

        {/* Return Modal */}
        {returnModal && (() => {
          const order = orders.find((o) => (o.id || o._id) === returnModal);
          if (!order) return null;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <h2 className="font-bold text-gray-800">Return / Refund Request</h2>
                    <p className="text-xs text-gray-400 mt-0.5">Order #{order.orderNumber}</p>
                  </div>
                  <button onClick={() => setReturnModal(null)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition">
                    <FiXCircle />
                  </button>
                </div>
                <div className="px-6 py-5 space-y-4">
                  {/* Items summary */}
                  <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
                    {(order.items || []).map((item, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-gray-700">{item.name} × {item.quantity}</span>
                        <span className="font-semibold text-gray-800">{formatPrice((item.price || 0) * item.quantity)}</span>
                      </div>
                    ))}
                    <div className="border-t border-gray-200 pt-1.5 flex justify-between font-bold text-sm">
                      <span>Refund Amount</span>
                      <span className="text-maroon-950">{formatPrice(order.total)}</span>
                    </div>
                  </div>
                  {/* Reason */}
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">
                      Reason for Return <span className="text-red-400">*</span>
                    </label>
                    <select
                      value={returnReason}
                      onChange={(e) => setReturnReason(e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                    >
                      <option value="">Select reason…</option>
                      <option value="wrong_item">Wrong Item Received</option>
                      <option value="damaged">Damaged / Defective</option>
                      <option value="quality_issue">Quality Issue</option>
                      <option value="not_as_shown">Not as Shown Online</option>
                      <option value="size_issue">Size / Fit Issue</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  {/* Description */}
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Description (optional)</label>
                    <textarea
                      value={returnDesc}
                      onChange={(e) => setReturnDesc(e.target.value)}
                      rows={3}
                      placeholder="Describe the issue in detail…"
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                    />
                  </div>
                  <p className="text-xs text-gray-400 bg-amber-50 rounded-lg px-3 py-2 border border-amber-100">
                    After submitting, our team will review your request and contact you within 24 hours.
                  </p>
                </div>
                <div className="px-6 pb-5 flex gap-3">
                  <button
                    onClick={() => submitReturn(order)}
                    disabled={submittingReturn}
                    className="flex-1 py-2.5 bg-maroon-950 text-white text-sm font-bold rounded-xl hover:bg-maroon-900 disabled:opacity-50 transition flex items-center justify-center gap-2"
                  >
                    {submittingReturn ? <LoadingSpinner size="sm" /> : <FiRotateCcw />}
                    Submit Return Request
                  </button>
                  <button onClick={() => setReturnModal(null)} className="px-5 py-2.5 border border-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-50 transition">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Profile tab */}
        {tab === 'profile' && (
          <div className="space-y-4">
            {/* Loyalty Points Card */}
            {settings.loyaltyEnabled && (
              <div className="bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🏆</span>
                    <div>
                      <p className="font-bold text-gray-800">Loyalty Points</p>
                      <p className="text-xs text-gray-500">₹100 spent = 1 point · 50 points = ₹50 off</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-bold text-amber-600">{loyalty.points}</p>
                    <p className="text-xs text-amber-700 font-semibold">points</p>
                  </div>
                </div>
                {loyalty.points >= 50 && (
                  <div className="bg-amber-100 rounded-lg px-3 py-2 text-xs text-amber-800 font-medium">
                    ✨ You can redeem ₹{Math.floor(loyalty.points / 50) * 50} discount on your next order!
                  </div>
                )}
                {loyalty.transactions.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Recent Activity</p>
                    {loyalty.transactions.slice(0, 4).map((tx) => (
                      <div key={tx.id} className="flex justify-between text-xs text-gray-600">
                        <span>{tx.description}</span>
                        <span className={tx.points > 0 ? 'text-green-600 font-semibold' : 'text-red-500 font-semibold'}>
                          {tx.points > 0 ? '+' : ''}{tx.points} pts
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Referral Card */}
            {settings.referralEnabled && (
              <div className="bg-gradient-to-r from-purple-50 to-violet-50 border border-purple-200 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl">🔁</span>
                  <div>
                    <p className="font-bold text-gray-800">Refer a Friend</p>
                    <p className="text-xs text-gray-500">Both you and your friend earn 20 loyalty points!</p>
                  </div>
                </div>
                {referralCode ? (
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Your referral code</p>
                    <div className="flex gap-2">
                      <div className="flex-1 bg-white border border-purple-200 rounded-lg px-3 py-2 font-mono font-bold text-purple-700 tracking-widest text-sm">
                        {referralCode}
                      </div>
                      <button onClick={copyReferralCode} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg transition">
                        {copied ? '✓ Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 bg-white rounded-lg px-3 py-2 border border-purple-100">Your referral code will appear here after your first order.</p>
                )}
                <div className="mt-3 border-t border-purple-100 pt-3">
                  <p className="text-xs text-gray-500 mb-1">Have a friend's referral code?</p>
                  <div className="flex gap-2">
                    <input
                      value={referralInput}
                      onChange={(e) => setReferralInput(e.target.value.toUpperCase())}
                      placeholder="Enter referral code"
                      className="flex-1 px-3 py-2 border border-purple-200 rounded-lg text-sm font-mono outline-none focus:ring-2 focus:ring-purple-400 bg-white uppercase"
                    />
                    <button onClick={applyReferral} disabled={applyingReferral} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg disabled:opacity-60 transition">
                      {applyingReferral ? 'Applying…' : 'Apply'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Profile Edit Form */}
            <form onSubmit={saveProfile} className="bg-white rounded-xl shadow-sm p-6 space-y-5">
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
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block font-medium">Phone / WhatsApp</label>
                  <input
                    type="tel"
                    value={profile.phone}
                    onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                    placeholder="e.g. 9876543210"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block font-medium">City</label>
                  <input
                    value={profile.city}
                    onChange={(e) => setProfile((p) => ({ ...p, city: e.target.value }))}
                    placeholder="e.g. Chennai"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block font-medium">🎂 Birthday</label>
                  <input
                    type="date"
                    value={profile.birthday}
                    onChange={(e) => setProfile((p) => ({ ...p, birthday: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block font-medium">💍 Wedding Date</label>
                  <input
                    type="date"
                    value={profile.weddingDate}
                    onChange={(e) => setProfile((p) => ({ ...p, weddingDate: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">We'll send you special offers before your big day!</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button type="submit" disabled={savingProfile} className="px-6 py-2.5 bg-maroon-950 text-white text-sm font-semibold rounded-xl hover:bg-maroon-900 disabled:opacity-60 transition">
                  {savingProfile ? 'Saving…' : 'Save Profile'}
                </button>
                <button type="button" onClick={() => signOut({ callbackUrl: '/' })} className="flex items-center gap-2 px-5 py-2.5 bg-red-50 text-red-600 border border-red-100 rounded-xl text-sm font-semibold hover:bg-red-100 transition">
                  <FiLogOut /> Sign Out
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
