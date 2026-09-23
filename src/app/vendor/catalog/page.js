import { redirect } from 'next/navigation';

/* Old URL — the catalogue is now the Products page. */
export default function VendorCatalogRedirect() {
  redirect('/vendor/products');
}
