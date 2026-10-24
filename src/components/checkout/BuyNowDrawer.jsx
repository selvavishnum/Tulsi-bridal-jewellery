'use client';

/* ─────────────────────────────────────────────
   Buy Now: checkout for one piece in a slide-over, without the cart.

   <BuyNowDrawer open onClose product qty />
     product — the product page's product (id/_id, name, price,
               discountPrice, images, stock, sku)
     qty     — the quantity picked on the page (adjustable here, 1..stock)

   Orders ONLY this piece ({ product, quantity }) and never reads or
   changes the cart. The order itself — form, saved addresses, COD rules,
   charges, Razorpay — is the same flow as /checkout (useCheckoutFlow).
   Messages show inline, beside the button that caused them.

   Right-hand drawer from md up; a bottom sheet on phones. Nothing is
   rendered (or loaded) until it opens; each open starts fresh.
   ───────────────────────────────────────────── */
import { useEffect, useId, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { FiX, FiMinus, FiPlus, FiLock, FiTag, FiAlertCircle, FiInfo, FiShield } from 'react-icons/fi';
import { formatPrice } from '@/lib/utils';
import { cldThumb } from '@/lib/cloudinaryImage';
import { getPendingCoupon, clearPendingCoupon } from '@/lib/welcomeOffer';
import { track } from '@/lib/analytics/tracker';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import useCheckoutFlow from './useCheckoutFlow';
import useAutoApplyPendingCoupon from './useAutoApplyPendingCoupon';
import { validateCoupon } from './validateCoupon';
import { AddressFields, PaymentMethodFields } from './CheckoutFields';
import { buyNowSignInUrl, clampQty, couponShortfall, maxOrderQty, shownCouponDiscount, unitPriceOf } from './checkoutRules';

/* Slide in from the bottom (phones) or the right (md+); only for people
   who haven't asked for reduced motion (Tailwind's motion-safe:). */
const KEYFRAMES = '@keyframes tjBuyNowUp{from{transform:translateY(100%)}to{transform:translateY(0)}}'
  + '@keyframes tjBuyNowIn{from{transform:translateX(100%)}to{transform:translateX(0)}}'
  + '@keyframes tjBuyNowFade{from{opacity:0}to{opacity:1}}';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function BuyNowDrawer({ open, onClose, product, qty = 1 }) {
  if (!open || !product) return null;
  return <BuyNowDialog onClose={onClose} product={product} initialQty={qty} />;
}

function BuyNowDialog({ onClose, product, initialQty }) {
  const titleId = useId();
  const panelRef = useRef(null);

  const productId = String(product._id || product.id || '');
  const maxQty = maxOrderQty(product);
  const soldOut = maxQty < 1;
  const unitPrice = unitPriceOf(product);
  const image = product.images?.find(Boolean);

  const [qty, setQty] = useState(() => clampQty(initialQty, maxQty));
  const subtotal = unitPrice * qty;

  /* This order's own coupon — the cart's coupon is left alone. The
     discount is recomputed from it for every quantity (0 below its
     minimum); `pin` is the server's own figure for one exact subtotal. */
  const [coupon, setCouponState] = useState(null);
  const [pin, setPin] = useState(null); // { subtotal, discount }
  const [couponInput, setCouponInput] = useState('');
  const [couponNote, setCouponNote] = useState(null); // { tone: 'error'|'info', text }
  const [couponBusy, setCouponBusy] = useState(false);
  const discount = shownCouponDiscount(coupon, subtotal, pin);
  const shortfall = couponShortfall(coupon, subtotal);
  function setCoupon(next, nextPin = null) {
    setCouponState(next);
    setPin(next ? nextPin : null);
  }

  /* Inline message from the order flow (validation, server, payment). */
  const [feedback, setFeedback] = useState(null); // { type: 'error'|'info', message }

  const flow = useCheckoutFlow({
    lines: soldOut ? [] : [{ product: productId, quantity: qty }],
    subtotal,
    discount,
    couponCode: coupon?.code,
    notify: (type, message) => setFeedback({ type, message }),
    emptyMessage: 'This piece is out of stock right now.',
    preloadPayment: !soldOut,
    /* Points the customer already redeemed come off this order too. */
    withParkedLoyalty: true,
    /* 409 COUPON_CHANGED: off (back in the box when it may still work: a
       bigger order, or a check that kept failing), or the server's figure. */
    onCouponChanged: ({ code, couponApplied, discount: serverDiscount, reason }) => {
      if (couponApplied && coupon) { setPin({ subtotal, discount: serverDiscount }); return; }
      setCoupon(null);
      setCouponInput(reason === 'min_order' || reason === 'check_failed' ? code || '' : '');
    },
  });
  const { status } = flow;
  const signedIn = status === 'authenticated';
  const canOrder = signedIn && !soldOut;
  /* Placed: locked until the confirmation page takes over. */
  const busy = flow.loading || flow.verifying || flow.placed;

  /* Visitor analytics: a signed-in customer reaching checkout (once per open). */
  const tracked = useRef(false);
  useEffect(() => {
    if (!signedIn || tracked.current) return;
    tracked.current = true;
    track('checkout_start');
  }, [signedIn]);

  /* The welcome code tapped in the offer bar, applied on open (or when
     it's tapped while the drawer is open). */
  const autoApply = useAutoApplyPendingCoupon({
    enabled: signedIn && !soldOut && !flow.placed,
    hasCoupon: !!coupon,
    orderAmount: subtotal,
    onApplied: (r) => { setCoupon(r.coupon, { subtotal: r.orderAmount, discount: r.discount }); setCouponNote(null); },
    onRejected: (r) => { setCouponNote({ tone: 'error', text: `${r.code}: ${r.message}` }); if (!r.definite) setCouponInput(r.code); },
    onUnavailable: (r) => {
      setCouponInput(r.code);
      setCouponNote({ tone: 'info', text: `Couldn’t check ${r.code} just now — tap Apply to try again.` });
    },
    onKept: (code) => setCouponInput((c) => c || code),
  });
  /* Hold "Place order" while a coupon is being checked, and for the moment
     the points discount already on the account takes to load (the total
     may still drop). Both give up after a few seconds. */
  const couponChecking = autoApply.checking || couponBusy;
  const holding = couponChecking || flow.loyaltyLoading;

  async function applyCoupon() {
    const code = couponInput.trim().toUpperCase();
    if (!code || couponBusy) return;
    setCouponBusy(true);
    setCouponNote(null);
    const r = await validateCoupon(code, subtotal);
    setCouponBusy(false);
    if (r.ok) {
      setCoupon(r.coupon, { subtotal: r.orderAmount ?? subtotal, discount: r.discount });
      setCouponInput('');
    } else {
      setCouponNote({ tone: 'error', text: r.message });
    }
  }

  /* Off this order — and the remembered welcome code is forgotten if it's
     this one, so the next open doesn't put it straight back. */
  function removeCoupon() {
    const code = coupon?.code || '';
    if (code && getPendingCoupon() === code.toUpperCase()) clearPendingCoupon();
    setCouponInput(code);
    setCoupon(null);
    setCouponNote(null);
  }

  /* Never close mid-order: the payment window would open over nothing. */
  function requestClose() {
    if (busy) return;
    onClose?.();
  }
  const closeRef = useRef(requestClose);
  useEffect(() => { closeRef.current = requestClose; });

  /* Modal behaviour: focus moves in (and back out on close), Esc closes,
     Tab stays inside, the page behind doesn't scroll. */
  useEffect(() => {
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement;
    const { body, documentElement } = document;
    const prevOverflow = body.style.overflow;
    const prevPadding = body.style.paddingRight;
    const scrollbar = window.innerWidth - documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    panel?.focus({ preventScroll: true });

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const active = document.activeElement;
      /* Leave focus alone inside anything layered above us (Razorpay). */
      if (active && active !== body && active !== panel && !panel.contains(active)) return;
      const nodes = [...panel.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === active);
      if (!nodes.length) { e.preventDefault(); panel.focus(); return; }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && (active === first || active === panel || active === body)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || active === body)) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPadding;
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus({ preventScroll: true });
    };
  }, []);

  function submit(e) {
    e.preventDefault();
    if (holding || busy) return;
    setFeedback(null);
    flow.placeOrder(e);
  }

  const total = flow.payableTotal;

  return (
    <div className="fixed inset-0 z-[70]">
      <style>{KEYFRAMES}</style>

      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={requestClose}
        className="absolute inset-0 bg-stone-900/50 backdrop-blur-[2px] motion-safe:animate-[tjBuyNowFade_200ms_ease-out]"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col overflow-hidden rounded-t-3xl bg-ivory shadow-luxury-lg outline-none motion-safe:animate-[tjBuyNowUp_320ms_cubic-bezier(0.22,1,0.36,1)] md:inset-y-0 md:left-auto md:right-0 md:h-full md:max-h-none md:w-full md:max-w-md md:rounded-none md:rounded-l-3xl md:motion-safe:animate-[tjBuyNowIn_320ms_cubic-bezier(0.22,1,0.36,1)]"
      >
        {/* Drag handle (look only) */}
        <div className="flex justify-center pt-2.5 md:hidden" aria-hidden="true">
          <span className="h-1.5 w-10 rounded-full bg-stone-300" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-stone-200/80 px-5 pb-3 pt-2 md:pt-[max(1.25rem,env(safe-area-inset-top))]">
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-widest2 text-gold-700">Quick checkout</p>
            <h2 id={titleId} className="font-serif text-2xl font-bold leading-tight text-wine-900">Buy Now</h2>
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={busy}
            aria-label="Close checkout"
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40"
          >
            <FiX size={20} />
          </button>
        </div>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
            {/* The piece */}
            <section aria-label="Your piece" className="flex gap-3 rounded-2xl bg-white p-3 shadow-card">
              <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl bg-stone-100">
                {image ? (
                  <Image src={cldThumb(image, 160)} alt={product.name || 'Product'} fill unoptimized sizes="64px" className="object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-2xl" aria-hidden="true">💍</div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 font-serif text-base font-semibold leading-snug text-stone-800">{product.name}</p>
                {product.sku && <p className="mt-0.5 text-2xs uppercase tracking-wider text-stone-400">SKU {product.sku}</p>}
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-wine-700">{formatPrice(unitPrice)}</span>
                  {soldOut ? (
                    <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">Out of stock</span>
                  ) : (
                    <div className="flex items-center rounded-full border border-stone-200 bg-white" role="group" aria-label="Quantity">
                      <button
                        type="button"
                        onClick={() => setQty((q) => clampQty(q - 1, maxQty))}
                        disabled={qty <= 1 || busy}
                        aria-label="Decrease quantity"
                        className="flex h-9 w-9 items-center justify-center rounded-full text-stone-600 transition hover:bg-stone-50 disabled:opacity-30"
                      >
                        <FiMinus size={14} />
                      </button>
                      <span className="w-7 text-center text-sm font-semibold tabular-nums" aria-live="polite">{qty}</span>
                      <button
                        type="button"
                        onClick={() => setQty((q) => clampQty(q + 1, maxQty))}
                        disabled={qty >= maxQty || busy}
                        aria-label="Increase quantity"
                        className="flex h-9 w-9 items-center justify-center rounded-full text-stone-600 transition hover:bg-stone-50 disabled:opacity-30"
                      >
                        <FiPlus size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {status === 'loading' && (
              <div className="flex justify-center py-10"><LoadingSpinner size="md" /></div>
            )}

            {status === 'unauthenticated' && (
              <section className="rounded-2xl border border-gold-200 bg-gold-50 p-5 text-center">
                <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-white text-gold-700 shadow-gold" aria-hidden="true">
                  <FiLock size={18} />
                </span>
                <h3 className="font-serif text-xl font-bold text-wine-900">Sign in to place your order</h3>
                <p className="mx-auto mt-1 max-w-xs text-sm text-stone-600">
                  It takes a moment — we&rsquo;ll bring you straight back here with this piece ready to order.
                </p>
                <Link
                  href={buyNowSignInUrl(productId, qty)}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-wine-700 py-3.5 text-sm font-bold text-white shadow-luxury transition hover:bg-wine-800"
                >
                  Sign in to continue
                </Link>
              </section>
            )}

            {signedIn && soldOut && (
              <p className="rounded-2xl bg-white p-5 text-center text-sm text-stone-600 shadow-card" role="status">
                This piece has just sold out, so it can&rsquo;t be ordered right now.
              </p>
            )}

            {canOrder && (
              <>
                {/* Coupon */}
                <section className="rounded-2xl bg-white p-4 shadow-card">
                  <label htmlFor={`${titleId}-coupon`} className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-stone-700">
                    <FiTag className="text-gold-600" aria-hidden="true" /> Coupon code
                  </label>
                  {coupon ? (
                    <div className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${shortfall > 0 ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'}`}>
                      {shortfall > 0 ? (
                        <p className="min-w-0 text-sm text-amber-800" role="status">
                          Add {formatPrice(shortfall)} more to use <span className="font-bold">{coupon.code}</span>
                        </p>
                      ) : (
                        <p className="min-w-0 text-sm text-green-800" role="status">
                          <span className="font-bold">{coupon.code}</span> applied — you save {formatPrice(discount)}
                          {coupon.firstOrderOnly && <span className="block text-2xs text-green-700/80">First-order offer · confirmed when you place the order</span>}
                        </p>
                      )}
                      <button type="button" onClick={removeCoupon} disabled={busy} className="flex-shrink-0 text-xs font-semibold text-stone-500 underline-offset-2 hover:text-red-600 hover:underline disabled:opacity-40">
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        id={`${titleId}-coupon`}
                        type="text"
                        value={couponInput}
                        onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyCoupon(); } }}
                        placeholder="Enter code"
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2.5 text-base uppercase outline-none focus:ring-2 focus:ring-gold-500 md:text-sm"
                      />
                      <button
                        type="button"
                        onClick={applyCoupon}
                        disabled={couponBusy || !couponInput.trim() || busy}
                        className="flex-shrink-0 rounded-lg bg-gold-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-gold-700 disabled:opacity-50"
                      >
                        {couponBusy ? 'Checking…' : 'Apply'}
                      </button>
                    </div>
                  )}
                  {couponNote && (
                    <p className={`mt-2 text-xs ${couponNote.tone === 'error' ? 'text-red-600' : 'text-stone-500'}`} role={couponNote.tone === 'error' ? 'alert' : 'status'}>{couponNote.text}</p>
                  )}
                </section>

                {/* Shipping */}
                <section className="rounded-2xl bg-white p-4 shadow-card">
                  <h3 className="mb-3 text-sm font-semibold text-stone-700">Delivery address</h3>
                  <AddressFields flow={flow} />
                </section>

                {/* Payment */}
                <section className="rounded-2xl bg-white p-4 shadow-card">
                  <h3 className="mb-3 text-sm font-semibold text-stone-700">Payment method</h3>
                  <PaymentMethodFields flow={flow} />
                </section>

                {/* Summary */}
                <section aria-label="Order summary" className="rounded-2xl bg-white p-4 text-sm text-stone-600 shadow-card">
                  <div className="space-y-2">
                    <div className="flex justify-between"><span>Subtotal{qty > 1 ? ` (${qty} pieces)` : ''}</span><span>{formatPrice(subtotal)}</span></div>
                    {discount > 0 && (
                      <div className="flex justify-between text-green-700"><span>Coupon {coupon?.code}</span><span>−{formatPrice(discount)}</span></div>
                    )}
                    {flow.loyaltyDiscount > 0 && (
                      <div className="flex justify-between text-amber-700"><span>Points discount</span><span>−{formatPrice(flow.loyaltyDiscount)}</span></div>
                    )}
                    {flow.shippingCost > 0 && (
                      <div className="flex justify-between"><span>Shipping</span><span>{formatPrice(flow.shippingCost)}</span></div>
                    )}
                    {flow.codFee > 0 && (
                      <div className="flex justify-between"><span>COD fee</span><span>{formatPrice(flow.codFee)}</span></div>
                    )}
                    <div className="flex justify-between border-t border-stone-100 pt-2 text-base font-bold text-stone-800">
                      <span>Total</span><span>{formatPrice(total)}</span>
                    </div>
                  </div>
                </section>
              </>
            )}
          </div>

          {/* Footer: the one button */}
          {canOrder && (
            <div className="border-t border-stone-200/80 bg-white/95 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
              {feedback && (
                <div
                  role={feedback.type === 'error' ? 'alert' : 'status'}
                  className={`mb-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs leading-relaxed ${feedback.type === 'error' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}
                >
                  {feedback.type === 'error'
                    ? <FiAlertCircle className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                    : <FiInfo className="mt-0.5 flex-shrink-0" aria-hidden="true" />}
                  <span className="min-w-0 flex-1">{feedback.message}</span>
                  <button type="button" onClick={() => setFeedback(null)} aria-label="Dismiss message" className="-m-1 flex-shrink-0 p-1 opacity-60 hover:opacity-100">
                    <FiX size={14} />
                  </button>
                </div>
              )}
              <button
                type="submit"
                disabled={busy || holding}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-wine-700 py-4 text-base font-bold text-white shadow-luxury transition hover:bg-wine-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {flow.placed ? 'Order placed — opening confirmation…'
                  : flow.loading ? <><LoadingSpinner size="sm" /> Placing order…</>
                    : couponChecking ? <><LoadingSpinner size="sm" /> Checking coupon…</>
                      : `Place order · ${formatPrice(total)}`}
              </button>
              <p className="mt-2 flex items-center justify-center gap-1.5 text-2xs text-stone-400">
                <FiShield aria-hidden="true" />
                {flow.paymentMethod === 'cod' ? 'Pay in cash when your order arrives' : 'Secure payment by Razorpay · UPI, cards, net banking'}
              </p>
            </div>
          )}
        </form>

        {/* Payment returned from Razorpay — confirming it */}
        {flow.verifying && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-ivory/90 text-center backdrop-blur-sm" role="status" aria-live="polite">
            <LoadingSpinner size="lg" />
            <p className="font-serif text-lg font-semibold text-wine-900">Confirming your payment…</p>
            <p className="max-w-[16rem] text-xs text-stone-500">Please don&rsquo;t close this window.</p>
          </div>
        )}
      </div>
    </div>
  );
}
