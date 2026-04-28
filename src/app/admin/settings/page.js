'use client';
import { useState, useEffect } from 'react';
import { FiSettings, FiSave, FiPhone, FiMapPin, FiInstagram, FiLink } from 'react-icons/fi';
import { FaWhatsapp } from 'react-icons/fa';
import toast from 'react-hot-toast';

const SECTIONS = [
  {
    title: 'Business Information',
    fields: [
      { key: 'businessName', label: 'Business Name', placeholder: 'Tulsi Bridal Jewellery' },
      { key: 'tagline', label: 'Tagline', placeholder: 'Premium Bridal Jewellery Rentals' },
      { key: 'phone', label: 'Phone / WhatsApp', placeholder: '+91 98765 43210' },
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
      { key: 'whatsapp', label: 'WhatsApp Number', placeholder: '919876543210' },
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
      { key: 'whatsappNotify', label: 'WhatsApp for new orders', placeholder: '+91 98765 43210' },
      { key: 'emailNotify', label: 'Email for notifications', placeholder: 'admin@tulsibridal.com' },
    ],
  },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    businessName: 'Tulsi Bridal Jewellery',
    tagline: 'Premium Bridal Jewellery Rentals',
    phone: '+91 98765 43210',
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((d) => { if (d.success && d.data) setSettings((prev) => ({ ...prev, ...d.data })); })
      .catch(() => {});
  }, []);

  function update(key, value) { setSettings((prev) => ({ ...prev, [key]: value })); }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
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
          <p className="text-gray-500 text-sm mt-0.5">Configure your business details</p>
        </div>
      </div>

      <form onSubmit={save} className="space-y-5">
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
