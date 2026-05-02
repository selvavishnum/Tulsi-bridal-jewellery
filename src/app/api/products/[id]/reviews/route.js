import { NextResponse } from 'next/server';
import { getDB, snapshotToArr } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';
import { sendReviewNotification } from '@/lib/email';

export async function GET(request, context) {
  try {
    const { id } = await context.params;
    const db = getDB();
    const snap = await db.collection('reviews').where('productId', '==', id).get();
    const reviews = snapshotToArr(snap).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const count = reviews.length;
    const average = count > 0 ? +(reviews.reduce((s, r) => s + r.rating, 0) / count).toFixed(1) : 0;

    return NextResponse.json({ success: true, data: { reviews, average, count } });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function POST(request, context) {
  try {
    const { id } = await context.params;
    const session = await getEffectiveSession();
    const body = await request.json();
    const { rating, comment, guestName, guestEmail } = body;

    if (!rating || rating < 1 || rating > 5) {
      return NextResponse.json({ success: false, message: 'Rating must be 1–5' }, { status: 400 });
    }
    if (!comment?.trim()) {
      return NextResponse.json({ success: false, message: 'Review comment required' }, { status: 400 });
    }

    const db = getDB();
    const prodDoc = await db.collection('products').doc(id).get();
    if (!prodDoc.exists) return NextResponse.json({ success: false, message: 'Product not found' }, { status: 404 });

    const reviewerName  = session?.user?.name  || guestName  || 'Anonymous';
    const reviewerEmail = session?.user?.email || guestEmail || null;
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
      verified: !!userId,
      createdAt: new Date().toISOString(),
    };
    await ref.set(review);

    /* Notify admin about new review */
    sendReviewNotification(review).catch(() => {});

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
