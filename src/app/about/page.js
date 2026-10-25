import Link from 'next/link';

import { absoluteUrl } from '@/lib/seo';

export const metadata = { title: 'About Us', alternates: { canonical: absoluteUrl('/about') } };

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-ivory">

      {/* Hero */}
      <div className="bg-luxury-gradient text-white py-20 text-center relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #c9973a 0, #c9973a 1px, transparent 0, transparent 40px)' }} />
        <div className="relative z-10 px-6">
          <p className="text-xs tracking-[0.45em] uppercase text-gold-400 font-medium mb-4">Est. 2025</p>
          <h1 className="font-serif text-5xl font-bold mb-4">Our Story</h1>
          <p className="text-white/50 text-base max-w-xl mx-auto">Modern jewellery for every day, made to be worn</p>
        </div>
      </div>

      <div className="section-container py-14">
        <div className="max-w-4xl mx-auto space-y-10">

          {/* Brand intro */}
          <div className="bg-white rounded-2xl shadow-card p-8 md:p-10 text-center">
            <div className="w-20 h-20 rounded-2xl bg-wine-100 flex items-center justify-center mx-auto mb-5">
              <svg width="40" height="34" viewBox="0 0 52 44" fill="none">
                <path d="M26 2L32 16L44 8L38 24H14L8 8L20 16L26 2Z" fill="#c9973a" stroke="#b87d2a" strokeWidth="1.5"/>
                <rect x="10" y="26" width="32" height="6" rx="1" fill="#c9973a"/>
                <rect x="12" y="34" width="28" height="5" rx="1" fill="#b87d2a"/>
              </svg>
            </div>
            <h2 className="font-serif text-2xl font-bold text-stone-800 mb-4">Tulsi Fashion Jewellery</h2>
            <p className="text-stone-500 leading-relaxed text-base max-w-2xl mx-auto">
              Born from a love of modern, minimalist jewellery, Tulsi Fashion Jewellery
              opened its doors in <strong className="text-wine-700">2025</strong>. Our physical store is a destination
              for anyone who wants to see trending chains, necklaces, earrings and anklets up close — touching, trying,
              and choosing pieces that make an everyday look unforgettable.
            </p>
          </div>

          {/* Physical store highlight */}
          <div className="bg-gold-gradient rounded-2xl p-8 md:p-10 text-white text-center shadow-gold">
            <p className="text-xs tracking-[0.4em] uppercase font-semibold text-white/70 mb-3">Visit Us</p>
            <h2 className="font-serif text-3xl font-bold mb-3">Our Physical Store</h2>
            <p className="text-white/80 leading-relaxed max-w-lg mx-auto mb-6">
              Open since 2025, our showroom is where our customers come to discover their perfect jewellery in person.
              Experience our full collection with expert guidance from our jewellery consultants.
            </p>
            <div className="inline-flex flex-col items-center gap-2 bg-white/20 backdrop-blur-sm rounded-xl px-8 py-5">
              <p className="font-semibold text-white">Mon – Sat: 10 AM – 8 PM</p>
              <p className="text-white/70 text-sm">Sunday: 11 AM – 6 PM</p>
              <p className="text-white/80 text-sm mt-1">📍 428, Main Bazaar, Udangudi - 628203, Tuticorin Dt.</p>
            </div>
          </div>

          {/* Values */}
          <div>
            <div className="text-center mb-8">
              <p className="text-xs tracking-[0.4em] uppercase text-wine-700 font-semibold mb-2">What We Stand For</p>
              <h2 className="font-serif text-3xl font-bold text-stone-800">Our Promise to You</h2>
            </div>
            <div className="grid md:grid-cols-3 gap-5">
              {[
                { title: 'Our Craft', icon: '🛠️', desc: 'Delicate chains, layering necklaces, earrings and anklets in modern, minimalist designs — pieces chosen to be worn every day, not saved for a special one.' },
                { title: 'Our Promise', icon: '💎', desc: 'We use only high-quality, hypoallergenic materials. Every piece is tarnish-resistant and backed by our quality guarantee.' },
                { title: 'Our Mission', icon: '🌸', desc: 'To make every day feel like an occasion — with fashion jewellery you can wear anywhere, at a price that suits every budget.' },
              ].map((v) => (
                <div key={v.title} className="bg-white rounded-2xl p-7 shadow-card text-center group hover:shadow-luxury transition-shadow duration-300">
                  <div className="text-4xl mb-4 group-hover:scale-110 transition-transform duration-300">{v.icon}</div>
                  <h3 className="font-serif font-bold text-stone-800 text-lg mb-2">{v.title}</h3>
                  <p className="text-stone-500 text-sm leading-relaxed">{v.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Numbers */}
          <div className="bg-luxury-gradient rounded-2xl p-10 text-white text-center relative overflow-hidden">
            <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #c9973a 0, #c9973a 1px, transparent 0, transparent 40px)' }} />
            <h2 className="font-serif text-2xl font-bold text-gold-400 mb-8 relative z-10">By the Numbers</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 relative z-10">
              {[
                { label: 'Happy Customers', value: '1,000+' },
                { label: 'Est. Year', value: '2025' },
                { label: 'Jewellery Pieces', value: '500+' },
              ].map((s) => (
                <div key={s.label}>
                  <p className="font-serif text-gold-400 text-3xl font-bold">{s.value}</p>
                  <p className="text-white/50 text-sm mt-1">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div className="text-center py-4">
            <p className="text-stone-500 text-sm mb-6">Ready to find your next favourite piece?</p>
            <div className="flex justify-center gap-4 flex-wrap">
              <Link href="/shop" className="btn-primary-rounded">Shop Collection</Link>
              <Link href="/contact" className="btn-outline">Get in Touch</Link>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
