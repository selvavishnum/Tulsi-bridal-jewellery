export const metadata = { title: 'Privacy Policy | Tulsi Bridal Jewellery' };

const LAST_UPDATED = 'January 1, 2025';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-ivory">
      <div className="bg-luxury-gradient text-white py-14 text-center">
        <p className="text-xs tracking-[0.4em] uppercase text-gold-400 font-medium mb-3">Legal</p>
        <h1 className="font-serif text-4xl font-bold">Privacy Policy</h1>
        <p className="text-white/50 text-sm mt-3">Last updated: {LAST_UPDATED}</p>
      </div>

      <div className="section-container py-14">
        <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-card p-8 md:p-12 space-y-8">

          <section>
            <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">1. Introduction</h2>
            <p className="text-stone-500 text-sm leading-relaxed">
              Tulsi Bridal Jewellery ("we", "our", "us") respects your privacy and is committed to protecting your personal data.
              This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website
              and make purchases or rental bookings. Please read this policy carefully. If you disagree with its terms, please
              discontinue use of the site.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">2. Information We Collect</h2>
            <p className="text-stone-500 text-sm leading-relaxed mb-3">We may collect the following categories of personal information:</p>
            <ul className="space-y-2">
              {[
                ['Identity Data', 'Name, username, date of birth'],
                ['Contact Data', 'Email address, phone number, billing and delivery address'],
                ['Transaction Data', 'Details of purchases, rentals, payments, and order history'],
                ['Technical Data', 'IP address, browser type, device identifiers, cookies and usage data'],
                ['Marketing Data', 'Your preferences for receiving marketing communications from us'],
              ].map(([label, desc]) => (
                <li key={label} className="flex gap-3 text-sm text-stone-500">
                  <span className="w-2 h-2 rounded-full bg-gold-400 flex-shrink-0 mt-1.5" />
                  <span><strong className="text-stone-700">{label}:</strong> {desc}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">3. How We Use Your Information</h2>
            <ul className="space-y-2">
              {[
                'Process and fulfil your orders and rental bookings',
                'Send order confirmations, shipping updates, and delivery notifications',
                'Manage your account and provide customer support',
                'Send promotional communications (only if you opted in)',
                'Improve our website, products, and services',
                'Comply with legal obligations and resolve disputes',
                'Prevent fraud and ensure the security of our platform',
              ].map((item) => (
                <li key={item} className="flex gap-3 text-sm text-stone-500">
                  <span className="text-gold-500 font-bold flex-shrink-0">✦</span> {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">4. Sharing Your Information</h2>
            <p className="text-stone-500 text-sm leading-relaxed mb-3">
              We do not sell, trade, or rent your personal data to third parties. We may share data with:
            </p>
            <ul className="space-y-2">
              {[
                'Payment processors (Razorpay) for secure transaction processing',
                'Courier / delivery partners to fulfil shipments',
                'IT and hosting service providers who support our website',
                'Law enforcement or regulatory bodies when required by law',
              ].map((item) => (
                <li key={item} className="flex gap-3 text-sm text-stone-500">
                  <span className="w-2 h-2 rounded-full bg-wine-300 flex-shrink-0 mt-1.5" />
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">5. Cookies</h2>
            <p className="text-stone-500 text-sm leading-relaxed">
              Our website uses cookies to enhance your browsing experience — for example, to remember your cart contents,
              maintain your login session, and understand how you use the site. You can disable cookies in your browser
              settings, but this may affect site functionality such as keeping items in your cart.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">6. Data Retention</h2>
            <p className="text-stone-500 text-sm leading-relaxed">
              We retain personal data for as long as necessary to provide our services and comply with legal obligations.
              Order and transaction records are kept for a minimum of 7 years as required by Indian tax law. You may
              request deletion of your account data at any time by contacting us.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">7. Your Rights</h2>
            <p className="text-stone-500 text-sm leading-relaxed mb-3">Under applicable data protection law, you have the right to:</p>
            <ul className="space-y-2">
              {[
                'Access the personal data we hold about you',
                'Correct inaccurate or incomplete data',
                'Request deletion of your personal data',
                'Object to processing of your data for marketing purposes',
                'Withdraw consent where processing is based on consent',
              ].map((item) => (
                <li key={item} className="flex gap-3 text-sm text-stone-500">
                  <span className="text-gold-500 font-bold flex-shrink-0">✦</span> {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">8. Security</h2>
            <p className="text-stone-500 text-sm leading-relaxed">
              We implement appropriate technical and organisational measures to protect your personal data against
              unauthorised access, loss, or misuse. All payment transactions are encrypted via SSL and processed
              through PCI-DSS compliant payment gateways. However, no internet transmission is 100% secure,
              and we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">9. Children's Privacy</h2>
            <p className="text-stone-500 text-sm leading-relaxed">
              Our services are not directed to individuals under the age of 18. We do not knowingly collect personal
              information from children. If you believe a child has provided us personal data, please contact us
              immediately and we will delete such information.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">10. Changes to This Policy</h2>
            <p className="text-stone-500 text-sm leading-relaxed">
              We may update this Privacy Policy from time to time. The latest version will always be posted on this page
              with the "Last Updated" date. We encourage you to review this policy periodically.
            </p>
          </section>

          <section className="bg-ivory-200 rounded-xl p-6">
            <h2 className="font-serif text-xl font-bold text-stone-800 mb-3">11. Contact Us</h2>
            <p className="text-stone-500 text-sm leading-relaxed">
              If you have any questions about this Privacy Policy or wish to exercise your rights, please contact us:
            </p>
            <div className="mt-3 space-y-1 text-sm">
              <p className="text-stone-700 font-medium">Tulsi Bridal Jewellery</p>
              <p className="text-stone-500">Email: <a href="mailto:hello@tulsibridal.com" className="text-wine-700 hover:underline">hello@tulsibridal.com</a></p>
              <p className="text-stone-500">Phone: <a href="tel:+919876543210" className="text-wine-700 hover:underline">+91 98765 43210</a></p>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
