'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import {
  FiShoppingCart, FiHeart, FiUser, FiMenu, FiX, FiSearch,
  FiChevronDown, FiLogOut, FiSettings, FiPhone,
} from 'react-icons/fi';

const catalogCategories = [
  { name: 'All Jewellery', href: '/catalog' },
  { name: 'Necklaces', href: '/catalog?category=necklace' },
  { name: 'Earrings', href: '/catalog?category=earrings' },
  { name: 'Bangles', href: '/catalog?category=bangles' },
  { name: 'Rings', href: '/catalog?category=ring' },
  { name: 'Maang Tikka', href: '/catalog?category=maang-tikka' },
  { name: 'Bridal Sets', href: '/catalog?category=set' },
];

const NAV_LINKS = [
  { label: 'Home', href: '/' },
  { label: 'Shop', href: '/shop' },
  { label: 'Catalogue', href: '/catalog' },
  { label: 'Rentals', href: '/rentals', highlight: true },
  { label: 'About', href: '/about' },
  { label: 'Contact', href: '/contact' },
];

export default function Navbar() {
  const { data: session } = useSession();
  const { itemCount } = useCart();
  const { items: wishlistItems } = useWishlist();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [sitePhone, setSitePhone] = useState('+91 76958 68787');
  const searchRef = useRef(null);
  const userMenuRef = useRef(null);

  useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((d) => { if (d.success && d.data?.phone) setSitePhone(d.data.phone); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (searchOpen && searchRef.current) searchRef.current.focus();
  }, [searchOpen]);

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      window.location.href = `/catalog?search=${encodeURIComponent(searchQuery.trim())}`;
    }
  };

  return (
    <header className={`sticky top-0 z-50 transition-all duration-300 ${scrolled ? 'bg-white shadow-md' : 'bg-white/95 backdrop-blur-sm shadow-sm'}`}>
      {/* Top announcement bar */}
      <div className="bg-wine-800 text-white py-2">
        <div className="section-container flex items-center justify-between">
          <p className="text-xs tracking-wider text-wine-100 hidden sm:block">
            ✦ Handcrafted Bridal Jewellery — Made with Love ✦
          </p>
          <p className="text-xs tracking-wide text-center sm:text-right w-full sm:w-auto">
            Free delivery above ₹2000 &nbsp;·&nbsp;
            <a href={`tel:${sitePhone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1 font-medium hover:text-gold-300 transition-colors">
              <FiPhone className="text-[10px]" /> {sitePhone}
            </a>
          </p>
        </div>
      </div>

      {/* Main nav */}
      <nav className="section-container">
        <div className="flex items-center justify-between h-16">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group flex-shrink-0">
            <div className="w-9 h-9 flex items-center justify-center">
              <svg width="36" height="30" viewBox="0 0 52 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M26 2L32 16L44 8L38 24H14L8 8L20 16L26 2Z" fill="#c9973a" stroke="#b87d2a" strokeWidth="1.5"/>
                <rect x="10" y="26" width="32" height="6" rx="1" fill="#c9973a"/>
                <rect x="12" y="34" width="28" height="5" rx="1" fill="#b87d2a"/>
              </svg>
            </div>
            <div>
              <p className="font-serif text-lg font-bold tracking-[0.12em] text-stone-900 leading-none group-hover:text-wine-700 transition-colors">TULSI</p>
              <p className="text-[8px] tracking-[0.28em] text-gold-600 uppercase leading-none font-medium mt-0.5">Bridal Jewellery</p>
            </div>
          </Link>

          {/* Desktop nav links */}
          <nav className="hidden lg:flex items-center gap-6">
            <Link href="/" className="nav-link">Home</Link>

            {/* Shop dropdown */}
            <div
              className="relative"
              onMouseEnter={() => setCatalogOpen(true)}
              onMouseLeave={() => setCatalogOpen(false)}
            >
              <button className="nav-link flex items-center gap-1 font-semibold text-wine-700">
                Shop <FiChevronDown className={`text-xs transition-transform duration-200 ${catalogOpen ? 'rotate-180' : ''}`} />
              </button>
              <div className={`absolute top-full left-1/2 -translate-x-1/2 mt-3 bg-white shadow-luxury-lg border border-stone-100 py-3 w-52 z-50 rounded-xl transition-all duration-200 origin-top ${catalogOpen ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'}`}>
                <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-l border-t border-stone-100 rotate-45" />
                <Link href="/shop" className="block px-5 py-2.5 text-sm text-wine-700 font-semibold hover:bg-ivory-100 transition-colors">All Jewellery</Link>
                <div className="h-px bg-stone-100 my-1" />
                {catalogCategories.map((c) => (
                  <Link
                    key={c.name}
                    href={c.href}
                    className="block px-5 py-2.5 text-sm text-stone-700 hover:text-wine-700 hover:bg-ivory-100 transition-colors font-medium"
                  >
                    {c.name}
                  </Link>
                ))}
              </div>
            </div>

            <Link href="/rentals" className="text-sm font-semibold text-gold-600 hover:text-gold-700 transition-colors">Rentals</Link>
            <Link href="/about" className="nav-link">About</Link>
            <Link href="/contact" className="nav-link">Contact</Link>
            <Link href="/track-order" className="nav-link">Track Order</Link>
          </nav>

          {/* Right actions */}
          <div className="flex items-center gap-1">
            {/* Search toggle */}
            <button
              onClick={() => setSearchOpen(!searchOpen)}
              className="p-2.5 text-stone-600 hover:text-wine-700 transition-colors rounded-xl hover:bg-ivory-200"
              aria-label="Search"
            >
              {searchOpen ? <FiX className="text-lg" /> : <FiSearch className="text-lg" />}
            </button>

            {/* Wishlist */}
            <Link href="/wishlist" className="relative p-2.5 text-stone-600 hover:text-wine-700 transition-colors rounded-xl hover:bg-ivory-200 hidden sm:flex">
              <FiHeart className="text-lg" />
              {wishlistItems.length > 0 && (
                <span className="absolute top-1.5 right-1.5 bg-wine-700 text-white text-[9px] rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold">
                  {wishlistItems.length}
                </span>
              )}
            </Link>

            {/* Cart */}
            <Link href="/cart" className="relative p-2.5 text-stone-600 hover:text-wine-700 transition-colors rounded-xl hover:bg-ivory-200">
              <FiShoppingCart className="text-lg" />
              {itemCount > 0 && (
                <span className="absolute top-1.5 right-1.5 bg-wine-700 text-white text-[9px] rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold">
                  {itemCount}
                </span>
              )}
            </Link>

            {/* User */}
            {session ? (
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="p-2.5 text-stone-600 hover:text-wine-700 transition-colors rounded-xl hover:bg-ivory-200"
                >
                  <FiUser className="text-lg" />
                </button>
                {userMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 bg-white shadow-luxury-lg border border-stone-100 py-2 w-48 z-50 rounded-xl">
                    <div className="px-4 py-2 border-b border-stone-100 mb-1">
                      <p className="text-xs text-stone-500 truncate">{session.user.email}</p>
                    </div>
                    <Link href="/account" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-stone-700 hover:text-wine-700 hover:bg-ivory-100 transition-colors font-medium">
                      <FiUser className="text-base" /> My Account
                    </Link>
                    {session.user.role === 'admin' && (
                      <Link href="/admin" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-stone-700 hover:text-wine-700 hover:bg-ivory-100 transition-colors font-medium">
                        <FiSettings className="text-base" /> Admin Panel
                      </Link>
                    )}
                    <div className="border-t border-stone-100 mt-1 pt-1">
                      <button onClick={() => signOut()} className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors font-medium">
                        <FiLogOut className="text-base" /> Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Link href="/login" className="hidden md:flex items-center gap-2 ml-1 px-4 py-2 text-sm font-semibold text-white bg-wine-700 hover:bg-wine-800 transition-colors rounded-xl">
                Sign In
              </Link>
            )}

            {/* Mobile menu button */}
            <button
              className="lg:hidden p-2.5 text-stone-600 hover:text-wine-700 transition-colors ml-1"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Menu"
            >
              {menuOpen ? <FiX className="text-xl" /> : <FiMenu className="text-xl" />}
            </button>
          </div>
        </div>

        {/* Expandable search bar */}
        {searchOpen && (
          <div className="py-3 border-t border-stone-100">
            <form onSubmit={handleSearch} className="flex items-center bg-ivory-100 border border-stone-200 rounded-xl px-4 py-2.5 gap-3">
              <FiSearch className="text-stone-400 text-base flex-shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search jewellery, bridal sets, rentals…"
                className="bg-transparent text-sm flex-1 outline-none text-stone-700 placeholder-stone-400 font-medium"
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery('')} className="text-stone-400 hover:text-stone-600 transition-colors">
                  <FiX className="text-sm" />
                </button>
              )}
              <button type="submit" className="text-xs font-semibold text-wine-700 hover:text-wine-800 transition-colors flex-shrink-0">
                Search
              </button>
            </form>
          </div>
        )}
      </nav>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="lg:hidden bg-white border-t border-stone-100">
          <div className="section-container py-5 space-y-1">
            {[
              { label: 'Home', href: '/' },
              { label: 'Buy Jewellery', href: '/shop' },
              { label: 'Rent Jewellery', href: '/rentals' },
              { label: 'Browse Catalogue', href: '/catalog' },
              { label: 'About Us', href: '/about' },
              { label: 'Contact', href: '/contact' },
              { label: 'Track Order', href: '/track-order' },
            ].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setMenuOpen(false)}
                className="flex items-center py-3 text-stone-700 border-b border-stone-100 text-sm font-medium hover:text-wine-700 transition-colors"
              >
                {l.label}
              </Link>
            ))}
            <div className="pt-3 flex gap-3">
              {!session ? (
                <Link href="/login" onClick={() => setMenuOpen(false)} className="flex-1 text-center py-3 bg-wine-700 text-white text-sm font-semibold rounded-xl hover:bg-wine-800 transition-colors">
                  Sign In / Register
                </Link>
              ) : (
                <button onClick={() => signOut()} className="flex-1 text-center py-3 border border-stone-200 text-stone-600 text-sm font-semibold rounded-xl hover:bg-stone-50 transition-colors">
                  Sign Out
                </button>
              )}
              <Link href="/wishlist" onClick={() => setMenuOpen(false)} className="px-5 py-3 border border-stone-200 text-stone-600 rounded-xl hover:bg-stone-50 transition-colors">
                <FiHeart className="text-lg" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
