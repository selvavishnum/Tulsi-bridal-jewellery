import { NextResponse } from 'next/server';
import { getDB, FieldValue, snapshotToArr } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';
import { sendOrderConfirmation, sendOrderNotificationToAdmin } from '@/lib/email';
import { notifyVendorsOfOrder } from '@/lib/vendorNotify';
import { sendOrderWhatsAppToAdmin, sendOrderWhatsAppToCustomer } from '@/lib/whatsapp';
import { getAvailableCouriers, isConfigured as shiprocketConfigured } from '@/lib/shiprocket';
import { PLATFORM_VENDOR_ID, validateVendorPricing, toCustomerOrder, marginFor, vendorShippingOf } from '@/lib/settlement';
import { getAccess } from '@/lib/requireRole';
import { CAN, toFulfillmentOrder } from '@/lib/access';
import { canMatchGuestOrders } from '@/lib/orderOwnership';
import { normalizeEmail, isValidEmail } from '@/lib/otp';
import { computeCharges } from '@/lib/storeCharges';
import { getStoreCharges } from '@/lib/storeChargesServer';
import { hasPlacedOrder, isAbandonedAttempt, couponDiscountFor, couponStateRefusal, couponUsesBy, couponRefusalMessage } from '@/lib/coupons';
import { holdsParkedLoyalty, attemptsHoldingLoyalty } from '@/lib/loyalty';
import crypto from 'crypto';
import { vendorCanSell } from '@/lib/vendorStatus';
import { analyticsVidFrom } from '@/lib/analytics/ingest';

/* Shipping and COD fees come from the admin's Shipping & Payment Charges
   (settings/store_settings), read fresh for every order — see
   src/lib/storeCharges.js, the one rule the cart and checkout also use. */
const PAYMENT_METHODS = ['razorpay', 'cod'];
/* Loyalty may cover at most this share of an order, so a large parked balance
   can never bring the amount payable to zero. */
const MAX_LOYALTY_SHARE = 0.2;
/* COD limit — mirrored on the checkout page for display only; this is
   the enforced copy. */
const COD_MAX_ORDER_VALUE = 20000;

const MAX_LINES = 50;

/* A coupon that can't be applied as the shopper was shown it, found inside
   the order transaction (the coupon changed since the check before it). */
class CouponChangedError extends Error {
  constructor(reason, discount = 0) {
    super(reason);
    this.reason = reason;
    this.discount = discount;
  }
}

/* An amount the checkout says it showed: null when not sent (an older page). */
const shown = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

/**
 * The coupon as checkout applies it — the same rules and discount formula
 * as /api/coupons/validate. A coupon applies if it's active, started,
 * unexpired, under its use limit (0 = unlimited), this customer hasn't
 * spent their use, the order meets its minimum and — first-order-only
 * codes — a signed-in customer has no placed order (by account or proven
 * email; never by delivery phone — see hasPlacedOrder).
 *
 * Once per customer: usedBy holds this customer's key from the moment an
 * order with the code is created — also an online order whose payment is
 * then abandoned. That use is spent only if one of their orders with the
 * code was actually placed (isPlacedOrder); otherwise this order re-uses it
 * (heldByMe) instead of losing the discount.
 *
 * @returns {{ code, reason: string|null, discount, id?, data?, minOrderAmount?, heldByMe? }}
 */
