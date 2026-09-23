import { NextResponse } from 'next/server';
import { requireVendor, requireActiveVendor } from '@/lib/vendorAuth';
import { parseVendorProduct, toVendorProduct, vendorPriceFloorError } from '@/lib/vendorCatalog';
import { marginFor } from '@/lib/settlement';
import { slugify } from '@/lib/utils';

/* GET /api/vendor/products — the vendor's own catalogue. scopedDb appends
   `vendorId == <this vendor>`, and toVendorProduct drops the margin and
   every platform-only field. */
export async function GET() {
  try {
    const ctx = await requireVendor();
    if (ctx.error) return ctx.error;
    const snap = await ctx.sdb.query('products').get();
    const products = snap.docs
      .map((d) => toVendorProduct(d.id, d.data()))
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ success: true, data: products });
  } catch (e) {
    console.error('[vendor/products GET]', e.message);
    return NextResponse.json({ success: false, message: 'Could not load products' }, { status: 500 });
  }
}

/* POST /api/vendor/products — a new listing. It starts hidden and "in
   review": Tulsi checks it, confirms the margin and publishes it. The
   vendor's retail price, offer price and shipping charge are kept as entered. */
export async function POST(request) {
  try {
    const ctx = await requireActiveVendor();
    if (ctx.error) return ctx.error;
    const parsed = parseVendorProduct(await request.json().catch(() => null), null);
    if (parsed.error) return NextResponse.json({ success: false, message: parsed.error }, { status: parsed.status });
    const data = parsed.data;

    if (!data.sku) data.sku = `V-${data.category.slice(0, 3).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
    const dup = await ctx.db.collection('products').where('sku', '==', data.sku).limit(1).get();
    if (!dup.empty) return NextResponse.json({ success: false, message: `SKU "${data.sku}" is already in use. Choose another.` }, { status: 409 });

    /* With a default margin % on the vendor, the new piece is priced for
       review straight away; otherwise Tulsi sets the margin at review. */
    const pct = Number(ctx.vendor.defaultMarginPercent) || 0;
    const margin = pct > 0
      ? { marginMode: 'percent', marginPercent: pct, supplyCost: marginFor({ ...data, marginMode: 'percent', marginPercent: pct }) }
      : { marginMode: 'fixed', marginPercent: 0, supplyCost: 0 };
    const floor = vendorPriceFloorError({ ...data, ...margin });
    if (floor) return NextResponse.json({ success: false, message: floor }, { status: 400 });

    const product = await ctx.sdb.create('products', {
      description: '', images: [], discountPrice: 0, stock: 0, material: '', tags: [],
      ...data,
      slug: `${slugify(data.name)}-${Date.now().toString(36)}`,
      isActive: false,
      showMe: false,
      featured: false,
      isNew: true,
      reviewStatus: 'pending',
      ...margin,
      submittedBy: ctx.session.user.email || null,
    });
    return NextResponse.json({ success: true, data: toVendorProduct(product.id, product) }, { status: 201 });
  } catch (e) {
    console.error('[vendor/products POST]', e.message);
    return NextResponse.json({ success: false, message: 'Could not save the product' }, { status: 500 });
  }
}
