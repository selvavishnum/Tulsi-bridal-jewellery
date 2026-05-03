'use client';
import { useState, useEffect } from 'react';
import { FiSettings, FiSave, FiPlus, FiTrash2, FiImage } from 'react-icons/fi';
import Image from 'next/image';
import toast from 'react-hot-toast';

const SECTIONS = [
  {
    title: 'Business Information',
    fields: [
      { key: 'businessName', label: 'Business Name', placeholder: 'Tulsi Bridal Jewellery' },
      { key: 'tagline', label: 'Tagline', placeholder: 'Premium Bridal Jewellery Rentals' },
      { key: 'phone', label: 'Phone / WhatsApp', placeholder: '+91 76958 68787' },
      { key: 'email', label: 'Contact Email', placeholder: 'info@tulsibridal.com' },
      { key: 'address', label: 'Address', placeholder: 'Your city, State' },
      { key: 'gstin', label: 'GSTIN (optional)', placeholder: '22ABCDE1234F1Z5' },
    ],
  },
  {
    title: 'Social Media',
    fields: [
      { key: 'instagram', label: 'Instagram URL', placeholder: 'https://instagram.com/yourpage' },
      { key: 'facebook', label: 'Facebook URL', placeholder: 'https://facebook.com/yourpage' },
      { key: 'whatsapp', label: 'WhatsApp Number', placeholder: '917695868787' },
      { key: 'youtube', label: 'YouTube URL', placeholder: 'https://youtube.com/...' },
    ],
  },
  {
    title: 'Rental Policy',
    fields: [
      { key: 'depositPercent', label: 'Security Deposit (%)', placeholder: '30', type: 'number' },
      { key: 'minRentalDays', label: 'Minimum Rental Days', placeholder: '1', type: 'number' },
      { key: 'deliveryCharge', label: 'Delivery Charge (₹)', placeholder: '200', type: 'number' },
      { key: 'freeDeliveryAbove', label: 'Free Delivery Above (₹)', placeholder: '2000', type: 'number' },
    ],
  },
  {
    title: 'Notifications',
    fields: [
      { key: 'whatsappNotify', label: 'WhatsApp for new orders', placeholder: '+91 76958 68787' },
      { key: 'emailNotify', label: 'Email for notifications', placeholder: 'admin@tulsibridal.com' },
    ],
  },
];

const BLANK_SLIDE = {
  id: '',
  imageUrl: '',
  tag: '',
  title: '',
  subtitle: '',
  ctaText: 'Shop Collection',
  ctaLink: '/shop',
  cta2Text: 'Book Rental',
  cta2Link: '/rentals',
};

