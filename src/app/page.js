import HeroBanner from '@/components/shop/HeroBanner';
import CategoryGrid from '@/components/shop/CategoryGrid';
import FeaturedProducts from '@/components/shop/FeaturedProducts';
import RentalBanner from '@/components/shop/RentalBanner';
import Testimonials from '@/components/shop/Testimonials';

export default function HomePage() {
  return (
    <>
      <HeroBanner />
      <CategoryGrid />
      <FeaturedProducts />
      <RentalBanner />
      <Testimonials />

      {/* Trust badges */}
      <section className="py-10 bg-cream">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { icon: '🚚', title: 'Free Shipping', desc: 'On orders above ₹2000' },
              { icon: '🔒', title: 'Secure Payment', desc: 'Razorpay protected' },
              { icon: '↩️', title: 'Easy Returns', desc: '7-day return policy' },
              { icon: '🎁', title: 'Gift Wrapping', desc: 'Beautiful packaging' },
            ].map((b) => (
              <div key={b.title} className="bg-white rounded-xl p-5 shadow-sm">
                <div className="text-3xl mb-2">{b.icon}</div>
                <h3 className="font-semibold text-gray-800 text-sm">{b.title}</h3>
                <p className="text-xs text-gray-400 mt-1">{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
