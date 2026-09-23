'use client';
import { useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Loading, Pill, PRODUCT_STATUS, sendJson, useVendorData } from '@/components/vendor/ui';

/* Quick stock controls: an In stock / Out of stock switch and an inline
   quantity editor per product. Each change saves on its own. */
export default function VendorInventoryPage() {
  const { data, error, setData } = useVendorData('/api/vendor/products');
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(null);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <Loading />;

  async function patch(id, body) {
    setBusy(id);
    try {
      const saved = await sendJson('/api/vendor/inventory', 'PATCH', { id, ...body });
      setData((list) => list.map((p) => (p.id === id ? saved : p)));
      setDrafts(({ [id]: _drop, ...rest }) => rest);
      toast.success(`${saved.name}: ${saved.stock} in stock`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  }

  const saveQty = (p) => {
    const raw = drafts[p.id];
    if (raw === undefined || raw === '' || Number(raw) === p.stock) return;
    patch(p.id, { stock: Number(raw) });
  };

  const totalUnits = data.reduce((s, p) => s + p.stock, 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl font-bold text-stone-900">Inventory</h1>
        <p className="text-sm text-stone-500">{data.length} products · {totalUnits} pieces in stock. Changes save as you make them.</p>
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-stone-500">No products yet. <Link href="/vendor/products/new" className="text-wine-700 font-semibold">Add one</Link>.</p>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 divide-y divide-stone-100">
          {data.map((p) => {
            const inStock = p.stock > 0;
            const [text, cls] = PRODUCT_STATUS[p.status] || [p.status, 'bg-stone-100'];
            const draft = drafts[p.id] ?? String(p.stock);
            return (
              <div key={p.id} className="p-3 sm:p-4 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1 basis-48">
                  <Link href={`/vendor/products/${p.id}`} className="font-semibold text-sm text-stone-800 hover:text-wine-700 truncate block">{p.name}</Link>
                  <p className="text-xs text-stone-400 font-mono">{p.sku} <Pill className={`${cls} ml-1 font-sans`}>{text}</Pill></p>
                </div>
                <button role="switch" aria-checked={inStock} aria-label={`${p.name} in stock`} disabled={busy === p.id}
                  onClick={() => patch(p.id, { inStock: !inStock })}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border disabled:opacity-50 ${inStock ? 'bg-green-50 border-green-200 text-green-700' : 'bg-stone-100 border-stone-200 text-stone-500'}`}>
                  <span className={`w-7 h-4 rounded-full relative transition-colors ${inStock ? 'bg-green-600' : 'bg-stone-300'}`}>
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${inStock ? 'left-3.5' : 'left-0.5'}`} />
                  </span>
                  {inStock ? 'In stock' : 'Out of stock'}
                </button>
                <form onSubmit={(e) => { e.preventDefault(); saveQty(p); }} className="flex items-center gap-2">
                  <label className="sr-only" htmlFor={`qty-${p.id}`}>Quantity for {p.name}</label>
                  <input id={`qty-${p.id}`} type="number" min="0" step="1" inputMode="numeric" value={draft}
                    onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                    onBlur={() => saveQty(p)}
                    className="w-20 px-2 py-1.5 border border-stone-300 rounded-lg text-sm text-right tabular-nums outline-none focus:border-wine-700" />
                  <span className="text-xs text-stone-400">pcs</span>
                </form>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
