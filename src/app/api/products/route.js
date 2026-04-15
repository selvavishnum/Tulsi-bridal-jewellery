import { NextResponse } from 'next/server';
import { getDB, paginate } from '@/lib/firebase';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
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

    let q = db.collection('products').where('isActive', '==', true);
    if (category) q = q.where('category', '==', category);
    if (featured === 'true') q = q.where('featured', '==', true);
    if (rental === 'true') q = q.where('isAvailableForRent', '==', true);
    q = q.orderBy('createdAt', 'desc');

    const result = await paginate(q, page, limit);

    // Client-side name/sku search (Firestore has no full-text search)
    if (search) {
      const term = search.toLowerCase();
      result.data = result.data.filter(
        (p) => p.name?.toLowerCase().includes(term) || p.sku?.toLowerCase().includes(term)
      );
    }

    return NextResponse.json({
      success: true,
      data: { products: result.data, total: result.total, page: result.page, pages: result.pages },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'admin') {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }
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