async function resolveCoupon(db, { couponCode, subtotal, couponUserKey, session }) {
  const code = String(couponCode).trim().toUpperCase();
  const cSnap = await db.collection('coupons').where('code', '==', code).limit(1).get();
  if (cSnap.empty) return { code, reason: 'not_found', discount: 0 };
  const id = cSnap.docs[0].id;
  const c = cSnap.docs[0].data();
  const base = { id, data: c, code: c.code || code, minOrderAmount: Number(c.minOrderAmount) || 0, discount: 0 };
  const heldByMe = Array.isArray(c.usedBy) && c.usedBy.includes(couponUserKey);

  const state = couponStateRefusal(c, { ownUseCounted: heldByMe });
  if (state) return { ...base, reason: state };
  /* Order-history lookups (before the minimum, as /api/coupons/validate:
     a returning customer isn't told to add more for a code they can't use).
     If one fails the code isn't applied (the order still goes through for
     an older page; a current one is asked to retry). */
  try {
    if (c.firstOrderOnly === true) {
      /* Never without a signed-in account: a sessionless API order could
         otherwise be a "first order" with every new email. */
      if (!session?.user?.id) return { ...base, reason: 'sign_in_required' };
      const email = canMatchGuestOrders(session.user) ? session.user.email : null;
      if (await hasPlacedOrder(db, { userId: session.user.id, email })) return { ...base, reason: 'first_order_only' };
    }
    if (heldByMe && (await couponUsesBy(db, { couponId: id, userKey: couponUserKey })).placed) return { ...base, reason: 'used' };
  } catch (e) {
    console.error('[orders POST] coupon order-history check failed:', e?.message);
    return { ...base, reason: 'check_failed' };
  }
  if (subtotal < base.minOrderAmount) return { ...base, reason: 'min_order' };
  return { ...base, reason: null, heldByMe, discount: couponDiscountFor(c, subtotal) };
}

/* 409: the coupon discount the shopper was shown is not what this order
   would get. Nothing is created; the checkout updates its total. */
function couponChangedResponse({ code, reason, discount = 0, minOrderAmount = 0, shownDiscount }) {
  const applied = reason === 'amount_changed';
  let message;
  if (applied) message = `${code} now takes ${inr(discount)} off this order${Number.isFinite(shownDiscount) ? ` (not ${inr(shownDiscount)})` : ''}. Please check your total and place the order again.`;
  else if (reason === 'check_failed') message = couponRefusalMessage(reason, { code });
  else message = `${couponRefusalMessage(reason, { code, minOrderAmount })} Please check your total and place the order again.`;
  return NextResponse.json({
    success: false,
    code: 'COUPON_CHANGED',
    couponApplied: applied,
    discount: applied ? discount : 0,
    reason,
    message,
  }, { status: 409 });
}

/* This customer's abandoned online attempts that still hold parked loyalty
   discount (refs; re-read inside the order transaction). A failed read
   just means no hand-over. */
async function abandonedLoyaltyHolders(db, userId) {
  try {
    return (await attemptsHoldingLoyalty(db, userId)).map((d) => d.ref);
  } catch (e) {
    console.error('[orders POST] abandoned-attempt lookup failed:', e?.message);
    return [];
  }
}

const ADDRESS_FIELDS = { fullName: 80, name: 80, phone: 15, email: 254, street: 200, address: 200, landmark: 120, city: 60, state: 60, pincode: 6, country: 40 };

/* Only known address fields, strings only, bounded, no markup characters. */
function parseShippingAddress(input) {
  const value = {};
  for (const [k, max] of Object.entries(ADDRESS_FIELDS)) {
    if (input[k] === undefined || input[k] === null) continue;
    if (typeof input[k] !== 'string' && typeof input[k] !== 'number') return { error: 'Invalid shipping address' };
    const v = String(input[k]).trim();
    if (v.length > max) return { error: `Shipping address ${k} is too long` };
    if (/[<>]/.test(v)) return { error: 'Shipping address can’t contain < or >' };
    value[k] = v;
  }
  value.name = value.fullName || value.name || '';
  if (!value.name || !(value.street || value.address) || !value.city || !/^[1-9]\d{5}$/.test(value.pincode || '')) {
    return { error: 'Enter your name, address, city and a 6-digit pincode' };
  }
  if (!/^[+\d][\d\s-]{7,14}$/.test(value.phone || '')) return { error: 'Enter a valid phone number' };
  if (value.email) value.email = normalizeEmail(value.email);
  return { value };
}

