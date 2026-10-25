'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useCart } from '@/context/CartContext';
import { formatPrice } from '@/lib/utils';
import toast from 'react-hot-toast';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { track } from '@/lib/analytics/tracker';
import useCheckoutFlow from '@/components/checkout/useCheckoutFlow';
import useAutoApplyPendingCoupon from '@/components/checkout/useAutoApplyPendingCoupon';
import useCouponRecheck from '@/components/checkout/useCouponRecheck';
import { minimumFromMessage } from '@/components/checkout/checkoutRules';
import { clearPendingCoupon } from '@/lib/welcomeOffer';
import { AddressFields, PaymentMethodFields } from '@/components/checkout/CheckoutFields';

/* The form, saved addresses, COD rules, charges and the order/payment flow
   live in useCheckoutFlow (shared with the Buy Now drawer); this page
   checks out the cart. */
export default function CheckoutPage() {
  const router = useRouter();
  const { items, subtotal, discount, coupon, couponShortfall = 0, dispatch } = useCart();
  /* Clearing the cart on a successful order makes items.length hit 0, which
     would otherwise trigger the "cart is empty → go to /cart" effect below
     and hijack the navigation to the confirmation page. This flag tells that
     effect to stand down once an order has actually been placed. */
  const orderPlacedRef = useRef(false);

  const flow = useCheckoutFlow({
    /* Prices, discounts and the total are computed server-side from the
       products collection — only the cart contents are sent. */
    lines: items.map((i) => ({ product: i._id || i.id, quantity: i.quantity })),
    subtotal,
    discount,
    couponCode: coupon?.code,
    withLoyalty: true,
    onOrderPlaced: () => {
      orderPlacedRef.current = true;
      dispatch({ type: 'CLEAR_CART' });
    },
    /* 409 COUPON_CHANGED: the server's figure for this order (the subtotal
       it was placed at) — the coupon comes off, or shows the server's
       discount; the customer confirms the new total. Also: the coupon
       couldn't be checked twice in a row → off. */
    onCouponChanged: ({ couponApplied, discount: serverDiscount }) => {
      if (couponApplied && coupon) dispatch({ type: 'APPLY_COUPON', payload: { coupon, discount: serverDiscount, subtotal } });
      else dispatch({ type: 'REMOVE_COUPON' });
    },
  });
  const {
    status, charges, shippingCost, codFee, payableTotal, loading, placed,
    loyalty, loyaltyDiscount, loyaltyLoading, canRedeemPoints, redeemingPoints, redeemLoyaltyPoints, placeOrder,
  } = flow;
  const userId = flow.session?.user?.id || null;

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login?callbackUrl=/checkout');
    }
  }, [status, router]);

  /* Visitor analytics: reaching checkout with a cart — counted even when
     the sign-in step stops a guest here, so that drop-off is visible. */
  const checkoutTracked = useRef(false);
  useEffect(() => {
    if (checkoutTracked.current || !items.length) return;
    checkoutTracked.current = true;
    track('checkout_start');
  }, [items.length]);

  /* The welcome code tapped in the offer bar (before or on this page):
     applied to the cart if no coupon is on it yet (the order endpoint
     decides in the end). */
  const autoApply = useAutoApplyPendingCoupon({
    enabled: status === 'authenticated' && items.length > 0 && !placed,
    hasCoupon: !!coupon,
    orderAmount: subtotal,
    onApplied: (r) => {
      dispatch({ type: 'APPLY_COUPON', payload: { coupon: { ...r.coupon, checkedFor: userId }, discount: r.discount, subtotal: r.orderAmount } });
      toast.success(`${r.code} applied — you save ${formatPrice(r.discount)}`);
    },
    onRejected: (r) => (r.definite ? toast.error(`${r.code}: ${r.message}`) : toast(`${r.code}: ${r.message}`, { icon: 'ℹ️' })),
  });

  /* A first-order-only code put on the cart while signed out (or under
     another account) was only a preview: check it for this customer before
     they can order, so a returning customer hears "first order only" now
     rather than paying more than the button said. */
  const recheckCode = status === 'authenticated' && !placed && coupon?.firstOrderOnly === true && coupon.checkedFor !== userId ? coupon.code : null;
  const recheck = useCouponRecheck({
    code: recheckCode,
    orderAmount: subtotal,
    onResult: (r) => {
      if (!coupon || coupon.code !== r.code) return; // changed meanwhile
      if (r.ok) {
        dispatch({ type: 'APPLY_COUPON', payload: { coupon: { ...r.coupon, checkedFor: userId }, discount: r.discount, subtotal: r.orderAmount } });
      } else if (r.refused && r.definite) {
        dispatch({ type: 'REMOVE_COUPON' });
        toast.error(`${r.code}: ${r.message}`, { duration: 8000 });
      } else if (r.refused) {
        /* Only this basket's minimum (checked after first-order): kept, at ₹0 until it's met. */
        const minOrderAmount = Number(coupon.minOrderAmount) || minimumFromMessage(r.message);
        dispatch({ type: 'APPLY_COUPON', payload: { coupon: { ...coupon, minOrderAmount, checkedFor: userId } } });
      }
      /* Offline / rate-limited / no answer in time: left as it is — the
         order endpoint answers 409 COUPON_CHANGED rather than charge a
         different amount. */
    },
  });
  /* Hold "Place order" while the coupon is being checked (the order would
     otherwise go without it, or with one about to be refused) — a check
     for a coupon removed meanwhile holds nothing — and, for the moment it
     takes, while the points discount already on the account loads (the
     total may still drop). Both give up after a few seconds
     (validateCoupon, useCheckoutFlow). */
  const couponChecking = autoApply.checking || (recheck.checking && !!coupon);
  const holding = couponChecking || loyaltyLoading;
  function submit(e) {
    if (holding) { e?.preventDefault?.(); return; }
    placeOrder(e);
  }

  /* Off this order — and the remembered welcome code is forgotten, so it
     isn't put straight back on (as on /cart). */
  function removeCoupon() {
    dispatch({ type: 'REMOVE_COUPON' });
    clearPendingCoupon();
  }

  /* Must run before the early return below: hooks called after a
     conditional return change the hook count between renders ("Rendered more
     hooks than during the previous render"), which crashed checkout on a
     hard refresh or direct link, when the session starts out 'loading'. */
  useEffect(() => {
    if (status === 'authenticated' && !items.length && !orderPlacedRef.current) router.push('/cart');
  }, [status, items.length, router]);

  if (status === 'loading' || status === 'unauthenticated') {
    return <div className="min-h-screen flex items-center justify-center"><LoadingSpinner size="lg" /></div>;
  }

  if (!items.length) return null;

  return (
    <>
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="font-serif text-3xl font-bold text-maroon-950 mb-6">Checkout</h1>

          <form onSubmit={submit}>
            <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-4">
                {/* Shipping */}
                <div className="bg-white rounded-xl p-6 shadow-sm">
                  <h2 className="font-semibold text-gray-700 mb-4">Shipping Details</h2>
                  <AddressFields flow={flow} />
                </div>

                {/* Payment */}
                <div className="bg-white rounded-xl p-6 shadow-sm">
                  <h2 className="font-semibold text-gray-700 mb-4">Payment Method</h2>
                  <PaymentMethodFields flow={flow} />
                </div>
              </div>

              {/* Summary */}
              <div>
                <div className="bg-white rounded-xl p-5 shadow-sm sticky top-24 lg:top-40">
                  <h2 className="font-semibold text-gray-700 mb-4">Order Summary</h2>
                  <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
                    {items.map((i) => (
                      <div key={i._id} className="flex justify-between text-xs text-gray-600">
                        <span className="truncate mr-2">{i.name} × {i.quantity}</span>
                        <span className="font-semibold flex-shrink-0">{formatPrice((i.discountPrice || i.price) * i.quantity)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="border-t pt-3 space-y-2 text-sm text-gray-600">
                    <div className="flex justify-between"><span>Subtotal</span><span>{formatPrice(subtotal)}</span></div>
                    {/* Shipping included in product prices (fee off in Store settings) → no shipping row. */}
                    {charges.enable_shipping_fee && (
                    <div className="flex justify-between">
                      <span>Shipping</span>
                      {shippingCost === 0 ? (
                        <span className="text-green-600 font-semibold">
                          {charges.enable_shipping_fee && <span className="line-through text-gray-400 font-normal mr-1.5">{formatPrice(charges.shipping_fee_amount)}</span>}FREE
                        </span>
                      ) : <span>{formatPrice(shippingCost)}</span>}
                    </div>
                    )}
                    {charges.enable_shipping_fee && shippingCost > 0 && charges.free_shipping_threshold > 0 && (
                      <p className="text-xs text-gray-400 -mt-1">Add {formatPrice(charges.free_shipping_threshold - subtotal)} more for free delivery</p>
                    )}
                    {discount > 0 && (
                      <div>
                        <div className="flex justify-between text-green-600"><span>Discount{coupon?.code ? ` (${coupon.code})` : ''}</span><span>-{formatPrice(discount)}</span></div>
                        {coupon && (
                          <button type="button" onClick={removeCoupon} disabled={loading || placed} className="text-xs font-semibold text-gray-500 underline-offset-2 hover:text-red-600 hover:underline disabled:opacity-40">
                            Remove coupon
                          </button>
                        )}
                      </div>
                    )}
                    {coupon && couponShortfall > 0 && (
                      <p className="text-xs text-amber-700">
                        Add {formatPrice(couponShortfall)} more to use {coupon.code}
                        <button type="button" onClick={removeCoupon} disabled={loading || placed} className="ml-2 font-semibold text-gray-500 underline-offset-2 hover:text-red-600 hover:underline disabled:opacity-40">Remove</button>
                      </p>
                    )}
                    {canRedeemPoints && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mt-2">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs font-semibold text-amber-800">🏆 {loyalty.points} Loyalty Points</p>
                          <p className="text-xs text-amber-700">= ₹{Math.floor(loyalty.points / 50) * 50} discount</p>
                        </div>
                        <button type="button" onClick={redeemLoyaltyPoints} disabled={redeemingPoints}
                          className="w-full py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg disabled:opacity-60 transition">
                          {redeemingPoints ? 'Redeeming…' : 'Use Points'}
                        </button>
                      </div>
                    )}
                    {/* Points redeemed now or on an earlier visit: the order takes
                        them (up to 20% of the subtotal) whatever is shown, so
                        there's no Remove. */}
                    {loyaltyDiscount > 0 && (
                      <div className="flex justify-between text-amber-700">
                        <span>🏆 Points Discount</span>
                        <span className="font-semibold">-{formatPrice(loyaltyDiscount)}</span>
                      </div>
                    )}
                    {codFee > 0 && (
                      <div className="flex justify-between"><span>COD Fee</span><span>{formatPrice(codFee)}</span></div>
                    )}
                    <div className="flex justify-between font-bold text-gray-800 text-base border-t pt-2">
                      <span>Total</span><span>{formatPrice(payableTotal)}</span>
                    </div>
                  </div>
                  <button type="submit" disabled={loading || placed || holding} className="w-full mt-4 py-3 bg-maroon-950 text-white font-bold rounded-xl hover:bg-maroon-900 disabled:opacity-60 transition flex items-center justify-center gap-2">
                    {placed ? 'Order placed — opening confirmation…'
                      : loading ? <><LoadingSpinner size="sm" /> Processing...</>
                        : couponChecking ? <><LoadingSpinner size="sm" /> Checking your coupon…</>
                          : `Place Order · ${formatPrice(payableTotal)}`}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
