'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { GiQueenCrown } from 'react-icons/gi';
import { FiInstagram, FiFacebook, FiYoutube, FiPhone, FiMail, FiMapPin } from 'react-icons/fi';

export default function Footer() {
  const [s, setS] = useState({});

  useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((d) => { if (d.success && d.data) setS(d.data); })
      .catch(() => {});
  }, []);

  const phone   = s.phone   || '+91 98765 43210';
  const email   = s.email   || 'hello@tulsibridal.com';
  const address = s.address || '123 Jewellery Lane, Mumbai';
  const phoneRaw = phone.replace(/\D/g, '');

  return (
    <footer className="bg-maroon-950 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">

          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <GiQueenCrown className="text-gold-400 text-3xl" />
              <div>
                <p className="font-serif text-lg font-bold leading-tight">{s.businessName || 'Tulsi'}</p>
                <p className="text-xs text-gold-400 tracking-widest uppercase leading-tight">Bridal Jewellery</p>
              </div>
            </div>
            <p className="text-sm text-gray-300 leading-relaxed mb-4">
              {s.tagline || 'Exquisite bridal jewellery crafted with love. Making your special day shine brighter.'}
            </p>
            <div className="flex gap-3">
              {s.instagram && <a href={s.instagram} target="_blank" rel="noopener noreferrer" className="p-2 bg-white/10 rounded-full hover:bg-gold-600 transition"><FiInstagram /></a>}
              {s.facebook  && <a href={s.facebook}  target="_blank" rel="noopener noreferrer" className="p-2 bg-white/10 rounded-full hover:bg-gold-600 transition"><FiFacebook /></a>}
              {s.youtube   && <a href={s.youtube}   target="_blank" rel="noopener noreferrer" className="p-2 bg-white/10 rounded-full hover:bg-gold-600 transition"><FiYoutube /></a>}
              {!s.instagram && !s.facebook && !s.youtube && (
                <>
                  <a href="#" className="p-2 bg-white/10 rounded-full hover:bg-gold-600 transition"><FiInstagram /></a>
                  <a href="#" className="p-2 bg-white/10 rounded-full hover:bg-gold-600 transition"><FiFacebook /></a>
                  <a href="#" className="p-2 bg-white/10 rounded-full hover:bg-gold-600 transition"><FiYoutube /></a>
                </>
              )}
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="font-semibold text-gold-400 mb-4 uppercase tracking-wider text-sm">Quick Links</h3>
            <ul className="space-y-2 text-sm text-gray-300">
              {[
                { name: 'Home', href: '/' },
                { name: 'Shop All', href: '/catalog' },
                { name: 'Rental Jewellery', href: '/catalog?rental=true' },
                { name: 'About Us', href: '/about' },
                { name: 'Contact', href: '/contact' },
                { name: 'My Account', href: '/account' },
              ].map((l) => (
                <li key={l.name}>
                  <Link href={l.href} className="hover:text-gold-400 transition">{l.name}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Categories */}
          <div>
            <h3 className="font-semibold text-gold-400 mb-4 uppercase tracking-wider text-sm">Categories</h3>
            <ul className="space-y-2 text-sm text-gray-300">
              {['Necklaces', 'Earrings', 'Bangles', 'Rings', 'Maang Tikka', 'Bridal Sets'].map((cat) => (
                <li key={cat}>
                  <Link href={`/catalog?category=${cat.toLowerCase().replace(' ', '-')}`} className="hover:text-gold-400 transition">
                    {cat}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="font-semibold text-gold-400 mb-4 uppercase tracking-wider text-sm">Contact Us</h3>
            <ul className="space-y-3 text-sm text-gray-300">
              <li className="flex items-start gap-2">
                <FiMapPin className="mt-0.5 text-gold-400 flex-shrink-0" />
                <span>{address}</span>
              </li>
              <li className="flex items-center gap-2">
                <FiPhone className="text-gold-400 flex-shrink-0" />
                <a href={`tel:+${phoneRaw}`} className="hover:text-gold-400 transition">{phone}</a>
              </li>
              <li className="flex items-center gap-2">
                <FiMail className="text-gold-400 flex-shrink-0" />
                <a href={`mailto:${email}`} className="hover:text-gold-400 transition">{email}</a>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10 py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center gap-2 text-xs text-gray-400">
          <p>© {new Date().getFullYear()} {s.businessName || 'Tulsi Bridal Jewellery'}. All rights reserved.</p>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-gold-400 transition">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-gold-400 transition">Terms of Service</Link>
            <Link href="/refunds" className="hover:text-gold-400 transition">Refunds</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
