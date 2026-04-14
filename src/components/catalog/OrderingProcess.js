/* ─────────────────────────────────────────────
   OrderingProcess
   Cream background, italic serif heading,
   left bullet-point steps / right jewellery image
   ───────────────────────────────────────────── */
'use client';
import Image from 'next/image';
import { useState } from 'react';

const STEPS = [
  { label: 'Explore Our Collection', desc: 'Browse our curated selection and choose the pieces you love.' },
  { label: 'Submit Your Details', desc: 'Send us your selected items along with your event date.' },
  { label: 'Check Availability', desc: 'We will verify the availability of your chosen pieces and provide you with a price quote.' },
  { label: 'Mix and Match Options', desc: 'Mix and Match is available for specific jewellery pieces. Please inquire about possibilities during booking.' },
  { label: 'Secure Your Booking', desc: 'Confirm your order by paying the deposit. The full payment must be completed before pick-up.' },
  { label: 'Receive Your Jewellery', desc: 'We will deliver the jewellery to your location a day prior to your event.' },
  { label: 'Return', desc: 'Return the jewellery in its original condition within the agreed timeframe.' },
];

export default function OrderingProcess() {
  const [imgError, setImgError] = useState(false);
  return (
    <section className="bg-cream-200">
      <div className="grid md:grid-cols-2">
        {/* Left — steps */}
        <div className="p-8 md:p-10 lg:p-14 flex flex-col justify-center order-2 md:order-1">
          <h2 className="font-serif text-2xl md:text-3xl italic text-wine mb-6">
            Ordering process
          </h2>
          <ul className="space-y-3">
            {STEPS.map((step) => (
              <li key={step.label} className="flex gap-3 text-sm text-gray-700 leading-relaxed">
                <span className="text-wine mt-0.5 flex-shrink-0 font-bold">•</span>
                <span>
                  <strong className="font-semibold text-gray-800">{step.label}:</strong>{' '}
                  {step.desc}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Right — photo */}
        <div className="relative aspect-square md:aspect-auto min-h-72 bg-velvet-800 order-1 md:order-2">
          {!imgError && (
            <Image
              src="/images/banners/ordering-jewellery.jpg"
              alt="Ordering Process"
              fill
              className="object-cover object-center"
              onError={() => setImgError(true)}
            />
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-velvet-800">
            <div className="text-center opacity-20">
              <div className="text-8xl">🪙</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
