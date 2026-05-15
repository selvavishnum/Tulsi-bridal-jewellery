import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';

export async function GET() {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const db = getDB();
    const snap = await db.collection('reviews').orderBy('createdAt', 'desc').get();
    const reviews = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Enrich with product image by fetching unique productIds
    const productIds = [...new Set(reviews.map((r) => r.productId).filter(Boolean))];
    const productDocs = await Promise.all(productIds.map((pid) => db.collection('products').doc(pid).get()));
    const productsMap = {};
    for (const doc of productDocs) {
      if (doc.exists) productsMap[doc.id] = { images: doc.data().images, slug: doc.data().slug, price: doc.data().discountPrice || doc.data().price };
    }
    const enriched = reviews.map((r) => ({
      ...r,
      productImage: r.productId ? (productsMap[r.productId]?.images?.[0] || null) : null,
      productSlug:  r.productId ? (productsMap[r.productId]?.slug || null) : null,
      productPrice: r.productId ? (productsMap[r.productId]?.price || null) : null,
    }));

    return NextResponse.json({ success: true, data: enriched });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const { id, status } = await request.json();
    if (!id || !status) return NextResponse.json({ success: false, message: 'id and status required' }, { status: 400 });

    const db = getDB();
    await db.collection('reviews').doc(id).update({ status, updatedAt: new Date().toISOString() });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });

    const db = getDB();
    await db.collection('reviews').doc(id).delete();
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
