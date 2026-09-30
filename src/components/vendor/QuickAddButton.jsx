'use client';
/* "Add a product" for the vendor portal — opens Quick Add (vendor mode).
   Product lists and the dashboard refresh after a save. */
import { useCallback, useState } from 'react';
import Link from 'next/link';
import { FiPlus } from 'react-icons/fi';
import QuickAddModal from '@/components/admin/inventory/quick-add-modal';
import { PRODUCT_CATEGORIES } from '@/lib/vendorCatalog';
import { VENDOR_PRODUCTS_CHANGED } from '@/components/vendor/ui';

export default function QuickAddButton({ showFullFormLink = false }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const announce = useCallback(() => window.dispatchEvent(new Event(VENDOR_PRODUCTS_CHANGED)), []);
  return (
    <div className="flex items-center gap-3">
      {showFullFormLink && (
        <Link href="/vendor/products/new" className="text-sm font-semibold text-stone-500 hover:text-wine-700">Full form</Link>
      )}
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-wine-700 hover:bg-wine-800 text-white text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wine-700">
        <FiPlus aria-hidden /> Add a product
      </button>
      <QuickAddModal open={open} onClose={close} mode="vendor" categories={PRODUCT_CATEGORIES} onSaved={announce} />
    </div>
  );
}