export async function GET(request) {
  try {
    /* Zero trust: the caller's tier is re-read from its source, not the token. */
    const access = await getAccess();
    const session = access.session;
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

    const db = getDB();
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const status = searchParams.get('status');

    /* All orders: SUPER_ADMIN in full; order, sales and business staff
       without cost/margin fields. Catalog/inventory staff and vendors fall
       through to the customer view below (their own purchases only). */
    if (CAN.viewOrders.includes(access.tier)) {
      const snap = await db.collection('orders').orderBy('createdAt', 'desc').get();
      let orders = snap.docs.map((d) => ({ id: d.id, _id: d.id, ...d.data() }));
      if (!CAN.manageOrders.includes(access.tier)) orders = orders.map(toFulfillmentOrder);
      if (status) orders = orders.filter((o) => o.status === status);
      const total = orders.length;
      const pages = Math.ceil(total / limit);
      const start = (page - 1) * limit;
      return NextResponse.json({ success: true, data: { orders: orders.slice(start, start + limit), total, pages, page } });
    }

    const [byUserId, byEmail] = await Promise.all([
      db.collection('orders').where('userId', '==', session.user.id).get(),
      /* Guest orders by email only once the user has proved that email. */
      canMatchGuestOrders(session.user)
        ? db.collection('orders').where('guestEmail', '==', String(session.user.email).toLowerCase()).get()
        : Promise.resolve({ docs: [] }),
    ]);

    const seen = new Set();
    const merged = [];
    for (const doc of [...byUserId.docs, ...byEmail.docs]) {
      if (!seen.has(doc.id)) {
        seen.add(doc.id);
        merged.push({ id: doc.id, _id: doc.id, ...doc.data() });
      }
    }

    let orders = merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(toCustomerOrder);
    if (status) orders = orders.filter((o) => o.status === status);

    const total = orders.length;
    const pages = Math.ceil(total / limit);
    const start = (page - 1) * limit;

    return NextResponse.json({ success: true, data: { orders: orders.slice(start, start + limit), total, pages, page } });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await getEffectiveSession();
    const db = getDB();
    const body = await request.json();
    /* Money fields (subtotal/shippingCost/discount/total) and item prices are
       deliberately NOT read from the body — they are recomputed below. */
    const { items, shippingAddress, payment, couponCode, guestEmail } = body;

    if (!Array.isArray(items) || !items.length || !shippingAddress || typeof shippingAddress !== 'object') {
      return NextResponse.json({ success: false, message: 'Items and shipping address are required' }, { status: 400 });
    }
    if (items.length > MAX_LINES) {
      return NextResponse.json({ success: false, message: `An order can have at most ${MAX_LINES} items.` }, { status: 400 });
    }

    /* Quantities must be positive whole numbers — a negative or non-numeric value
       would slip past the stock check below and later inflate/corrupt stock. */
    for (const item of items) {
      const qty = Number(item?.quantity);
      if (!Number.isInteger(qty) || qty < 1 || qty > 999) {
        return NextResponse.json({ success: false, message: 'Invalid quantity in your cart' }, { status: 400 });
      }
      item.quantity = qty;
    }
    /* The same product on two lines is one line: otherwise each line passes
       the stock check on its own and the order takes more than there is. */
    const merged = new Map();
    for (const item of items) {
      const id = String(item.product || '');
      if (merged.has(id)) merged.get(id).quantity += item.quantity;
      else merged.set(id, { product: id, quantity: item.quantity, name: item.name });
    }
    const lines = [...merged.values()];
    if (lines.some((l) => l.quantity > 999)) {
      return NextResponse.json({ success: false, message: 'Invalid quantity in your cart' }, { status: 400 });
    }

    /* Whitelisted, typed, length-limited: these values are shown to staff
       (labels, emails, WhatsApp) and sent to Shiprocket. */
    const addr = parseShippingAddress(shippingAddress);
    if (addr.error) return NextResponse.json({ success: false, message: addr.error }, { status: 400 });
    /* Signed in: confirmations go to the account's own email. A guest's
       email must be one plain address (no lists of recipients). */
    const resolvedEmail = session?.user?.email
      ? String(session.user.email).toLowerCase()
      : normalizeEmail(guestEmail || addr.value.email);
    if (!isValidEmail(resolvedEmail)) {
      return NextResponse.json({ success: false, message: 'Enter a valid email address.' }, { status: 400 });
    }

    /* Price the order from the products collection. Anything money-related that
       the browser sent is discarded — otherwise a caller could post total: 1
       for a high-value cart and pay ₹1 for it. */
    let computedSubtotal = 0;
    /* Items are rebuilt from scratch rather than trusting the client's
       objects — any extra keys the browser sent used to be stored as-is. */
    const orderItems = [];
    const vendorFees = {};
    const vendorCache = new Map();
    for (const item of lines) {
      if (!item.product) {
        return NextResponse.json({ success: false, message: 'Each item must reference a product' }, { status: 400 });
      }
      const prodDoc = await db.collection('products').doc(item.product).get();
      if (!prodDoc.exists) {
        return NextResponse.json({ success: false, message: `Product not found: ${item.name || item.product}` }, { status: 400 });
      }
      const prod = prodDoc.data();
      if (prod.isActive === false || prod.showMe === false) {
        return NextResponse.json({ success: false, message: `Product no longer available: ${prod.name || item.name}` }, { status: 400 });
      }
      if ((Number(prod.stock) || 0) < item.quantity) {
        return NextResponse.json({ success: false, message: `Insufficient stock for ${prod.name || item.name}` }, { status: 400 });
      }
      const unitPrice = Number(prod.discountPrice) || Number(prod.price) || 0;

      /* Marketplace: snapshot who sells this piece, what the platform
         retains as margin, the vendor's shipping charge and fee rate at this moment —
         settlement on delivery uses these, never the product's later values. */
      const vendorId = prod.vendorId || PLATFORM_VENDOR_ID;
      let supplyCost = 0;
      let vendorShipping = null;
      if (vendorId !== PLATFORM_VENDOR_ID) {
        if (!vendorCache.has(vendorId)) {
          const vDoc = await db.collection('vendors').doc(vendorId).get();
          vendorCache.set(vendorId, vDoc.exists ? vDoc.data() : null);
        }
        const vendor = vendorCache.get(vendorId);
        const pricingError = validateVendorPricing({ ...prod, vendorId });
        if (!vendorCanSell(vendor) || pricingError) {
          console.error('[orders POST] vendor product not sellable:', item.product, pricingError || (vendor ? 'vendor suspended' : 'vendor missing'));
          return NextResponse.json({ success: false, message: `Product no longer available: ${prod.name || item.name}` }, { status: 400 });
        }
        supplyCost = marginFor(prod, unitPrice); // per piece, fixed or % of this price
        vendorShipping = vendorShippingOf(prod);
        vendorFees[vendorId] = Math.max(0, Math.floor(Number(vendor.platformFeeBps) || 0));
      }

      computedSubtotal += unitPrice * item.quantity;
      orderItems.push({
        product: item.product,
        quantity: item.quantity,
        price: unitPrice,
        name: prod.name || '',
        image: prod.images?.[0] || null,
        sku: prod.sku || null,
        vendorId,
        supplyCost,
        /* Only when the vendor set their own shipping charge — otherwise
           settlement deducts the actual courier cost. */
        ...(vendorShipping !== null && { vendorShipping }),
      });
    }

    /* Who is using the coupon, for once-per-customer: the account, or the
       guest's email. */
    const couponUserKey = session?.user?.id ? `u:${session.user.id}` : `e:${resolvedEmail}`;

    /* Re-validate the coupon against the server-computed subtotal */
    const coupon = couponCode
      ? await resolveCoupon(db, { couponCode, subtotal: computedSubtotal, couponUserKey, session })
      : null;
    const couponApplies = !!coupon && !coupon.reason;
    const couponDiscount = couponApplies ? coupon.discount : 0;
    const resolvedCouponId = couponApplies ? coupon.id : null;
    const resolvedCouponCode = couponApplies ? coupon.code : null;

    /* The checkout sends the coupon discount it showed (couponDiscount). If
       this order wouldn't get it — the code was refused, or its amount
       differs by ₹1 or more — refuse rather than charge a surprise amount;
       nothing is created and the checkout shows the right total. Without it
       (an older page) a refused code is left off, as before. */
    const shownCouponDiscount = coupon ? shown(body.couponDiscount) : null;
    if (shownCouponDiscount !== null && !(Math.abs(couponDiscount - shownCouponDiscount) < 1)) {
      return couponChangedResponse({
        code: coupon.code,
        reason: coupon.reason || 'amount_changed',
        discount: couponDiscount,
        minOrderAmount: coupon.minOrderAmount,
        shownDiscount: shownCouponDiscount,
      });
    }

    const resolvedPaymentMethod = PAYMENT_METHODS.includes(payment?.method) ? payment.method : 'razorpay';
    const settingsDoc = await db.collection('settings').doc('site').get().catch(() => null);
    const siteSettings = settingsDoc?.data() || {};

    /* Admin can pause online payment site-wide (e.g. while Razorpay KYC is
       pending) — re-checked here so a stale/cached checkout page can't place
       a "razorpay" order while it's off. COD stays available either way. */
    if (resolvedPaymentMethod === 'razorpay' && siteSettings.onlinePaymentEnabled === false) {
      return NextResponse.json(
        { success: false, message: 'Online payment is temporarily unavailable. Please choose Cash on Delivery.' },
        { status: 400 }
      );
    }

    const isCod = resolvedPaymentMethod === 'cod';
    /* Shipping and COD fee from the stored settings — never from the body. */
    const charges = await getStoreCharges(db);
    const { shipping: computedShipping, codFee } = computeCharges({ subtotal: computedSubtotal, paymentMethod: resolvedPaymentMethod, charges });
    /* The checkout sends the fees it showed the customer. If they differ
       (a tampered request, or the admin changed the charges while the
       customer was on the page), refuse rather than charge a surprise
       amount — the checkout refreshes and shows the right total. */
    if ((shown(body.shippingCost) !== null && shown(body.shippingCost) !== computedShipping)
      || (shown(body.codFee) !== null && shown(body.codFee) !== codFee)) {
      const { updatedAt: _u, ...current } = charges;
      return NextResponse.json({
        success: false,
        code: 'CHARGES_CHANGED',
        message: `Delivery charges have been updated: shipping ${computedShipping ? `₹${computedShipping}` : 'FREE'}${isCod ? `, COD fee ${codFee ? `₹${codFee}` : 'none'}` : ''}. Please check your total and place the order again.`,
        charges: current,
      }, { status: 409 });
    }

    if (isCod) {
      /* Pre-loyalty total — loyalty only ever reduces it further, so this is
         a safe (conservative) figure to cap against. */
      const preliminaryTotal = Math.max(0, computedSubtotal - couponDiscount + computedShipping + codFee);
      if (preliminaryTotal > COD_MAX_ORDER_VALUE) {
        return NextResponse.json({
          success: false,
          message: `Cash on Delivery is available only for orders up to ₹${COD_MAX_ORDER_VALUE.toLocaleString('en-IN')}. Please choose online payment for this order.`,
        }, { status: 400 });
      }

      /* Fails open — a Shiprocket outage, missing config, or the admin having
         switched this check off shouldn't block a sale. */
      if (shiprocketConfigured() && siteSettings.codPincodeCheckEnabled !== false) {
        try {
          const couriers = await getAvailableCouriers(addr.value.pincode, true);
          if (Array.isArray(couriers) && couriers.length === 0) {
            return NextResponse.json({
              success: false,
              message: `Cash on Delivery is not available for pincode ${addr.value.pincode}. Please choose online payment.`,
            }, { status: 400 });
          }
        } catch {}
      }
    }

    const orderRef = db.collection('orders').doc();
    /* Timestamp + random suffix: not guessable from the order time alone. */
    const orderNumber = `TBJ${Date.now()}${crypto.randomInt(100, 1000)}`;

    /* Normalize address fields: checkout sends fullName, emails expect name */
    const normalizedAddress = { ...addr.value, email: addr.value.email || resolvedEmail };

    const baseOrder = {
      orderNumber,
      userId: session?.user?.id || null,
      guestEmail: resolvedEmail,
      /* Visitor analytics: which browser placed it, so the purchase is
         credited to the visit (and source) that led to it. */
      analyticsVid: analyticsVidFrom(request),
      items: orderItems,
      vendorIds: [...new Set(orderItems.map((i) => i.vendorId))],
      vendorFees,
      shippingAddress: normalizedAddress,
      /* Built server-side — a client-supplied payment object could otherwise
         pre-seed razorpayOrderId/amountDue and defeat payment verification. */
      payment: {
        method: resolvedPaymentMethod,
        status: 'pending',
      },
      coupon: resolvedCouponId,
      couponCode: resolvedCouponCode,
      subtotal: computedSubtotal,
      shippingCost: computedShipping,
      codFee,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    /* Read the parked loyalty discount, apply it and debit it in one commit.
       Reading it outside a transaction would let concurrent orders each spend
       the same balance. */
    const userRef = session?.user?.id ? db.collection('users').doc(session.user.id) : null;

    const couponRef = resolvedCouponId ? db.collection('coupons').doc(resolvedCouponId) : null;
    /* An abandoned online attempt spent the parked loyalty discount: this
       order takes it back (as cancelling that attempt would) — closing the
       payment window must not cost the customer their points discount. */
    const uid = session?.user?.id ? String(session.user.id) : null;
    const loyaltyHolders = userRef ? await abandonedLoyaltyHolders(db, uid) : [];

    let orderData;
    try {
      orderData = await db.runTransaction(async (tx) => {
        /* Every read first (Firestore refuses a read after a write). */
        /* Coupon limits are enforced here, in the same commit as the order:
           re-read it, re-check it, and count this use — so maxUses and
           once-per-customer hold even for parallel checkouts. */
        const cDoc = couponRef ? await tx.get(couponRef) : null;
        const c = cDoc?.exists ? cDoc.data() : null;
        const heldByMe = !!c && Array.isArray(c.usedBy) && c.usedBy.includes(couponUserKey);
        const uses = c && heldByMe ? await couponUsesBy(db, { couponId: resolvedCouponId, userKey: couponUserKey }, tx) : null;
        const uDoc = userRef ? await tx.get(userRef) : null;
        /* The earlier attempts this order may take over, read in full: the
           holders of this customer's use of the code, and the attempts
           holding their parked loyalty discount. */
        const attemptRefs = new Map([...(uses?.holders || []), ...loyaltyHolders].map((r) => [r.id, r]));
        const attempts = (await Promise.all([...attemptRefs.values()].map((r) => tx.get(r)))).filter((d) => d.exists);
        const holderIds = new Set((uses?.holders || []).map((r) => r.id));
        const couponHolders = attempts.filter((d) => holderIds.has(d.id));

        let appliedCoupon = 0;
        if (couponRef) {
          /* A holder the store has moved on (confirmed, packed… though
             unpaid) is a real order: its use is spent. A cancelled one or an
             abandoned attempt hands it over (below). */
          const spentByHolder = couponHolders.some((d) => d.data().status !== 'cancelled' && !isAbandonedAttempt(d.data()));
          const reason = !c ? 'not_found'
            : couponStateRefusal(c, { ownUseCounted: heldByMe })
              || (uses?.placed || spentByHolder ? 'used' : null)
              || (computedSubtotal < (Number(c.minOrderAmount) || 0) ? 'min_order' : null);
          if (reason) throw new CouponChangedError(reason);
          appliedCoupon = couponDiscountFor(c, computedSubtotal);
          if (shownCouponDiscount !== null && !(Math.abs(appliedCoupon - shownCouponDiscount) < 1)) {
            throw new CouponChangedError('amount_changed', appliedCoupon);
          }
        }

        /* This customer's use of the code is already counted — held by an
           attempt that was never placed. This order takes it over: no
           second usedBy entry, no second count. */
        const takesUseFrom = new Set(couponRef && heldByMe ? couponHolders.map((d) => d.id) : []);
        /* Replaced by this order: the signed-in customer's own abandoned
           attempts whose coupon use or parked loyalty it takes over. They
           are cancelled in this same commit, so they can't be paid any more
           (create-order refuses them; a payment landing anyway is recorded
           for a refund — settlePaidOrder) and nothing is handed back twice.
           Never one that was paid (not an abandoned attempt), and never on
           a sessionless request's word. */
        const replaced = attempts.filter((d) => {
          const o = d.data();
          return !!uid && o.userId === uid && isAbandonedAttempt(o) && (takesUseFrom.has(d.id) || holdsParkedLoyalty(o));
        });
        /* A replaced attempt's use of a DIFFERENT code (not taken over) is
           released, as cancelling it would. */
        const releasesUse = (d) => !!d.data().coupon && !d.data().couponReleased && !takesUseFrom.has(d.id);
        const otherIds = [...new Set(replaced.filter(releasesUse).map((d) => String(d.data().coupon)))].filter((id) => id !== resolvedCouponId);
        const otherCoupons = new Map((await Promise.all(otherIds.map((id) => tx.get(db.collection('coupons').doc(id))))).map((s) => [s.id, s]));

        const moved = replaced.filter((d) => holdsParkedLoyalty(d.data()));
        const movedAmount = moved.reduce((sum, d) => sum + (Number(d.data().loyaltyDiscount) || 0), 0);
        let loyaltyDiscount = 0;
        if (userRef) {
          const parked = Math.max(0, Number(uDoc.exists ? uDoc.data().pendingLoyaltyDiscount : 0) || 0) + movedAmount;
          /* Cap the loyalty contribution so no single balance can zero an order */
          loyaltyDiscount = Math.min(parked, Math.floor(computedSubtotal * MAX_LOYALTY_SHARE));
        }

        const discount = Math.min(appliedCoupon + loyaltyDiscount, computedSubtotal);
        const total = Math.max(0, computedSubtotal - discount + computedShipping + codFee);
        const data = { ...baseOrder, discount, loyaltyDiscount, total, ...(couponRef && { couponUserKey }) };
        const now = new Date().toISOString();

        /* Coupon bookkeeping: one write per coupon document. */
        const books = new Map();
        const book = (id, snap) => {
          if (!books.has(id)) {
            const cd = snap.data() || {};
            books.set(id, { ref: snap.ref, usedCount: Number(cd.usedCount) || 0, usedBy: Array.isArray(cd.usedBy) ? [...cd.usedBy] : [] });
          }
          return books.get(id);
        };
        if (couponRef && !heldByMe) {
          const b = book(resolvedCouponId, cDoc);
          b.usedCount += 1;
          b.usedBy.push(couponUserKey);
        }
        const attemptUpdates = new Map();
        const updateOf = (d) => {
          if (!attemptUpdates.has(d.id)) attemptUpdates.set(d.id, { ref: d.ref, fields: {} });
          return attemptUpdates.get(d.id).fields;
        };
        /* The old holder stops holding the use, so cancelling it later
           doesn't give back the use this order holds. */
        for (const d of couponHolders) {
          if (takesUseFrom.has(d.id)) Object.assign(updateOf(d), { couponReleased: true, couponMovedTo: orderRef.id });
        }
        for (const d of replaced) {
          const o = d.data();
          const fields = updateOf(d);
          Object.assign(fields, { status: 'cancelled', cancelReason: 'replaced', replacedBy: orderRef.id, cancelledAt: now });
          /* Its loyalty is handed to this order (marked restored there, so
             it is never handed back twice); what this order doesn't use
             stays parked for the next one. */
          if (holdsParkedLoyalty(o)) Object.assign(fields, { loyaltyRestored: true, loyaltyMovedTo: orderRef.id });
          if (releasesUse(d)) {
            const id = String(o.coupon);
            const snap = id === resolvedCouponId ? cDoc : otherCoupons.get(id);
            if (snap?.exists) {
              const b = book(id, snap);
              b.usedCount = Math.max(0, b.usedCount - 1);
              const at = o.couponUserKey ? b.usedBy.indexOf(o.couponUserKey) : -1;
              if (at >= 0) b.usedBy.splice(at, 1);
            }
            fields.couponReleased = true;
          }
        }

        for (const b of books.values()) tx.update(b.ref, { usedCount: b.usedCount, usedBy: b.usedBy, updatedAt: now });
        tx.set(orderRef, data);
        for (const { ref, fields } of attemptUpdates.values()) tx.update(ref, { ...fields, updatedAt: now });
        const parkedChange = movedAmount - loyaltyDiscount;
        if (userRef && parkedChange !== 0) {
          const change = { pendingLoyaltyDiscount: FieldValue.increment(parkedChange) };
          if (uDoc.exists) tx.update(userRef, change);
          else tx.set(userRef, change, { merge: true });
        }
        return data;
      });
    } catch (e) {
      if (!(e instanceof CouponChangedError)) throw e;
      /* The coupon changed between the check above and this commit. */
      if (shownCouponDiscount === null) {
        return NextResponse.json({ success: false, message: 'This coupon is no longer available. Remove it and try again.' }, { status: 400 });
      }
      return couponChangedResponse({ code: coupon.code, reason: e.reason, discount: e.discount, minOrderAmount: coupon.minOrderAmount, shownDiscount: shownCouponDiscount });
    }

    const computedTotal = orderData.total;

    // Save shipping address to user's saved addresses (max 3, newest first)
    if (session?.user?.id) {
      const userRef = db.collection('users').doc(session.user.id);
      const userDoc = await userRef.get().catch(() => null);
      if (userDoc) {
        const existing = userDoc.exists ? (userDoc.data().savedAddresses || []) : [];
        const isDup = existing.some(
          (a) => a.street === normalizedAddress.street && a.pincode === normalizedAddress.pincode
        );
        if (!isDup) {
          const newAddr = {
            id: Date.now().toString(),
            fullName: normalizedAddress.name || '',
            phone: normalizedAddress.phone || '',
            street: normalizedAddress.street || '',
            city: normalizedAddress.city || '',
            state: normalizedAddress.state || '',
            pincode: normalizedAddress.pincode || '',
            savedAt: new Date().toISOString(),
          };
          await userRef.update({ savedAddresses: [newAddr, ...existing].slice(0, 3) }).catch(() => {});
        }
      }
    }

    /* Loyalty points are NOT awarded here. An unpaid order costs the caller
       nothing, so awarding on creation let anyone farm points by placing and
       abandoning orders — and points are spendable money. They are granted in
       awardLoyaltyPoints() once the order is actually paid. */

    const fullOrder = { id: orderRef.id, _id: orderRef.id, ...orderData };
    const customerOrder = toCustomerOrder(fullOrder);

    /* Send emails + WhatsApp — await so they complete before response */
    await Promise.all([
      sendOrderConfirmation(customerOrder).catch((e) => console.error('[Email] Customer confirmation failed:', e.message)),
      sendOrderNotificationToAdmin(fullOrder).catch((e) => console.error('[Email] Admin notification failed:', e.message)),
      sendOrderWhatsAppToAdmin(fullOrder).catch((e) => console.error('[WhatsApp] Admin alert failed:', e.message)),
      sendOrderWhatsAppToCustomer(customerOrder).catch((e) => console.error('[WhatsApp] Customer alert failed:', e.message)),
      /* Vendors hear about a COD order now; an online one when it's paid (settlePayment). */
      ...(fullOrder.payment.method === 'cod' && fullOrder.vendorIds.some((v) => v !== PLATFORM_VENDOR_ID)
        ? [notifyVendorsOfOrder(db, orderRef.id).catch((e) => console.error('[Email] Vendor notification failed:', e.message))]
        : []),
    ]);

    return NextResponse.json({ success: true, data: customerOrder }, { status: 201 });
  } catch (error) {
    const message = error?.error?.description || error?.message || 'Could not place order. Please try again.';
    console.error('[orders POST] failed:', error?.error || error);
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
