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
import { GiQueenCrown } from 'react-icons/gi';

const categories = [
  { name: 'Necklaces', href: '/shop?category=necklace' },
  { name: 'Earrings', href: '/shop?category=earrings' },
  { name: 'Bangles', href: '/shop?category=bangles' },
  { name: 'Rings', href: '/shop?category=ring' },
  { name: 'Maang Tikka', href: '/shop?category=maang-tikka' },
  { name: 'Sets', href: '/shop?category=set' },
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
      window.location.href = `/shop?search=${encodeURIComponent(searchQuery.trim())}`;
    }
  };

  return (
    <header className="bg-white shadow-sm sticky top-0 z-50">
      {/* Top bar */}
      <div className="bg-maroon-950 text-white text-center py-1.5 text-xs">
        Free shipping on orders above ₹2000 | Call us: +91 98765 43210
      </div>

      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <GiQueenCrown className="text-gold-600 text-3xl" />
            <div>
              <p className="font-serif text-lg font-bold text-maroon-950 leading-tight">Tulsi</p>
              <p className="text-xs text-gold-600 tracking-widest uppercase leading-tight">Bridal Jewellery</p>
            </div>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-6">
            <Link href="/" className="text-sm text-gray-700 hover:text-maroon-950 transition">Home</Link>
            <div className="relative group">
              <button className="flex items-center gap-1 text-sm text-gray-700 hover:text-maroon-950 transition">
                Shop <FiChevronDown className="text-xs" />
              </button>
              <div className="absolute top-full left-0 bg-white shadow-lg rounded-lg py-2 w-44 hidden group-hover:block z-50">
                {categories.map((c) => (
                  <Link key={c.name} href={c.href} className="block px-4 py-2 text-sm text-gray-700 hover:bg-gold-50 hover:text-maroon-950">
                    {c.name}
                  </Link>
                ))}
                <Link href="/shop" className="block px-4 py-2 text-sm font-semibold text-maroon-950 hover:bg-gold-50 border-t mt-1">
                  All Jewellery
                </Link>
              </div>
            </div>
            <Link href="/shop?rental=true" className="text-sm text-gray-700 hover:text-maroon-950 transition">Rentals</Link>
            <Link href="/about" className="text-sm text-gray-700 hover:text-maroon-950 transition">About</Link>
            <Link href="/contact" className="text-sm text-gray-700 hover:text-maroon-950 transition">Contact</Link>
          </div>

          {/* Search + icons */}
          <div className="flex items-center gap-3">
            <form onSubmit={handleSearch} className="hidden md:flex items-center bg-gray-100 rounded-full px-3 py-1.5 gap-2">
              <FiSearch className="text-gray-400 text-sm" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search jewellery..."
                className="bg-transparent text-sm w-36 outline-none text-gray-700 placeholder-gray-400"
              />
            </form>

            <Link href="/cart" className="relative p-2 text-gray-700 hover:text-maroon-950 transition">
              <FiShoppingCart className="text-xl" />
              {itemCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-maroon-950 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                  {itemCount}
                </span>
              )}
            </Link>

            <Link href="/wishlist" className="relative p-2 text-gray-700 hover:text-maroon-950 transition">
              <FiHeart className="text-xl" />
              {wishlistItems.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-gold-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                  {wishlistItems.length}
                </span>
              )}
            </Link>

            {session ? (
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-1.5 p-2 text-gray-700 hover:text-maroon-950 transition"
                >
                  <FiUser className="text-xl" />
                  <span className="hidden md:inline text-sm">{session.user.name?.split(' ')[0]}</span>
                </button>
                {userMenuOpen && (
                  <div className="absolute right-0 top-full bg-white shadow-lg rounded-lg py-2 w-44 z-50">
                    <Link href="/account" className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gold-50">
                      <FiUser /> My Account
                    </Link>
                    {session.user.role === 'admin' && (
                      <Link href="/admin" className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gold-50">
                        <FiSettings /> Admin Panel
                      </Link>
                    )}
                    <hr className="my-1" />
                    <button
                      onClick={() => signOut()}
                      className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                    >
                      <FiLogOut /> Sign Out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link href="/login" className="hidden md:flex items-center gap-1.5 p-2 text-gray-700 hover:text-maroon-950 transition text-sm">
                <FiUser className="text-xl" /> Login
              </Link>
            )}

            <button
              className="md:hidden p-2 text-gray-700"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <FiX className="text-xl" /> : <FiMenu className="text-xl" />}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden bg-white border-t px-4 py-4 space-y-3">
          <form onSubmit={handleSearch} className="flex items-center bg-gray-100 rounded-full px-3 py-2 gap-2 mb-3">
            <FiSearch className="text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search jewellery..."
              className="bg-transparent text-sm flex-1 outline-none"
            />
          </form>
          <Link href="/" className="block py-2 text-gray-700 border-b">Home</Link>
          <Link href="/shop" className="block py-2 text-gray-700 border-b">All Jewellery</Link>
          {categories.map((c) => (
            <Link key={c.name} href={c.href} className="block py-2 pl-4 text-sm text-gray-600 border-b">
              {c.name}
            </Link>
          ))}
          <Link href="/shop?rental=true" className="block py-2 text-gray-700 border-b">Rentals</Link>
          <Link href="/about" className="block py-2 text-gray-700 border-b">About</Link>
          <Link href="/contact" className="block py-2 text-gray-700 border-b">Contact</Link>
          {!session && <Link href="/login" className="block py-2 text-maroon-950 font-semibold">Login / Register</Link>}
        </div>
      )}
    </header>
  );
}
