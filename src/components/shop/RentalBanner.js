import Link from 'next/link';

export default function RentalBanner() {
  return (
    <section className="py-12 bg-gradient-to-r from-gold-50 to-cream">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="grid md:grid-cols-2 gap-0">
            <div className="p-8 md:p-12 flex flex-col justify-center">
              <span className="inline-block bg-gold-100 text-gold-700 text-xs font-semibold px-3 py-1 rounded-full mb-4 uppercase tracking-wider">
                Jewellery Rental Service
              </span>
              <h2 className="font-serif text-3xl md:text-4xl font-bold text-maroon-950 mb-4">
                Look Stunning Without Breaking the Bank
              </h2>
              <p className="text-gray-600 mb-6 leading-relaxed">
                Rent our exquisite bridal jewellery sets for your special day. Choose from 200+ pieces — necklaces, earrings, maang tikkas and more. Starting from just ₹500/day.
              </p>
              <ul className="space-y-2 mb-8 text-sm text-gray-600">
                {['Genuine gold-plated & kundan pieces', 'Hygienic & sanitised before every rental', 'Flexible rental duration (1-7 days)', 'Security deposit refundable'].map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <span className="text-green-500 font-bold">✓</span> {item}
                  </li>
                ))}
              </ul>
              <Link
                href="/shop?rental=true"
                className="inline-flex items-center gap-2 px-8 py-3 bg-maroon-950 text-white font-semibold rounded-full hover:bg-maroon-900 transition w-fit"
              >
                Explore Rentals
              </Link>
            </div>
            <div className="bg-gradient-to-br from-maroon-950 to-maroon-800 p-8 md:p-12 text-white flex items-center justify-center">
              <div className="text-center">
                <div className="text-7xl mb-4">💍</div>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: 'Items Available', value: '200+' },
                    { label: 'Per Day From', value: '₹500' },
                    { label: 'Happy Rentals', value: '1000+' },
                    { label: 'Cities', value: '5+' },
                  ].map((s) => (
                    <div key={s.label} className="bg-white/10 rounded-xl p-4">
                      <p className="text-gold-400 text-2xl font-bold">{s.value}</p>
                      <p className="text-gray-300 text-xs mt-1">{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
