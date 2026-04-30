'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { FiCheckCircle, FiPackage } from 'react-icons/fi';

function OrderSuccessContent() {
  const searchParams = useSearchParams();
  const orderNumber = searchParams.get('orderNumber');
  const email       = searchParams.get('email');

  const trackUrl = orderNumber && email
    ? `/track-order?orderNumber=${encodeURIComponent(orderNumber)}&email=${encodeURIComponent(email)}`
    : '/track-order';

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
      <div className="bg-white rounded-2xl shadow-sm p-8 max-w-md w-full text-center">
        <div className="w-20 h-20 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-5">
          <FiCheckCircle className="text-5xl text-green-500" />
        </div>

        <h1 className="font-serif text-2xl font-bold text-gray-800 mb-2">Order Placed!</h1>
        <p className="text-gray-500 text-sm mb-5">
          Thank you! We&apos;ve received your order and will process it shortly.
          {email && <> A confirmation has been sent to <span className="font-medium text-gray-700">{email}</span>.</>}
        </p>

        {orderNumber && (
          <div className="bg-gold-50 border border-gold-100 rounded-xl px-5 py-4 mb-6">
            <p className="text-xs text-gray-500 mb-1">Your Order Number</p>
            <p className="font-mono text-xl font-bold text-maroon-950">#{orderNumber}</p>
            <p className="text-xs text-gray-400 mt-1">Save this to track your order</p>
          </div>
        )}

        <div className="space-y-3">
          <Link
            href={trackUrl}
            className="flex items-center justify-center gap-2 w-full py-3 bg-maroon-950 text-white font-semibold rounded-xl hover:bg-maroon-900 transition"
          >
            <FiPackage /> Track My Order
          </Link>
          <Link
            href="/catalog"
            className="block w-full py-3 border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition text-sm"
          >
            Continue Shopping
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function OrderSuccessPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="text-gray-400">Loading...</div></div>}>
      <OrderSuccessContent />
    </Suspense>
  );
}
