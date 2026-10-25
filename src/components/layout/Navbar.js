'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import WelcomeBar from '@/components/layout/WelcomeBar';
import { NAV_LINKS, isActiveLink } from '@/components/layout/navLinks';
import {
  FiShoppingCart, FiHeart, FiUser, FiMenu, FiX, FiSearch,
  FiLogOut, FiSettings, FiBriefcase,
} from 'react-icons/fi';

const SEARCH_PLACEHOLDER = 'Search necklaces, chains, earrings...';

/* Every height here is fixed (announcement strip h-8, main row h-16, link
   row h-11), so nothing below the header moves when the settings, the
   session or the cart arrive. An active link changes colour and underline
   only — never its weight — so no neighbour moves either. */
const ICON_BTN = 'min-w-11 min-h-11 sm:min-w-12 sm:min-h-12 flex items-center justify-center text-stone-600 hover:text-wine-700 transition-colors rounded-xl hover:bg-ivory-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500';
const BADGE = 'absolute top-1.5 right-1.5 bg-wine-700 text-white text-[9px] rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold';
const DESKTOP_LINK = 'relative inline-flex items-center h-11 text-sm font-medium transition-colors duration-200 after:absolute after:left-0 after:bottom-2.5 after:h-px after:bg-wine-700 after:transition-all after:duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 rounded-sm';

/* The address bar's query, handed to the header. useSearchParams() has to sit
   inside <Suspense> — on a statically rendered page it opts the nearest
   boundary out of the server render — and this renders nothing, so the
   header's markup (server HTML and first client render alike) never depends
   on it. The links that need the query (?category=…) light up right after. */
function QueryWatcher({ onChange }) {
  const query = useSearchParams().toString();
  useEffect(() => { onChange(query); }, [query, onChange]);
  return null;
}

/* Search box — the same one in the header row (computers) and the row that
   opens under the hamburger row (phones, tablets). The magnifier is the submit
   button. */
function SearchField({ value, onChange, onSubmit, inputRef, className = '' }) {
  return (
    <form role="search" onSubmit={onSubmit} className={className}>
      <div className="flex items-center h-11 rounded-full border border-stone-400 bg-ivory-50 shadow-sm pl-1 pr-2 gap-1 transition-colors hover:border-gold-600 focus-within:border-gold-600 focus-within:ring-2 focus-within:ring-gold-500/40">
        <button
          type="submit"
          aria-label="Search"
          className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full text-stone-600 hover:text-wine-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
        >
          <FiSearch aria-hidden="true" className="text-lg" />
        </button>
        <input
          ref={inputRef}
          type="text"
          name="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={SEARCH_PLACEHOLDER}
          aria-label="Search products"
          autoComplete="off"
          enterKeyHint="search"
          className="flex-1 min-w-0 bg-transparent text-sm text-stone-800 placeholder:text-stone-500 outline-none"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear search"
            className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full text-stone-500 hover:text-stone-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
          >
            <FiX aria-hidden="true" className="text-sm" />
          </button>
        )}
      </div>
    </form>
  );
}

