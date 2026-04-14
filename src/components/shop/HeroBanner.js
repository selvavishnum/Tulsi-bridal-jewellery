'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';

export default function HeroBanner() {
  return (
    <section className="relative bg-gradient-to-br from-maroon-950 via-maroon-900 to-maroon-800 text-white overflow-hidden">
      {/* Decorative elements */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-10 left-10 w-32 h-32 rounded-full bg-gold-400 blur-3xl" />
        <div className="absolute bottom-10 right-10 w-48 h-48 rounded-full bg-gold-300 blur-3xl" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-32">
        <div className="max-w-2xl">
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-gold-400 uppercase tracking-widest text-sm font-semibold mb-3"
          >
            Exquisite Bridal Collection
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="font-serif text-4xl md:text-6xl font-bold mb-6 leading-tight"
          >
            Shine Like a
            <span className="text-gold-400"> Queen </span>
            on Your Special Day
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-gray-300 text-lg mb-8 leading-relaxed"
          >
            Discover our handcrafted bridal jewellery collection — from traditional kundan sets to modern gold designs. Buy or rent for your perfect bridal look.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="flex flex-wrap gap-4"
          >
            <Link
              href="/shop"
              className="px-8 py-3 bg-gold-600 text-white font-semibold rounded-full hover:bg-gold-700 transition shadow-lg"
            >
              Shop Now
            </Link>
            <Link
              href="/shop?rental=true"
              className="px-8 py-3 border-2 border-white text-white font-semibold rounded-full hover:bg-white hover:text-maroon-950 transition"
            >
              Rent Jewellery
            </Link>
          </motion.div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="border-t border-white/10 bg-black/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            {[
              { label: 'Happy Brides', value: '5000+' },
              { label: 'Jewellery Pieces', value: '500+' },
              { label: 'Years of Excellence', value: '14+' },
              { label: 'Rental Items', value: '200+' },
            ].map((stat) => (
              <div key={stat.label}>
                <p className="text-gold-400 font-bold text-2xl">{stat.value}</p>
                <p className="text-gray-300 text-sm">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
