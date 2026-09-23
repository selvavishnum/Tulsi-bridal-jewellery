import { NextResponse } from 'next/server';
import { requireVendor, requireActiveVendor, logVendorStockChange } from '@/lib/vendorAuth';
import { parseVendorProduct, toVendorProduct, vendorPriceFloorError } from '@/lib/vendorCatalog';

/* Another vendor's product and a missing id get the same 404, so ids can't
   be probed (scopedDb.get returns null for both). */
const notFound = () => NextResponse.json({ success: false, message: 'Product not found' }, { status: 404 });

export async function GET(request, context) {
  try {
    const ctx = await requireVendor();
    if (ctx.error) return ctx.error;
    const { id } = await context.params;
    const product = await ctx.sdb.get('products', id);
    if (!product) return notFound();
    return NextResponse.json({ success: true, data: toVendorProduct(product.id, product) });
  } catch (e) {
    console.error('[vendor/products/:id GET]', e.message);
    return NextResponse.json({ success: false, message: 'Could not load the product' }, { status: 500 });
  }
}

/* PUT /api/vendor/products/:id — edit listing, retail price, offer price
   and stock. Price changes on a live piece take effect immediately but may
   not go below the supply cost Tulsi retains. */
export async function PUT(request, context) {
  try {
    const ctx = await requireActiveVendor();
    if (ctx.error) return ctx.error;
    const { id } = await context.params;
    const current = await ctx.sdb.get('products', id);
    if (!current) return notFound();

    const parsed = parseVendorProduct(await request.json().catch(() => null), current);
    if (parsed.error) return NextResponse.json({ success: false, message: parsed.error }, { status: parsed.status });
    const data = parsed.data;

    const floor = vendorPriceFloorError({ ...current, ...data });
    if (floor) return NextResponse.json({ success: false, message: floor }, { status: 400 });

    if (data.sku !== undefined && data.sku !== current.sku) {
      if (!data.sku) return NextResponse.json({ success: false, message: 'SKU cannot be empty.' }, { status: 400 });
      const dup = await ctx.db.collection('products').where('sku', '==', data.sku).limit(1).get();
      if (!dup.empty && dup.docs[0].id !== id) {
        return NextResponse.json({ success: false, message: `SKU "${data.sku}" is already in use. Choose another.` }, { status: 409 });
      }
    }
    if (data.stock !== undefined && data.stock !== (Number(current.stock) || 0)) {
      await logVendorStockChange(ctx, id, Number(current.stock) || 0, data.stock);
    }

    const saved = await ctx.sdb.update('products', id, data);
    if (!saved) return notFound();
    return NextResponse.json({ success: true, data: toVendorProduct(saved.id, saved) });
  } catch (e) {
    console.error('[vendor/products/:id PUT]', e.message);
    return NextResponse.json({ success: false, message: 'Could not save the product' }, { status: 500 });
  }
}
