'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { cldThumb } from '@/lib/cloudinaryImage';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { formatPrice } from '@/lib/utils';

export default function VendorCatalogPage() {
  const [products, setProducts] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/vendor/products').then((r) => r.json())
      .then((d) => (d.success ? setProducts(d.data) : setError(d.message)))
      .catch(() => setError('Could not load your catalogue. Check your connection and refresh.'));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!products) return <div className="py-20 flex justify-center"><LoadingSpinner size="lg" /></div>;
  if (products.length === 0) return <p className="text-sm text-stone-500">No products are listed under your name yet — Tulsi adds and prices them for you.</p>;

  return (
    <div>
      <p className="text-sm text-stone-500 mb-4">Listings, prices and stock are managed by Tulsi. Margin shown is per piece, before shipping and platform fee.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {products.map((p) => {
          const selling = p.discountPrice || p.price;
          return (
            <article key={p.id} className="bg-white rounded-xl border border-stone-200 p-3 flex gap-3">
              <div className="w-20 h-20 rounded-lg bg-stone-100 overflow-hidden flex-shrink-0">
                {p.image && <Image src={cldThumb(p.image, 160)} alt={p.name} width={80} height={80} unoptimized className="w-full h-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold text-stone-800 truncate">{p.name}</p>
                <p className="text-xs text-stone-400">{p.sku} · stock {p.stock}</p>
                <p className="mt-1 tabular-nums">
                  {formatPrice(selling)}
                  {p.discountPrice > 0 && p.discountPrice < p.price && <span className="text-xs text-stone-400 line-through ml-1">{formatPrice(p.price)}</span>}
                </p>
                <p className="text-xs text-stone-500 tabular-nums">Supply {formatPrice(p.supplyCost)} · margin <span className="font-semibold text-stone-700">{formatPrice(selling - p.supplyCost)}</span></p>
                <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${p.live ? 'bg-green-50 text-green-700' : 'bg-stone-100 text-stone-500'}`}>{p.live ? 'Live' : 'Hidden'}</span>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
