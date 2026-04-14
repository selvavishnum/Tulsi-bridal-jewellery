'use client';

import { useSession } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';
import {
  FiHome, FiPackage, FiShoppingBag, FiCalendar, FiBarChart2,
  FiTag, FiUsers, FiMenu, FiX, FiLogOut,
} from 'react-icons/fi';
import { GiQueenCrown } from 'react-icons/gi';
import { signOut } from 'next-auth/react';
import { useState } from 'react';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

const navItems = [
  { href: '/admin', label: 'Dashboard', icon: FiHome },
  { href: '/admin/products', label: 'Products', icon: FiPackage },
  { href: '/admin/orders', label: 'Orders', icon: FiShoppingBag },
  { href: '/admin/rentals', label: 'Rentals', icon: FiCalendar },
  { href: '/admin/customers', label: 'Customers', icon: FiUsers },
  { href: '/admin/coupons', label: 'Coupons', icon: FiTag },
  { href: '/admin/reports', label: 'Reports', icon: FiBarChart2 },
];

export default function AdminLayout({ children }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
    if (status === 'authenticated' && session.user.role !== 'admin') router.push('/');
  }, [status, session, router]);

  if (status === 'loading') return <div className="min-h-screen flex items-center justify-center"><LoadingSpinner size="lg" /></div>;
  if (!session || session.user.role !== 'admin') return null;

  const Sidebar = () => (
    <div className="flex flex-col h-full bg-maroon-950">
      <div className="p-5 flex items-center gap-2 border-b border-white/10">
        <GiQueenCrown className="text-gold-400 text-2xl" />
        <div>
          <p className="font-serif font-bold text-white text-sm">Tulsi Admin</p>
          <p className="text-gold-400 text-xs">{session.user.email}</p>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={() => setSidebarOpen(false)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${pathname === href ? 'bg-white/15 text-white' : 'text-gray-300 hover:bg-white/10 hover:text-white'}`}
          >
            <Icon className="text-base flex-shrink-0" /> {label}
          </Link>
        ))}
      </nav>
      <div className="p-3 border-t border-white/10">
        <Link href="/" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-300 hover:bg-white/10 hover:text-white transition mb-1">
          <FiHome className="text-base" /> View Site
        </Link>
        <button onClick={() => signOut()} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-300 hover:bg-red-500/20 hover:text-red-300 transition">
          <FiLogOut className="text-base" /> Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden md:flex md:w-56 lg:w-64 flex-shrink-0 flex-col">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <div className="relative w-64 h-full"><Sidebar /></div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile topbar */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 bg-maroon-950 text-white">
          <button onClick={() => setSidebarOpen(true)}><FiMenu className="text-xl" /></button>
          <span className="font-serif font-bold">Tulsi Admin</span>
        </div>

        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
