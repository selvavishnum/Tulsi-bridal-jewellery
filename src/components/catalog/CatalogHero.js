/* ─────────────────────────────────────────────
   CatalogHero
   Exactly replicates the Swastik logo/header:
   • White background
   • Crown icon
   • Large decorative serif brand name
   • "BRIDAL JEWELLERY" with horizontal lines
   • Tagline (owner / sub-brand name)
   ───────────────────────────────────────────── */

export default function CatalogHero() {
  return (
    <section className="bg-white py-10 px-4 text-center border-b border-gray-100">
      {/* Crown */}
      <div className="flex justify-center mb-3">
        <svg width="52" height="44" viewBox="0 0 52 44" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M26 2L32 16L44 8L38 24H14L8 8L20 16L26 2Z" fill="#b87333" stroke="#9a5c28" strokeWidth="1"/>
          <rect x="10" y="26" width="32" height="6" rx="1" fill="#b87333"/>
          <rect x="12" y="34" width="28" height="5" rx="1" fill="#9a5c28"/>
          <circle cx="26" cy="12" r="2.5" fill="#d4922a"/>
          <circle cx="14" cy="14" r="2" fill="#d4922a"/>
          <circle cx="38" cy="14" r="2" fill="#d4922a"/>
        </svg>
      </div>

      {/* Brand name */}
      <h1
        className="font-serif text-6xl md:text-7xl font-bold tracking-widest text-gray-900 leading-none"
        style={{ fontVariant: 'small-caps', letterSpacing: '0.12em' }}
      >
        TULSI
      </h1>

      {/* Decorated sub-title line */}
      <div className="flex items-center justify-center gap-3 mt-3 mb-2">
        <div className="h-px w-16 md:w-24 bg-gray-400" />
        <p className="text-xs md:text-sm tracking-[0.35em] text-gray-600 font-semibold uppercase">
          Bridal Jewellery
        </p>
        <div className="h-px w-16 md:w-24 bg-gray-400" />
      </div>

      {/* Tagline */}
      <p className="text-xs tracking-[0.28em] text-gray-400 uppercase mt-1">
        Rentals &amp; Collections
      </p>
    </section>
  );
}
