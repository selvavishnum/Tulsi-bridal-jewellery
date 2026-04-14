'use client';

import { useState, useEffect } from 'react';
import ProductCard from './ProductCard';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import Link from 'next/link';

export default function FeaturedProducts() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/products?featured=true&limit=8')
      .then((r) => r.json())
      .then((d) => { if (d.success) setProducts(d.data.products); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="font-serif text-3xl font-bold text-maroon-950 mb-1">Featured Collection</h2>
            <p className="text-gray-500">Our most loved bridal pieces</p>
          </div>
          <Link href="/shop" className="text-sm font-semibold text-gold-600 hover:text-gold-700 transition hidden sm:block">
            View All →
          </Link>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
        ) : products.length === 0 ? (
          <p className="text-center text-gray-400 py-12">No featured products yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
            {products.map((p) => <ProductCard key={p._id} product={p} />)}
          </div>
        )}

        <div className="text-center mt-8 sm:hidden">
          <Link href="/shop" className="text-sm font-semibold text-gold-600">View All Products →</Link>
        </div>
      </div>
    </section>
  );
}
