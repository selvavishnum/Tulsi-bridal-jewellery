const testimonials = [
  { name: 'Priya Sharma', city: 'Mumbai', rating: 5, text: 'Absolutely stunning pieces! The kundan necklace set I bought for my wedding was the highlight of my bridal look. The quality is exceptional.', avatar: 'P' },
  { name: 'Ananya Gupta', city: 'Delhi', rating: 5, text: 'Rented the bridal set for my sister\'s wedding and everyone thought it was purchased! Great quality at an affordable rental price. Highly recommend!', avatar: 'A' },
  { name: 'Meera Patel', city: 'Ahmedabad', rating: 5, text: 'Fast delivery, beautiful packaging and even more beautiful jewellery. The maang tikka I ordered was exactly as shown. Will definitely shop again!', avatar: 'M' },
  { name: 'Kavya Reddy', city: 'Hyderabad', rating: 5, text: 'The customer service is amazing! They helped me choose the perfect set for my big day. The pieces are authentic and gorgeous.', avatar: 'K' },
];

export default function Testimonials() {
  return (
    <section className="py-12 bg-maroon-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <h2 className="font-serif text-3xl font-bold text-white mb-2">Happy Brides Say</h2>
          <p className="text-gray-300">Over 5000 brides have trusted us for their special day</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {testimonials.map((t) => (
            <div key={t.name} className="bg-white/10 backdrop-blur rounded-xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-gold-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                  {t.avatar}
                </div>
                <div>
                  <p className="font-semibold text-white text-sm">{t.name}</p>
                  <p className="text-gray-400 text-xs">{t.city}</p>
                </div>
              </div>
              <div className="flex gap-0.5 mb-3">
                {Array.from({ length: t.rating }).map((_, i) => (
                  <span key={i} className="text-gold-400 text-sm">★</span>
                ))}
              </div>
              <p className="text-gray-300 text-sm leading-relaxed">{t.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
