import { NextResponse } from 'next/server';
import { getDB, docToObj, toPublicProduct } from '@/lib/firebase';
import { checkProductVendor } from '@/lib/vendorProducts';
import { requireAdmin } from '@/lib/adminCollection';
import { requireRole, ROLES, CAN } from '@/lib/requireRole';
import { catalogProductViolations, CATALOG_EDITABLE_PRODUCT_FIELDS, stripCostFields } from '@/lib/access';

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
    const auth = await requireRole(CAN.editCatalog);
    if (auth.error) return auth.error;

    const db = getDB();
    /* The admin form posts back the whole product it loaded, including
       read-only keys — never write those onto the document. */
    const { id: _id, _id: _legacyId, createdAt: _createdAt, ...body } = await request.json();
    const ref = db.collection('products').doc(id);
    const doc = await ref.get();
    if (!doc.exists) return NextResponse.json({ success: false, message: 'Product not found' }, { status: 404 });

    /* Barcodes are generated from the SKU, so it must stay unique — the
       inventory route already enforced this; this route didn't. */
    if (body.sku && body.sku !== doc.data().sku) {
      const dup = await db.collection('products').where('sku', '==', body.sku).limit(1).get();
      if (!dup.empty && dup.docs[0].id !== id) {
        return NextResponse.json({ success: false, message: `SKU "${body.sku}" already exists on another product.` }, { status: 409 });
      }
    }

    if (auth.tier !== ROLES.SUPER_ADMIN) {
      /* Restricted fields sent back unchanged (the form round-trips the
         product) are fine; any attempt to change one is refused. */
      const denied = catalogProductViolations(body, doc.data());
      if (denied.length) {
        return NextResponse.json({ success: false, message: `Forbidden fields for catalog staff: ${denied.join(', ')}` }, { status: 403 });
      }
      const allowed = Object.fromEntries(Object.entries(body).filter(([k]) => CATALOG_EDITABLE_PRODUCT_FIELDS.includes(k)));
      if (allowed.stock !== undefined) {
        const n = Number(allowed.stock);
        if (!Number.isInteger(n) || n < 0) return NextResponse.json({ success: false, message: 'Stock must be a whole number ≥ 0' }, { status: 400 });
        allowed.stock = n;
        const before = Number(doc.data().stock) || 0;
        /* Same rule as inventory PATCH: catalog stock corrections are logged
           for a Super Admin to reconcile against the FIFO cost lots. */
        if (n !== before) {
          await db.collection('stockAdjustments').add({
            productId: id, from: before, to: n, by: auth.session?.user?.email || null, tier: auth.tier,
            lotsReconciled: false, createdAt: new Date().toISOString(),
          });
        }
      }
      await ref.update({ ...allowed, updatedAt: new Date().toISOString() });
      return NextResponse.json({ success: true, data: stripCostFields(docToObj(await ref.get())) });
    }

    const vendor = await checkProductVendor(db, { ...doc.data(), ...body });
    if (vendor.error) return NextResponse.json({ success: false, message: vendor.error }, { status: 400 });

    /* Publishing a vendor-submitted draft completes its review. */
    const merged = { ...doc.data(), ...body };
    const review = merged.reviewStatus === 'pending' && merged.isActive !== false
      ? { reviewStatus: 'approved', reviewedBy: auth.session?.user?.email || null, reviewedAt: new Date().toISOString() }
      : {};
    await ref.update({ ...body, ...review, vendorId: vendor.vendorId, supplyCost: vendor.supplyCost, marginMode: vendor.marginMode, marginPercent: vendor.marginPercent, vendorShipping: vendor.vendorShipping, updatedAt: new Date().toISOString() });
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
