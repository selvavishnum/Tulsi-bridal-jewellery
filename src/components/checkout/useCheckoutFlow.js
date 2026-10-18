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

   What the customer is charged is what the button showed:
   • the fees and the coupon discount shown are sent with the order; the
     server answers 409 (CHARGES_CHANGED / COUPON_CHANGED) instead of
     charging a different amount — the caller updates its coupon
     (onCouponChanged) and the customer confirms the new total;
   • an online order whose payment wasn't completed (Razorpay closed, or a
     failed payment) is kept: retrying the same order pays THAT order
     (create-order again), never a second one. If anything changed — the
     lines, coupon, address, payment method, or the amount — the unpaid
     order is cancelled first (which hands back its coupon use and parked
     points), then the new one is placed. It is never cancelled when the
     Razorpay window closes: a UPI payment can still land after that, and
     an attempt that turns out paid goes to the confirmation page;
   • once an order is placed, `placed` stays true until the page leaves —
     a second tap can't place it twice.
   ───────────────────────────────────────────── */
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { useCart } from '@/context/CartContext';
import { loadRazorpayScript } from '@/lib/loadRazorpay';
import { getPendingCoupon, clearPendingCoupon } from '@/lib/welcomeOffer';
import { checkoutAmounts, correctedPaymentMethod, fillFromAddress, loyaltyDiscountFor, orderSuccessPath, PHONE_RE } from './checkoutRules';

const toastNotify = (type, message, options) => (type === 'error' ? toast.error(message, options) : toast(message, options));

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const ADDRESS_KEYS = ['fullName', 'phone', 'email', 'street', 'city', 'state', 'pincode'];

/* COUPON_CHANGED reasons that say nothing final about the code: below its
   minimum (a bigger order can use it), not signed in, or the server
   couldn't check it just now. */
const KEEP_PENDING_REASONS = new Set(['min_order', 'sign_in_required', 'check_failed']);

/* The remembered welcome code is forgotten once THIS code was spent or refused. */
function forgetPendingCoupon(code) {
  const pending = getPendingCoupon();
  if (pending && code && String(code).toUpperCase() === pending) clearPendingCoupon();
}

