import { NextResponse } from 'next/server';
import { requireVendor } from '@/lib/vendorAuth';

/* GET /api/vendor/products — the vendor's own catalogue, read-only.
   Listing, pricing and supply cost are managed by the platform admin. */
export async function GET() {
  try {
    const ctx = await requireVendor('catalog:read');
    if (!ctx) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const snap = await ctx.sdb.query('products').get();
    const products = snap.docs.map((d) => {
      const p = d.data();
      return {
        id: d.id,
        name: p.name || '',
        sku: p.sku || '',
        image: p.images?.[0] || null,
        category: p.category || '',
        price: Number(p.price) || 0,
        discountPrice: Number(p.discountPrice) || 0,
        supplyCost: Number(p.supplyCost) || 0,
        stock: Number(p.stock) || 0,
        live: p.isActive !== false && p.showMe !== false,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ success: true, data: products });
  } catch (e) {
    console.error('[vendor/products]', e.message);
    return NextResponse.json({ success: false, message: 'Could not load products' }, { status: 500 });
  }
}
