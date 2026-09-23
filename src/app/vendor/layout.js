'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { FiLogOut } from 'react-icons/fi';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

const TABS = [
  { href: '/vendor', label: 'Earnings', exact: true },
  { href: '/vendor/orders', label: 'Orders' },
  { href: '/vendor/catalog', label: 'Catalogue' },
];

/* Outside vendors' dashboard. Read-only: listing, pricing, dispatch and
   payouts are all run by the platform. The middleware already keeps anyone
   but a vendor out; this guard just avoids a flash while the session loads. */
export default function VendorLayout({ children }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center bg-stone-50"><LoadingSpinner size="lg" /></div>;
  }
  if (session?.user?.role !== 'vendor') {
    router.replace(session?.user?.role === 'admin' ? '/admin' : '/admin-portal');
    return null;
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-serif text-lg font-bold text-wine-700 leading-tight">Tulsi Vendor Portal</p>
            <p className="text-xs text-stone-500">{session.user.email}</p>
          </div>
          <button onClick={() => signOut({ callbackUrl: '/admin-portal' })}
            className="flex items-center gap-2 text-sm text-stone-500 hover:text-wine-700">
            <FiLogOut /> Sign out
          </button>
        </div>
        <nav className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto" aria-label="Vendor sections">
          {TABS.map((t) => {
            const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
            return (
              <Link key={t.href} href={t.href}
                className={`px-4 py-2.5 text-sm font-semibold border-b-2 whitespace-nowrap ${active ? 'border-wine-700 text-wine-700' : 'border-transparent text-stone-500 hover:text-stone-800'}`}>
                {t.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
