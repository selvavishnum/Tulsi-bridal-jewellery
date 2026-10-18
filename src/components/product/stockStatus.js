/* What the product page says about stock — always the real figure, never
   invented urgency. Pure module (safe in tests).

     0 (or missing) → "Out of stock"
     1..LOW_STOCK_MAX → "Only N left in stock — order soon" (warm amber)
     more            → "In stock"                          */

export const LOW_STOCK_MAX = 3;

/** @returns {{ tone: 'out'|'low'|'in', count: number, label: string }} */
export function stockStatus(stock) {
  const n = Number(stock);
  const count = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  if (count < 1) return { tone: 'out', count: 0, label: 'Out of stock' };
  if (count <= LOW_STOCK_MAX) return { tone: 'low', count, label: `Only ${count} left in stock — order soon` };
  return { tone: 'in', count, label: 'In stock' };
}
