export const metadata = { title: 'Terms & Conditions | Tulsi Bridal Jewellery' };

const LAST_UPDATED = 'January 1, 2025';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-ivory">
      <div className="bg-luxury-gradient text-white py-14 text-center">
        <p className="text-xs tracking-[0.4em] uppercase text-gold-400 font-medium mb-3">Legal</p>
        <h1 className="font-serif text-4xl font-bold">Terms &amp; Conditions</h1>
        <p className="text-white/50 text-sm mt-3">Last updated: {LAST_UPDATED}</p>
      </div>

      <div className="section-container py-14">
        <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-card p-8 md:p-12 space-y-8">

          <section>
            <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">1. Acceptance of Terms</h2>
            <p className="text-stone-500 text-sm leading-relaxed">
              By accessing and using the Tulsi Bridal Jewellery website (www.tulsibridal.com) or placing any order,
              you agree to be bound by these Terms &amp; Conditions. If you do not accept these terms, please do not
              use our website or services. We reserve the right to modify these terms at any time, and your
              continued use of the site constitutes acceptance of the updated terms.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">2. Products &amp; Pricing</h2>
            <ul className="space-y-2">
              {[
                'All prices are listed in Indian Rupees (₹) and include applicable taxes unless stated otherwise.',
                'We reserve the right to change prices without prior notice. The price at time of order confirmation applies.',
                'Product images are for representational purposes. Slight colour variations may occur due to photography lighting.',
                'We do not guarantee that product listings are error-free. We reserve the right to cancel orders placed at incorrect prices.',
                'All jewellery is gold-plated / imitation fashion jewellery unless explicitly stated as genuine gold or silver.',
              ].map((item) => (
                <li key={item} className="flex gap-3 text-sm text-stone-500">
                  <span className="text-gold-500 font-bold flex-shrink-0">✦</span> {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">3. Orders &amp; Payment</h2>
            <ul className="space-y-2">
              {[
                'Orders are confirmed only upon successful payment or acceptance of Cash on Delivery (COD).',
                'We accept UPI, credit/debit cards, net banking (via Razorpay), and Cash on Delivery.',
                'We reserve the right to refuse or cancel any order for reasons including stock unavailability, pricing errors, or suspected fraud.',
                'COD orders may require advance confirmation via WhatsApp for orders above ₹5,000.',
                'All online payments are processed securely via Razorpay. We do not store card details.',
              ].map((item) => (
                <li key={item} className="flex gap-3 text-sm text-stone-500">
                  <span className="text-gold-500 font-bold flex-shrink-0">✦</span> {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">4. Delivery</h2>
            <ul className="space-y-2">
              {[
                'Orders are typically dispatched within 2–3 business days after payment confirmation.',
                'Estimated delivery: 4–7 business days for most locations in India.',
                'Free delivery applies to orders above ₹2,000. A delivery charge applies to smaller orders.',
                'We are not responsible for delays caused by courier partners, natural calamities, or public holidays.',
                'Risk of loss and title pass to you upon handover to the courier partner.',
              ].map((item) => (
                <li key={item} className="flex gap-3 text-sm text-stone-500">
                  <span className="text-gold-500 font-bold flex-shrink-0">✦</span> {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">5. Rental Terms</h2>
            <ul className="space-y-2">
              {[
                'Rental bookings require a refundable security deposit of 30% of the product\'s purchase price.',
                'The security deposit is returned within 5–7 business days after the item is received and inspected.',
                'Any damage beyond normal wear will be deducted from the security deposit. Severe damage may be charged additionally.',
                'Rental items must be returned by the agreed return date. Late returns are charged at 1.5x the daily rental rate.',
                'Rental items remain the property of Tulsi Bridal Jewellery at all times.',
                'Cancellations made 48+ hours before rental start date receive a full refund. Within 48 hours, 50% is refunded.',
              ].map((item) => (
                <li key={item} className="flex gap-3 text-sm text-stone-500">
                  <span className="text-gold-500 font-bold flex-shrink-0">✦</span> {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">6. Intellectual Property</h2>
            <p className="text-stone-500 text-sm leading-relaxed">
              All content on this website — including product photographs, descriptions, logo, brand name, and design —
              is the property of Tulsi Bridal Jewellery and is protected by copyright law. You may not reproduce,
              distribute, or use any content for commercial purposes without our express written permission.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">7. User Accounts</h2>
            <ul className="space-y-2">
              {[
                'You are responsible for maintaining the confidentiality of your account credentials.',
                'You agree to provide accurate, current, and complete information during registration.',
                'We reserve the right to suspend or terminate accounts that violate these terms.',
                'You are responsible for all activity that occurs under your account.',
              ].map((item) => (
                <li key={item} className="flex gap-3 text-sm text-stone-500">
                  <span className="text-gold-500 font-bold flex-shrink-0">✦</span> {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">8. Limitation of Liability</h2>
            <p className="text-stone-500 text-sm leading-relaxed">
              To the maximum extent permitted by applicable law, Tulsi Bridal Jewellery shall not be liable for any
              indirect, incidental, special, or consequential damages arising from your use of our products or services.
              Our total liability in any matter shall not exceed the amount paid by you for the specific order or rental
              in question.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">9. Governing Law</h2>
            <p className="text-stone-500 text-sm leading-relaxed">
              These terms are governed by the laws of India. Any disputes arising from these terms or your use of our
              services shall be subject to the exclusive jurisdiction of the courts of Mumbai, Maharashtra.
            </p>
          </section>

          <section className="bg-ivory-200 rounded-xl p-6">
            <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">10. Contact</h2>
            <p className="text-stone-500 text-sm">
              Questions about these terms? Reach us at{' '}
              <a href="mailto:hello@tulsibridal.com" className="text-wine-700 hover:underline font-medium">hello@tulsibridal.com</a>
              {' '}or call{' '}
              <a href="tel:+917695868787" className="text-wine-700 hover:underline font-medium">+91 76958 68787</a>.
            </p>
          </section>

        </div>
      </div>
    </div>
  );
}
