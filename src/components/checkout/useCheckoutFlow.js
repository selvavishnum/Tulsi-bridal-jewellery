'use client';

/* ─────────────────────────────────────────────
   The checkout flow, shared by the /checkout page (the cart) and the Buy
   Now drawer (one piece): the shipping form and saved addresses, payment
   method and when COD is offered, the charges summary, and placing the
   order through POST /api/orders → Razorpay → /api/payments/verify.

   The caller says WHAT is being bought (`lines`, its `subtotal`, coupon
   `discount`/`couponCode`) and how to talk to the customer (`notify`,
   default: toasts). Prices are computed server-side from the products
   collection — only the lines are sent.

   Messages go through notify(type, message, toastOptions), type 'error'
   or 'info'. The one exception is the "payment on hold" note, which is a
   toast either way: the customer is taken to My Orders with it.
   ───────────────────────────────────────────── */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { useCart } from '@/context/CartContext';
import { loadRazorpayScript } from '@/lib/loadRazorpay';
import { getPendingCoupon, clearPendingCoupon } from '@/lib/welcomeOffer';
import { checkoutAmounts, correctedPaymentMethod, fillFromAddress, orderSuccessPath, PHONE_RE } from './checkoutRules';

const toastNotify = (type, message, options) => (type === 'error' ? toast.error(message, options) : toast(message, options));

/**
 * @param {object} p
 * @param {{ product: string, quantity: number }[]} p.lines  what is being bought
 * @param {number} p.subtotal       display subtotal of those lines
 * @param {number} [p.discount]     coupon discount shown
 * @param {string} [p.couponCode]   coupon to send (the server re-validates it)
 * @param {boolean} [p.withLoyalty] load and offer loyalty points (the page)
 * @param {boolean} [p.preloadPayment] start loading Razorpay now (default true)
 * @param {(type: 'error'|'info', message: string, options?: object) => void} [p.notify]
 * @param {string} [p.emptyMessage] shown if there is nothing to order
 * @param {() => void} [p.onOrderPlaced] runs once the order is placed (COD,
 *   paid, or paid-and-held), just before leaving for the confirmation page
 */
