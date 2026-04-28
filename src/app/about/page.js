export const metadata = { title: 'About Us' };

export default function AboutPage() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <div className="bg-gradient-to-br from-maroon-950 to-maroon-800 text-white py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="font-serif text-4xl md:text-5xl font-bold mb-4">Our Story</h1>
          <p className="text-gray-300 text-lg">Crafting dreams into reality since 2010</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="prose prose-lg mx-auto">
          <div className="bg-gold-50 rounded-2xl p-8 mb-8 text-center">
            <div className="text-5xl mb-4">👑</div>
            <h2 className="font-serif text-2xl font-bold text-maroon-950 mb-3">Tulsi Bridal Jewellery</h2>
            <p className="text-gray-600 leading-relaxed">
              Born from a passion for preserving the timeless beauty of Indian bridal jewellery, Tulsi was founded in 2010 by master artisan Savita Devi in the heart of Mumbai. What started as a small workshop has grown into one of India&apos;s most trusted bridal jewellery brands.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 mb-10">
            {[
              { title: 'Our Craft', icon: '🛠️', desc: 'Each piece is handcrafted by skilled artisans with decades of experience in traditional Indian jewellery making techniques — kundan, meenakari, and polki.' },
              { title: 'Our Promise', icon: '💎', desc: 'We use only high-quality materials. Every piece is hypoallergenic, tarnish-resistant, and backed by our quality guarantee.' },
              { title: 'Our Mission', icon: '🌸', desc: 'To make every bride feel like royalty on her special day, whether she buys or rents our jewellery — at a price that suits every budget.' },
            ].map((v) => (
              <div key={v.title} className="bg-white rounded-xl p-6 shadow-sm text-center">
                <div className="text-3xl mb-3">{v.icon}</div>
                <h3 className="font-serif font-bold text-maroon-950 mb-2">{v.title}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{v.desc}</p>
              </div>
            ))}
          </div>

          <div className="bg-maroon-950 rounded-2xl p-8 text-white text-center mb-8">
            <h2 className="font-serif text-2xl font-bold text-gold-400 mb-6">Our Numbers</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {[
                { label: 'Happy Brides', value: '5000+' },
                { label: 'Years of Craft', value: '14+' },
                { label: 'Jewellery Pieces', value: '500+' },
                { label: 'Rental Items', value: '200+' },
              ].map((s) => (
                <div key={s.label}>
                  <p className="text-gold-400 text-3xl font-bold">{s.value}</p>
                  <p className="text-gray-300 text-sm mt-1">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="text-center">
            <h2 className="font-serif text-2xl font-bold text-maroon-950 mb-4">Meet Our Team</h2>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                { name: 'Savita Devi', role: 'Founder & Master Artisan', emoji: '👩‍🎨' },
                { name: 'Rajesh Kumar', role: 'Head of Design', emoji: '👨‍🎨' },
                { name: 'Priya Singh', role: 'Customer Relations', emoji: '👩‍💼' },
              ].map((member) => (
                <div key={member.name} className="bg-white rounded-xl p-6 shadow-sm text-center">
                  <div className="text-4xl mb-3">{member.emoji}</div>
                  <h3 className="font-semibold text-gray-800">{member.name}</h3>
                  <p className="text-gray-500 text-sm">{member.role}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
