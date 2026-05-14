import { NextResponse } from 'next/server';
import { getDB, snapshotToArr, docToObj } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';

export async function GET(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const mainCategory = searchParams.get('mainCategory') || '';
    const subCategory = searchParams.get('subCategory') || '';
    const brand = searchParams.get('brand') || '';
    const showMe = searchParams.get('showMe') || '';
    const limit = parseInt(searchParams.get('limit') || '50');
    const db = getDB();
    const snap = await db.collection('products').orderBy('createdAt', 'desc').limit(200).get();
    let products = snapshotToArr(snap);
    if (search) {
      const q = search.toLowerCase();
      products = products.filter((p) => p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q));
    }
    if (mainCategory) products = products.filter((p) => p.category === mainCategory);
    if (subCategory) products = products.filter((p) => p.subCategory === subCategory);
    if (brand) products = products.filter((p) => p.brand === brand);
    if (showMe === 'visible') products = products.filter((p) => p.showMe !== false);
    if (showMe === 'hidden') products = products.filter((p) => p.showMe === false);
    return NextResponse.json({ success: true, data: products.slice(0, limit) });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const body = await request.json();
    const { id, sku, mrp, discPct, inStock, showMe } = body;
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });
    const db = getDB();
    const ref = db.collection('products').doc(id);
    const updateData = { updatedAt: new Date().toISOString() };
    if (sku !== undefined) updateData.sku = sku;
    if (mrp !== undefined) updateData.price = mrp;
    if (discPct !== undefined) {
      updateData.discPct = discPct;
      if (mrp !== undefined) updateData.discountPrice = Math.round(mrp * (1 - discPct / 100));
    }
    if (inStock !== undefined) updateData.stock = inStock;
    if (showMe !== undefined) updateData.showMe = showMe;
    await ref.update(updateData);
    return NextResponse.json({ success: true, data: docToObj(await ref.get()) });
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
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });
    const db = getDB();
    await db.collection('products').doc(id).delete();
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
