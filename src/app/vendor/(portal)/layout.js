'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { FiLogOut, FiExternalLink } from 'react-icons/fi';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

const TABS = [
  { href: '/vendor/dashboard', label: 'Dashboard' },
  { href: '/vendor/products', label: 'Products' },
  { href: '/vendor/inventory', label: 'Inventory' },
  { href: '/vendor/orders', label: 'Orders & Earnings' },
  { href: '/vendor/profile', label: 'Store Profile' },
];

/* Vendor self-service portal. The middleware already keeps anyone but a
   vendor out and every /api/vendor call re-checks the vendor from the
   database; this guard just avoids a flash while the session loads. */
export default function VendorPortalLayout({ children }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const role = session?.user?.role;

  useEffect(() => {
    if (status === 'loading' || role === 'vendor') return;
    router.replace(role === 'admin' ? '/admin' : `/vendor/login?callbackUrl=${encodeURIComponent(pathname)}`);
  }, [status, role, router, pathname]);

  if (status === 'loading' || role !== 'vendor') {
    return <div className="min-h-screen flex items-center justify-center bg-stone-50"><LoadingSpinner size="lg" /></div>;
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-serif text-lg font-bold text-wine-700 leading-tight">Tulsi Vendor Portal</p>
            <p className="text-xs text-stone-500 truncate">{session.user.email}</p>
          </div>
          <div className="flex items-center gap-4 flex-shrink-0">
            <Link href="/" className="hidden sm:flex items-center gap-1.5 text-sm text-stone-500 hover:text-wine-700">
              Shop <FiExternalLink className="text-xs" />
            </Link>
            <button onClick={() => signOut({ callbackUrl: '/vendor/login' })}
              className="flex items-center gap-2 text-sm text-stone-500 hover:text-wine-700">
              <FiLogOut /> Sign out
            </button>
          </div>
        </div>
        <nav className="max-w-6xl mx-auto px-2 flex overflow-x-auto" aria-label="Vendor sections">
          {TABS.map((t) => {
            const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
            return (
              <Link key={t.href} href={t.href} aria-current={active ? 'page' : undefined}
                className={`px-3 py-2.5 text-sm font-semibold border-b-2 whitespace-nowrap ${active ? 'border-wine-700 text-wine-700' : 'border-transparent text-stone-500 hover:text-stone-800'}`}>
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
