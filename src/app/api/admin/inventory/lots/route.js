import { NextResponse } from 'next/server';
import { getDB, snapshotToArr } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';

export async function GET(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('productId') || '';

    const db = getDB();
    let query = db.collection('stockLots').orderBy('createdAt', 'desc');
    const snap = await query.get();
    let lots = snapshotToArr(snap);

    if (productId) lots = lots.filter((l) => l.productId === productId);

    // FIFO valuation: group active/partial lots by product, oldest first
    const activeByProduct = {};
    for (const lot of lots) {
      if (lot.status === 'active' || lot.status === 'partial') {
        if (!activeByProduct[lot.productId]) activeByProduct[lot.productId] = [];
        activeByProduct[lot.productId].push(lot);
      }
    }

    const valuation = [];
    let grandTotal = 0;
    for (const [pid, pLots] of Object.entries(activeByProduct)) {
      const sorted = pLots.sort((a, b) => {
        if (a.purchaseDate < b.purchaseDate) return -1;
        if (a.purchaseDate > b.purchaseDate) return 1;
        return a.createdAt < b.createdAt ? -1 : 1;
      });
      const fifoQty = sorted.reduce((s, l) => s + (l.remainingQty || 0), 0);
      const fifoValue = sorted.reduce((s, l) => s + (l.remainingQty || 0) * (l.purchasePrice || 0), 0);
      const avgCost = fifoQty > 0 ? fifoValue / fifoQty : 0;
      grandTotal += fifoValue;
      valuation.push({
        productId: pid,
        productName: sorted[0].productName,
        sku: sorted[0].sku || '',
        fifoQty,
        fifoValue,
        avgCost,
      });
    }

    valuation.sort((a, b) => a.productName.localeCompare(b.productName));

    return NextResponse.json({ success: true, data: { lots, valuation, grandTotal } });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
