import { NextResponse } from 'next/server';
import { getDB, FieldValue, snapshotToArr } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';
import { sendOrderConfirmation, sendOrderNotificationToAdmin } from '@/lib/email';
import { sendOrderWhatsAppToAdmin, sendOrderWhatsAppToCustomer } from '@/lib/whatsapp';
import { getAvailableCouriers, isConfigured as shiprocketConfigured } from '@/lib/shiprocket';
import { PLATFORM_VENDOR_ID, validateVendorPricing, toCustomerOrder, marginFor, vendorShippingOf } from '@/lib/settlement';
import { getAccess } from '@/lib/requireRole';
import { CAN, toFulfillmentOrder } from '@/lib/access';

/* Shipping rules — must match the cart display in src/context/CartContext.js */
const FREE_SHIPPING_ABOVE = 2000;
const SHIPPING_FEE = 99;
const PAYMENT_METHODS = ['razorpay', 'cod'];
/* Loyalty may cover at most this share of an order, so a large parked balance
   can never bring the amount payable to zero. */
const MAX_LOYALTY_SHARE = 0.2;
/* COD rules — mirrored on the client (checkout page) for display only; this
   is the enforced copy. Keep both in sync if these change. */
const COD_MAX_ORDER_VALUE = 20000;
const COD_FEE = 49;
const COD_FEE_BELOW = 500;

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
      session.user.email
        ? db.collection('orders').where('guestEmail', '==', session.user.email).get()
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

    if (!items?.length || !shippingAddress) {
      return NextResponse.json({ success: false, message: 'Items and shipping address are required' }, { status: 400 });
    }

    /* Quantities must be positive whole numbers — a negative or non-numeric value
       would slip past the stock check below and later inflate/corrupt stock. */
    for (const item of items) {
      const qty = Number(item.quantity);
      if (!Number.isInteger(qty) || qty < 1 || qty > 999) {
        return NextResponse.json({ success: false, message: `Invalid quantity for ${item.name || 'item'}` }, { status: 400 });
      }
      item.quantity = qty;
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
    for (const item of items) {
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
        if (!vendor || vendor.status === 'suspended' || pricingError) {
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

    const computedShipping = computedSubtotal >= FREE_SHIPPING_ABOVE ? 0 : SHIPPING_FEE;

    /* Re-validate the coupon against the server-computed subtotal */
    let couponDiscount = 0;
    let resolvedCouponId = null;
    let resolvedCouponCode = null;
    if (couponCode) {
      const cSnap = await db.collection('coupons')
        .where('code', '==', String(couponCode).toUpperCase()).limit(1).get();
      if (!cSnap.empty) {
        const c = cSnap.docs[0].data();
        const usable =
          c.isActive &&
          (!c.expiresAt || new Date(c.expiresAt) >= new Date()) &&
          (Number(c.usedCount) || 0) < Number(c.maxUses) &&
          computedSubtotal >= (Number(c.minOrderAmount) || 0);
        if (usable) {
          couponDiscount = c.type === 'percentage'
            ? Math.round((computedSubtotal * Number(c.value)) / 100)
            : Math.min(Number(c.value), computedSubtotal);
          resolvedCouponId = cSnap.docs[0].id;
          resolvedCouponCode = c.code;
        }
      }
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
    const codFee = isCod && computedSubtotal < COD_FEE_BELOW ? COD_FEE : 0;

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
          const couriers = await getAvailableCouriers(shippingAddress.pincode, true);
          if (Array.isArray(couriers) && couriers.length === 0) {
            return NextResponse.json({
              success: false,
              message: `Cash on Delivery is not available for pincode ${shippingAddress.pincode}. Please choose online payment.`,
            }, { status: 400 });
          }
        } catch {}
      }
    }

    const orderRef = db.collection('orders').doc();
    const orderNumber = `TBJ${Date.now()}`;
    const resolvedEmail = guestEmail || session?.user?.email || shippingAddress?.email || null;

    /* Normalize address fields: checkout sends fullName, emails expect name */
    const normalizedAddress = {
      ...shippingAddress,
      name:  shippingAddress.fullName || shippingAddress.name || '',
      email: shippingAddress.email || resolvedEmail || '',
    };

    const baseOrder = {
      orderNumber,
      userId: session?.user?.id || null,
      guestEmail: resolvedEmail,
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

    const orderData = await db.runTransaction(async (tx) => {
      let loyaltyDiscount = 0;
      if (userRef) {
        const uDoc = await tx.get(userRef);
        const parked = Math.max(0, Number(uDoc.exists ? uDoc.data().pendingLoyaltyDiscount : 0) || 0);
        /* Cap the loyalty contribution so no single balance can zero an order */
        loyaltyDiscount = Math.min(parked, Math.floor(computedSubtotal * MAX_LOYALTY_SHARE));
      }

      const discount = Math.min(couponDiscount + loyaltyDiscount, computedSubtotal);
      const total = Math.max(0, computedSubtotal - discount + computedShipping + codFee);
      const data = { ...baseOrder, discount, loyaltyDiscount, total };

      tx.set(orderRef, data);
      if (userRef && loyaltyDiscount > 0) {
        tx.update(userRef, { pendingLoyaltyDiscount: FieldValue.increment(-loyaltyDiscount) });
      }
      return data;
    });

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
    ]);

    return NextResponse.json({ success: true, data: customerOrder }, { status: 201 });
  } catch (error) {
    const message = error?.error?.description || error?.message || 'Could not place order. Please try again.';
    console.error('[orders POST] failed:', error?.error || error);
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
