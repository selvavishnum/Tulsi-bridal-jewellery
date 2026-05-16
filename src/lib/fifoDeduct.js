/**
 * FIFO deduction utility.
 * Deducts `qty` pieces from the oldest active lots for a product.
 */
export async function fifoDeduct(db, productId, qty) {
  if (!productId || qty <= 0) return;

  const snap = await db.collection('stockLots')
    .where('productId', '==', productId)
    .get();

  const lots = snap.docs
    .map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))
    .filter((l) => l.status === 'active' || l.status === 'partial')
    .sort((a, b) => {
      if (a.purchaseDate < b.purchaseDate) return -1;
      if (a.purchaseDate > b.purchaseDate) return 1;
      return a.createdAt < b.createdAt ? -1 : 1;
    });

  let remaining = qty;
  const batch = db.batch();

  for (const lot of lots) {
    if (remaining <= 0) break;
    const deduct = Math.min(lot.remainingQty, remaining);
    const newRemaining = lot.remainingQty - deduct;
    batch.update(lot.ref, {
      remainingQty: newRemaining,
      status: newRemaining === 0 ? 'consumed' : 'partial',
      updatedAt: new Date().toISOString(),
    });
    remaining -= deduct;
  }

  await batch.commit();
}
