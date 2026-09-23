'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { FiPlus, FiSearch, FiEdit2 } from 'react-icons/fi';
import { cldThumb } from '@/lib/cloudinaryImage';
import { Loading, Pill, PRODUCT_STATUS, inr, useVendorData } from '@/components/vendor/ui';

const FILTERS = [['all', 'All'], ['live', 'Live'], ['in_review', 'In review'], ['out_of_stock', 'Out of stock'], ['hidden', 'Hidden']];

export default function VendorProductsPage() {
  const { data, error } = useVendorData('/api/vendor/products');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');

  const shown = useMemo(() => (data || []).filter((p) => (filter === 'all' || p.status === filter)
    && (!q || `${p.name} ${p.sku}`.toLowerCase().includes(q.toLowerCase()))), [data, q, filter]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <Loading />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl font-bold text-stone-900">Products <span className="text-base font-sans font-normal text-stone-400">({data.length})</span></h1>
        <Link href="/vendor/products/new" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-wine-700 hover:bg-wine-800 text-white text-sm font-semibold">
          <FiPlus /> Add a product
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <label className="relative flex-1">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title or SKU" aria-label="Search products"
            className="w-full pl-9 pr-3 py-2.5 border border-stone-300 rounded-xl text-sm bg-white outline-none focus:border-wine-700" />
        </label>
        <div className="flex gap-1.5 overflow-x-auto">
          {FILTERS.map(([id, text]) => (
            <button key={id} onClick={() => setFilter(id)} aria-pressed={filter === id}
              className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap ${filter === id ? 'bg-wine-700 text-white' : 'bg-white border border-stone-200 text-stone-600'}`}>
              {text}
            </button>
          ))}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 p-6 text-sm text-stone-600">
          No products yet. <Link href="/vendor/products/new" className="text-wine-700 font-semibold">Add your first piece</Link> — Tulsi reviews it and puts it live.
        </div>
      ) : shown.length === 0 ? (
        <p className="text-sm text-stone-500">Nothing matches that search.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {shown.map((p) => {
            const [text, cls] = PRODUCT_STATUS[p.status] || [p.status, 'bg-stone-100'];
            const onOffer = p.discountPrice > 0 && p.discountPrice < p.price;
            return (
              <Link key={p.id} href={`/vendor/products/${p.id}`}
                className="bg-white rounded-xl border border-stone-200 p-3 flex gap-3 hover:border-wine-700/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-wine-700">
                <div className="w-20 h-20 rounded-lg bg-stone-100 overflow-hidden flex-shrink-0">
                  {p.images[0] && <Image src={cldThumb(p.images[0], 160)} alt="" width={80} height={80} unoptimized className="w-full h-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold text-stone-800 truncate">{p.name}</p>
                  <p className="text-xs text-stone-400 font-mono truncate">{p.sku}</p>
                  <p className="mt-1 tabular-nums">
                    {inr(onOffer ? p.discountPrice : p.price)}
                    {onOffer && <span className="text-xs text-stone-400 line-through ml-1">{inr(p.price)}</span>}
                    <span className="text-xs text-stone-500 ml-2">· {p.stock} in stock</span>
                  </p>
                  <div className="mt-1 flex items-center justify-between">
                    <Pill className={cls}>{text}</Pill>
                    <FiEdit2 className="text-stone-400" aria-hidden />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
