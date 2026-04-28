/* ─────────────────────────────────────────────
   TrendingGrid
   "Our TRENDING Collections" — 4-col photo grid
   matching the Swastik layout exactly
   ───────────────────────────────────────────── */
'use client';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';

export default function TrendingGrid() {
  const [products, setProducts] = useState([]);

  useEffect(() => {
    fetch('/api/products?featured=true&limit=8')
      .then((r) => r.json())
      .then((d) => { if (d.success) setProducts(d.data.products); })
      .catch(() => {});
  }, []);

  /* Placeholder tiles when no products loaded yet */
  const tiles = products.length >= 4 ? products.slice(0, 8) : Array.from({ length: 8 });

  return (
    <section className="bg-white py-8">
      <div className="max-w-5xl mx-auto px-4">
        {/* Heading */}
        <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-5">
          Our <span className="tracking-widest">TRENDING</span> Collections
        </h2>

        {/* 4-column grid */}
        <div className="grid grid-cols-4 gap-1.5 md:gap-2">
          {tiles.map((p, i) => (
            <Link
              key={p?._id || i}
              href={p ? `/product/${p._id}` : '/catalog'}
              className="group relative aspect-square bg-velvet-800 overflow-hidden block"
            >
              {p?.images?.[0] ? (
                <Image
                  src={p.images[0]}
                  alt={p.name}
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                /* placeholder — dark velvet tile */
                <div className="w-full h-full bg-velvet-700 flex items-center justify-center">
                  <span className="text-3xl opacity-30">💍</span>
                </div>
              )}
              {/* subtle hover overlay */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
            </Link>
          ))}
        </div>

        <div className="text-center mt-6">
          <Link
            href="/catalog"
            className="inline-block border border-gray-400 text-gray-700 text-xs tracking-[0.25em] uppercase px-8 py-2.5 hover:bg-gray-900 hover:text-white hover:border-gray-900 transition-colors"
          >
            View Full Catalogue
          </Link>
        </div>
      </div>
    </section>
  );
}