export default function useCheckoutFlow({
  lines,
  subtotal,
  discount = 0,
  couponCode,
  withLoyalty = false,
  preloadPayment = true,
  notify = toastNotify,
  emptyMessage = 'Your cart is empty',
  onOrderPlaced,
}) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { charges, refreshCharges } = useCart();

  const [loading, setLoading] = useState(false);
  /* Razorpay handed back a payment and we're confirming it with the server. */
  const [verifying, setVerifying] = useState(false);
  const [loyalty, setLoyalty] = useState({ points: 0 });
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(false);
  const [loyaltyDiscount, setLoyaltyDiscount] = useState(0);
  const [redeemingPoints, setRedeeming] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('razorpay');
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [addrChoice, setAddrChoice] = useState('new');
  const [pincodeLoading, setPincodeLoading] = useState(false);
  const [codAvailable, setCodAvailable] = useState(true); // optimistic until checked
  const [onlinePaymentEnabled, setOnlinePaymentEnabled] = useState(true);
  const [form, setForm] = useState({
    fullName: session?.user?.name || '',
    phone: '',
    email: session?.user?.email || '',
    street: '',
    city: '',
    state: '',
    pincode: '',
  });

  /* On a hard refresh the session is still loading on the first render, so
     the account's name and email arrive one render later: fill them in
     then, without overwriting anything already typed or loaded. */
  const [prefilled, setPrefilled] = useState(() => !!session?.user);
  if (!prefilled && session?.user) {
    setPrefilled(true);
    setForm((prev) => ({
      ...prev,
      fullName: prev.fullName || session.user.name || '',
      email: prev.email || session.user.email || '',
    }));
  }

  /* Same rule the server applies (src/lib/storeCharges.js), from the admin's
     current settings: switching payment method re-computes instantly. */
  const amounts = checkoutAmounts({ subtotal, discount, loyaltyDiscount, paymentMethod, charges, codAvailable });
  const { shippingCost, codFee, codBlocked } = amounts;

  /* Never let a disabled option sit selected. Adjusted during render (not
     in an effect), so the wrong option is never painted. */
  const allowedMethod = correctedPaymentMethod(paymentMethod, { codBlocked, onlinePaymentEnabled });
  if (allowedMethod !== paymentMethod) setPaymentMethod(allowedMethod);

  /* Start loading Razorpay as soon as checkout opens, so it's already
     ready by the time the customer reaches "Place Order". */
  useEffect(() => {
    if (preloadPayment) loadRazorpayScript().catch(() => {});
  }, [preloadPayment]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    if (withLoyalty) {
      fetch('/api/loyalty').then((r) => r.json()).then((d) => { if (d.success) setLoyalty(d.data); }).catch(() => {});
    }
    fetch('/api/admin/settings').then((r) => r.json()).then((d) => {
      if (d.success) {
        setLoyaltyEnabled(!!d.data?.loyaltyEnabled);
        setOnlinePaymentEnabled(d.data?.onlinePaymentEnabled !== false);
      }
    }).catch(() => {});
    fetch('/api/user/address').then((r) => r.json()).then((d) => {
      if (d.success && d.data.length > 0) {
        setSavedAddresses(d.data);
        setAddrChoice('saved-0');
        setForm((prev) => fillFromAddress(prev, d.data[0]));
      }
    }).catch(() => {});
  }, [status, withLoyalty]);

  function updateForm(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  /* 'saved-<i>' fills the form from that address; 'new' clears it. */
  function chooseAddress(choice) {
    setAddrChoice(choice);
    if (choice === 'new') {
      setForm((prev) => ({ ...prev, street: '', city: '', state: '', pincode: '', phone: '' }));
      return;
    }
    const a = savedAddresses[parseInt(String(choice).split('-')[1])];
    if (a) setForm((prev) => fillFromAddress(prev, a));
  }

  async function handlePincodeChange(val) {
    updateForm('pincode', val);
    setCodAvailable(true); // reset to optimistic until re-checked for the new pincode
    if (val.length === 6 && /^\d{6}$/.test(val)) {
      setPincodeLoading(true);
      try {
        const res = await fetch(`https://api.postalpincode.in/pincode/${val}`);
        const data = await res.json();
        if (data[0]?.Status === 'Success' && data[0].PostOffice?.length > 0) {
          const po = data[0].PostOffice[0];
          setForm((prev) => ({ ...prev, city: po.District, state: po.State }));
        }
      } catch {}
      finally { setPincodeLoading(false); }

      fetch(`/api/cod-availability?pincode=${val}`)
        .then((r) => r.json())
        .then((d) => { if (d.success) setCodAvailable(d.data.available); })
        .catch(() => {});
    }
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

  /* The order is placed: a remembered welcome code it used is spent. */
  function orderPlaced() {
    const pending = getPendingCoupon();
    if (pending && couponCode && String(couponCode).toUpperCase() === pending) clearPendingCoupon();
    onOrderPlaced?.();
  }

  async function placeOrder(e) {
    e?.preventDefault?.();
    if (!lines.length) { notify('error', emptyMessage); return; }
    if (!PHONE_RE.test(form.phone)) {
      notify('error', 'Enter a valid 10-digit mobile number');
      return;
    }
    setLoading(true);

    try {
      /* Prices, discounts and the total are computed server-side from the
         products collection — only the lines are sent. */
      const orderRes = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: lines,
          shippingAddress: { ...form },
          payment: { method: paymentMethod },
          couponCode,
          guestEmail: !session ? form.email : undefined,
          /* The fees shown to the customer: the server refuses the order if
             they no longer match its own calculation (409 below). */
          shippingCost,
          codFee,
        }),
      });
      const orderData = await orderRes.json();
      if (orderRes.status === 409 && orderData.code === 'CHARGES_CHANGED') {
        /* The admin changed the charges while this page was open: show the
           new total and let the customer confirm again. */
        await refreshCharges();
        notify('info', orderData.message, { icon: 'ℹ️', duration: 10000 });
        return;
      }
      if (!orderData.success) throw new Error(orderData.message || 'Could not place order. Please try again.');
      const orderId = orderData.data.id || orderData.data._id;
      const orderNumber = orderData.data.orderNumber;

      if (paymentMethod === 'cod') {
        orderPlaced();
        router.push(orderSuccessPath(orderNumber, form.email));
        return;
      }

      /* In case the earlier mount-time load hasn't finished (or failed) yet */
      await loadRazorpayScript();

      const payRes = await fetch('/api/payments/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      const payData = await payRes.json();
      if (!payData.success) throw new Error(payData.message || 'Payment setup failed. Please try again.');

      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: payData.data.amount,
        currency: payData.data.currency,
        name: 'Tulsi Bridal Jewellery',
        description: 'Order Payment',
        order_id: payData.data.id,
        prefill: { name: form.fullName, email: form.email, contact: form.phone },
        theme: { color: '#800020' },
        /* User closed the modal without paying — the order stays pending in
           Firestore, but they need to know nothing was charged. */
        modal: {
          ondismiss: () => {
            notify('info', 'Payment cancelled. Your order was not placed.', { icon: 'ℹ️' });
          },
        },
        handler: async (response) => {
          setVerifying(true);
          try {
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
              orderPlaced();
              router.push(orderSuccessPath(orderNumber, form.email));
            } else if (verifyRes.status === 202) {
              /* Money is on hold with the bank and is being captured — the
                 order confirms itself (webhook); don't make them pay again. */
              orderPlaced();
              toast(verifyData.message, { duration: 15000 });
              router.push('/account');
            } else {
              setVerifying(false);
              notify('error', verifyData.message || 'Payment verification failed');
            }
          } catch {
            /* Offline mid-confirmation. The payment (if taken) still
               confirms the order through Razorpay's webhook. */
            setVerifying(false);
            notify('error', 'We couldn’t confirm your payment just now. If money was deducted, your order will update automatically — please check My Orders in a few minutes.', { duration: 15000 });
          }
        },
      };

      const rzp = new window.Razorpay(options);
      /* Card declined, bank timeout, etc. — Razorpay shows its own message
         inside the modal, but the merchant page should reflect it too. */
      rzp.on('payment.failed', (response) => {
        notify('error', response.error?.description || 'Payment failed. Please try again.', { duration: 15000 });
      });
      rzp.open();
    } catch (error) {
      /* Stays on screen until dismissed — the default toast duration was too
         short to read on a phone, let alone screenshot. */
      notify('error', error.message || 'Checkout failed', { duration: 15000 });
    } finally {
      setLoading(false);
    }
  }

  return {
    session,
    status,
    charges,
    form,
    updateForm,
    savedAddresses,
    addrChoice,
    chooseAddress,
    pincodeLoading,
    handlePincodeChange,
    codAvailable,
    onlinePaymentEnabled,
    paymentMethod: allowedMethod,
    setPaymentMethod,
    loyalty,
    loyaltyEnabled,
    loyaltyDiscount,
    redeemingPoints,
    redeemLoyaltyPoints,
    ...amounts,
    loading,
    verifying,
    placeOrder,
  };
}
