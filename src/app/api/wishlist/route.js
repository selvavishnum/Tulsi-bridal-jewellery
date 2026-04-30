import { NextResponse } from 'next/server';
import { getDB, snapshotToArr } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';

export async function GET() {
  try {
    const session = await getEffectiveSession();
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    const db = getDB();
    const doc = await db.collection('wishlists').doc(session.user.id).get();
    const productIds = doc.exists ? (doc.data().productIds || []) : [];
    if (!productIds.length) return NextResponse.json({ success: true, data: [] });

    // Fetch actual product details
    const products = await Promise.all(
      productIds.map((pid) => db.collection('products').doc(pid).get())
    );
    const result = products
      .filter((d) => d.exists)
      .map((d) => ({ id: d.id, _id: d.id, ...d.data() }));
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await getEffectiveSession();
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    const { productId } = await request.json();
    if (!productId) return NextResponse.json({ success: false, message: 'productId required' }, { status: 400 });
    const db = getDB();
    const ref = db.collection('wishlists').doc(session.user.id);
    const doc = await ref.get();
    const ids = doc.exists ? (doc.data().productIds || []) : [];
    if (!ids.includes(productId)) {
      await ref.set({ productIds: [...ids, productId], updatedAt: new Date().toISOString() });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const session = await getEffectiveSession();
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('productId');
    const db = getDB();
    const ref = db.collection('wishlists').doc(session.user.id);
    const doc = await ref.get();
    const ids = doc.exists ? (doc.data().productIds || []) : [];
    await ref.set({ productIds: ids.filter((id) => id !== productId), updatedAt: new Date().toISOString() });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