export default function Navbar() {
  const { data: session } = useSession();
  const { itemCount, charges } = useCart();
  const { items: wishlistItems } = useWishlist();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  /* The address bar's query — null until the browser has reported it (QueryWatcher). */
  const [query, setQuery] = useState(null);
  /* Public site settings (the phone in the top strip) — null until loaded.
     The strip's welcome offer comes from /api/announcement (WelcomeBar),
     which also checks that its code is a live coupon. */
  const [siteSettings, setSiteSettings] = useState(null);
  const searchRef = useRef(null);
  const userMenuRef = useRef(null);
  const isActive = (href) => isActiveLink(href, pathname, query);

  /* Fresh on every page load (the endpoint is no-store): an admin's change
     to the phone shows on the visitor's next visit. */
  useEffect(() => {
    fetch('/api/admin/settings', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d.success && d.data) setSiteSettings(d.data); })
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

  /* Moving to another page (the cart icon, the logo, a link, Back) closes whatever is open.
     Done while rendering, not in an effect, so the old page's menu is never painted over the new one. */
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setMenuOpen(false);
    setSearchOpen(false);
    setUserMenuOpen(false);
  }

  /* Escape closes whatever is open. */
  useEffect(() => {
    if (!menuOpen && !searchOpen && !userMenuOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      setSearchOpen(false);
      setUserMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen, searchOpen, userMenuOpen]);

  useEffect(() => {
    if (searchOpen && searchRef.current) searchRef.current.focus();
  }, [searchOpen]);

  const handleSearch = (e) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearchOpen(false);
    setMenuOpen(false);
    router.push(`/catalog?search=${encodeURIComponent(q)}`);
  };

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className={`sticky top-0 z-50 transition-all duration-500 border-b ${scrolled ? 'bg-white/97 backdrop-blur-md shadow-luxury border-stone-100/80' : 'bg-white/95 backdrop-blur-sm shadow-sm border-transparent'}`}>
      <Suspense fallback={null}><QueryWatcher onChange={setQuery} /></Suspense>

      {/* Top announcement bar — welcome offer, or tagline + delivery + phone */}
      <WelcomeBar settings={siteSettings} charges={charges} />

      {/* Main row: phones and tablets — menu · brand · search · cart (wishlist
          and account from tablet width up); computers — brand · search ·
          wishlist · cart · account. */}
      <div className="section-container">
        <div className="flex items-center h-16 gap-1 lg:gap-6">

          {/* Mobile menu button */}
          <button
            type="button"
            className={`lg:hidden -ml-2 ${ICON_BTN}`}
            onClick={() => { setMenuOpen(!menuOpen); setSearchOpen(false); }}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
          >
            {menuOpen ? <FiX aria-hidden="true" className="text-xl" /> : <FiMenu aria-hidden="true" className="text-xl" />}
          </button>

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 sm:gap-2.5 group flex-shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500">
            <div className="w-8 h-9 sm:w-9 flex items-center justify-center group-hover:scale-105 transition-transform duration-300">
              <svg aria-hidden="true" width="36" height="30" viewBox="0 0 52 44" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto">
                <path d="M26 2L32 16L44 8L38 24H14L8 8L20 16L26 2Z" fill="url(#logoGold)" stroke="#b87d2a" strokeWidth="1.5"/>
                <rect x="10" y="26" width="32" height="6" rx="1" fill="url(#logoGold)"/>
                <rect x="12" y="34" width="28" height="5" rx="1" fill="#b87d2a"/>
                <defs>
                  <linearGradient id="logoGold" x1="8" y1="2" x2="44" y2="44" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#f4dfa0"/>
                    <stop offset="50%" stopColor="#c9973a"/>
                    <stop offset="100%" stopColor="#9a6220"/>
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <div>
              <p className="font-serif text-lg font-bold tracking-[0.14em] leading-none text-gold-shimmer">TULSI</p>
              <p className="text-[8px] tracking-[0.2em] sm:tracking-[0.3em] text-gold-700 uppercase leading-none font-medium mt-0.5 whitespace-nowrap">Fashion Jewellery</p>
            </div>
          </Link>

          {/* Search — always visible from computer width up */}
          <div className="hidden lg:flex flex-1 min-w-0 justify-center">
            <SearchField
              value={searchQuery}
              onChange={setSearchQuery}
              onSubmit={handleSearch}
              className="w-full max-w-[560px]"
            />
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-0.5 ml-auto lg:ml-0 -mr-2 sm:mr-0">
            {/* Search toggle — below computer width */}
            <button
              type="button"
              onClick={() => { setSearchOpen(!searchOpen); setMenuOpen(false); }}
              className={`lg:hidden ${ICON_BTN}`}
              aria-label={searchOpen ? 'Close search' : 'Search'}
              aria-expanded={searchOpen}
              aria-controls="mobile-search"
            >
              {searchOpen ? <FiX aria-hidden="true" className="text-lg" /> : <FiSearch aria-hidden="true" className="text-lg" />}
            </button>

            {/* Wishlist */}
            <Link href="/wishlist" aria-label={wishlistItems.length > 0 ? `Wishlist, ${wishlistItems.length} saved` : 'Wishlist'} className={`relative hidden sm:flex ${ICON_BTN}`}>
              <FiHeart aria-hidden="true" className="text-lg" />
              {wishlistItems.length > 0 && (
                <span aria-hidden="true" className={BADGE}>
                  {wishlistItems.length}
                </span>
              )}
            </Link>

            {/* Cart */}
            <Link href="/cart" aria-label={itemCount > 0 ? `Cart, ${itemCount} ${itemCount === 1 ? 'item' : 'items'}` : 'Cart'} className={`relative ${ICON_BTN}`}>
              <FiShoppingCart aria-hidden="true" className="text-lg" />
              {itemCount > 0 && (
                <span aria-hidden="true" className={BADGE}>
                  {itemCount}
                </span>
              )}
            </Link>

            {/* Account — the same icon, the same size, signed in or not (the
                session arrives after the page, and a "Sign In" button that
                turned into an avatar would push the cart sideways). Phones
                get it in the menu. */}
            <div className="relative hidden sm:block" ref={userMenuRef}>
              {session ? (
                <button
                  type="button"
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  aria-label="Account menu"
                  aria-expanded={userMenuOpen}
                  className={ICON_BTN}
                >
                  <FiUser aria-hidden="true" className="text-lg" />
                </button>
              ) : (
                <Link href="/login" aria-label="Sign in or register" title="Sign in / Register" className={ICON_BTN}>
                  <FiUser aria-hidden="true" className="text-lg" />
                </Link>
              )}
              {session && userMenuOpen && (
                <div className="absolute right-0 top-full mt-2 bg-white shadow-luxury-lg border border-stone-100 py-2 w-48 z-50 rounded-xl">
                  <div className="px-4 py-2 border-b border-stone-100 mb-1">
                    <p className="text-xs text-stone-500 truncate">{session.user.email}</p>
                  </div>
                  <Link href="/account" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-stone-700 hover:text-wine-700 hover:bg-ivory-100 transition-colors font-medium">
                    <FiUser aria-hidden="true" className="text-base" /> My Account
                  </Link>
                  {session.user.role === 'vendor' && (
                    <Link href="/vendor/dashboard" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-wine-700 hover:bg-ivory-100 transition-colors font-semibold">
                      <FiBriefcase aria-hidden="true" className="text-base" /> Vendor Dashboard
                    </Link>
                  )}
                  {session.user.role === 'admin' && (
                    <Link href="/admin" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-stone-700 hover:text-wine-700 hover:bg-ivory-100 transition-colors font-medium">
                      <FiSettings aria-hidden="true" className="text-base" /> Admin Panel
                    </Link>
                  )}
                  <div className="border-t border-stone-100 mt-1 pt-1">
                    <button type="button" onClick={() => signOut()} className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors font-medium">
                      <FiLogOut aria-hidden="true" className="text-base" /> Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Search row — opened by the search icon, below computer width. It is
            the user's own tap that opens it, so pushing the page down is fine. */}
        {searchOpen && (
          <div id="mobile-search" className="lg:hidden pb-3">
            <SearchField value={searchQuery} onChange={setSearchQuery} onSubmit={handleSearch} inputRef={searchRef} />
          </div>
        )}
      </div>

      {/* Links row — computers. Fixed height; all eight links sit on one line
          from 1024px up (about 780px of the 960px content width at its
          narrowest). */}
      <div className="hidden lg:block border-t border-stone-100">
        <nav aria-label="Main" className="section-container">
          <ul className="flex items-center justify-center gap-8 h-11">
            {NAV_LINKS.map((l) => {
              const active = isActive(l.href);
              return (
                <li key={l.label}>
                  <Link
                    href={l.href}
                    aria-current={active ? 'page' : undefined}
                    className={`${DESKTOP_LINK} ${active ? 'text-wine-700 after:w-full' : 'text-stone-700 hover:text-wine-700 after:w-0 hover:after:w-full'}`}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {/* Mobile menu — always mounted, animated via transform/opacity (GPU
          compositable) instead of mount/unmount, so open/close has no pop-in
          jank. max-h+overflow clips it without a layout-thrashing height
          animation; it never grows past the screen (it scrolls instead). */}
      <div
        id="mobile-menu"
        aria-hidden={!menuOpen}
        inert={!menuOpen}
        className={`lg:hidden bg-white border-t border-stone-100 overflow-x-hidden transition-[max-height,opacity,transform] duration-300 ease-luxury ${
          menuOpen ? 'max-h-[calc(100dvh-6rem)] overflow-y-auto opacity-100 translate-y-0' : 'max-h-0 overflow-y-hidden opacity-0 -translate-y-2 pointer-events-none border-t-0'
        }`}
      >
        <nav aria-label="Mobile" className="section-container py-4">
          <ul>
            {NAV_LINKS.map((l) => {
              const active = isActive(l.href);
              return (
                <li key={l.label}>
                  <Link
                    href={l.href}
                    onClick={closeMenu}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center min-h-11 border-b border-stone-100 text-sm font-medium transition-colors hover:text-wine-700 ${active ? 'text-wine-700' : 'text-stone-700'}`}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="pt-4 grid grid-cols-2 gap-3">
            <Link href="/wishlist" onClick={closeMenu} className="flex items-center justify-center gap-2 min-h-11 border border-stone-200 text-stone-700 text-sm font-semibold rounded-xl hover:bg-stone-50 transition-colors">
              <FiHeart aria-hidden="true" className="text-base" /> Wishlist{wishlistItems.length > 0 ? ` (${wishlistItems.length})` : ''}
            </Link>
            {session ? (
              <Link href="/account" onClick={closeMenu} className="flex items-center justify-center gap-2 min-h-11 border border-stone-200 text-stone-700 text-sm font-semibold rounded-xl hover:bg-stone-50 transition-colors">
                <FiUser aria-hidden="true" className="text-base" /> My Account
              </Link>
            ) : (
              <Link href="/login" onClick={closeMenu} className="flex items-center justify-center gap-2 min-h-11 bg-wine-700 text-white text-sm font-semibold rounded-xl hover:bg-wine-800 transition-colors">
                <FiUser aria-hidden="true" className="text-base" /> Sign In
              </Link>
            )}
          </div>
          {session?.user?.role === 'vendor' && (
            <Link href="/vendor/dashboard" onClick={closeMenu} className="flex items-center justify-center gap-2 mt-3 min-h-11 bg-wine-700 text-white text-sm font-semibold rounded-xl hover:bg-wine-800 transition-colors">
              <FiBriefcase aria-hidden="true" /> Vendor Dashboard
            </Link>
          )}
          {session?.user?.role === 'admin' && (
            <Link href="/admin" onClick={closeMenu} className="flex items-center justify-center gap-2 mt-3 min-h-11 border border-stone-200 text-stone-700 text-sm font-semibold rounded-xl hover:bg-stone-50 transition-colors">
              <FiSettings aria-hidden="true" /> Admin Panel
            </Link>
          )}
          {session && (
            <button type="button" onClick={() => signOut()} className="flex items-center justify-center gap-2 w-full mt-3 min-h-11 border border-stone-200 text-stone-600 text-sm font-semibold rounded-xl hover:bg-stone-50 transition-colors">
              <FiLogOut aria-hidden="true" /> Sign Out
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
