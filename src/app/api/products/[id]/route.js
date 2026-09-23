import { NextResponse } from 'next/server';
import { getDB, docToObj, toPublicProduct } from '@/lib/firebase';
import { checkProductVendor } from '@/lib/vendorProducts';
import { requireAdmin } from '@/lib/adminCollection';

export async function GET(request, context) {
  try {
    const { id } = await context.params;
    const db = getDB();
    const doc = await db.collection('products').doc(id).get();
    if (!doc.exists) return NextResponse.json({ success: false, message: 'Product not found' }, { status: 404 });
    const product = docToObj(doc);
    if (product.isActive === false || product.showMe === false) {
      return NextResponse.json({ success: false, message: 'Product not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: toPublicProduct(product) });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function PUT(request, context) {
  try {
    const { id } = await context.params;
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const db = getDB();
    /* The admin form posts back the whole product it loaded, including
       read-only keys — never write those onto the document. */
    const { id: _id, _id: _legacyId, createdAt: _createdAt, ...body } = await request.json();
    const ref = db.collection('products').doc(id);
    const doc = await ref.get();
    if (!doc.exists) return NextResponse.json({ success: false, message: 'Product not found' }, { status: 404 });

    const vendor = await checkProductVendor(db, { ...doc.data(), ...body });
    if (vendor.error) return NextResponse.json({ success: false, message: vendor.error }, { status: 400 });

    await ref.update({ ...body, vendorId: vendor.vendorId, supplyCost: vendor.supplyCost, updatedAt: new Date().toISOString() });
    const updated = await ref.get();
    return NextResponse.json({ success: true, data: docToObj(updated) });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function DELETE(request, context) {
  try {
    const { id } = await context.params;
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const db = getDB();
    const ref = db.collection('products').doc(id);
    const doc = await ref.get();
    if (!doc.exists) return NextResponse.json({ success: true, message: 'Already deleted' });
    await ref.delete();
    return NextResponse.json({ success: true, message: 'Product deleted' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
