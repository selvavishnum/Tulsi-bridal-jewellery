'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import {
  FiShoppingCart, FiHeart, FiUser, FiMenu, FiX, FiSearch,
  FiChevronDown, FiLogOut, FiSettings,
} from 'react-icons/fi';

const catalogCategories = [
  { name: 'All Jewellery', href: '/catalog' },
  { name: 'Necklaces', href: '/catalog?category=necklace' },
  { name: 'Earrings', href: '/catalog?category=earrings' },
  { name: 'Bangles', href: '/catalog?category=bangles' },
  { name: 'Rings', href: '/catalog?category=ring' },
  { name: 'Maang Tikka', href: '/catalog?category=maang-tikka' },
  { name: 'Bridal Sets', href: '/catalog?category=set' },
  { name: 'Rentals Only', href: '/catalog?rental=true' },
];

export default function Navbar() {
  const { data: session } = useSession();
  const { itemCount } = useCart();
  const { items: wishlistItems } = useWishlist();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      window.location.href = `/catalog?search=${encodeURIComponent(searchQuery.trim())}`;
    }
  };

  return (
    <header className="bg-white shadow-sm sticky top-0 z-50">
      {/* Top marquee */}
      <div className="bg-velvet-800 text-white text-center py-1.5 text-xs tracking-wide">
        Free delivery on orders above ₹2000 &nbsp;|&nbsp; Call: +91 98765 43210
      </div>

      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-1.5 group">
            <svg width="26" height="22" viewBox="0 0 52 44" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M26 2L32 16L44 8L38 24H14L8 8L20 16L26 2Z" fill="#b87333" stroke="#9a5c28" strokeWidth="1"/>
              <rect x="10" y="26" width="32" height="6" rx="1" fill="#b87333"/>
              <rect x="12" y="34" width="28" height="5" rx="1" fill="#9a5c28"/>
            </svg>
            <div>
              <p className="font-serif text-base font-bold tracking-wider text-gray-900 leading-none">TULSI</p>
              <p className="text-[9px] tracking-[0.22em] text-gold-600 uppercase leading-none">Bridal Jewellery</p>
            </div>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-5">
            <Link href="/" className="text-sm text-gray-700 hover:text-wine transition">Home</Link>

            {/* Catalogue dropdown */}
            <div className="relative group">
              <button className="flex items-center gap-1 text-sm text-gray-700 hover:text-wine transition">
                Catalogue <FiChevronDown className="text-xs" />
              </button>
              <div className="absolute top-full left-0 bg-white shadow-lg py-2 w-44 hidden group-hover:block z-50 border-t-2 border-wine">
                {catalogCategories.map((c) => (
                  <Link key={c.name} href={c.href} className="block px-4 py-2 text-sm text-gray-700 hover:bg-cream-100 hover:text-wine">
                    {c.name}
                  </Link>
                ))}
              </div>
            </div>

            <Link href="/catalog?rental=true" className="text-sm text-gray-700 hover:text-wine transition">Rentals</Link>
            <Link href="/about" className="text-sm text-gray-700 hover:text-wine transition">About</Link>
            <Link href="/contact" className="text-sm text-gray-700 hover:text-wine transition">Contact</Link>
          </div>

          {/* Right icons */}
          <div className="flex items-center gap-2">
            {/* Search */}
            <form onSubmit={handleSearch} className="hidden md:flex items-center bg-gray-100 rounded-full px-3 py-1.5 gap-2">
              <FiSearch className="text-gray-400 text-sm" />
              <input
                type="text" value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search…"
                className="bg-transparent text-sm w-28 outline-none text-gray-700 placeholder-gray-400"
              />
            </form>

            <Link href="/cart" className="relative p-2 text-gray-700 hover:text-wine transition">
              <FiShoppingCart className="text-xl" />
              {itemCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-wine text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">{itemCount}</span>
              )}
            </Link>

            <Link href="/wishlist" className="relative p-2 text-gray-700 hover:text-wine transition hidden sm:block">
              <FiHeart className="text-xl" />
              {wishlistItems.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-gold-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">{wishlistItems.length}</span>
              )}
            </Link>

            {session ? (
              <div className="relative">
                <button onClick={() => setUserMenuOpen(!userMenuOpen)} className="flex items-center gap-1.5 p-2 text-gray-700 hover:text-wine transition">
                  <FiUser className="text-xl" />
                </button>
                {userMenuOpen && (
                  <div className="absolute right-0 top-full bg-white shadow-lg py-2 w-44 z-50 border-t-2 border-wine">
                    <Link href="/account" className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-cream-100">
                      <FiUser /> My Account
                    </Link>
                    {session.user.role === 'admin' && (
                      <Link href="/admin" className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-cream-100">
                        <FiSettings /> Admin Panel
                      </Link>
                    )}
                    <hr className="my-1" />
                    <button onClick={() => signOut()} className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                      <FiLogOut /> Sign Out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link href="/login" className="hidden md:flex items-center gap-1 text-sm text-gray-700 hover:text-wine transition p-2">
                <FiUser className="text-xl" />
              </Link>
            )}

            <button className="md:hidden p-2 text-gray-700" onClick={() => setMenuOpen(!menuOpen)}>
              {menuOpen ? <FiX className="text-xl" /> : <FiMenu className="text-xl" />}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden bg-white border-t px-4 py-4 space-y-2">
          <form onSubmit={handleSearch} className="flex items-center bg-gray-100 rounded-full px-3 py-2 gap-2 mb-3">
            <FiSearch className="text-gray-400" />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search catalogue…" className="bg-transparent text-sm flex-1 outline-none" />
          </form>
          {[
            { label: 'Home', href: '/' },
            { label: 'Full Catalogue', href: '/catalog' },
            { label: 'Rental Jewellery', href: '/catalog?rental=true' },
            { label: 'About', href: '/about' },
            { label: 'Contact', href: '/contact' },
          ].map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setMenuOpen(false)} className="block py-2 text-gray-700 border-b text-sm">{l.label}</Link>
          ))}
          {!session && <Link href="/login" className="block py-2 font-semibold text-wine text-sm">Login / Register</Link>}
        </div>
      )}
    </header>
  );
}
