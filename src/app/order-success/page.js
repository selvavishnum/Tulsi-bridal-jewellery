'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { FiCheckCircle, FiPackage, FiMapPin, FiMail, FiPhone, FiShoppingBag, FiArrowRight } from 'react-icons/fi';

function fmt(amount) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount || 0);
}

function OrderSuccessContent() {
  const searchParams = useSearchParams();
  const orderNumber  = searchParams.get('orderNumber');
  const email        = searchParams.get('email');

  const [order, setOrder]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderNumber || !email) { setLoading(false); return; }
    fetch(`/api/track-order?orderNumber=${encodeURIComponent(orderNumber)}&email=${encodeURIComponent(email)}`)
      .then((r) => r.json())
      .then((d) => { if (d.success) setOrder(d.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [orderNumber, email]);

  const trackUrl = orderNumber && email
    ? `/track-order?orderNumber=${encodeURIComponent(orderNumber)}&email=${encodeURIComponent(email)}`
    : '/track-order';

  const addr = order?.shippingAddress || {};
  const name = addr.name || addr.fullName || '';

  return (
    <div className="min-h-screen bg-ivory py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-5">

        {/* ── Success header ── */}
        <div className="bg-white rounded-2xl shadow-card p-8 text-center">
          <div className="w-20 h-20 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
            <FiCheckCircle className="text-5xl text-green-500" />
          </div>
          <h1 className="font-serif text-3xl font-bold text-stone-800 mb-2">Order Placed! 🎉</h1>
          <p className="text-stone-500 text-sm">
            Thank you{name ? `, ${name}` : ''}! Your order has been received and is being processed.
          </p>
          {email && (
            <p className="text-stone-400 text-xs mt-2 flex items-center justify-center gap-1.5">
              <FiMail className="text-wine-600" />
              Confirmation email sent to <span className="font-semibold text-stone-600">{email}</span>
            </p>
          )}

          {/* Order number box */}
          <div className="mt-5 bg-gold-50 border border-gold-100 rounded-xl px-6 py-4 inline-block">
            <p className="text-xs text-stone-400 uppercase tracking-widest mb-1">Order Number</p>
            <p className="font-mono text-2xl font-bold text-wine-700">#{orderNumber || '—'}</p>
            <p className="text-xs text-stone-400 mt-1">Save this to track your order</p>
          </div>
        </div>

        {/* ── Order items ── */}
        {loading ? (
          <div className="bg-white rounded-2xl shadow-card p-6">
            <div className="space-y-3 animate-pulse">
              {[1, 2].map((i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-16 h-16 bg-stone-100 rounded-xl flex-shrink-0" />
                  <div className="flex-1 space-y-2 py-1">
                    <div className="h-3 bg-stone-100 rounded w-2/3" />
                    <div className="h-3 bg-stone-100 rounded w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : order?.items?.length > 0 && (
          <div className="bg-white rounded-2xl shadow-card p-6">
            <h2 className="font-serif text-lg font-bold text-stone-800 mb-4 flex items-center gap-2">
              <FiShoppingBag className="text-wine-600" /> Items Ordered
            </h2>
            <div className="divide-y divide-stone-100">
              {order.items.map((item, i) => (
                <div key={i} className="flex items-center gap-4 py-3">
                  {item.image ? (
                    <div className="relative w-16 h-16 rounded-xl overflow-hidden bg-stone-50 flex-shrink-0 border border-stone-100">
                      <Image src={item.image} alt={item.name} fill className="object-cover" />
                    </div>
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-stone-50 flex items-center justify-center flex-shrink-0 border border-stone-100">
                      <FiShoppingBag className="text-stone-300 text-xl" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-stone-800 text-sm truncate">{item.name}</p>
                    <p className="text-stone-400 text-xs mt-0.5">Qty: {item.quantity}</p>
                  </div>
                  <p className="font-bold text-wine-700 text-sm flex-shrink-0">
                    {fmt((item.price || 0) * item.quantity)}
                  </p>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="border-t border-stone-100 mt-3 pt-3 space-y-1.5">
              <div className="flex justify-between text-sm text-stone-500">
                <span>Subtotal</span>
                <span>{fmt(order.subtotal)}</span>
              </div>
              {order.discount > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>Discount</span>
                  <span>−{fmt(order.discount)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm text-stone-500">
                <span>Shipping</span>
                <span>{order.shippingCost === 0 ? 'FREE' : fmt(order.shippingCost)}</span>
              </div>
              <div className="flex justify-between font-bold text-stone-800 text-base border-t border-stone-100 pt-2 mt-1">
                <span>Total Paid</span>
                <span className="text-wine-700">{fmt(order.total)}</span>
              </div>
            </div>

            {/* Payment */}
            <div className="mt-3 flex items-center gap-2 text-xs text-stone-400">
              <span className="capitalize">{order.payment?.method || 'COD'}</span>
              <span>·</span>
              <span className={`capitalize font-semibold ${order.payment?.status === 'paid' ? 'text-green-600' : 'text-amber-600'}`}>
                {order.payment?.status || 'Pending'}
              </span>
            </div>
          </div>
        )}

        {/* ── Delivery address ── */}
        {!loading && order?.shippingAddress && (
          <div className="bg-white rounded-2xl shadow-card p-6">
            <h2 className="font-serif text-lg font-bold text-stone-800 mb-4 flex items-center gap-2">
              <FiMapPin className="text-wine-600" /> Delivering To
            </h2>
            <div className="text-sm text-stone-600 space-y-1">
              <p className="font-semibold text-stone-800 text-base">{name}</p>
              {addr.street && <p>{addr.street}</p>}
              <p>{[addr.city, addr.state, addr.pincode].filter(Boolean).join(', ')}</p>
              {addr.phone && (
                <p className="flex items-center gap-1.5 text-stone-400 mt-1">
                  <FiPhone className="text-xs" /> {addr.phone}
                </p>
              )}
            </div>
            <div className="mt-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-2.5 text-xs text-amber-700">
              📦 Expected delivery: <strong>5–7 business days</strong>
            </div>
          </div>
        )}

        {/* ── Actions ── */}
        <div className="space-y-3">
          <Link href={trackUrl}
            className="flex items-center justify-center gap-2 w-full py-3.5 bg-wine-700 text-white font-bold rounded-2xl hover:bg-wine-800 transition text-sm">
            <FiPackage /> Track My Order <FiArrowRight className="ml-auto" />
          </Link>
          <Link href="/shop"
            className="flex items-center justify-center gap-2 w-full py-3.5 border-2 border-stone-200 text-stone-700 font-semibold rounded-2xl hover:bg-stone-50 transition text-sm">
            <FiShoppingBag /> Continue Shopping
          </Link>
        </div>

        <p className="text-center text-xs text-stone-400 pb-4">
          Questions? WhatsApp us at{' '}
          <a href="https://wa.me/917695868787" className="text-wine-600 font-medium">+91 76958 68787</a>
        </p>

      </div>
    </div>
  );
}

export default function OrderSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-ivory">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 border-4 border-wine-200 border-t-wine-600 rounded-full animate-spin mx-auto" />
          <p className="text-stone-400 text-sm">Loading your order…</p>
        </div>
      </div>
    }>
      <OrderSuccessContent />
    </Suspense>
  );
}
