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
import { hasPlacedOrder, isPlacedOrder, couponDiscountFor, couponStateRefusal, couponUsesBy, couponRefusalMessage } from '@/lib/coupons';
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
 * codes — a signed-in customer has no placed order (by account, proven
 * email or delivery phone).
 *
 * Once per customer: usedBy holds this customer's key from the moment an
 * order with the code is created — also an online order whose payment is
 * then abandoned. That use is spent only if one of their orders with the
 * code was actually placed (isPlacedOrder); otherwise this order re-uses it
 * (heldByMe) instead of losing the discount.
 *
 * @returns {{ code, reason: string|null, discount, id?, data?, minOrderAmount?, heldByMe? }}
 */
async function resolveCoupon(db, { couponCode, subtotal, couponUserKey, session, phone }) {
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
      if (await hasPlacedOrder(db, { userId: session.user.id, email, phone })) return { ...base, reason: 'first_order_only' };
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

/* An online attempt that was never paid but spent the customer's parked
   loyalty discount (loyaltyDiscount, not yet given back). */
const holdsAbandonedLoyalty = (o) => !!o && o.status === 'pending' && !isPlacedOrder(o)
  && (Number(o.loyaltyDiscount) || 0) > 0 && !o.loyaltyRestored;

/* This customer's abandoned online attempts that still hold parked loyalty
   discount. Equality filters only. A failed read just means no hand-over. */
async function abandonedLoyaltyHolders(db, userId) {
  try {
    const snap = await db.collection('orders')
      .where('userId', '==', String(userId)).where('status', '==', 'pending')
      .limit(25).get();
    return snap.docs.filter((d) => holdsAbandonedLoyalty(d.data())).map((d) => d.ref);
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
      ? await resolveCoupon(db, { couponCode, subtotal: computedSubtotal, couponUserKey, session, phone: addr.value.phone })
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
    const loyaltyHolders = userRef ? await abandonedLoyaltyHolders(db, session.user.id) : [];

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
        const holderDocs = uDoc?.exists && loyaltyHolders.length ? await Promise.all(loyaltyHolders.map((r) => tx.get(r))) : [];

        let appliedCoupon = 0;
        if (couponRef) {
          const reason = !c ? 'not_found'
            : couponStateRefusal(c, { ownUseCounted: heldByMe })
              || (uses?.placed ? 'used' : null)
              || (computedSubtotal < (Number(c.minOrderAmount) || 0) ? 'min_order' : null);
          if (reason) throw new CouponChangedError(reason);
          appliedCoupon = couponDiscountFor(c, computedSubtotal);
          if (shownCouponDiscount !== null && !(Math.abs(appliedCoupon - shownCouponDiscount) < 1)) {
            throw new CouponChangedError('amount_changed', appliedCoupon);
          }
        }

        const moved = holderDocs.filter((d) => d.exists && holdsAbandonedLoyalty(d.data()));
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

        if (couponRef && heldByMe) {
          /* This customer's use is already counted — held by an attempt that
             was never placed. This order takes it over: no second usedBy
             entry, no second count. The old attempt stops holding it, so
             cancelling it later doesn't give back the use this order holds. */
          for (const ref of uses.holders) tx.update(ref, { couponReleased: true, couponMovedTo: orderRef.id, updatedAt: now });
        } else if (couponRef) {
          tx.update(couponRef, {
            usedCount: (Number(c.usedCount) || 0) + 1,
            usedBy: [...(Array.isArray(c.usedBy) ? c.usedBy : []), couponUserKey],
            updatedAt: now,
          });
        }
        tx.set(orderRef, data);
        /* Loyalty handed over from abandoned attempts: marked restored there
           (a later cancel doesn't hand it back twice); what this order
           doesn't use stays parked for the next one. */
        for (const d of moved) tx.update(d.ref, { loyaltyRestored: true, loyaltyMovedTo: orderRef.id, updatedAt: now });
        const parkedChange = movedAmount - loyaltyDiscount;
        if (userRef && parkedChange !== 0) {
          tx.update(userRef, { pendingLoyaltyDiscount: FieldValue.increment(parkedChange) });
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
