/* ─────────────────────────────────────────────
   WelcomeSection
   Dark velvet-brown (#3d1a11) background,
   left image / right text — matches Swastik layout
   ───────────────────────────────────────────── */
'use client';
import Image from 'next/image';
import { useState } from 'react';

export default function WelcomeSection() {
  const [imgError, setImgError] = useState(false);
  return (
    <section className="bg-velvet-800 text-white">
      <div className="grid md:grid-cols-2">
        {/* Left — hero jewellery photo */}
        <div className="relative aspect-square md:aspect-auto min-h-64 md:min-h-80 bg-velvet-900">
          {!imgError && (
            <Image
              src="/images/banners/welcome-jewellery.jpg"
              alt="Tulsi Bridal Jewellery"
              fill
              className="object-cover"
              priority
              onError={() => setImgError(true)}
            />
          )}
          {/* Placeholder when no image uploaded yet */}
          <div className="absolute inset-0 flex items-center justify-center bg-velvet-900">
            <div className="text-center opacity-30">
              <div className="text-7xl mb-2">💍</div>
              <p className="text-xs tracking-widest text-white/60 uppercase">Upload hero image</p>
            </div>
          </div>
        </div>

        {/* Right — text */}
        <div className="p-8 md:p-10 lg:p-12 flex flex-col justify-center">
          <h2 className="font-serif text-2xl md:text-3xl font-semibold leading-snug mb-5">
            Welcome to<br />Tulsi Bridal Jewellery,
          </h2>
          <ul className="space-y-4 text-sm leading-relaxed text-gray-200">
            <li className="flex gap-3">
              <span className="text-gold-400 mt-0.5 flex-shrink-0">•</span>
              <span>
                Greetings! We are delighted to introduce you to Tulsi Bridal Jewellery — a passion project
                that has blossomed into something truly extraordinary. Our mission is to redefine
                sophistication by offering exquisite jewellery rentals that empower individuals to shine on
                every occasion.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-gold-400 mt-0.5 flex-shrink-0">•</span>
              <span>
                We aim to provide a seamless rental experience, ensuring accessibility to high-quality
                pieces without the commitment. Through innovation and customer-centricity, we aspire to
                create lasting memories and foster a community where elegance meets convenience.
              </span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