/* ── Hero Slide Editor row ── */
function SlideRow({ slide, index, onChange, onDelete }) {
  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Slide {index + 1}</span>
        <button type="button" onClick={onDelete} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition">
          <FiTrash2 className="text-sm" />
        </button>
      </div>

      {/* Image preview */}
      {slide.imageUrl && (
        <div className="relative h-32 rounded-lg overflow-hidden bg-gray-200 mb-1">
          <Image src={slide.imageUrl} alt="slide preview" fill className="object-cover object-top" />
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <label className="text-xs text-gray-500 mb-1 block font-medium">Image URL <span className="text-gray-400">(model photo — full width)</span></label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <FiImage className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
              <input
                type="url"
                value={slide.imageUrl}
                onChange={(e) => onChange('imageUrl', e.target.value)}
                placeholder="https://… paste image link here"
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400"
              />
            </div>
          </div>
          <p className="text-[10px] text-gray-400 mt-1">Use Google Drive, Cloudinary, or any public image URL. Recommended size: 1600×900px</p>
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block font-medium">Tag / Badge text</label>
          <input value={slide.tag} onChange={(e) => onChange('tag', e.target.value)} placeholder="e.g. New Bridal Collection"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block font-medium">Main Title</label>
          <input value={slide.title} onChange={(e) => onChange('title', e.target.value)} placeholder="You Are The Occasion"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400" />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs text-gray-500 mb-1 block font-medium">Subtitle / description</label>
          <input value={slide.subtitle} onChange={(e) => onChange('subtitle', e.target.value)} placeholder="Jewellery Crafted for Brides"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block font-medium">Button 1 Text</label>
          <input value={slide.ctaText} onChange={(e) => onChange('ctaText', e.target.value)} placeholder="Shop Collection"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block font-medium">Button 1 Link</label>
          <input value={slide.ctaLink} onChange={(e) => onChange('ctaLink', e.target.value)} placeholder="/shop"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block font-medium">Button 2 Text <span className="text-gray-400">(optional)</span></label>
          <input value={slide.cta2Text} onChange={(e) => onChange('cta2Text', e.target.value)} placeholder="Book Rental"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block font-medium">Button 2 Link <span className="text-gray-400">(optional)</span></label>
          <input value={slide.cta2Link} onChange={(e) => onChange('cta2Link', e.target.value)} placeholder="/rentals"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400" />
        </div>
      </div>
    </div>
  );
}

function TestEmailPanel() {
  const [testEmail, setTestEmail] = useState('');
  const [status, setStatus]       = useState(null); // null | 'loading' | {ok, msg}

  async function runTest() {
    setStatus('loading');
    try {
      const res  = await fetch('/api/admin/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testEmail }),
      });
      const data = await res.json();
      setStatus({ ok: data.success, msg: data.message });
    } catch (e) {
      setStatus({ ok: false, msg: e.message });
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <h2 className="font-bold text-gray-800 mb-1">Test Email Notifications</h2>
      <p className="text-xs text-gray-400 mb-4">Send a test mail to verify your SMTP setup is working</p>
      <div className="flex gap-3">
        <input
          type="email"
          value={testEmail}
          onChange={(e) => setTestEmail(e.target.value)}
          placeholder="Enter your email to receive test"
          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400"
        />
        <button
          type="button"
          onClick={runTest}
          disabled={status === 'loading'}
          className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 transition whitespace-nowrap"
        >
          {status === 'loading' ? 'Sending…' : 'Send Test Email'}
        </button>
      </div>

      {status && status !== 'loading' && (
        <div className={`mt-3 px-4 py-3 rounded-lg text-sm font-medium ${status.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {status.ok ? '✅ ' : '❌ '}
          {status.msg}
          {!status.ok && (
            <div className="mt-2 text-xs font-normal text-red-600 space-y-1">
              <p>Common fixes:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>SMTP_USER / SMTP_PASS / ADMIN_EMAIL not set in <code className="bg-red-100 px-1 rounded">.env.local</code></li>
                <li>Gmail: use <strong>App Password</strong>, not your normal password</li>
                <li>Gmail: 2-Step Verification must be ON before creating App Password</li>
                <li>After editing .env.local, <strong>restart the server</strong> (npm run dev)</li>
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    businessName: 'Tulsi Bridal Jewellery',
    tagline: 'Premium Bridal Jewellery Rentals',
    phone: '+91 76958 68787',
    email: '',
    address: '',
    gstin: '',
    instagram: '',
    facebook: '',
    whatsapp: '',
    youtube: '',
    depositPercent: '30',
    minRentalDays: '1',
    deliveryCharge: '200',
    freeDeliveryAbove: '2000',
    whatsappNotify: '',
    emailNotify: '',
  });
  const [heroSlides, setHeroSlides] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.data) {
          setSettings((prev) => ({ ...prev, ...d.data }));
          if (Array.isArray(d.data.heroSlides)) setHeroSlides(d.data.heroSlides);
        }
      })
      .catch(() => {});
  }, []);

  function update(key, value) { setSettings((prev) => ({ ...prev, [key]: value })); }

  function addSlide() {
    setHeroSlides((prev) => [...prev, { ...BLANK_SLIDE, id: Date.now().toString() }]);
  }

  function updateSlide(index, field, value) {
    setHeroSlides((prev) => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  }

  function deleteSlide(index) {
    setHeroSlides((prev) => prev.filter((_, i) => i !== index));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, heroSlides }),
      });
      const data = await res.json();
      if (data.success) toast.success('Settings saved!');
      else toast.error(data.message || 'Failed to save');
    } catch { toast.error('Network error'); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><FiSettings /> Admin Settings</h1>
          <p className="text-gray-500 text-sm mt-0.5">Configure your business details and homepage</p>
        </div>
      </div>

      <form onSubmit={save} className="space-y-5">
        {/* ── Hero Banner Slides ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-100">
            <div>
              <h2 className="font-bold text-gray-800">Homepage Hero Banners</h2>
              <p className="text-xs text-gray-400 mt-0.5">Full-screen model images shown on the homepage slider</p>
            </div>
            <button type="button" onClick={addSlide}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-maroon-950 text-white text-xs font-semibold rounded-lg hover:bg-maroon-900 transition">
              <FiPlus /> Add Slide
            </button>
          </div>

          {heroSlides.length === 0 ? (
            <div className="text-center py-10 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
              <FiImage className="text-3xl mx-auto mb-2 opacity-40" />
              <p className="text-sm font-medium">No hero slides yet</p>
              <p className="text-xs mt-1">Click "Add Slide" to add your first model banner image</p>
              <button type="button" onClick={addSlide} className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-gold-600 text-white text-xs font-semibold rounded-lg hover:bg-gold-700 transition">
                <FiPlus /> Add First Slide
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {heroSlides.map((slide, i) => (
                <SlideRow
                  key={slide.id || i}
                  slide={slide}
                  index={i}
                  onChange={(field, value) => updateSlide(i, field, value)}
                  onDelete={() => deleteSlide(i)}
                />
              ))}
              <button type="button" onClick={addSlide}
                className="w-full py-3 border-2 border-dashed border-gray-200 text-sm text-gray-500 hover:border-gold-400 hover:text-gold-600 rounded-xl flex items-center justify-center gap-2 transition">
                <FiPlus /> Add Another Slide
              </button>
            </div>
          )}
        </div>

        {/* ── Other Settings ── */}
        {SECTIONS.map((section) => (
          <div key={section.title} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="font-bold text-gray-800 mb-4 pb-2 border-b border-gray-100">{section.title}</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {section.fields.map(({ key, label, placeholder, type }) => (
                <div key={key}>
                  <label className="text-xs text-gray-500 mb-1 block font-medium">{label}</label>
                  <input
                    type={type || 'text'}
                    value={settings[key] || ''}
                    onChange={(e) => update(key, e.target.value)}
                    placeholder={placeholder}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}

        <TestEmailPanel />

        <div className="flex justify-end">
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 px-6 py-3 bg-maroon-950 text-white font-bold rounded-xl hover:bg-maroon-900 disabled:opacity-60 transition">
            <FiSave /> {saving ? 'Saving…' : 'Save All Settings'}
          </button>
        </div>
      </form>
    </div>
  );
}
