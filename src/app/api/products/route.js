import { NextResponse } from 'next/server';
import { getDB, snapshotToArr } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';
import { slugify } from '@/lib/utils';

export async function GET(request) {
  try {
    const db = getDB();
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '12');
    const category = searchParams.get('category');
    const featured = searchParams.get('featured');
    const rental = searchParams.get('rental');
    const search = searchParams.get('search');

    // Simple query — no composite index needed
    const snap = await db.collection('products').orderBy('createdAt', 'desc').get();
    let products = snapshotToArr(snap).filter((p) => p.isActive !== false);

    // Filter in JS (avoids Firestore composite index requirement)
    if (category) products = products.filter((p) => p.category === category);
    if (featured === 'true') products = products.filter((p) => p.featured === true);
    if (rental === 'true')  products = products.filter((p) => p.isAvailableForRent === true);
    if (rental === 'false') products = products.filter((p) => !p.isAvailableForRent);
    if (search) {
      const term = search.toLowerCase();
      products = products.filter(
        (p) => p.name?.toLowerCase().includes(term) || p.sku?.toLowerCase().includes(term)
      );
    }

    const total = products.length;
    const pages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const data = products.slice(start, start + limit);

    return NextResponse.json({ success: true, data: { products: data, total, page, pages } });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const db = getDB();
    const body = await request.json();
    if (!body.slug) body.slug = slugify(body.name);
    if (!body.sku) body.sku = `${(body.category || 'PRD').substring(0, 3).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

    const productRef = db.collection('products').doc();
    const productData = {
      name: body.name,
      slug: body.slug,
      sku: body.sku,
      description: body.description || '',
      price: Number(body.price) || 0,
      discountPrice: Number(body.discountPrice) || 0,
      stock: Number(body.stock) || 0,
      category: body.category || 'other',
      images: body.images || [],
      featured: body.featured || false,
      isActive: true,
      isAvailableForRent: body.isAvailableForRent || false,
      rentalPrice: Number(body.rentalPrice) || 0,
      rentalStock: Number(body.rentalStock) || 0,
      weight: body.weight || '',
      material: body.material || '',
      occasion: body.occasion || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await productRef.set(productData);
    return NextResponse.json({ success: true, data: { id: productRef.id, ...productData } }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
