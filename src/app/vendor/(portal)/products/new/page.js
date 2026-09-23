'use client';
import ProductForm from '@/components/vendor/ProductForm';

export default function NewVendorProductPage() {
  return (
    <div>
      <h1 className="font-serif text-2xl font-bold text-stone-900 mb-4">Add a product</h1>
      <ProductForm />
    </div>
  );
}
