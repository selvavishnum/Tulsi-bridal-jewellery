import { NextResponse } from 'next/server';
import { requireActiveVendor, logVendorStockChange } from '@/lib/vendorAuth';
import { toVendorProduct } from '@/lib/vendorCatalog';

/* PATCH /api/vendor/inventory — quick stock controls for one of the
   vendor's own products:
     { id, stock: 12 }       set the quantity
     { id, inStock: false }  mark out of stock (quantity → 0; the old
                             quantity is remembered)
     { id, inStock: true }   back in stock (restores it, or 1) */
export async function PATCH(request) {
  try {
    const ctx = await requireActiveVendor();
    if (ctx.error) return ctx.error;
    const body = await request.json().catch(() => ({}));
    const extra = Object.keys(body || {}).filter((k) => !['id', 'stock', 'inStock'].includes(k));
    if (extra.length) return NextResponse.json({ success: false, message: `Only stock can be changed here (got ${extra.join(', ')})` }, { status: 403 });
    if (!body.id) return NextResponse.json({ success: false, message: 'Product id required' }, { status: 400 });

    const current = await ctx.sdb.get('products', body.id);
    if (!current) return NextResponse.json({ success: false, message: 'Product not found' }, { status: 404 });
    const before = Number(current.stock) || 0;

    const update = {};
    if (body.stock !== undefined) {
      const n = Number(body.stock);
      if (!Number.isInteger(n) || n < 0 || n > 100000) return NextResponse.json({ success: false, message: 'Stock must be a whole number from 0 to 100000.' }, { status: 400 });
      update.stock = n;
    } else if (body.inStock === false) {
      update.stock = 0;
      if (before > 0) update.restockQty = before;
    } else if (body.inStock === true) {
      update.stock = before > 0 ? before : Math.max(1, Number(current.restockQty) || 1);
    } else {
      return NextResponse.json({ success: false, message: 'Send stock or inStock.' }, { status: 400 });
    }

    if (update.stock !== before) await logVendorStockChange(ctx, body.id, before, update.stock);
    const saved = await ctx.sdb.update('products', body.id, update);
    return NextResponse.json({ success: true, data: toVendorProduct(saved.id, saved) });
  } catch (e) {
    console.error('[vendor/inventory]', e.message);
    return NextResponse.json({ success: false, message: 'Could not update stock' }, { status: 500 });
  }
}
