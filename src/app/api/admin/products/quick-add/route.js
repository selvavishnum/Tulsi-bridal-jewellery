import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { requireRole, CAN } from '@/lib/requireRole';
import { stripCostFields } from '@/lib/access';
import { PLATFORM_VENDOR_ID } from '@/lib/settlement';
import { parseQuickAdd, generateSku, customerPrices } from '@/lib/quickAddProduct';
import { nextLotNumber, lotDoc } from '@/lib/stockLots';

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const PRICE_KEYS = ['purchasePrice', 'mrp', 'salePrice', 'shipping'];

/* POST /api/admin/products/quick-add — add a new Tulsi piece to stock from
   the Inventory screen in one step.
   Super Admin / Business Manager: priced and live in the shop; a purchase
   cost opens a FIFO stock lot for margin tracking.
   Product staff: same form without prices — saved as a hidden draft for
   a Super Admin to price and publish (as with the full product form). */
export async function POST(request) {
  try {
    const auth = await requireRole(CAN.editCatalog);
    if (auth.error) return auth.error;
    const pricing = CAN.manageCatalog.includes(auth.tier);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({ success: false, message: 'Invalid request' }, { status: 400 });
    if (!pricing && PRICE_KEYS.some((k) => body[k] !== undefined && body[k] !== null && body[k] !== '')) {
      return NextResponse.json({ success: false, message: 'Prices and purchase cost need a Super Admin or Business Manager.' }, { status: 403 });
    }

    const parsed = parseQuickAdd(body, { pricing });
    if (parsed.errors) return NextResponse.json({ success: false, message: 'Please fix the highlighted fields.', errors: parsed.errors }, { status: 400 });
    const d = parsed.data;

    const db = getDB();
    const sku = d.sku || generateSku(d.category);
    const dup = await db.collection('products').where('sku', '==', sku).limit(1).get();
    if (!dup.empty) {
      return NextResponse.json({ success: false, message: `SKU "${sku}" is already used by “${dup.docs[0].data().name || 'another product'}”.`, errors: { sku: 'Already in use — tap Auto to get a new one' } }, { status: 409 });
    }

    /* Shipping is built into what the customer pays — added to MRP and
       selling price, never charged separately. */
    const prices = pricing ? customerPrices(d) : { price: 0, discountPrice: 0, includedShipping: 0 };
    const now = new Date().toISOString();
    const ref = db.collection('products').doc();
    const product = {
      name: d.name,
      slug: `${slugify(d.name)}-${Date.now().toString(36)}`,
      sku,
      category: d.category,
      subCategory: d.designType || '',
      description: '',
      images: d.images,
      price: prices.price,
      discountPrice: prices.discountPrice,
      includedShipping: prices.includedShipping,
      stock: d.stock,
      lowStockAt: d.lowStockAt,
      ...(pricing && d.purchasePrice !== null && { purchasePrice: d.purchasePrice }),
      /* Priced by an owner → live; staff draft → hidden until priced. */
      isActive: pricing,
      showMe: pricing,
      featured: false,
      isNew: true,
      isAvailableForRent: false, rentalPrice: 0, rentalStock: 0,
      tags: d.designType ? [d.designType.toLowerCase()] : [],
      vendorId: PLATFORM_VENDOR_ID, supplyCost: 0, marginMode: 'fixed', marginPercent: 0, vendorShipping: null,
      createdBy: auth.session?.user?.email || null,
      createdVia: 'quick-add',
      createdAt: now,
      updatedAt: now,
    };
    await ref.set(product);

    /* Purchase cost → a FIFO stock lot, like Purchase → Inward. */
    if (pricing && d.purchasePrice !== null) {
      await db.collection('stockLots').doc().set(lotDoc({
        lotNumber: await nextLotNumber(db), productId: ref.id, productName: d.name, sku,
        qty: d.stock, purchasePrice: d.purchasePrice, source: 'quick-add',
      }));
    }

    const saved = { id: ref.id, _id: ref.id, ...product };
    return NextResponse.json({ success: true, data: pricing ? saved : stripCostFields(saved) }, { status: 201 });
  } catch (e) {
    console.error('[quick-add]', e.message);
    return NextResponse.json({ success: false, message: 'Could not add the product. Please try again.' }, { status: 500 });
  }
}
