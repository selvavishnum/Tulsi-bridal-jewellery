'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { FiSearch, FiPackage, FiCheckCircle, FiTruck, FiBox, FiXCircle, FiClock } from 'react-icons/fi';
import { formatPrice } from '@/lib/utils';
import { format } from 'date-fns';

const STEPS = [
  { key: 'pending',    label: 'Order Received',   icon: FiClock,        desc: 'We have received your order' },
  { key: 'confirmed',  label: 'Order Confirmed',  icon: FiCheckCircle,  desc: 'Your order is confirmed' },
  { key: 'processing', label: 'Being Prepared',   icon: FiBox,          desc: 'We are preparing your jewellery' },
  { key: 'shipped',    label: 'Out for Delivery',  icon: FiTruck,        desc: 'Your order is on the way' },
  { key: 'delivered',  label: 'Delivered',         icon: FiCheckCircle,  desc: 'Order delivered successfully' },
];

const STEP_ORDER = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];

function TrackOrderContent() {
  const searchParams = useSearchParams();
  const [orderNumber, setOrderNumber] = useState(searchParams.get('orderNumber') || '');
  const [email, setEmail]             = useState(searchParams.get('email') || '');
  const [loading, setLoading]         = useState(false);
  const [order, setOrder]             = useState(null);
  const [error, setError]             = useState('');

  useEffect(() => {
    if (searchParams.get('orderNumber') && searchParams.get('email')) {
      handleTrack(null, searchParams.get('orderNumber'), searchParams.get('email'));
    }
  }, []);

  async function handleTrack(e, prefillNum, prefillEmail) {
    if (e) e.preventDefault();
    const num = prefillNum || orderNumber;
    const mail = prefillEmail || email;
    if (!num || !mail) return;
    setLoading(true);
    setError('');
    setOrder(null);
    try {
      const res = await fetch(`/api/track-order?orderNumber=${encodeURIComponent(num)}&email=${encodeURIComponent(mail)}`);
      const data = await res.json();
      if (data.success) {
        setOrder(data.data);
      } else {
        setError(data.message || 'Order not found');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const currentStepIndex = order ? STEP_ORDER.indexOf(order.status) : -1;
  const isCancelled = order?.status === 'cancelled';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero */}
      <div className="bg-gradient-to-br from-maroon-950 to-maroon-800 text-white py-14">
        <div className="max-w-2xl mx-auto px-4 text-center">
          <FiPackage className="text-5xl mx-auto mb-4 text-gold-300" />
          <h1 className="font-serif text-3xl font-bold mb-2">Track Your Order</h1>
          <p className="text-maroon-200 text-sm">Enter your order number and email to see live status</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
        {/* Search form */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <form onSubmit={handleTrack} className="space-y-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block font-medium">Order Number</label>
              <input
                required
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value.trim())}
                placeholder="e.g. TBJ1234567890"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-500 font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block font-medium">Email Address</label>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value.trim())}
                placeholder="Email you used while ordering"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-maroon-950 text-white font-bold rounded-xl hover:bg-maroon-900 disabled:opacity-60 transition flex items-center justify-center gap-2"
            >
              <FiSearch /> {loading ? 'Searching...' : 'Track Order'}
            </button>
          </form>

          {error && (
            <div className="mt-4 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
              <FiXCircle className="flex-shrink-0" /> {error}
            </div>
          )}
        </div>

        {/* Order result */}
        {order && (
          <div className="space-y-4">
            {/* Order header */}
            <div className="bg-white rounded-2xl shadow-sm p-5 flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-xs text-gray-400">Order Number</p>
                <p className="font-bold text-gray-800 font-mono text-lg">#{order.orderNumber}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Placed on {order.createdAt ? format(new Date(order.createdAt), 'dd MMM yyyy, hh:mm a') : '—'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-400">Order Total</p>
                <p className="font-bold text-maroon-950 text-lg">{formatPrice(order.total)}</p>
                <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                  isCancelled ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'
                } capitalize`}>
                  {order.status}
                </span>
              </div>
            </div>

            {/* Status timeline */}
            <div className="bg-white rounded-2xl shadow-sm p-6">
              <h2 className="font-bold text-gray-700 mb-5">Order Status</h2>

              {isCancelled ? (
                <div className="flex items-center gap-3 bg-red-50 border border-red-100 rounded-xl p-4">
                  <FiXCircle className="text-red-500 text-2xl flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-red-700">Order Cancelled</p>
                    <p className="text-sm text-red-500">This order has been cancelled. Contact us for help.</p>
                  </div>
                </div>
              ) : (
                <div className="relative">
                  {/* Vertical connector line */}
                  <div className="absolute left-5 top-5 bottom-5 w-0.5 bg-gray-100" />

                  <div className="space-y-6">
                    {STEPS.map((step, index) => {
                      const done    = index <= currentStepIndex;
                      const current = index === currentStepIndex;
                      const Icon    = step.icon;
                      return (
                        <div key={step.key} className="relative flex items-start gap-4 pl-0">
                          {/* Circle */}
                          <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-all ${
                            done
                              ? current
                                ? 'bg-maroon-950 border-maroon-950 text-white shadow-lg scale-110'
                                : 'bg-green-500 border-green-500 text-white'
                              : 'bg-white border-gray-200 text-gray-300'
                          }`}>
                            <Icon className="text-base" />
                          </div>
                          {/* Text */}
                          <div className="pt-1.5">
                            <p className={`font-semibold text-sm ${done ? (current ? 'text-maroon-950' : 'text-green-700') : 'text-gray-400'}`}>
                              {step.label}
                              {current && <span className="ml-2 text-xs bg-maroon-100 text-maroon-700 px-2 py-0.5 rounded-full">Current</span>}
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
              )}
            </div>

            {/* Items */}
            <div className="bg-white rounded-2xl shadow-sm p-5">
              <h2 className="font-bold text-gray-700 mb-4">Items Ordered</h2>
              <div className="space-y-3">
                {(order.items || []).map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    {item.image && (
                      <img src={item.image} alt={item.name} className="w-12 h-12 object-cover rounded-lg bg-gray-100 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 text-sm truncate">{item.name}</p>
                      <p className="text-xs text-gray-400">Qty: {item.quantity}</p>
                    </div>
                    <p className="font-semibold text-gray-800 text-sm">{formatPrice((item.price || 0) * item.quantity)}</p>
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-100 mt-4 pt-3 space-y-1.5 text-sm">
                {order.discount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount</span><span>-{formatPrice(order.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-500">
                  <span>Shipping</span>
                  <span>{order.shippingCost === 0 ? 'FREE' : formatPrice(order.shippingCost)}</span>
                </div>
                <div className="flex justify-between font-bold text-gray-800 text-base">
                  <span>Total</span><span>{formatPrice(order.total)}</span>
                </div>
              </div>
            </div>

            {/* Delivery address */}
            {order.shippingAddress?.city && (
              <div className="bg-white rounded-2xl shadow-sm p-5">
                <h2 className="font-bold text-gray-700 mb-2">Delivering To</h2>
                <p className="text-sm text-gray-600">
                  {order.shippingAddress.name && <span className="font-semibold">{order.shippingAddress.name}, </span>}
                  {order.shippingAddress.city}, {order.shippingAddress.state} — {order.shippingAddress.pincode}
                </p>
              </div>
            )}

            {/* Help */}
            <div className="bg-gold-50 border border-gold-100 rounded-2xl p-5 text-center">
              <p className="text-sm text-gray-600 mb-2">Need help with your order?</p>
              <Link href="/contact" className="text-sm font-semibold text-maroon-950 hover:underline">Contact Us →</Link>
            </div>
          </div>
        )}

        {!order && !error && !loading && (
          <div className="text-center text-gray-400 text-sm py-4">
            Your order number is in the confirmation email you received after placing the order.
          </div>
        )}
      </div>
    </div>
  );
}

export default function TrackOrderPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="text-gray-400">Loading...</div></div>}>
      <TrackOrderContent />
    </Suspense>
  );
}