async function readOrder(orderId) {
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`);
    const data = await res.json();
    return data?.success ? data.data : null;
  } catch { return null; }
}

/**
 * An earlier unpaid online order is being given up: paid meanwhile
 * ('paid' — never cancel it), cancelled now or already ('cancelled'), or
 * we couldn't tell ('failed' — place nothing new, it would hold the coupon
 * twice).
 */
async function settleUnpaidOrder(orderId) {
  const before = await readOrder(orderId);
  if (before?.payment?.status === 'paid') return 'paid';
  if (before?.status === 'cancelled') return 'cancelled';
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      /* unpaidOnly: refused if a payment was confirmed since the look-up. */
      body: JSON.stringify({ status: 'cancelled', unpaidOnly: true }),
    });
    const data = await res.json().catch(() => null);
    if (data?.success) return 'cancelled';
    /* Razorpay has the money although we haven't heard yet (late UPI). */
    if (data?.code === 'ALREADY_PAID') return 'paid';
  } catch { /* offline — looked up below */ }
  const after = await readOrder(orderId);
  if (after?.payment?.status === 'paid') return 'paid';
  if (after?.status === 'cancelled') return 'cancelled';
  return 'failed';
}

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
 * @param {(c: { code: string, couponApplied: boolean, discount: number, reason: string|null }) => void} [p.onCouponChanged]
 *   the server would apply the coupon differently from what was shown (409
 *   COUPON_CHANGED): remove it (couponApplied false) or show `discount`
 *   for the current subtotal. Nothing was ordered; the customer is told.
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
  onCouponChanged,
}) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { charges, refreshCharges } = useCart();

  const [loading, setLoading] = useState(false);
  /* Razorpay handed back a payment and we're confirming it with the server. */
  const [verifying, setVerifying] = useState(false);
  /* The order is placed and the confirmation page is on its way. */
  const [placed, setPlaced] = useState(false);
  const placedRef = useRef(false);
  const submitting = useRef(false);
  /* The online order of an attempt whose payment wasn't completed:
     { orderId, orderNumber, email, couponCode, signature, total }. */
  const unpaid = useRef(null);
  const [loyalty, setLoyalty] = useState({ points: 0 });
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(false);
  /* What was redeemed on this page (₹). The order takes at most 20% of the
     subtotal of it (the rest stays parked) — `loyaltyDiscount` below. */
  const [redeemed, setRedeemed] = useState(0);
  const loyaltyDiscount = loyaltyDiscountFor(redeemed, subtotal);
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
    if (redeemed > 0) { setRedeemed(0); return; }
    setRedeeming(true);
    try {
      const res = await fetch('/api/loyalty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'redeem' }),
      });
      const data = await res.json();
      if (data.success) {
        setRedeemed(data.data.discount);
        setLoyalty((prev) => ({ ...prev, points: prev.points - data.data.pointsRedeemed }));
        toast.success(`₹${loyaltyDiscountFor(data.data.discount, subtotal)} discount applied!`);
      } else {
        toast.error(data.message);
      }
    } catch { toast.error('Failed to redeem points'); }
    finally { setRedeeming(false); }
  }

  /* The order is placed: a remembered welcome code it used is spent, and
     the button stays locked until the confirmation page takes over. */
  function orderPlaced(usedCode = couponCode) {
    placedRef.current = true;
    unpaid.current = null;
    setPlaced(true);
    forgetPendingCoupon(usedCode);
    onOrderPlaced?.();
  }

  /* What this attempt is for — an unpaid order is re-used only for the same. */
  function attemptSignature() {
    return JSON.stringify({
      lines: lines.map((l) => [String(l.product), Number(l.quantity)]),
      coupon: couponCode ? String(couponCode).toUpperCase() : null,
      couponDiscount: couponCode ? discount : 0,
      loyaltyDiscount,
      address: ADDRESS_KEYS.map((k) => String(form[k] ?? '').trim()),
      method: paymentMethod,
    });
  }

  /* An earlier attempt turned out paid: that's the order. */
  function earlierAttemptPaid(prev) {
    notify('info', 'Your earlier payment went through — opening your order.', { icon: '✅' });
    orderPlaced(prev.couponCode);
    router.push(orderSuccessPath(prev.orderNumber, prev.email));
  }

  async function placeOrder(e) {
    e?.preventDefault?.();
    /* Placed already (the confirmation page is loading), or a tap that
       landed before the button showed it's busy. */
    if (placedRef.current || submitting.current) return;
    if (!lines.length) { notify('error', emptyMessage); return; }
    if (!PHONE_RE.test(form.phone)) {
      notify('error', 'Enter a valid 10-digit mobile number');
      return;
    }
    submitting.current = true;
    setLoading(true);

    try {
      const signature = attemptSignature();
      const prev = unpaid.current;
      let order = null;
      if (prev) {
        const sameAmount = !Number.isFinite(Number(prev.total)) || Math.abs(Number(prev.total) - amounts.payableTotal) < 1;
        if (paymentMethod === 'razorpay' && prev.signature === signature && sameAmount) {
          order = prev; // pay the order already created for exactly this
        } else {
          const outcome = await settleUnpaidOrder(prev.orderId);
          if (outcome === 'paid') { earlierAttemptPaid(prev); return; }
          if (outcome !== 'cancelled') {
            throw new Error('We couldn’t update your earlier payment attempt. Please check your connection and try again.');
          }
          unpaid.current = null;
        }
      }

      if (!order) {
        /* Prices, discounts and the total are computed server-side from the
           products collection — only the lines are sent. */
        const orderRes = await fetch('/api/orders', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({
            items: lines,
            shippingAddress: { ...form },
            payment: { method: paymentMethod },
            couponCode,
            guestEmail: !session ? form.email : undefined,
            /* The fees and coupon discount shown to the customer: the server
               refuses the order if they no longer match its own
               calculation (409 below). */
            shippingCost,
            codFee,
            couponDiscount: couponCode ? discount : undefined,
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
        if (orderRes.status === 409 && orderData.code === 'COUPON_CHANGED') {
          /* The coupon gives a different discount (or none) for this order:
             nothing was ordered — show the new total and let the customer
             confirm it. */
          const couponApplied = orderData.couponApplied === true;
          const serverDiscount = Math.max(0, Number(orderData.discount) || 0);
          const reason = orderData.reason || null;
          /* Refused for good → the remembered welcome code goes too; below
             its minimum it stays for a bigger order. */
          if (!couponApplied && !KEEP_PENDING_REASONS.has(reason)) forgetPendingCoupon(couponCode);
          /* "Couldn't check it just now": nothing changed — the coupon stays
             on and the next tap tries again. */
          if (reason !== 'check_failed') onCouponChanged?.({ code: couponCode, couponApplied, discount: serverDiscount, reason });
          notify('info', orderData.message || (couponApplied
            ? `Your coupon now saves ₹${serverDiscount.toLocaleString('en-IN')} on this order. Please check your total and place the order again.`
            : 'Your coupon can’t be used on this order, so it has been removed. Please check your total and place the order again.'), { icon: 'ℹ️', duration: 10000 });
          return;
        }
        if (!orderData.success) throw new Error(orderData.message || 'Could not place order. Please try again.');
        order = {
          orderId: orderData.data.id || orderData.data._id,
          orderNumber: orderData.data.orderNumber,
          email: form.email,
          couponCode,
          signature,
          total: orderData.data.total,
        };

        if (paymentMethod === 'cod') {
          orderPlaced();
          router.push(orderSuccessPath(order.orderNumber, order.email));
          return;
        }
        /* Kept until it's paid: a retry pays this order instead of placing
           another one. */
        unpaid.current = order;
      }
      const { orderId, orderNumber } = order;

      /* In case the earlier mount-time load hasn't finished (or failed) yet */
      await loadRazorpayScript();

      const payRes = await fetch('/api/payments/create-order', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ orderId }),
      });
      const payData = await payRes.json();
      if (!payData.success) {
        /* The earlier attempt's payment came through (late UPI). */
        if (payData.code === 'ALREADY_PAID') { earlierAttemptPaid(order); return; }
        if (order === prev && payRes.status === 400) {
          /* The earlier order can't be paid any more: paid meanwhile, or
             cancelled (e.g. by the store). */
          const outcome = await settleUnpaidOrder(orderId);
          if (outcome === 'paid') { earlierAttemptPaid(order); return; }
          if (outcome === 'cancelled') {
            unpaid.current = null;
            throw new Error('Your earlier payment attempt has expired. Please tap Place order again.');
          }
        }
        throw new Error(payData.message || 'Payment setup failed. Please try again.');
      }

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
           Firestore (kept for a retry, never cancelled here: a UPI payment
           can still land), but they need to know nothing was charged. */
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
              headers: JSON_HEADERS,
              body: JSON.stringify({
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
                orderId,
              }),
            });
            const verifyData = await verifyRes.json();
            if (verifyData.success) {
              orderPlaced(order.couponCode);
              router.push(orderSuccessPath(orderNumber, order.email));
            } else if (verifyRes.status === 202) {
              /* Money is on hold with the bank and is being captured — the
                 order confirms itself (webhook); don't make them pay again. */
              orderPlaced(order.couponCode);
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
      submitting.current = false;
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
    placed,
    placeOrder,
  };
}
