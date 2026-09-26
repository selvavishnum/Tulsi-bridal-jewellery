'use client';
import Link from 'next/link';
import { FiPlus, FiAlertTriangle } from 'react-icons/fi';
import { Card, Stat, Loading, Pill, inrPaise, inr, shortDate, useVendorData } from '@/components/vendor/ui';

const LOW_STOCK = 2;

export default function VendorDashboardPage() {
  const summary = useVendorData('/api/vendor/summary', { pollMs: 60000 });
  const products = useVendorData('/api/vendor/products');
  const orders = useVendorData('/api/vendor/orders', { pollMs: 60000 });

  const error = summary.error || products.error || orders.error;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!summary.data || !products.data || !orders.data) return <Loading />;
  const orderList = orders.data.orders;

  const s = summary.data.summary;
  const list = products.data;
  const count = (st) => list.filter((p) => p.status === st).length;
  const lowStock = list.filter((p) => p.status === 'live' && p.stock <= LOW_STOCK);
  const openOrders = orderList.filter((o) => ['pending', 'confirmed', 'processing', 'shipped'].includes(o.status));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold text-stone-900">{summary.data.vendor.name}</h1>
          {summary.data.vendor.status === 'suspended' && (
            <p className="text-sm text-red-600 mt-1">Your store is paused — changes are locked. Contact Tulsi.</p>
          )}
        </div>
        <Link href="/vendor/products/new" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-wine-700 hover:bg-wine-800 text-white text-sm font-semibold">
          <FiPlus /> Add a product
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Withdrawable now" value={inrPaise(s.availablePaise)} tone={s.availablePaise < 0 ? 'text-red-600' : 'text-wine-700'} hint="Paid out by Tulsi" />
        <Stat label="In return window" value={inrPaise(s.pendingPaise)} hint={`Free after ${summary.data.holdDays} days`} />
        <Stat label="Open orders" value={openOrders.length} hint="Not yet delivered" />
        <Stat label="Live products" value={count('live')} hint={`${count('in_review')} in review · ${count('out_of_stock')} out of stock`} />
      </div>

      {lowStock.length > 0 && (
        <Card title={<span className="flex items-center gap-2"><FiAlertTriangle className="text-amber-600" /> Running low</span>}
          action={<Link href="/vendor/inventory" className="text-sm font-semibold text-wine-700">Update stock</Link>}>
          <ul className="divide-y divide-stone-100 text-sm">
            {lowStock.slice(0, 5).map((p) => (
              <li key={p.id} className="py-2 flex justify-between gap-3">
                <span className="truncate text-stone-700">{p.name}</span>
                <span className="tabular-nums font-semibold text-amber-700">{p.stock} left</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Latest orders" action={<Link href="/vendor/orders" className="text-sm font-semibold text-wine-700">All orders</Link>}>
        {orderList.length === 0 ? (
          <p className="text-sm text-stone-500">No orders with your pieces yet. Orders appear here as soon as a customer buys one.</p>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {orderList.slice(0, 5).map((o) => (
              <li key={o.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-mono font-semibold text-stone-800">{o.orderNumber}</span>
                  <span className="text-xs text-stone-500 ml-2">{shortDate(o.createdAt)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{inr(o.itemsTotal)}</span>
                  <Pill className="bg-stone-100 text-stone-600 capitalize">{o.status === 'processing' ? 'packed' : o.status}</Pill>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {list.length === 0 && (
        <Card>
          <p className="text-sm text-stone-600">You haven&apos;t listed anything yet. Add your first piece — Tulsi reviews it and puts it live on tulsijewels.in.</p>
        </Card>
      )}
    </div>
  );
}
