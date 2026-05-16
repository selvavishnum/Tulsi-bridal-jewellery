import { NextResponse } from 'next/server';
import { getDB, snapshotToArr, docToObj } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';

async function generateLotNumber(db) {
  const snap = await db.collection('stockLots').orderBy('lotNumber', 'desc').limit(1).get();
  if (snap.empty) return 'LOT-TBJ-0001';
  const last = snap.docs[0].data().lotNumber || 'LOT-TBJ-0000';
  const num = parseInt(last.split('-').pop() || '0') + 1;
  return `LOT-TBJ-${String(num).padStart(4, '0')}`;
}

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

    // Stock update + FIFO lot creation
    const stockBatch = db.batch();
    for (const item of (items || [])) {
      if (item.productId && item.qty) {
        const productRef = db.collection('products').doc(item.productId);
        const productSnap = await productRef.get();
        if (productSnap.exists) {
          const productData = productSnap.data();
          const currentStock = productData.stock || 0;
          const updateData = { stock: currentStock + item.qty };
          if (item.purchasePrice) updateData.purchasePrice = item.purchasePrice;
          stockBatch.update(productRef, updateData);

          // Create FIFO stock lot
          const lotNumber = await generateLotNumber(db);
          const lotRef = db.collection('stockLots').doc();
          stockBatch.set(lotRef, {
            lotNumber,
            productId: item.productId,
            productName: item.name || productData.name || '',
            sku: productData.sku || '',
            purchaseInwardId: ref.id,
            invoiceNumber: invoiceNumber || '',
            supplierId: supplierId || '',
            supplierName: supplierName || '',
            purchaseDate: invoiceDate || new Date().toISOString().split('T')[0],
            originalQty: item.qty,
            remainingQty: item.qty,
            purchasePrice: parseFloat(item.purchasePrice) || 0,
            totalLotCost: item.qty * (parseFloat(item.purchasePrice) || 0),
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }
    await stockBatch.commit();
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

export async function DELETE(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });
    const db = getDB();
    await db.collection('purchaseOrders').doc(id).delete();
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
