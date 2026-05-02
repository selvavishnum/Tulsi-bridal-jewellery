export const metadata = { title: 'Refund & Return Policy | Tulsi Bridal Jewellery' };

const LAST_UPDATED = 'January 1, 2025';

export default function RefundsPage() {
  return (
    <div className="min-h-screen bg-ivory">
      <div className="bg-luxury-gradient text-white py-14 text-center">
        <p className="text-xs tracking-[0.4em] uppercase text-gold-400 font-medium mb-3">Legal</p>
        <h1 className="font-serif text-4xl font-bold">Refund &amp; Return Policy</h1>
        <p className="text-white/50 text-sm mt-3">Last updated: {LAST_UPDATED}</p>
      </div>

      <div className="section-container py-14">
        <div className="max-w-3xl mx-auto space-y-6">

          {/* Summary cards */}
          <div className="grid md:grid-cols-3 gap-4 mb-2">
            {[
              { icon: '🔄', title: '7-Day Returns', desc: 'Return within 7 days of delivery for eligible items' },
              { icon: '💰', title: 'Full Refund', desc: 'Original payment method, processed in 5–7 business days' },
              { icon: '📦', title: 'Easy Process', desc: 'Contact us and we arrange free return pickup' },
            ].map((c) => (
              <div key={c.title} className="bg-white rounded-2xl p-5 shadow-card text-center">
                <div className="text-3xl mb-2">{c.icon}</div>
                <p className="font-serif font-semibold text-stone-800 mb-1">{c.title}</p>
                <p className="text-stone-400 text-xs leading-relaxed">{c.desc}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl shadow-card p-8 md:p-10 space-y-8">

            <section>
              <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">1. Return Eligibility (Purchase Orders)</h2>
              <p className="text-stone-500 text-sm leading-relaxed mb-3">
                We accept returns within <strong className="text-stone-700">7 days of delivery</strong> for the following reasons:
              </p>
              <ul className="space-y-2 mb-4">
                {[
                  'Product received is damaged or defective',
                  'Wrong item delivered (different from what was ordered)',
                  'Significant colour or design difference from product listing',
                ].map((item) => (
                  <li key={item} className="flex gap-3 text-sm text-stone-500">
                    <span className="text-green-500 font-bold flex-shrink-0">✓</span> {item}
                  </li>
                ))}
              </ul>
              <p className="text-stone-500 text-sm leading-relaxed mb-2">We do <strong className="text-stone-700">not</strong> accept returns for:</p>
              <ul className="space-y-2">
                {[
                  'Change of mind after delivery',
                  'Minor colour variations due to photography or screen calibration',
                  'Items that have been worn, used, or tampered with',
                  'Items without original packaging or tags',
                  'Custom or personalised orders',
                ].map((item) => (
                  <li key={item} className="flex gap-3 text-sm text-stone-500">
                    <span className="text-red-400 font-bold flex-shrink-0">✕</span> {item}
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">2. How to Initiate a Return</h2>
              <ol className="space-y-3">
                {[
                  { step: '1', text: 'Contact us within 7 days of delivery via WhatsApp (+91 98765 43210) or email (hello@tulsibridal.com).' },
                  { step: '2', text: 'Share your order number, reason for return, and clear photographs of the item and packaging.' },
                  { step: '3', text: 'Our team reviews your request within 24 hours and confirms eligibility.' },
                  { step: '4', text: 'We arrange a free return pickup from your address (or provide prepaid return label).' },
                  { step: '5', text: 'Once we receive and inspect the item, your refund is processed within 5–7 business days.' },
                ].map(({ step, text }) => (
                  <li key={step} className="flex gap-4 text-sm text-stone-500">
                    <span className="w-7 h-7 rounded-full bg-wine-100 text-wine-700 font-bold text-xs flex items-center justify-center flex-shrink-0">{step}</span>
                    {text}
                  </li>
                ))}
              </ol>
            </section>

            <section>
              <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">3. Refund Timeline</h2>
              <div className="overflow-hidden rounded-xl border border-stone-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-stone-50">
                      <th className="text-left px-4 py-3 text-stone-600 font-semibold">Payment Method</th>
                      <th className="text-left px-4 py-3 text-stone-600 font-semibold">Refund Timeline</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['UPI / Net Banking', '3–5 business days'],
                      ['Credit / Debit Card', '5–7 business days'],
                      ['Cash on Delivery', '5–7 business days (bank transfer)'],
                      ['Wallet / Razorpay', '2–3 business days'],
                    ].map(([method, timeline], i) => (
                      <tr key={method} className={i % 2 === 0 ? 'bg-white' : 'bg-stone-50/50'}>
                        <td className="px-4 py-3 text-stone-600">{method}</td>
                        <td className="px-4 py-3 text-stone-500">{timeline}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">4. Order Cancellations (Before Dispatch)</h2>
              <ul className="space-y-2">
                {[
                  'You may cancel your order any time before it is dispatched for a full refund.',
                  'Once dispatched, cancellation is not possible — please initiate a return after delivery.',
                  'To cancel, go to My Account → Orders → Cancel Order, or contact us on WhatsApp.',
                  'Refund for cancelled orders is processed within 3–5 business days.',
                ].map((item) => (
                  <li key={item} className="flex gap-3 text-sm text-stone-500">
                    <span className="text-gold-500 font-bold flex-shrink-0">✦</span> {item}
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">5. Rental Returns &amp; Deposits</h2>
              <ul className="space-y-2">
                {[
                  'Rental items must be returned on or before the agreed return date.',
                  'Security deposit (30% of product value) is refunded within 5–7 business days after inspection.',
                  'Minor cleaning charges may be deducted from the deposit if required.',
                  'Damage beyond normal wear will be assessed; costs deducted from deposit or billed separately.',
                  'Late returns incur a charge of 1.5× the daily rental rate per additional day.',
                  'Lost or stolen items will be charged at full purchase price.',
                ].map((item) => (
                  <li key={item} className="flex gap-3 text-sm text-stone-500">
                    <span className="text-gold-500 font-bold flex-shrink-0">✦</span> {item}
                  </li>
                ))}
              </ul>
            </section>

            <section className="bg-ivory-200 rounded-xl p-6">
              <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">Need Help?</h2>
              <p className="text-stone-500 text-sm leading-relaxed mb-3">
                Our customer support team is available Monday–Saturday, 10 AM – 7 PM.
              </p>
              <div className="flex flex-wrap gap-3">
                <a href="https://wa.me/919876543210" target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-500 text-white text-sm font-semibold rounded-xl hover:bg-green-400 transition">
                  WhatsApp Us
                </a>
                <a href="mailto:hello@tulsibridal.com"
                  className="inline-flex items-center gap-2 px-5 py-2.5 border border-wine-700 text-wine-700 text-sm font-semibold rounded-xl hover:bg-wine-50 transition">
                  Email Us
                </a>
              </div>
            </section>

          </div>
        </div>
      </div>
    </div>
  );
}
