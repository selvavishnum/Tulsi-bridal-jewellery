'use client';

import { useSession, signOut } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import {
  FiHome, FiPackage, FiShoppingBag, FiCalendar, FiBarChart2,
  FiTag, FiUsers, FiMenu, FiLogOut, FiTruck, FiArchive,
  FiDollarSign, FiSettings, FiUserCheck, FiTrendingUp, FiX,
  FiExternalLink, FiChevronRight, FiAlertTriangle,
} from 'react-icons/fi';
import { GiQueenCrown } from 'react-icons/gi';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

/* Set NEXT_PUBLIC_ADMIN_BYPASS=true in Vercel env vars to skip login during testing.
   Remove or set to false before going live with real customers. */
const DEV_BYPASS = process.env.NEXT_PUBLIC_ADMIN_BYPASS === 'true';

const NAV = [
  { href: '/admin',            label: 'Dashboard',       icon: FiHome,        exact: true },
  { href: '/admin/orders',     label: 'Orders',          icon: FiShoppingBag },
  { href: '/admin/products',   label: 'Products',        icon: FiPackage },
  { href: '/admin/rentals',    label: 'Rentals',         icon: FiCalendar },
  { href: '/admin/customers',  label: 'Customers',       icon: FiUsers },
  { href: '/admin/coupons',    label: 'Coupons',         icon: FiTag },
  { href: '/admin/reports',    label: 'Reports',         icon: FiBarChart2 },
  { href: '/admin/sales',      label: 'Sales',           icon: FiTrendingUp },
  { href: '/admin/suppliers',  label: 'Suppliers',       icon: FiTruck },
  { href: '/admin/warehouses', label: 'Warehouses',      icon: FiArchive },
  { href: '/admin/employees',  label: 'Employees',       icon: FiUserCheck },
  { href: '/admin/accounting', label: 'Accounting',      icon: FiDollarSign },
  { href: '/admin/settings',   label: 'Settings',        icon: FiSettings },
];

const NAV_GROUPS = [
  { label: 'Operations',  items: NAV.slice(0, 6) },
  { label: 'Analytics',   items: NAV.slice(6, 8) },
  { label: 'Management',  items: NAV.slice(8) },
];

function NavItem({ href, label, icon: Icon, exact, pathname, onClick }) {
  const active = exact ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`group flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all relative ${
        active
          ? 'bg-amber-500/10 text-amber-300'
          : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-amber-400 rounded-r" />
      )}
      <Icon className={`text-base flex-shrink-0 transition ${active ? 'text-amber-400' : 'text-slate-500 group-hover:text-slate-300'}`} />
      <span className="truncate">{label}</span>
      {active && <FiChevronRight className="ml-auto text-amber-400/60 text-xs flex-shrink-0" />}
    </Link>
  );
}

function Sidebar({ session, pathname, onClose }) {
  return (
    <div className="flex flex-col h-full bg-[#0d1117] border-r border-white/[0.06]">

      {/* Brand */}
      <div className="px-4 py-4 flex items-center justify-between flex-shrink-0 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-900/40 border border-amber-700/30 flex items-center justify-center flex-shrink-0">
            <GiQueenCrown className="text-amber-400 text-base" />
          </div>
          <div className="min-w-0">
            <p className="font-serif font-bold text-white text-sm leading-none">Tulsi Admin</p>
            <p className="text-[10px] text-amber-500/70 mt-0.5 truncate">{session?.user?.email}</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition md:hidden">
            <FiX className="text-lg" />
          </button>
        )}
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest px-3 mb-1.5">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavItem key={item.href} {...item} pathname={pathname} onClick={onClose} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer actions */}
      <div className="px-2 py-3 border-t border-white/[0.06] flex-shrink-0 space-y-0.5">
        <Link
          href="/"
          target="_blank"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] text-slate-500 hover:bg-white/[0.04] hover:text-slate-300 transition"
        >
          <FiExternalLink className="text-base flex-shrink-0" />
          <span>View Live Site</span>
        </Link>
        <button
          onClick={() => signOut({ callbackUrl: '/admin-portal' })}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] text-slate-500 hover:bg-red-500/8 hover:text-red-400 transition"
        >
          <FiLogOut className="text-base flex-shrink-0" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );
}

export default function AdminLayout({ children }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close mobile sidebar on route change
  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  // Dev bypass: skip all auth checks when NEXT_PUBLIC_ADMIN_BYPASS=true
  if (!DEV_BYPASS) {
    if (status === 'loading') {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#0d1117]">
          <LoadingSpinner size="lg" />
        </div>
      );
    }

    if (status === 'unauthenticated') {
      router.replace('/admin-portal');
      return null;
    }

    if (session?.user?.role !== 'admin') {
      // Show a clear error — never silently bounce to homepage
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#070b11] px-4">
          <div className="text-center space-y-4 max-w-sm">
            <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto">
              <FiAlertTriangle className="text-red-400 text-3xl" />
            </div>
            <h2 className="text-white text-xl font-bold">Access Denied</h2>
            <p className="text-slate-400 text-sm">
              <span className="text-white font-medium">{session?.user?.email}</span> is not an admin account.
            </p>
            <p className="text-slate-500 text-xs leading-relaxed">
              Add your email to <code className="bg-slate-800 px-1 rounded text-amber-400">ADMIN_EMAILS</code> in Vercel environment variables, then redeploy.
            </p>
            <div className="flex gap-3 justify-center pt-1">
              <button
                onClick={() => signOut({ callbackUrl: '/admin-portal' })}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold rounded-xl transition flex items-center gap-2"
              >
                <FiLogOut className="text-sm" /> Sign Out &amp; Retry
              </button>
            </div>
          </div>
        </div>
      );
    }
  }

  const bypassSession = DEV_BYPASS ? { user: { email: 'dev-bypass@test.com', name: 'Dev Admin' } } : null;
  const activeSession = session || bypassSession;

  return (
    <div className="flex h-screen bg-[#f0f2f5] overflow-hidden">

      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-56 lg:w-60 flex-shrink-0 flex-col">
        <Sidebar session={activeSession} pathname={pathname} />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative w-64 h-full z-10 shadow-2xl">
            <Sidebar session={activeSession} pathname={pathname} onClose={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Mobile top bar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-[#0d1117] border-b border-white/[0.06] flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-slate-400 hover:text-white transition p-1 -ml-1"
          >
            <FiMenu className="text-xl" />
          </button>
          <div className="flex items-center gap-2">
            <GiQueenCrown className="text-amber-400 text-lg" />
            <span className="font-serif font-bold text-white text-sm">Tulsi Admin</span>
          </div>
          <div className="ml-auto">
            <div className="w-7 h-7 rounded-full bg-amber-700/30 border border-amber-600/40 flex items-center justify-center">
              <span className="text-amber-300 text-xs font-bold">
                {activeSession?.user?.name?.[0]?.toUpperCase() || 'A'}
              </span>
            </div>
          </div>
        </header>

        {/* Dev bypass warning banner */}
        {DEV_BYPASS && (
          <div className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white text-xs font-semibold flex-shrink-0">
            <FiAlertTriangle className="flex-shrink-0" />
            <span>
              DEV BYPASS ACTIVE — Authentication is disabled. Remove <code className="bg-orange-600 px-1 rounded">NEXT_PUBLIC_ADMIN_BYPASS=true</code> from Vercel env vars before going live.
            </span>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
