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
   • the points discount shown includes what the customer redeemed on an
     earlier visit (parked on their account, GET /api/loyalty
     parkedDiscount): the server takes it off whatever they order next.
     It is sent with the order too (signed-in customers); the server
     answers 409 LOYALTY_CHANGED with its own figure, which is shown for
     the customer to confirm;
   • a new order may find an earlier attempt paid on Razorpay after all
     (409 EARLIER_ORDER_PAID → that order's confirmation page) or a payment
     on it still going through (EARLIER_PAYMENT_PENDING → nothing placed;
     the customer waits and checks My Orders);
   • paying the kept order again: create-order answers ALREADY_PAID (→ the
     confirmation page) or ORDER_CANCELLED (→ a fresh order for what is on
     screen — unless the points discount changed meanwhile, or the attempt
     was replaced by a newer order from another tab or window: then
     nothing is placed in that tap, and the customer is told).
     Any other failure is shown as it is, and nothing is cancelled;
   • money that lands on an attempt already replaced or cancelled is not
     an order (verify 409 PAID_AFTER_CANCEL, or a look-up finding it
     cancelled and paid): it is refunded — never the confirmation page;
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
import { fetchJsonWithin } from './fetchWithin';

/* How long the points balance may take to load before checkout carries on
   without it (Place order is held meanwhile). */
export const LOYALTY_LOAD_TIMEOUT_MS = 8000;

const toastNotify = (type, message, options) => (type === 'error' ? toast.error(message, options) : toast(message, options));

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const ADDRESS_KEYS = ['fullName', 'phone', 'email', 'street', 'city', 'state', 'pincode'];

/* COUPON_CHANGED reasons that say nothing final about the code: below its
   minimum (a bigger order can use it), not signed in, or the server
   couldn't check it just now. */
const KEEP_PENDING_REASONS = new Set(['min_order', 'sign_in_required', 'check_failed']);

/* "Couldn't check the coupon just now" this many times in a row → the
   coupon comes off, so the customer isn't stuck retrying. */
export const CHECK_FAILED_LIMIT = 2;

/* The kept attempt was replaced by a newer order of the customer's
   (another tab or window): that may be the order they wanted. */
const REPLACED_MESSAGE = 'This payment was replaced by your newer order. Please check My Orders — tap the button again only if you want another order.';
/* Paid for an attempt already replaced or cancelled: refunded, not placed
   (verify's 409 PAID_AFTER_CANCEL; the same found by a look-up). */
const PAID_AFTER_CANCEL_MESSAGE = 'This payment was for an order that had already been replaced or cancelled, so it was not placed. We will refund it to your original payment method.';
const EARLIER_PAYMENT_REFUNDED = 'Your earlier payment was for an order that had already been replaced or cancelled, so it was not placed. We will refund it to your original payment method.';

/* The remembered welcome code is forgotten once THIS code was spent or refused. */
function forgetPendingCoupon(code) {
  const pending = getPendingCoupon();
  if (pending && code && String(code).toUpperCase() === pending) clearPendingCoupon();
}

/* GET /api/loyalty → { data, parked } (parked: the ₹ points discount the
   next order takes, before the 20% cap), or null — offline, too slow, or
   refused: checkout carries on without it (the server decides anyway). */
async function loadLoyalty() {
  try {
    const { data: d } = await fetchJsonWithin('/api/loyalty', {}, { ms: LOYALTY_LOAD_TIMEOUT_MS });
    if (!d?.success || !d.data) return null;
    return { data: d.data, parked: Math.max(0, Math.floor(Number(d.data.parkedDiscount) || 0)) };
  } catch { return null; }
}

async function readOrder(orderId) {
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`);
    const data = await res.json();
    return data?.success ? data.data : null;
  } catch { return null; }
}

/* A looked-up order is for exactly these lines: the same pieces, the same
   quantities (the server merges repeated pieces into one line). */
function isOrderFor(order, lines) {
  const count = (list) => (list || []).reduce((m, l) => m.set(String(l.product), (m.get(String(l.product)) || 0) + Number(l.quantity)), new Map());
  const had = count(order?.items);
  const want = count(lines);
  return had.size > 0 && had.size === want.size && [...want].every(([p, q]) => had.get(p) === q);
}

/* A looked-up order → 'gone' (cancelled — checked first: money that
   arrived after the cancel is being refunded, it is not an order), 'paid',
   or null (still open, or not found). */
function finishedAs(order) {
  if (order?.status === 'cancelled') return 'gone';
  if (order?.payment?.status === 'paid') return 'paid';
  return null;
}

/**
 * An earlier unpaid online order is being given up → { outcome, seen }:
 * paid meanwhile ('paid' — never cancel it), cancelled now ('cancelled'),
 * found cancelled by something else ('gone' — e.g. replaced by an order
 * from another tab, which took its points discount; `seen` is that order
 * as looked up), or we couldn't tell ('failed' — place nothing new, it
 * would hold the coupon twice).
 */
async function settleUnpaidOrder(orderId) {
  const before = await readOrder(orderId);
  const was = finishedAs(before);
  if (was) return { outcome: was, seen: before };
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      /* unpaidOnly: refused if a payment was confirmed since the look-up. */
      body: JSON.stringify({ status: 'cancelled', unpaidOnly: true }),
    });
    const data = await res.json().catch(() => null);
    if (data?.success) return { outcome: 'cancelled' };
    /* Razorpay has the money although we haven't heard yet (late UPI). */
    if (data?.code === 'ALREADY_PAID') return { outcome: 'paid' };
  } catch { /* offline — looked up below */ }
  const after = await readOrder(orderId);
  return { outcome: finishedAs(after) || 'failed', seen: after };
}

/**
 * @param {object} p
 * @param {{ product: string, quantity: number }[]} p.lines  what is being bought
 * @param {number} p.subtotal       display subtotal of those lines
 * @param {number} [p.discount]     coupon discount shown
 * @param {string} [p.couponCode]   coupon to send (the server re-validates it)
 * @param {boolean} [p.withLoyalty] load and offer loyalty points (the page);
 *   includes withParkedLoyalty
 * @param {boolean} [p.withParkedLoyalty] load the points discount already
 *   redeemed on the customer's account (the drawer) — the server takes it
 *   off any order they place, so every checkout that places orders for a
 *   signed-in customer must show it
 * @param {boolean} [p.preloadPayment] start loading Razorpay now (default true)
 * @param {(type: 'error'|'info', message: string, options?: object) => void} [p.notify]
 * @param {string} [p.emptyMessage] shown if there is nothing to order
 * @param {() => void} [p.onOrderPlaced] runs once the order is placed (COD,
 *   paid, or paid-and-held), just before leaving for the confirmation page
 * @param {(c: { code: string, couponApplied: boolean, discount: number, reason: string|null }) => void} [p.onCouponChanged]
 *   the server would apply the coupon differently from what was shown (409
 *   COUPON_CHANGED): remove it (couponApplied false) or show `discount`
 *   for the current subtotal. Nothing was ordered; the customer is told.
 *   Also called (couponApplied false, reason 'check_failed') once the
 *   server couldn't check the coupon CHECK_FAILED_LIMIT times in a row.
 */
export default function useCheckoutFlow({
  lines,
  subtotal,
  discount = 0,
  couponCode,
  withLoyalty = false,
  withParkedLoyalty = false,
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
  /* COUPON_CHANGED 'check_failed' answers in a row, for one code. */
  const checkFailed = useRef({ code: null, count: 0 });
  const [loyalty, setLoyalty] = useState({ points: 0 });
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(false);
  /* Points discount (₹) redeemed before this page opened and still parked
     on the account — including what an abandoned online attempt holds,
     which the next order takes over (GET /api/loyalty parkedDiscount). */
  const wantsParked = withLoyalty || withParkedLoyalty;
  /* This checkout shows the points discount (a signed-in customer): it is
     sent with the order, for the server to check. */
  const knowsLoyalty = wantsParked && status === 'authenticated';
  const [parked, setParked] = useState(0);
  const [loyaltyLoaded, setLoyaltyLoaded] = useState(false);
  /* Place order waits for it: the server takes it off the order anyway. */
  const loyaltyLoading = knowsLoyalty && !loyaltyLoaded;
  /* What was redeemed on this page (₹). The order takes at most 20% of the
     subtotal of parked + redeemed, and no more than the coupon leaves (the
     rest stays parked for a later order) — `loyaltyDiscount` below, the
     same rule the server applies. */
  const [redeemed, setRedeemed] = useState(0);
  const loyaltyDiscount = loyaltyDiscountFor(parked + redeemed, subtotal, discount);
  const [redeemingPoints, setRedeeming] = useState(false);
  /* Offered once per visit, while points would still lower this order. */
  const canRedeemPoints = withLoyalty && loyaltyEnabled && (Number(loyalty.points) || 0) >= 50
    && redeemed === 0 && loyaltyDiscount < loyaltyDiscountFor(Infinity, subtotal, discount);
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
    if (wantsParked) {
      loadLoyalty()
        .then((d) => { if (d) { setLoyalty(d.data); setParked(d.parked); } })
        .finally(() => setLoyaltyLoaded(true));
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
  }, [status, wantsParked]);

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

  /* Points → a parked discount on the account, which this order (and, past
     the 20% cap, the next one) takes. /checkout offers it once per visit
     (canRedeemPoints). A redemption can't be undone — the server takes
     parked points off the next order whatever a page shows — so a second
     call doesn't hide it: it re-reads the account's parked discount. */
  async function redeemLoyaltyPoints() {
    if (redeemed > 0) {
      const d = await loadLoyalty();
      if (d) { setLoyalty(d.data); setParked(d.parked); setRedeemed(0); }
      return;
    }
    setRedeeming(true);
    try {
      const res = await fetch('/api/loyalty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'redeem' }),
      });
      const data = await res.json();
      if (data.success) {
        const added = Math.max(0, Number(data.data.discount) || 0);
        setRedeemed(added);
        setLoyalty((prev) => ({ ...prev, points: prev.points - data.data.pointsRedeemed }));
        const gain = loyaltyDiscountFor(parked + added, subtotal, discount) - loyaltyDiscount;
        if (gain > 0) toast.success(`₹${gain} discount applied!`);
        else toast.success('Points redeemed — they’ll come off your next order.');
      } else {
        toast.error(data.message);
      }
    } catch { toast.error('Failed to redeem points'); }
    finally { setRedeeming(false); }
  }

  /* The order is placed: a remembered welcome code it used is spent, and
     the button stays locked until the confirmation page takes over.
     `ofScreen` false: the order placed is not what is on screen (an
     earlier attempt, for other pieces) — the caller's basket is kept. */
  function orderPlaced(usedCode = couponCode, ofScreen = true) {
    placedRef.current = true;
    unpaid.current = null;
    setPlaced(true);
    forgetPendingCoupon(usedCode);
    if (ofScreen) onOrderPlaced?.();
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

  /* The kept attempt turned out cancelled by something else before a
     fresh order is placed for it: replaced by a newer order of the
     customer's (another tab), which took its points discount — or
     expired / cancelled by the store, which gave it back. The points
     discount shown may no longer be what the fresh order gets: re-read it,
     and if it changed show the new total instead of placing (false) —
     saying so unless `tell` is false. */
  async function parkedStillAsShown(tell = true) {
    if (!knowsLoyalty) return true;
    const d = await loadLoyalty();
    if (!d || loyaltyDiscountFor(d.parked, subtotal, discount) === loyaltyDiscount) return true;
    setLoyalty(d.data);
    setParked(d.parked);
    setRedeemed(0);
    if (tell) notify('info', 'Your points discount has changed — an order placed in another tab or window used it. Please check your total and place the order again.', { icon: 'ℹ️', duration: 10000 });
    return false;
  }

  /**
   * The kept attempt turned out cancelled (`seen`: as looked up, if it
   * was; `replaced`: create-order said a newer order replaced it). Place a
   * fresh order for what is on screen in this tap (true), or tell the
   * customer and place nothing (false) — the next tap places it:
   *   • it was paid after the cancel: that money is being refunded;
   *   • a newer order of theirs replaced it (another tab or window): that
   *     may be the order they wanted — the total shown is brought up to
   *     date (the newer order may hold the points discount);
   *   • the points discount changed (parkedStillAsShown).
   */
  async function freshOrderWanted(seen, replaced = false) {
    if (seen?.status === 'cancelled' && seen.payment?.status === 'paid') {
      notify('info', EARLIER_PAYMENT_REFUNDED, { icon: 'ℹ️', duration: 15000 });
      return false;
    }
    if (replaced || seen?.cancelReason === 'replaced') {
      await parkedStillAsShown(false);
      notify('info', REPLACED_MESSAGE, { icon: 'ℹ️', duration: 15000 });
      return false;
    }
    return parkedStillAsShown();
  }

  /* An earlier attempt turned out paid: that's the order. Without its
     order number (a look-up that failed) My Orders has it — for a guest,
     order tracking (the number is in their confirmation email). */
  function earlierAttemptPaid(prev, message = 'Your earlier payment went through — opening your order.', ofScreen = true) {
    notify('info', message, { icon: '✅' });
    orderPlaced(prev.couponCode, ofScreen);
    router.push(prev.orderNumber ? orderSuccessPath(prev.orderNumber, prev.email) : session ? '/account' : '/track-order');
  }

  /* 409 EARLIER_ORDER_PAID: placing this order found an earlier attempt of
     the customer's paid on Razorpay, and the server confirmed it instead —
     nothing new was placed. Opened as an earlier attempt that turned out
     paid is (looked up for its order number). The basket (the cart) goes
     only if that order is for exactly what is on screen: an earlier Buy
     Now for another piece, or a look-up that failed, leaves it. */
  async function earlierOrderConfirmed(answer) {
    const o = answer.orderId ? await readOrder(String(answer.orderId)) : null;
    earlierAttemptPaid({
      orderNumber: o?.orderNumber,
      email: o?.shippingAddress?.email || o?.guestEmail || form.email,
      couponCode: o?.couponCode,
    }, answer.message || 'Your earlier payment went through — we have confirmed that order.', isOrderFor(o, lines));
  }

  /* 409 LOYALTY_CHANGED: the server takes a different points discount
     than shown (e.g. an order from another tab took it over, or it didn't
     load here). Its parked amount (before the caps, as GET /api/loyalty
     parkedDiscount) is shown instead, so the next tap matches. */
  async function adoptServerParked(answer) {
    if (typeof answer.parkedDiscount === 'number' && Number.isFinite(answer.parkedDiscount)) {
      setParked(Math.max(0, Math.floor(answer.parkedDiscount)));
      setRedeemed(0);
      return;
    }
    const d = await loadLoyalty(); // an answer without it: read it
    if (d) { setLoyalty(d.data); setParked(d.parked); setRedeemed(0); }
  }

  /* "Couldn't check the coupon just now" (409 COUPON_CHANGED check_failed):
     the coupon stays on and the next tap tries again — until it has
     happened CHECK_FAILED_LIMIT times in a row: then it comes off. */
  function couponCheckFailed(message) {
    const code = String(couponCode || '').toUpperCase();
    const count = checkFailed.current.code === code ? checkFailed.current.count + 1 : 1;
    if (count < CHECK_FAILED_LIMIT) {
      checkFailed.current = { code, count };
      notify('info', message || `We couldn’t check ${code} just now. Please try again.`, { icon: 'ℹ️', duration: 10000 });
      return;
    }
    checkFailed.current = { code: null, count: 0 };
    /* Forgotten too, or the page would put it straight back on. */
    forgetPendingCoupon(couponCode);
    onCouponChanged?.({ code: couponCode, couponApplied: false, discount: 0, reason: 'check_failed' });
    notify('info', `We still couldn’t check ${code}, so it has been taken off this order. Please check your total and place the order again.`, { icon: 'ℹ️', duration: 10000 });
  }

  /* POST /api/orders for what is on screen → the new order, or null when
     the answer was handled here: a 409 (the new total is shown, nothing
     was ordered; or an earlier attempt turned out paid, or its payment is
     still going through) or a COD order placed. Throws on any other
     failure. */
  async function submitOrder(signature) {
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
        /* The points discount shown — 0 too (e.g. the points didn't
           load): a different figure on the server is 409 LOYALTY_CHANGED. */
        loyaltyDiscount: knowsLoyalty ? loyaltyDiscount : undefined,
      }),
    });
    const orderData = await orderRes.json();
    const conflict = orderRes.status === 409 ? orderData.code : null;
    const couponChanged = conflict === 'COUPON_CHANGED';
    if (!(couponChanged && orderData.reason === 'check_failed')) checkFailed.current = { code: null, count: 0 };
    if (conflict === 'CHARGES_CHANGED') {
      /* The admin changed the charges while this page was open: show the
         new total and let the customer confirm again. */
      await refreshCharges();
      notify('info', orderData.message, { icon: 'ℹ️', duration: 10000 });
      return null;
    }
    if (conflict === 'LOYALTY_CHANGED') {
      /* Nothing was ordered: show the server's points discount and let the
         customer confirm the new total. */
      await adoptServerParked(orderData);
      const now = Math.max(0, Number(orderData.loyaltyDiscount) || 0);
      notify('info', orderData.message || `Your points discount is now ₹${now.toLocaleString('en-IN')}. Please check your total and place the order again.`, { icon: 'ℹ️', duration: 10000 });
      return null;
    }
    if (conflict === 'EARLIER_ORDER_PAID') {
      await earlierOrderConfirmed(orderData);
      return null;
    }
    if (conflict === 'EARLIER_PAYMENT_PENDING') {
      /* An earlier attempt's payment may still go through (or Razorpay
         couldn't be asked just now): nothing was placed or cancelled. */
      notify('info', orderData.message || 'Your earlier payment is still being processed. Please wait a few minutes and check My Orders before paying again.', { icon: 'ℹ️', duration: 15000 });
      return null;
    }
    if (couponChanged) {
      /* The coupon gives a different discount (or none) for this order:
         nothing was ordered — show the new total and let the customer
         confirm it. */
      const couponApplied = orderData.couponApplied === true;
      const serverDiscount = Math.max(0, Number(orderData.discount) || 0);
      const reason = orderData.reason || null;
      if (reason === 'check_failed') { couponCheckFailed(orderData.message); return null; }
      /* Refused for good → the remembered welcome code goes too; below
         its minimum it stays for a bigger order. */
      if (!couponApplied && !KEEP_PENDING_REASONS.has(reason)) forgetPendingCoupon(couponCode);
      onCouponChanged?.({ code: couponCode, couponApplied, discount: serverDiscount, reason });
      notify('info', orderData.message || (couponApplied
        ? `Your coupon now saves ₹${serverDiscount.toLocaleString('en-IN')} on this order. Please check your total and place the order again.`
        : 'Your coupon can’t be used on this order, so it has been removed. Please check your total and place the order again.'), { icon: 'ℹ️', duration: 10000 });
      return null;
    }
    if (!orderData.success) throw new Error(orderData.message || 'Could not place order. Please try again.');
    const order = {
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
      return null;
    }
    return order;
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
          const { outcome, seen } = await settleUnpaidOrder(prev.orderId);
          if (outcome === 'paid') { earlierAttemptPaid(prev); return; }
          if (outcome !== 'cancelled' && outcome !== 'gone') {
            throw new Error('We couldn’t update your earlier payment attempt. Please check your connection and try again.');
          }
          unpaid.current = null;
          if (outcome === 'gone' && !(await freshOrderWanted(seen))) return;
        }
      }

      /* Round 2 only after ORDER_CANCELLED on the kept order: a fresh order
         for what is on screen. */
      let payData = null;
      for (let round = 0; !payData; round += 1) {
        if (!order) {
          order = await submitOrder(signature);
          if (!order) return; // answered (409 → new total shown, or COD placed)
          /* Kept until it's paid: a retry pays this order instead of placing
             another one. */
          unpaid.current = order;
        }

        /* In case the earlier mount-time load hasn't finished (or failed) yet */
        await loadRazorpayScript();

        const payRes = await fetch('/api/payments/create-order', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ orderId: order.orderId }),
        });
        const answer = await payRes.json().catch(() => null);
        if (answer?.success) { payData = answer; break; }

        /* The kept order's payment came through (late UPI). */
        if (answer?.code === 'ALREADY_PAID') { earlierAttemptPaid(order); return; }
        const retry = order === prev;
        const replaced = answer?.code === 'ORDER_CANCELLED' && answer.replaced === true;
        let gone = answer?.code === 'ORDER_CANCELLED';
        let seen = null;
        if (!gone && retry && !answer?.code) {
          /* No code (e.g. a proxy's error page): look the kept order up —
             only a look-up, nothing is cancelled. Cancelled is checked
             first: paid after its cancel is a refund, not an order. */
          seen = await readOrder(order.orderId);
          const now = finishedAs(seen);
          if (now === 'paid') { earlierAttemptPaid(order); return; }
          gone = now === 'gone';
        }
        if (gone) {
          /* Cancelled (by the store or the daily clean-up — its coupon use
             and points went back — or replaced by a later order, which
             took them over): it can't be paid. A fresh order goes in the
             same tap only for the kept order, and never when a newer order
             replaced it. */
          if (unpaid.current === order) unpaid.current = null;
          if (replaced || (retry && round === 0)) {
            if (!(await freshOrderWanted(seen, replaced))) return;
            order = null;
            continue;
          }
        }
        /* Anything else (online payment paused, Razorpay down…): shown as
           it is; the kept order stays for the next tap. */
        throw new Error(answer?.message || 'Payment setup failed. Please try again.');
      }
      const { orderId, orderNumber } = order;

      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: payData.data.amount,
        currency: payData.data.currency,
        name: 'Tulsi Fashion Jewellery',
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
            } else if (verifyRes.status === 409 && verifyData.code === 'PAID_AFTER_CANCEL') {
              /* Paid for an attempt replaced or cancelled meanwhile (e.g.
                 by an order from another tab): not an order — refunded.
                 The next tap places a fresh one. */
              setVerifying(false);
              if (unpaid.current?.orderId === orderId) unpaid.current = null;
              notify('info', verifyData.message || PAID_AFTER_CANCEL_MESSAGE, { icon: 'ℹ️', duration: 15000 });
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
    loyaltyLoading,
    canRedeemPoints,
    redeemingPoints,
    redeemLoyaltyPoints,
    ...amounts,
    loading,
    verifying,
    placed,
    placeOrder,
  };
}
