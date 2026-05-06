'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { FiInstagram, FiFacebook, FiYoutube, FiPhone, FiMail, FiMapPin, FiArrowRight } from 'react-icons/fi';

const QUICK_LINKS = [
  { name: 'Home', href: '/' },
  { name: 'Buy Jewellery', href: '/shop' },
  { name: 'Rent Jewellery', href: '/rentals' },
  { name: 'Browse Catalogue', href: '/catalog' },
  { name: 'About Us', href: '/about' },
  { name: 'Contact', href: '/contact' },
  { name: 'My Account', href: '/account' },
];

const CATEGORIES = [
  { name: 'Necklaces', href: '/catalog?category=necklace' },
  { name: 'Earrings', href: '/catalog?category=earrings' },
  { name: 'Bangles', href: '/catalog?category=bangles' },
  { name: 'Rings', href: '/catalog?category=ring' },
  { name: 'Maang Tikka', href: '/catalog?category=maang-tikka' },
  { name: 'Bridal Sets', href: '/catalog?category=set' },
];

export default function Footer() {
  const [s, setS] = useState({});

  useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((d) => { if (d.success && d.data) setS(d.data); })
      .catch(() => {});
  }, []);

  const phone   = s.phone   || '+91 76958 68787';
  const email   = s.email   || 'hello@tulsibridal.com';
  const address = s.address || '123 Jewellery Lane, Mumbai';
  const phoneRaw = phone.replace(/\D/g, '');

  return (
    <footer className="bg-white text-stone-800 border-t border-stone-200">
      {/* Top ornament */}
      <div className="border-t-2 border-gold-500/40">
        <div className="section-container pt-14 pb-10">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-8">

            {/* Brand column */}
            <div className="lg:col-span-1">
              {/* Logo */}
              <Link href="/" className="flex items-center gap-3 mb-5 group">
                <svg width="36" height="30" viewBox="0 0 52 44" fill="none">
                  <path d="M26 2L32 16L44 8L38 24H14L8 8L20 16L26 2Z" fill="#c9973a" stroke="#b87d2a" strokeWidth="1.5"/>
                  <rect x="10" y="26" width="32" height="6" rx="1" fill="#c9973a"/>
                  <rect x="12" y="34" width="28" height="5" rx="1" fill="#b87d2a"/>
                </svg>
                <div>
                  <p className="font-serif text-lg font-bold tracking-[0.12em] text-stone-800 leading-none group-hover:text-gold-600 transition-colors">
                    {s.businessName || 'TULSI'}
                  </p>
                  <p className="text-[8px] tracking-[0.28em] text-gold-600 uppercase leading-none mt-0.5">Bridal Jewellery</p>
                </div>
              </Link>

              <p className="text-sm text-stone-500 leading-relaxed mb-6">
                {s.tagline || 'Exquisite bridal jewellery crafted with love. Making your special day shine brighter.'}
              </p>

              {/* Social links */}
              <div className="flex gap-2.5">
                {[
                  { href: s.instagram, icon: FiInstagram, label: 'Instagram' },
                  { href: s.facebook,  icon: FiFacebook,  label: 'Facebook' },
                  { href: s.youtube,   icon: FiYoutube,   label: 'YouTube' },
                ].map(({ href, icon: Icon, label }) => (
                  <a
                    key={label}
                    href={href || undefined}
                    target={href ? '_blank' : undefined}
                    rel="noopener noreferrer"
                    aria-label={label}
                    onClick={!href ? (e) => e.preventDefault() : undefined}
                    className="w-9 h-9 rounded-xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-500 hover:bg-gold-600 hover:text-white hover:border-gold-600 transition-all duration-200 cursor-pointer"
                  >
                    <Icon className="text-sm" />
                  </a>
                ))}
              </div>
            </div>

            {/* Quick links */}
            <div>
              <h3 className="text-xs font-semibold text-gold-600 uppercase tracking-widest mb-5">Quick Links</h3>
              <ul className="space-y-2.5">
                {QUICK_LINKS.map((l) => (
                  <li key={l.name}>
                    <Link href={l.href} className="text-sm text-stone-600 hover:text-gold-600 transition-colors flex items-center gap-1.5 group">
                      <FiArrowRight className="text-xs text-gold-600/0 group-hover:text-gold-600/100 -translate-x-1 group-hover:translate-x-0 transition-all duration-200" />
                      {l.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Categories */}
            <div>
              <h3 className="text-xs font-semibold text-gold-600 uppercase tracking-widest mb-5">Categories</h3>
              <ul className="space-y-2.5">
                {CATEGORIES.map((c) => (
                  <li key={c.name}>
                    <Link href={c.href} className="text-sm text-stone-600 hover:text-gold-600 transition-colors flex items-center gap-1.5 group">
                      <FiArrowRight className="text-xs text-gold-600/0 group-hover:text-gold-600/100 -translate-x-1 group-hover:translate-x-0 transition-all duration-200" />
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Contact */}
            <div>
              <h3 className="text-xs font-semibold text-gold-600 uppercase tracking-widest mb-5">Get in Touch</h3>
              <ul className="space-y-4">
                <li className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-stone-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <FiMapPin className="text-gold-600 text-xs" />
                  </div>
                  <span className="text-sm text-stone-600 leading-relaxed">{address}</span>
                </li>
                <li className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg bg-stone-100 flex items-center justify-center flex-shrink-0">
                    <FiPhone className="text-gold-600 text-xs" />
                  </div>
                  <a href={`tel:+${phoneRaw}`} className="text-sm text-stone-600 hover:text-gold-600 transition-colors">{phone}</a>
                </li>
                <li className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg bg-stone-100 flex items-center justify-center flex-shrink-0">
                    <FiMail className="text-gold-600 text-xs" />
                  </div>
                  <a href={`mailto:${email}`} className="text-sm text-stone-600 hover:text-gold-600 transition-colors">{email}</a>
                </li>
              </ul>

              {/* Store hours */}
              <div className="mt-6 p-4 rounded-xl bg-stone-50 border border-stone-200">
                <p className="text-xs font-semibold text-gold-600 uppercase tracking-wider mb-2">Store Hours</p>
                <p className="text-xs text-stone-500 leading-relaxed">Mon – Sat: 10 AM – 8 PM<br />Sunday: 11 AM – 6 PM</p>
              </div>
            </div>

          </div>
        </div>

        {/* Gold divider */}
        <div className="h-px mx-8 bg-gradient-to-r from-transparent via-gold-400/40 to-transparent" />

        {/* Bottom bar */}
        <div className="section-container py-5 flex flex-col sm:flex-row justify-between items-center gap-3">
          <p className="text-xs text-stone-400">
            © {new Date().getFullYear()} {s.businessName || 'Tulsi Bridal Jewellery'}. All rights reserved.
          </p>
          <div className="flex gap-5">
            {[
              { name: 'Privacy Policy', href: '/privacy' },
              { name: 'Terms of Service', href: '/terms' },
              { name: 'Refunds', href: '/refunds' },
            ].map((l) => (
              <Link key={l.name} href={l.href} className="text-xs text-stone-400 hover:text-gold-600 transition-colors">
                {l.name}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
