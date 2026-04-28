'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { FiTrash2, FiPlus, FiMinus, FiShoppingBag } from 'react-icons/fi';
import { useCart } from '@/context/CartContext';
import { formatPrice } from '@/lib/utils';
import toast from 'react-hot-toast';

export default function CartPage() {
  const { items, dispatch, subtotal, shippingCost, total, discount, coupon } = useCart();
  const [couponCode, setCouponCode] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);

  async function applyCoupon() {
    if (!couponCode.trim()) return;
    setCouponLoading(true);
    try {
      const res = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: couponCode, orderAmount: subtotal }),
      });
      const data = await res.json();
      if (data.success) {
        dispatch({ type: 'APPLY_COUPON', payload: { coupon: data.data.coupon, discount: data.data.discount } });
        toast.success(`Coupon applied! You saved ${formatPrice(data.data.discount)}`);
      } else {
        toast.error(data.message);
      }
    } catch { toast.error('Failed to apply coupon'); }
    finally { setCouponLoading(false); }
  }

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <FiShoppingBag className="text-6xl text-gray-300 mx-auto mb-4" />
          <h2 className="text-2xl font-serif font-bold text-gray-700 mb-2">Your cart is empty</h2>
          <p className="text-gray-500 mb-6">Discover our beautiful jewellery collection</p>
          <Link href="/shop" className="px-8 py-3 bg-maroon-950 text-white font-semibold rounded-full hover:bg-maroon-900 transition">
            Shop Now
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="font-serif text-3xl font-bold text-maroon-950 mb-6">Shopping Cart ({items.length})</h1>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Items */}
          <div className="lg:col-span-2 space-y-3">
            {items.map((item) => (
              <div key={item._id} className="bg-white rounded-xl p-4 flex items-center gap-4 shadow-sm">
                <div className="relative w-20 h-20 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                  {item.images?.[0] ? (
                    <Image src={item.images[0]} alt={item.name} fill className="object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl">💍</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <Link href={`/product/${item._id}`} className="font-serif font-semibold text-gray-800 hover:text-maroon-950 line-clamp-2 text-sm">{item.name}</Link>
                  <p className="text-gold-600 font-bold mt-1">{formatPrice(item.discountPrice || item.price)}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => item.quantity > 1 ? dispatch({ type: 'UPDATE_QUANTITY', payload: { id: item._id, quantity: item.quantity - 1 } }) : dispatch({ type: 'REMOVE_ITEM', payload: item._id })} className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-100 transition">
                    <FiMinus className="text-xs" />
                  </button>
                  <span className="w-8 text-center font-semibold text-sm">{item.quantity}</span>
                  <button onClick={() => dispatch({ type: 'UPDATE_QUANTITY', payload: { id: item._id, quantity: item.quantity + 1 } })} className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-100 transition">
                    <FiPlus className="text-xs" />
                  </button>
                  <button onClick={() => { dispatch({ type: 'REMOVE_ITEM', payload: item._id }); toast.success('Removed from cart'); }} className="ml-2 p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-full transition">
                    <FiTrash2 className="text-sm" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="space-y-4">
            {/* Coupon */}
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <h3 className="font-semibold text-gray-700 mb-3 text-sm">Apply Coupon</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  placeholder="Enter code"
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500 uppercase"
                />
                <button onClick={applyCoupon} disabled={couponLoading || !!coupon} className="px-4 py-2 bg-gold-600 text-white text-sm font-semibold rounded-lg hover:bg-gold-700 disabled:opacity-50 transition">
                  Apply
                </button>
              </div>
              {coupon && <p className="text-green-600 text-xs mt-2">✓ Coupon &ldquo;{coupon.code}&rdquo; applied — saving {formatPrice(discount)}</p>}
            </div>

            {/* Order summary */}
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <h3 className="font-semibold text-gray-700 mb-4">Order Summary</h3>
              <div className="space-y-2 text-sm text-gray-600 mb-4">
                <div className="flex justify-between"><span>Subtotal</span><span>{formatPrice(subtotal)}</span></div>
                <div className="flex justify-between"><span>Shipping</span><span className={shippingCost === 0 ? 'text-green-600 font-semibold' : ''}>{shippingCost === 0 ? 'FREE' : formatPrice(shippingCost)}</span></div>
                {discount > 0 && <div className="flex justify-between text-green-600"><span>Discount</span><span>-{formatPrice(discount)}</span></div>}
              </div>
              <div className="flex justify-between font-bold text-gray-800 border-t pt-3 text-lg mb-4">
                <span>Total</span><span>{formatPrice(total)}</span>
              </div>
              <Link href="/checkout" className="block w-full py-3 bg-maroon-950 text-white text-center font-semibold rounded-xl hover:bg-maroon-900 transition">
                Proceed to Checkout
              </Link>
              <Link href="/shop" className="block w-full py-2.5 text-center text-sm text-gray-500 hover:text-maroon-950 mt-2 transition">
                Continue Shopping
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
