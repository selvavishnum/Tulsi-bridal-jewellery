'use client';

import { useSession, signOut } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import {
  FiHome, FiPackage, FiShoppingBag, FiCalendar, FiBarChart2,
  FiTag, FiUsers, FiMenu, FiLogOut, FiTruck, FiArchive,
  FiDollarSign, FiSettings, FiUserCheck, FiTrendingUp,
} from 'react-icons/fi';
import { GiQueenCrown } from 'react-icons/gi';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

const NAV = [
  { href: '/admin',            label: 'Dashboard',        icon: FiHome },
  { href: '/admin/reports',    label: 'Reports',          icon: FiBarChart2 },
  { href: '/admin/sales',      label: 'Sales',            icon: FiTrendingUp },
  { href: '/admin/warehouses', label: 'Warehouses',       icon: FiArchive },
  { href: '/admin/suppliers',  label: 'Suppliers',        icon: FiTruck },
  { href: '/admin/orders',     label: 'Orders',           icon: FiShoppingBag },
  { href: '/admin/rentals',    label: 'Rentals',          icon: FiCalendar },
  { href: '/admin/products',   label: 'Products',         icon: FiPackage },
  { href: '/admin/customers',  label: 'Customers (CRM)',  icon: FiUsers },
  { href: '/admin/employees',  label: 'Employees (HRM)',  icon: FiUserCheck },
  { href: '/admin/accounting', label: 'Accounting',       icon: FiDollarSign },
  { href: '/admin/coupons',    label: 'Coupons & Offers', icon: FiTag },
  { href: '/admin/settings',   label: 'Admin Settings',   icon: FiSettings },
];

export default function AdminLayout({ children }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (status === 'loading') return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <LoadingSpinner size="lg" />
    </div>
  );
  if (status === 'unauthenticated') { router.push('/admin-portal'); return null; }
  if (session?.user?.role !== 'admin') { router.push('/'); return null; }

  const Sidebar = () => (
    <div className="flex flex-col h-full bg-gray-900 overflow-y-auto">
      <div className="p-4 flex items-center gap-2 border-b border-white/10 flex-shrink-0">
        <GiQueenCrown className="text-gold-400 text-2xl flex-shrink-0" />
        <div className="min-w-0">
          <p className="font-serif font-bold text-white text-sm leading-none">Tulsi Admin</p>
          <p className="text-gold-400 text-[10px] truncate mt-0.5">{session.user.email}</p>
        </div>
      </div>

      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
          return (
            <Link key={href} href={href} onClick={() => setSidebarOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                active
                  ? 'bg-gold-600/20 text-gold-300 border-l-2 border-gold-400'
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`}>
              <Icon className="text-base flex-shrink-0" />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-2 border-t border-white/10 flex-shrink-0 space-y-0.5">
        <Link href="/" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-white/5 hover:text-white transition">
          <FiHome className="text-base" /> View Live Site
        </Link>
        <button onClick={() => signOut({ callbackUrl: '/admin-portal' })}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-red-500/10 hover:text-red-400 transition">
          <FiLogOut className="text-base" /> Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      <div className="hidden md:flex md:w-56 lg:w-60 flex-shrink-0 flex-col">
        <Sidebar />
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <div className="relative w-60 h-full z-10"><Sidebar /></div>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="md:hidden flex items-center gap-3 px-4 py-3 bg-gray-900 text-white flex-shrink-0">
          <button onClick={() => setSidebarOpen(true)}><FiMenu className="text-xl" /></button>
          <GiQueenCrown className="text-gold-400 text-lg" />
          <span className="font-serif font-bold text-sm">Tulsi Admin</span>
        </div>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
