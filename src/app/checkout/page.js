'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useCart } from '@/context/CartContext';
import { formatPrice } from '@/lib/utils';
import toast from 'react-hot-toast';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

export default function CheckoutPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { items, subtotal, shippingCost, total, discount, coupon, dispatch } = useCart();
  const [loading, setLoading] = useState(false);
  const [loyalty, setLoyalty]           = useState({ points: 0 });
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(false);
  const [loyaltyDiscount, setLoyaltyDiscount] = useState(0);
  const [redeemingPoints, setRedeeming] = useState(false);
  const [form, setForm] = useState({
    fullName: session?.user?.name || '',
    phone: '',
    email: session?.user?.email || '',
    street: '',
    city: '',
    state: '',
    pincode: '',
  });

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login?callbackUrl=/checkout');
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/loyalty').then((r) => r.json()).then((d) => { if (d.success) setLoyalty(d.data); }).catch(() => {});
    fetch('/api/admin/settings').then((r) => r.json()).then((d) => {
      if (d.success) setLoyaltyEnabled(!!d.data?.loyaltyEnabled);
    }).catch(() => {});
  }, [status]);

  if (status === 'loading' || status === 'unauthenticated') {
    return <div className="min-h-screen flex items-center justify-center"><LoadingSpinner size="lg" /></div>;
  }
  const [paymentMethod, setPaymentMethod] = useState('razorpay');

  function updateForm(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function redeemLoyaltyPoints() {
    if (loyaltyDiscount > 0) { setLoyaltyDiscount(0); return; }
    setRedeeming(true);
    try {
      const res = await fetch('/api/loyalty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'redeem' }),
      });
      const data = await res.json();
      if (data.success) {
        setLoyaltyDiscount(data.data.discount);
        setLoyalty((prev) => ({ ...prev, points: prev.points - data.data.pointsRedeemed }));
        toast.success(`₹${data.data.discount} discount applied!`);
      } else {
        toast.error(data.message);
      }
    } catch { toast.error('Failed to redeem points'); }
    finally { setRedeeming(false); }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!items.length) { toast.error('Your cart is empty'); return; }
    setLoading(true);

    try {
      // Create order
      const orderItems = items.map((i) => ({
        product: i._id || i.id,
        name: i.name,
        image: i.images?.[0],
        price: i.discountPrice || i.price,
        quantity: i.quantity,
      }));

      const orderRes = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: orderItems,
          shippingAddress: { ...form },
          payment: { method: paymentMethod, status: 'pending' },
          coupon: coupon?._id,
          couponCode: coupon?.code,
          subtotal, shippingCost, discount: discount + loyaltyDiscount, total: total - loyaltyDiscount,
          loyaltyDiscount,
          guestEmail: !session ? form.email : undefined,
        }),
      });
      const orderData = await orderRes.json();
      if (!orderData.success) throw new Error(orderData.message);
      const orderId = orderData.data.id || orderData.data._id;
      const orderNumber = orderData.data.orderNumber;

      if (paymentMethod === 'cod') {
        dispatch({ type: 'CLEAR_CART' });
        router.push(`/order-success?orderNumber=${encodeURIComponent(orderNumber)}&email=${encodeURIComponent(form.email)}`);
        return;
      }

      // Razorpay
      const payRes = await fetch('/api/payments/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: total, receipt: orderId }),
      });
      const payData = await payRes.json();
      if (!payData.success) throw new Error(payData.message);

      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: payData.data.amount,
        currency: payData.data.currency,
        name: 'Tulsi Bridal Jewellery',
        description: 'Order Payment',
        order_id: payData.data.id,
        prefill: { name: form.fullName, email: form.email, contact: form.phone },
        theme: { color: '#800020' },
        handler: async (response) => {
          const verifyRes = await fetch('/api/payments/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
              orderId,
            }),
          });
          const verifyData = await verifyRes.json();
          if (verifyData.success) {
            dispatch({ type: 'CLEAR_CART' });
            router.push(`/order-success?orderNumber=${encodeURIComponent(orderNumber)}&email=${encodeURIComponent(form.email)}`);
          } else {
            toast.error('Payment verification failed');
          }
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (error) {
      toast.error(error.message || 'Checkout failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!items.length) router.push('/cart');
  }, [items.length, router]);

  if (!items.length) return null;

  return (
    <>
      <script src="https://checkout.razorpay.com/v1/checkout.js" async />
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="font-serif text-3xl font-bold text-maroon-950 mb-6">Checkout</h1>

          <form onSubmit={handleSubmit}>
            <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-4">
                {/* Shipping */}
                <div className="bg-white rounded-xl p-6 shadow-sm">
                  <h2 className="font-semibold text-gray-700 mb-4">Shipping Details</h2>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2 md:col-span-1">
                      <label className="text-xs text-gray-500 mb-1 block">Full Name *</label>
                      <input required value={form.fullName} onChange={(e) => updateForm('fullName', e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                    </div>
                    <div className="col-span-2 md:col-span-1">
                      <label className="text-xs text-gray-500 mb-1 block">Phone *</label>
                      <input required type="tel" value={form.phone} onChange={(e) => updateForm('phone', e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-gray-500 mb-1 block">Email *</label>
                      <input required type="email" value={form.email} onChange={(e) => updateForm('email', e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-gray-500 mb-1 block">Street Address *</label>
                      <input required value={form.street} onChange={(e) => updateForm('street', e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">City *</label>
                      <input required value={form.city} onChange={(e) => updateForm('city', e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">State *</label>
                      <input required value={form.state} onChange={(e) => updateForm('state', e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Pincode *</label>
                      <input required value={form.pincode} onChange={(e) => updateForm('pincode', e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                    </div>
                  </div>
                </div>

                {/* Payment */}
                <div className="bg-white rounded-xl p-6 shadow-sm">
                  <h2 className="font-semibold text-gray-700 mb-4">Payment Method</h2>
                  <div className="space-y-3">
                    {[{ value: 'razorpay', label: 'Pay Online (Razorpay)', desc: 'Cards, UPI, Net Banking, Wallets' }, { value: 'cod', label: 'Cash on Delivery', desc: 'Pay when you receive' }].map((p) => (
                      <label key={p.value} className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition ${paymentMethod === p.value ? 'border-gold-600 bg-gold-50' : 'border-gray-200 hover:border-gray-300'}`}>
                        <input type="radio" name="payment" value={p.value} checked={paymentMethod === p.value} onChange={() => setPaymentMethod(p.value)} className="accent-gold-600" />
                        <div>
                          <p className="font-semibold text-sm text-gray-800">{p.label}</p>
                          <p className="text-xs text-gray-500">{p.desc}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Summary */}
              <div>
                <div className="bg-white rounded-xl p-5 shadow-sm sticky top-24">
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
                    <div className="flex justify-between"><span>Shipping</span><span className={shippingCost === 0 ? 'text-green-600' : ''}>{shippingCost === 0 ? 'FREE' : formatPrice(shippingCost)}</span></div>
                    {discount > 0 && <div className="flex justify-between text-green-600"><span>Discount</span><span>-{formatPrice(discount)}</span></div>}
                    {loyaltyEnabled && loyalty.points >= 50 && loyaltyDiscount === 0 && (
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
                    {loyaltyDiscount > 0 && (
                      <div className="flex justify-between text-amber-700">
                        <span>🏆 Points Discount <button type="button" onClick={redeemLoyaltyPoints} className="text-red-400 text-xs ml-1">✕ Remove</button></span>
                        <span className="font-semibold">-{formatPrice(loyaltyDiscount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-gray-800 text-base border-t pt-2">
                      <span>Total</span><span>{formatPrice(total - loyaltyDiscount)}</span>
                    </div>
                  </div>
                  <button type="submit" disabled={loading} className="w-full mt-4 py-3 bg-maroon-950 text-white font-bold rounded-xl hover:bg-maroon-900 disabled:opacity-60 transition flex items-center justify-center gap-2">
                    {loading ? <><LoadingSpinner size="sm" /> Processing...</> : `Place Order · ${formatPrice(total - loyaltyDiscount)}`}
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
