'use client';
import { use } from 'react';
import Link from 'next/link';
import ProductForm from '@/components/vendor/ProductForm';
import { Loading, Pill, PRODUCT_STATUS, useVendorData } from '@/components/vendor/ui';

export default function EditVendorProductPage({ params }) {
  const { id } = use(params);
  const { data, error } = useVendorData(`/api/vendor/products/${encodeURIComponent(id)}`);
  if (error) return <p className="text-sm text-red-600">{error} <Link href="/vendor/products" className="underline">Back to products</Link></p>;
  if (!data) return <Loading />;
  const [text, cls] = PRODUCT_STATUS[data.status] || [data.status, 'bg-stone-100'];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h1 className="font-serif text-2xl font-bold text-stone-900">Edit product</h1>
        <Pill className={cls}>{text}</Pill>
      </div>
      <ProductForm product={data} />
    </div>
  );
}
