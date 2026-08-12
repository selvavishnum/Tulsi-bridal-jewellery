import { NextResponse } from 'next/server';
import { getDB, FieldValue, snapshotToArr } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';
import { sendOrderConfirmation, sendOrderNotificationToAdmin } from '@/lib/email';
import { sendOrderWhatsAppToAdmin, sendOrderWhatsAppToCustomer } from '@/lib/whatsapp';

/* Shipping rules — must match the cart display in src/context/CartContext.js */
const FREE_SHIPPING_ABOVE = 2000;
const SHIPPING_FEE = 99;
const PAYMENT_METHODS = ['razorpay', 'cod'];
/* Loyalty may cover at most this share of an order, so a large parked balance
   can never bring the amount payable to zero. */
const MAX_LOYALTY_SHARE = 0.2;

export async function GET(request) {
  try {
    const session = await getEffectiveSession();
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

    const db = getDB();
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const status = searchParams.get('status');

    if (session.user.role === 'admin') {
      const snap = await db.collection('orders').orderBy('createdAt', 'desc').get();
      let orders = snap.docs.map((d) => ({ id: d.id, _id: d.id, ...d.data() }));
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

    let orders = merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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
    for (const item of items) {
      if (!item.product) {
        return NextResponse.json({ success: false, message: 'Each item must reference a product' }, { status: 400 });
      }
      const prodDoc = await db.collection('products').doc(item.product).get();
      if (!prodDoc.exists) {
        return NextResponse.json({ success: false, message: `Product not found: ${item.name || item.product}` }, { status: 400 });
      }
      const prod = prodDoc.data();
      if ((Number(prod.stock) || 0) < item.quantity) {
        return NextResponse.json({ success: false, message: `Insufficient stock for ${prod.name || item.name}` }, { status: 400 });
      }
      const unitPrice = Number(prod.discountPrice) || Number(prod.price) || 0;
      computedSubtotal += unitPrice * item.quantity;
      /* Store the authoritative values, not the client's copy */
      item.price = unitPrice;
      item.name  = prod.name || item.name || '';
      item.image = prod.images?.[0] || item.image || null;
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
      items,
      shippingAddress: normalizedAddress,
      /* Built server-side — a client-supplied payment object could otherwise
         pre-seed razorpayOrderId/amountDue and defeat payment verification. */
      payment: {
        method: PAYMENT_METHODS.includes(payment?.method) ? payment.method : 'razorpay',
        status: 'pending',
      },
      coupon: resolvedCouponId,
      couponCode: resolvedCouponCode,
      subtotal: computedSubtotal,
      shippingCost: computedShipping,
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
      const total = Math.max(0, computedSubtotal - discount + computedShipping);
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

    /* Send emails + WhatsApp — await so they complete before response */
    await Promise.all([
      sendOrderConfirmation(fullOrder).catch((e) => console.error('[Email] Customer confirmation failed:', e.message)),
      sendOrderNotificationToAdmin(fullOrder).catch((e) => console.error('[Email] Admin notification failed:', e.message)),
      sendOrderWhatsAppToAdmin(fullOrder).catch((e) => console.error('[WhatsApp] Admin alert failed:', e.message)),
      sendOrderWhatsAppToCustomer(fullOrder).catch((e) => console.error('[WhatsApp] Customer alert failed:', e.message)),
    ]);

    return NextResponse.json({ success: true, data: fullOrder }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
