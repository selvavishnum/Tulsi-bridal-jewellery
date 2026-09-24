import { NextResponse } from 'next/server';
import { getDB, snapshotToArr } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';
import { sendReviewNotification } from '@/lib/email';
import { sendReviewWhatsApp } from '@/lib/whatsapp';
import { normalizeEmail, isValidEmail } from '@/lib/otp';
import { hit, clientIp, LIMITS, tooManyRequests } from '@/lib/rateLimit';

export async function GET(request, context) {
  try {
    const { id } = await context.params;
    const db = getDB();
    const snap = await db.collection('reviews').where('productId', '==', id).get();
    // All reviews always show publicly — admin approve/reject only controls the verified badge.
    // reviewerEmail is deliberately omitted: this endpoint is unauthenticated.
    const reviews = snapshotToArr(snap)
      .map(({ reviewerEmail, ...r }) => r)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const count = reviews.length;
    const average = count > 0 ? +(reviews.reduce((s, r) => s + r.rating, 0) / count).toFixed(1) : 0;

    return NextResponse.json({ success: true, data: { reviews, average, count } });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

async function boughtIt(db, userId, productId) {
  const snap = await db.collection('orders').where('userId', '==', userId).get();
  return snap.docs.some((d) => {
    const o = d.data();
    return o.payment?.status === 'paid' && o.status !== 'cancelled' && (o.items || []).some((it) => it.product === productId);
  });
}

export async function POST(request, context) {
  try {
    const { id } = await context.params;
    const session = await getEffectiveSession();
    const body = await request.json();
    const { rating, comment, guestName, guestEmail } = body;

    if (!Number.isInteger(Number(rating)) || rating < 1 || rating > 5) {
      return NextResponse.json({ success: false, message: 'Rating must be 1–5' }, { status: 400 });
    }
    if (typeof comment !== 'string' || !comment.trim() || comment.length > 2000) {
      return NextResponse.json({ success: false, message: 'Write a review of up to 2000 characters' }, { status: 400 });
    }
    if (guestName !== undefined && (typeof guestName !== 'string' || guestName.length > 60)) {
      return NextResponse.json({ success: false, message: 'Name is too long' }, { status: 400 });
    }

    const db = getDB();
    const limited = await hit(db, `review:ip:${clientIp(request.headers)}`, LIMITS.review);
    if (!limited.allowed) return tooManyRequests(limited.retryAfterSec, 'Too many reviews. Please try again later.');
    const prodDoc = await db.collection('products').doc(id).get();
    if (!prodDoc.exists) return NextResponse.json({ success: false, message: 'Product not found' }, { status: 404 });

    const reviewerName  = session?.user?.name  || guestName  || 'Anonymous';
    const reviewerEmail = session?.user?.email || (typeof guestEmail === 'string' && isValidEmail(normalizeEmail(guestEmail)) ? normalizeEmail(guestEmail) : null);
    const userId        = session?.user?.id    || null;

    /* One review per user per product (for logged-in users) */
    if (userId) {
      const existing = await db.collection('reviews')
        .where('productId', '==', id)
        .where('userId', '==', userId)
        .get();
      if (!existing.empty) {
        return NextResponse.json({ success: false, message: 'You have already reviewed this product' }, { status: 400 });
      }
    }

    const ref = db.collection('reviews').doc();
    const review = {
      productId: id,
      productName: prodDoc.data().name,
      userId,
      reviewerName,
      reviewerEmail,
      rating: Number(rating),
      comment: comment.trim(),
      /* "Verified purchase" only if this account actually bought it and
         the order was paid. */
      verified: userId ? await boughtIt(db, userId, id) : false,
      createdAt: new Date().toISOString(),
    };
    await ref.set(review);

    /* Notify admin — email + WhatsApp */
    await Promise.all([
      sendReviewNotification(review).catch((e) => console.error('[Email] Review notification failed:', e.message)),
      sendReviewWhatsApp(review).catch((e) => console.error('[WhatsApp] Review alert failed:', e.message)),
    ]);

    /* Update product aggregate ratings */
    const allSnap = await db.collection('reviews').where('productId', '==', id).get();
    const allReviews = allSnap.docs.map((d) => d.data());
    const count = allReviews.length;
    const average = +(allReviews.reduce((s, r) => s + r.rating, 0) / count).toFixed(1);
    await db.collection('products').doc(id).update({ 'ratings.average': average, 'ratings.count': count });

    return NextResponse.json({ success: true, data: { id: ref.id, ...review } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
