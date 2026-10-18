'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { FiTrash2, FiPlus, FiMinus, FiShoppingBag } from 'react-icons/fi';
import { useCart } from '@/context/CartContext';
import { formatPrice } from '@/lib/utils';
import { clearPendingCoupon } from '@/lib/welcomeOffer';
import toast from 'react-hot-toast';
import useAutoApplyPendingCoupon from '@/components/checkout/useAutoApplyPendingCoupon';
import { validateCoupon } from '@/components/checkout/validateCoupon';

export default function CartPage() {
  const { items, dispatch, subtotal, shippingCost, total, discount, coupon, couponShortfall = 0, charges } = useCart();
  const { data: session } = useSession();
  const [couponCode, setCouponCode] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);

  /* Which account the coupon was checked for (null: signed out) — checkout
     re-checks a first-order code that wasn't checked for this customer. */
  const checkedFor = session?.user?.id || null;
  /* `at`: the subtotal the code was checked for (the quantity can change
     while the check is in flight). */
  const applyResult = (r, at = r.orderAmount) => dispatch({ type: 'APPLY_COUPON', payload: { coupon: { ...r.coupon, checkedFor }, discount: r.discount, subtotal: at } });

  /* The welcome code tapped in the offer bar: applied when the cart has
     items and no coupon yet. Refused (expired, first order only…) →
     forgotten, with the reason; below its minimum or offline → left in the
     box to retry (and not re-checked on every visit). */
  useAutoApplyPendingCoupon({
    enabled: items.length > 0,
    hasCoupon: !!coupon,
    orderAmount: subtotal,
    onApplied: (r) => {
      applyResult(r);
      toast.success(`${r.code} applied — you save ${formatPrice(r.discount)}`);
    },
    onRejected: (r) => {
      if (r.definite) { toast.error(`${r.code}: ${r.message}`); return; }
      /* e.g. below the code's minimum: kept for a bigger cart. */
      setCouponCode(r.code);
      toast(`${r.code}: ${r.message}`, { icon: 'ℹ️' });
    },
    onUnavailable: (r) => setCouponCode(r.code),
    onKept: (code) => setCouponCode((c) => c || code),
  });

  /* Typed code: applied, or replaces the coupon that's on. */
  async function applyCoupon() {
    const code = couponCode.trim().toUpperCase();
    if (!code || couponLoading) return;
    if (coupon?.code === code) { setCouponCode(''); return; }
    setCouponLoading(true);
    const checkedAt = subtotal;
    const r = await validateCoupon(code, checkedAt);
    setCouponLoading(false);
    if (r.ok) {
      applyResult(r, checkedAt);
      setCouponCode('');
      toast.success(`Coupon applied! You saved ${formatPrice(r.discount)}`);
    } else {
      toast.error(r.message);
    }
  }

  /* Off the cart — and the remembered welcome code is forgotten, so it
     isn't put straight back on the next visit. */
  function removeCoupon() {
    if (coupon?.code) setCouponCode(coupon.code);
    dispatch({ type: 'REMOVE_COUPON' });
    clearPendingCoupon();
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
            {items.map((item) => {
              const itemId = item._id || item.id;
              return (
              <div key={itemId} className="bg-white rounded-xl p-4 flex items-center gap-4 shadow-sm">
                <div className="relative w-20 h-20 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                  {item.images?.[0] ? (
                    <Image src={item.images[0]} alt={item.name} fill className="object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl">💍</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <Link href={`/product/${itemId}`} className="font-serif font-semibold text-gray-800 hover:text-maroon-950 line-clamp-2 text-sm">{item.name}</Link>
                  <p className="text-gold-600 font-bold mt-1">{formatPrice(item.discountPrice || item.price)}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => item.quantity > 1 ? dispatch({ type: 'UPDATE_QUANTITY', payload: { id: itemId, quantity: item.quantity - 1 } }) : dispatch({ type: 'REMOVE_ITEM', payload: itemId })} className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-100 transition">
                    <FiMinus className="text-xs" />
                  </button>
                  <span className="w-8 text-center font-semibold text-sm">{item.quantity}</span>
                  <button onClick={() => dispatch({ type: 'UPDATE_QUANTITY', payload: { id: itemId, quantity: item.quantity + 1 } })} className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-100 transition">
                    <FiPlus className="text-xs" />
                  </button>
                  <button onClick={() => { dispatch({ type: 'REMOVE_ITEM', payload: itemId }); toast.success('Removed from cart'); }} className="ml-2 p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-full transition">
                    <FiTrash2 className="text-sm" />
                  </button>
                </div>
              </div>
              );
            })}
          </div>

          {/* Summary */}
          <div className="space-y-4">
            {/* Coupon */}
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <h3 className="font-semibold text-gray-700 mb-3 text-sm">Apply Coupon</h3>
              {coupon && (
                <div className={`mb-3 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${couponShortfall > 0 ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'}`}>
                  {couponShortfall > 0 ? (
                    <p className="min-w-0 text-xs text-amber-800" role="status">
                      Add {formatPrice(couponShortfall)} more to use &ldquo;{coupon.code}&rdquo;
                    </p>
                  ) : (
                    <p className="min-w-0 text-xs text-green-700" role="status">
                      ✓ Coupon &ldquo;{coupon.code}&rdquo; applied — saving {formatPrice(discount)}
                    </p>
                  )}
                  <button type="button" onClick={removeCoupon} className="flex-shrink-0 text-xs font-semibold text-gray-500 underline-offset-2 hover:text-red-600 hover:underline">
                    Remove
                  </button>
                </div>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyCoupon(); } }}
                  placeholder={coupon ? 'Have another code?' : 'Enter code'}
                  aria-label="Coupon code"
                  className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-base md:text-sm outline-none focus:ring-2 focus:ring-gold-500 uppercase"
                />
                <button type="button" onClick={applyCoupon} disabled={couponLoading || !couponCode.trim()} className="px-4 py-2 bg-gold-600 text-white text-sm font-semibold rounded-lg hover:bg-gold-700 disabled:opacity-50 transition">
                  {couponLoading ? 'Checking…' : 'Apply'}
                </button>
              </div>
            </div>

            {/* Order summary */}
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <h3 className="font-semibold text-gray-700 mb-4">Order Summary</h3>
              <div className="space-y-2 text-sm text-gray-600 mb-4">
                <div className="flex justify-between"><span>Subtotal</span><span>{formatPrice(subtotal)}</span></div>
                {/* Shipping included in product prices (fee off in Store settings) → no shipping row at all. */}
                {charges?.enable_shipping_fee !== false && (
                  <div className="flex justify-between"><span>Shipping</span><span className={shippingCost === 0 ? 'text-green-600 font-semibold' : ''}>{shippingCost === 0 ? 'FREE' : formatPrice(shippingCost)}</span></div>
                )}
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
