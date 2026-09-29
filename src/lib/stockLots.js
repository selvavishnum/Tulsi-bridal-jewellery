/* FIFO stock lots — shared by Purchase → Inward and Quick Add Product.
   Takes `db`. */

/** Next lot number: LOT-TBJ-0001, LOT-TBJ-0002, … */
export async function nextLotNumber(db) {
  const snap = await db.collection('stockLots').orderBy('lotNumber', 'desc').limit(1).get();
  if (snap.empty) return 'LOT-TBJ-0001';
  const last = snap.docs[0].data().lotNumber || 'LOT-TBJ-0000';
  const num = parseInt(last.split('-').pop() || '0', 10) + 1;
  return `LOT-TBJ-${String(num).padStart(4, '0')}`;
}

/** The lot document for `qty` pieces bought at `purchasePrice` each. */
export function lotDoc({ lotNumber, productId, productName, sku, qty, purchasePrice, source, purchaseDate, extra = {} }) {
  const now = new Date().toISOString();
  const price = Number(purchasePrice) || 0;
  return {
    lotNumber, productId, productName: productName || '', sku: sku || '',
    purchaseDate: purchaseDate || now.split('T')[0],
    originalQty: qty, remainingQty: qty,
    purchasePrice: price, totalLotCost: qty * price,
    status: 'active', source,
    ...extra,
    createdAt: now, updatedAt: now,
  };
}
