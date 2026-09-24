import { NextResponse } from 'next/server';
import { getAccess, ROLES } from '@/lib/requireRole';
import { getDB, snapshotToArr } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';
import { normalizeEmail, isValidEmail } from '@/lib/otp';
import { calculateRentalDays } from '@/lib/utils';
import { sendRentalConfirmation, sendRentalNotificationToAdmin } from '@/lib/email';
import { sendRentalWhatsAppToAdmin, sendRentalWhatsAppToCustomer } from '@/lib/whatsapp';

/* Rental delivery/return rates — must match DELIVERY_OPTIONS in
   src/app/rental-booking/[id]/page.js. Server-side so the client cannot price it. */
const DELIVERY_RATES = { self: 0, delivery: 99, courier: 199 };

/* Own-property lookup only — `in` would also match inherited keys like
   "constructor", which would return a function instead of a rate. */
function rateFor(method) {
  return Object.prototype.hasOwnProperty.call(DELIVERY_RATES, method) ? method : 'self';
}


export async function GET(request) {
  try {
    const access = await getAccess();
    const session = access.session;
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

    const db = getDB();
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const status = searchParams.get('status');

    let snap;
    if (access.tier === ROLES.SUPER_ADMIN) {
      snap = await db.collection('rentals').orderBy('createdAt', 'desc').get();
    } else {
      snap = await db.collection('rentals').where('userId', '==', session.user.id).get();
    }
    let rentals = snapshotToArr(snap).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (status) rentals = rentals.filter((r) => r.status === status);

    return NextResponse.json({ success: true, data: { rentals: rentals.slice(0, limit), total: rentals.length } });
  } catch (error) {
    console.error('[rentals]', error.message);
    return NextResponse.json({ success: false, message: 'Could not complete the booking. Please try again.' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await getEffectiveSession();
    const db = getDB();
    const body = await request.json();
    const { productId, rentalStartDate, rentalEndDate, customerDetails, payment, guestEmail, delivery, returnMethod, total: clientTotal } = body;

    if (!productId || typeof productId !== 'string') return NextResponse.json({ success: false, message: 'Product required' }, { status: 400 });
    /* Dates: real, today or later, end after start, at most 60 days. */
    const DAY = 24 * 60 * 60 * 1000;
    const start = new Date(rentalStartDate);
    const end = new Date(rentalEndDate);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start < today || end <= start || end - start > 60 * DAY) {
      return NextResponse.json({ success: false, message: 'Choose a start date from today and an end date after it (up to 60 days).' }, { status: 400 });
    }
    /* Customer details are shown to staff and put into emails — plain,
       bounded strings only; the confirmation goes to one valid address. */
    const cd = {};
    for (const [k, max] of Object.entries({ name: 80, phone: 15, email: 254, address: 300, city: 60, state: 60, pincode: 6, notes: 500 })) {
      const v = customerDetails?.[k];
      if (v === undefined || v === null || v === '') continue;
      if (typeof v !== 'string' || v.length > max || /[<>]/.test(v)) return NextResponse.json({ success: false, message: `Invalid ${k}` }, { status: 400 });
      cd[k] = v.trim();
    }
    if (!cd.name || !cd.phone) return NextResponse.json({ success: false, message: 'Name and phone are required' }, { status: 400 });
    const resolvedEmail = session?.user?.email
      ? String(session.user.email).toLowerCase()
      : normalizeEmail(guestEmail || cd.email);
    if (!isValidEmail(resolvedEmail)) return NextResponse.json({ success: false, message: 'Enter a valid email address.' }, { status: 400 });

    const prodDoc = await db.collection('products').doc(productId).get();
    if (!prodDoc.exists) return NextResponse.json({ success: false, message: 'Product not found' }, { status: 404 });
    const product = prodDoc.data();
    if (product.isActive === false || product.showMe === false || !product.isAvailableForRent || !(Number(product.rentalStock) >= 1)) {
      return NextResponse.json({ success: false, message: 'Product not available for rent' }, { status: 400 });
    }

    const rentalDays = Math.max(1, calculateRentalDays(rentalStartDate, rentalEndDate) || 0);
    const pricePerDay = product.rentalPrice || 0;
    const totalRentalCost = pricePerDay * rentalDays;
    const securityDeposit = Math.round((product.price || 0) * 0.3);
    /* Charges come from a server-side rate table, never from the body — a
       negative charge would otherwise wipe out the rental fee and deposit. */
    const deliveryMethod = rateFor(delivery?.method);
    const returnMethodName = rateFor(returnMethod?.method);
    const deliveryCharge = DELIVERY_RATES[deliveryMethod];
    const returnCharge   = DELIVERY_RATES[returnMethodName];
    const total = Math.max(0, totalRentalCost + securityDeposit + deliveryCharge + returnCharge);

    const rentalRef = db.collection('rentals').doc();
    const rentalData = {
      rentalNumber: `TBJr${Date.now()}`,
      userId: session?.user?.id || null,
      guestEmail: resolvedEmail,
      productId,
      productName: product.name,
      productImage: product.images?.[0] || null,
      rentalStartDate: start.toISOString().slice(0, 10),
      rentalEndDate: end.toISOString().slice(0, 10),
      rentalDays,
      pricePerDay,
      securityDeposit,
      totalRentalCost,
      delivery:     { method: deliveryMethod,   charge: deliveryCharge },
      returnMethod: { method: returnMethodName, charge: returnCharge },
      deliveryCharge,
      returnCharge,
      total,
      customerDetails: cd,
      /* Built server-side — never persist a client-supplied payment object */
      payment: {
        method: ['razorpay', 'cod'].includes(payment?.method) ? payment.method : 'cod',
        status: 'pending',
      },
      status: 'pending',
      deliveryStatus: 'not_dispatched',
      returnStatus: 'not_scheduled',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await rentalRef.set(rentalData);

    const fullRental = { id: rentalRef.id, ...rentalData };

    /* Send email + WhatsApp notifications */
    await Promise.all([
      sendRentalConfirmation(fullRental).catch((e) => console.error('[Email] Rental confirmation failed:', e.message)),
      sendRentalNotificationToAdmin(fullRental).catch((e) => console.error('[Email] Rental admin notification failed:', e.message)),
      sendRentalWhatsAppToAdmin(fullRental).catch((e) => console.error('[WhatsApp] Rental admin alert failed:', e.message)),
      sendRentalWhatsAppToCustomer(fullRental).catch((e) => console.error('[WhatsApp] Rental customer alert failed:', e.message)),
    ]);

    return NextResponse.json({ success: true, data: fullRental }, { status: 201 });
  } catch (error) {
    console.error('[rentals]', error.message);
    return NextResponse.json({ success: false, message: 'Could not complete the booking. Please try again.' }, { status: 500 });
  }
}
