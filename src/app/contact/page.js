'use client';

import { useState } from 'react';
import { FiPhone, FiMail, FiMapPin, FiClock } from 'react-icons/fi';
import toast from 'react-hot-toast';

export default function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', subject: '', message: '' });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1000));
    toast.success('Message sent! We&apos;ll get back to you within 24 hours.');
    setForm({ name: '', email: '', phone: '', subject: '', message: '' });
    setLoading(false);
  }

  return (
    <div className="min-h-screen">
      <div className="bg-gradient-to-br from-maroon-950 to-maroon-800 text-white py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="font-serif text-4xl font-bold mb-3">Get in Touch</h1>
          <p className="text-gray-300">We&apos;d love to help you find your perfect bridal jewellery</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid md:grid-cols-2 gap-8">
          {/* Info */}
          <div>
            <h2 className="font-serif text-2xl font-bold text-maroon-950 mb-6">Contact Information</h2>
            <div className="space-y-4 mb-8">
              {[
                { icon: FiPhone, title: 'Phone', content: '+91 98765 43210', sub: 'Mon–Sat, 10am–7pm' },
                { icon: FiMail, title: 'Email', content: 'hello@tulsibridal.com', sub: 'We reply within 24 hours' },
                { icon: FiMapPin, title: 'Visit Us', content: '123 Jewellery Lane, Bridal Market', sub: 'Mumbai, Maharashtra 400001' },
                { icon: FiClock, title: 'Hours', content: 'Monday – Saturday: 10am – 7pm', sub: 'Sunday: 11am – 5pm' },
              ].map(({ icon: Icon, title, content, sub }) => (
                <div key={title} className="flex items-start gap-4 p-4 bg-white rounded-xl shadow-sm">
                  <div className="p-2.5 bg-gold-100 text-gold-700 rounded-lg flex-shrink-0"><Icon /></div>
                  <div>
                    <p className="font-semibold text-gray-800 text-sm">{title}</p>
                    <p className="text-gray-700 text-sm">{content}</p>
                    <p className="text-gray-400 text-xs">{sub}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-gold-50 rounded-xl p-5">
              <h3 className="font-semibold text-maroon-950 mb-2">Rental Enquiries?</h3>
              <p className="text-sm text-gray-600">For bulk rental orders or wedding package enquiries, please call us directly or WhatsApp us for personalised assistance.</p>
            </div>
          </div>

          {/* Form */}
          <div className="bg-white rounded-2xl shadow-sm p-6">
            <h2 className="font-serif text-xl font-bold text-maroon-950 mb-5">Send us a Message</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Name *</label>
                  <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Phone</label>
                  <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Email *</label>
                <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Subject</label>
                <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Message *</label>
                <textarea required rows={4} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500 resize-none" />
              </div>
              <button type="submit" disabled={loading} className="w-full py-3 bg-maroon-950 text-white font-semibold rounded-xl hover:bg-maroon-900 disabled:opacity-60 transition">
                {loading ? 'Sending...' : 'Send Message'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
