import { NextResponse } from 'next/server';
import { getDB, snapshotToArr, docToObj } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';

export async function GET() {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const db = getDB();
    const snap = await db.collection('purchaseOrders').orderBy('createdAt', 'desc').get();
    return NextResponse.json({ success: true, data: snapshotToArr(snap) });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const body = await request.json();
    const {
      invoiceNumber, invoiceDate, supplierId, supplierName, poIndentId,
      paymentStatus, items, loadingCharges, transportCharges,
      subtotal, totalTax, grandTotal, payments, notes,
    } = body;
    const db = getDB();
    const ref = db.collection('purchaseOrders').doc();
    const doc = {
      invoiceNumber: invoiceNumber || '',
      invoiceDate: invoiceDate || '',
      supplierId: supplierId || '',
      supplierName: supplierName || '',
      poIndentId: poIndentId || null,
      paymentStatus: paymentStatus || 'unpaid',
      items: items || [],
      loadingCharges: loadingCharges || 0,
      transportCharges: transportCharges || 0,
      subtotal: subtotal || 0,
      totalTax: totalTax || 0,
      grandTotal: grandTotal || 0,
      payments: payments || [],
      notes: notes || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await ref.set(doc);
    const batch = db.batch();
    for (const item of (items || [])) {
      if (item.productId && item.qty) {
        const productRef = db.collection('products').doc(item.productId);
        const productSnap = await productRef.get();
        if (productSnap.exists) {
          const currentStock = productSnap.data().stock || 0;
          const updateData = { stock: currentStock + item.qty };
          if (item.purchasePrice) updateData.purchasePrice = item.purchasePrice;
          batch.update(productRef, updateData);
        }
      }
    }
    await batch.commit();
    return NextResponse.json({ success: true, data: { id: ref.id, ...doc } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const body = await request.json();
    const { id, ...rest } = body;
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });
    const db = getDB();
    const ref = db.collection('purchaseOrders').doc(id);
    await ref.update({ ...rest, updatedAt: new Date().toISOString() });
    return NextResponse.json({ success: true, data: docToObj(await ref.get()) });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
