import Link from 'next/link';
import { FiCheckCircle } from 'react-icons/fi';

export default function OrderSuccessPage({ searchParams }) {
  const orderId = searchParams?.orderId;
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
      <div className="bg-white rounded-2xl shadow-sm p-8 max-w-md w-full text-center">
        <FiCheckCircle className="text-6xl text-green-500 mx-auto mb-4" />
        <h1 className="font-serif text-2xl font-bold text-gray-800 mb-2">Order Placed!</h1>
        <p className="text-gray-500 mb-2">Thank you for your order. We&apos;ve received it and will process it shortly.</p>
        {orderId && <p className="text-xs text-gray-400 mb-6">Order ID: {orderId}</p>}
        <div className="space-y-3">
          <Link href="/shop" className="block w-full py-3 bg-maroon-950 text-white font-semibold rounded-xl hover:bg-maroon-900 transition">
            Continue Shopping
          </Link>
          <Link href="/account/orders" className="block w-full py-3 border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition text-sm">
            View My Orders
          </Link>
        </div>
      </div>
    </div>
  );
}
