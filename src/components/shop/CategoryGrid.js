import Link from 'next/link';

const categories = [
  { name: 'Necklaces', slug: 'necklace', emoji: '📿', desc: 'Statement pieces' },
  { name: 'Earrings', slug: 'earrings', emoji: '✨', desc: 'Jhumkas & chandbalis' },
  { name: 'Bangles', slug: 'bangles', emoji: '💛', desc: 'Kangan & churi' },
  { name: 'Maang Tikka', slug: 'maang-tikka', emoji: '👑', desc: 'Crown your look' },
  { name: 'Rings', slug: 'ring', emoji: '💍', desc: 'Engagement & bridal' },
  { name: 'Bridal Sets', slug: 'set', emoji: '🌸', desc: 'Complete sets' },
];

export default function CategoryGrid() {
  return (
    <section className="py-12 bg-cream">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <h2 className="font-serif text-3xl font-bold text-maroon-950 mb-2">Shop by Category</h2>
          <p className="text-gray-500">Find the perfect jewellery for every occasion</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {categories.map((cat) => (
            <Link
              key={cat.slug}
              href={`/shop?category=${cat.slug}`}
              className="group bg-white rounded-xl p-5 text-center shadow-sm hover:shadow-md hover:-translate-y-1 transition-all"
            >
              <div className="text-3xl mb-2">{cat.emoji}</div>
              <h3 className="font-semibold text-gray-800 text-sm group-hover:text-maroon-950 transition">{cat.name}</h3>
              <p className="text-xs text-gray-400 mt-1">{cat.desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
