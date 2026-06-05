'use client';
import { useState, useEffect, useRef } from 'react';
import { FiSettings, FiSave, FiPlus, FiTrash2, FiImage, FiUpload } from 'react-icons/fi';
import Image from 'next/image';
import toast from 'react-hot-toast';
import { compressImage } from '@/lib/imageCompress';

/* ─────────────────────────── Toggle component ─────────────────────────── */
function Toggle({ value, onChange, label, description }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-gray-100 last:border-0">
      <div>
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {description && <p className="text-xs text-gray-400 mt-0.5">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors duration-200 ${value ? 'bg-amber-500' : 'bg-gray-200'}`}
      >
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform duration-200 mt-0.5 ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

/* ─────────────────────────── Hero Slide row ─────────────────────────── */
const BLANK_SLIDE = { id: '', imageUrl: '', tag: '', title: '', subtitle: '', ctaText: 'Shop Collection', ctaLink: '/shop', cta2Text: 'Book Rental', cta2Link: '/rentals' };

function SlideRow({ slide, index, onChange, onDelete }) {
  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Slide {index + 1}</span>
        <button type="button" onClick={onDelete} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition"><FiTrash2 className="text-sm" /></button>
      </div>
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
              <input type="url" value={slide.imageUrl} onChange={(e) => onChange('imageUrl', e.target.value)} placeholder="https://… paste image link here"
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
          </div>
          <p className="text-[10px] text-gray-400 mt-1">Recommended size: 1600×900px</p>
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block font-medium">Tag / Badge text</label>
          <input value={slide.tag} onChange={(e) => onChange('tag', e.target.value)} placeholder="e.g. New Bridal Collection"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block font-medium">Main Title</label>
          <input value={slide.title} onChange={(e) => onChange('title', e.target.value)} placeholder="You Are The Occasion"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs text-gray-500 mb-1 block font-medium">Subtitle / description</label>
          <input value={slide.subtitle} onChange={(e) => onChange('subtitle', e.target.value)} placeholder="Jewellery Crafted for Brides"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block font-medium">Button 1 Text</label>
          <input value={slide.ctaText} onChange={(e) => onChange('ctaText', e.target.value)} placeholder="Shop Collection"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block font-medium">Button 1 Link</label>
          <input value={slide.ctaLink} onChange={(e) => onChange('ctaLink', e.target.value)} placeholder="/shop"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block font-medium">Button 2 Text <span className="text-gray-400">(optional)</span></label>
          <input value={slide.cta2Text} onChange={(e) => onChange('cta2Text', e.target.value)} placeholder="Book Rental"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block font-medium">Button 2 Link <span className="text-gray-400">(optional)</span></label>
          <input value={slide.cta2Link} onChange={(e) => onChange('cta2Link', e.target.value)} placeholder="/rentals"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Testimonial row ─────────────────────────── */
const BLANK_TESTIMONIAL = { name: '', location: '', photo: '', rating: 5, review: '' };

function TestimonialRow({ testimonial, index, onChange, onDelete }) {
  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Review {index + 1}</span>
        <button type="button" onClick={onDelete} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition"><FiTrash2 className="text-sm" /></button>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 mb-1 block font-medium">Customer Name</label>
          <input value={testimonial.name} onChange={(e) => onChange('name', e.target.value)} placeholder="e.g. Priya Sharma"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block font-medium">Location</label>
          <input value={testimonial.location} onChange={(e) => onChange('location', e.target.value)} placeholder="e.g. Chennai"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs text-gray-500 mb-1 block font-medium">Photo URL <span className="text-gray-400">(optional — circular avatar)</span></label>
          <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <FiImage className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
              <input type="url" value={testimonial.photo} onChange={(e) => onChange('photo', e.target.value)} placeholder="https://… paste image link here"
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            {testimonial.photo && (
              <div className="relative w-10 h-10 rounded-full overflow-hidden border border-gray-300 flex-shrink-0">
                <Image src={testimonial.photo} alt="avatar" fill className="object-cover" />
              </div>
            )}
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block font-medium">Star Rating</label>
          <select value={testimonial.rating} onChange={(e) => onChange('rating', Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white">
            {[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{r} Star{r > 1 ? 's' : ''}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="text-xs text-gray-500 mb-1 block font-medium">Review Text</label>
          <textarea value={testimonial.review} onChange={(e) => onChange('review', e.target.value)}
            placeholder="What did the customer say about their experience?" rows={3}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Instagram Post row ─────────────────────────── */
const BLANK_INSTA_POST = { imageUrl: '', caption: '', postUrl: '' };

function InstaPostRow({ post, index, onChange, onDelete }) {
  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Post {index + 1}</span>
        <button type="button" onClick={onDelete} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition"><FiTrash2 className="text-sm" /></button>
      </div>
      {post.imageUrl && (
        <div className="relative aspect-square w-24 rounded-lg overflow-hidden bg-gray-200 border border-gray-300">
          <Image src={post.imageUrl} alt="post preview" fill className="object-cover" />
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <label className="text-xs text-gray-500 mb-1 block font-medium">Image URL</label>
          <div className="relative">
            <FiImage className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
            <input type="url" value={post.imageUrl} onChange={(e) => onChange('imageUrl', e.target.value)} placeholder="https://… paste image link here"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block font-medium">Caption <span className="text-gray-400">(optional)</span></label>
          <input value={post.caption} onChange={(e) => onChange('caption', e.target.value)} placeholder="Beautiful bridal necklace set…"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block font-medium">Post URL <span className="text-gray-400">(instagram.com/p/…)</span></label>
          <input type="url" value={post.postUrl} onChange={(e) => onChange('postUrl', e.target.value)} placeholder="https://instagram.com/p/…"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Category Images Panel ─────────────────────────── */
const CATEGORY_LIST = [
  { key: 'necklace',    label: 'Necklaces',   emoji: '📿' },
  { key: 'earrings',   label: 'Earrings',    emoji: '✨' },
  { key: 'bangles',    label: 'Bangles',     emoji: '🟡' },
  { key: 'maang-tikka', label: 'Maang Tikka', emoji: '👑' },
  { key: 'set',        label: 'Bridal Sets', emoji: '💍' },
  { key: 'rentals',    label: 'Rentals',     emoji: '🗓️' },
];

function CategoryImagesPanel({ images, onChange, shape, size, onShapeChange, onSizeChange }) {
  const fileRefs = useRef({});
  const [uploading, setUploading] = useState(null);

  async function handleUpload(key, file) {
    setUploading(key);
    try {
      const compressed = await compressImage(file);
      const fd = new FormData();
      fd.append('file', compressed);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.success) { onChange({ ...images, [key]: data.data.url }); toast.success('Photo uploaded!'); }
      else toast.error(data.message || 'Upload failed');
    } catch (e) { toast.error(e.message || 'Upload failed'); }
    finally { setUploading(null); }
  }

  function removeImage(key) { const u = { ...images }; delete u[key]; onChange(u); }

  const btnBase = 'px-3 py-1.5 text-xs font-semibold rounded-lg border transition';
  const btnActive = 'bg-amber-500 text-white border-amber-500';
  const btnInactive = 'bg-white text-gray-600 border-gray-200 hover:border-amber-300';

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="mb-4 pb-2 border-b border-gray-100">
        <h2 className="font-bold text-gray-800">Category Display</h2>
        <p className="text-xs text-gray-400 mt-0.5">Upload photos and control how categories look on the homepage.</p>
      </div>
      <div className="grid grid-cols-2 gap-4 mb-5 p-4 bg-stone-50 rounded-xl border border-gray-100">
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-2">Shape</p>
          <div className="flex gap-2">
            {['square', 'circle'].map((s) => (
              <button key={s} type="button" onClick={() => onShapeChange(s)}
                className={`${btnBase} ${shape === s ? btnActive : btnInactive} capitalize`}>
                {s === 'square' ? '⬜ Square' : '⭕ Circle'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-2">Size</p>
          <div className="flex gap-2 flex-wrap">
            {['small', 'medium', 'large'].map((s) => (
              <button key={s} type="button" onClick={() => onSizeChange(s)}
                className={`${btnBase} ${size === s ? btnActive : btnInactive} capitalize`}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {CATEGORY_LIST.map(({ key, label, emoji }) => (
          <div key={key} className="border border-gray-200 rounded-xl p-3 text-center flex flex-col">
            <div className={`aspect-square overflow-hidden bg-stone-50 mb-2 flex items-center justify-center border border-gray-100 ${shape === 'circle' ? 'rounded-full' : 'rounded-xl'}`}>
              {images[key] ? <img src={images[key]} alt={label} className="w-full h-full object-cover" /> : <span className="text-4xl">{emoji}</span>}
            </div>
            <p className="text-xs font-semibold text-gray-700 mb-2">{label}</p>
            <input type="file" accept="image/*" className="hidden" ref={(el) => { if (el) fileRefs.current[key] = el; }}
              onChange={(e) => e.target.files[0] && handleUpload(key, e.target.files[0])} />
            <div className="flex gap-1.5 mt-auto">
              <button type="button" onClick={() => fileRefs.current[key]?.click()} disabled={uploading === key}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 transition disabled:opacity-60">
                <FiUpload className="text-xs" />
                {uploading === key ? 'Uploading…' : images[key] ? 'Change' : 'Upload'}
              </button>
              {images[key] && (
                <button type="button" onClick={() => removeImage(key)}
                  className="px-2.5 py-1.5 bg-red-50 text-red-500 text-xs font-semibold rounded-lg hover:bg-red-100 transition">✕</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────── Test Email Panel ─────────────────────────── */
function TestEmailPanel() {
  const [testEmail, setTestEmail] = useState('');
  const [status, setStatus] = useState(null);

  async function runTest() {
    setStatus('loading');
    try {
      const res = await fetch('/api/admin/test-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testEmail }) });
      const data = await res.json();
      setStatus({ ok: data.success, msg: data.message });
    } catch (e) { setStatus({ ok: false, msg: e.message }); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <h2 className="font-bold text-gray-800 mb-1">Test Email Notifications</h2>
      <p className="text-xs text-gray-400 mb-4">Send a test mail to verify your SMTP setup is working</p>
      <div className="flex gap-3">
        <input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="Enter your email to receive test"
          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400" />
        <button type="button" onClick={runTest} disabled={status === 'loading'}
          className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 transition whitespace-nowrap">
          {status === 'loading' ? 'Sending…' : 'Send Test Email'}
        </button>
      </div>
      {status && status !== 'loading' && (
        <div className={`mt-3 px-4 py-3 rounded-lg text-sm font-medium ${status.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {status.ok ? '✅ ' : '❌ '}{status.msg}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Section card wrapper ─────────────────────────── */
function SectionCard({ title, description, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="mb-4 pb-2 border-b border-gray-100">
        <h2 className="font-bold text-gray-800">{title}</h2>
        {description && <p className="text-xs text-gray-400 mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/* ─────────────────────────── Field helpers ─────────────────────────── */
function Field({ label, children }) {
  return (
    <div>
      <label className="text-xs text-gray-500 mb-1 block font-medium">{label}</label>
      {children}
    </div>
  );
}

const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400';

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════════════════ */
const TABS = ['Business', 'Website', 'Marketing', 'Social & Email', 'Defaults'];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('Business');
  const [settings, setSettings] = useState({
    /* Business */
    businessName: 'Tulsi Bridal Jewellery',
    tagline: 'Premium Bridal Jewellery Rentals',
    phone: '+91 76958 68787',
    email: '',
    address: '',
    gstin: '',
    depositPercent: '30',
    minRentalDays: '1',
    deliveryCharge: '200',
    freeDeliveryAbove: '2000',
    whatsappNotify: '',
    emailNotify: '',
    loyaltyEnabled: false,
    referralEnabled: false,
    /* Website */
    bizOnline: true,
    openTime: '',
    closeTime: '',
    offlineNotes: '',
    bannerVideoUrl: '',
    bannerVideoCenterText: '',
    bannerVideoBottomText: '',
    showDisplayCounters: false,
    showCertificates: false,
    showTestimonials: true,
    showClientLogos: false,
    showVlogs: false,
    showBlogs: false,
    /* Social & Email */
    instagram: '',
    facebook: '',
    whatsapp: '',
    youtube: '',
    twitter: '',
    linkedin: '',
    emailFrom: '',
    emailFirstName: '',
    emailLastName: '',
    /* Defaults */
    retailPortalLoadingMs: 1000,
    productListLoadingMs: 500,
    searchThreshold: 0.2,
    phoneNumberLength: 10,
    pincodeLength: 6,
    maxCartItems: 20,
    loyaltyPointsPerRupee: 0.1,
    /* Category display */
    categoryShape: 'square',
    categorySize: 'large',
  });
  const [heroSlides, setHeroSlides] = useState([]);
  const [testimonials, setTestimonials] = useState([]);
  const [instagramFeed, setInstagramFeed] = useState([]);
  const [categoryImages, setCategoryImages] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.data) {
          setSettings((prev) => ({ ...prev, ...d.data }));
          if (Array.isArray(d.data.heroSlides)) setHeroSlides(d.data.heroSlides);
          if (Array.isArray(d.data.testimonials)) setTestimonials(d.data.testimonials);
          if (Array.isArray(d.data.instagramFeed)) setInstagramFeed(d.data.instagramFeed);
          if (d.data.categoryImages && typeof d.data.categoryImages === 'object') setCategoryImages(d.data.categoryImages);
        }
      })
      .catch(() => {});
  }, []);

  function upd(key, value) { setSettings((prev) => ({ ...prev, [key]: value })); }

  /* Hero slides */
  function addSlide() { setHeroSlides((p) => [...p, { ...BLANK_SLIDE, id: Date.now().toString() }]); }
  function updateSlide(i, field, val) { setHeroSlides((p) => p.map((s, idx) => idx === i ? { ...s, [field]: val } : s)); }
  function deleteSlide(i) { setHeroSlides((p) => p.filter((_, idx) => idx !== i)); }

  /* Testimonials */
  function addTestimonial() { setTestimonials((p) => [...p, { ...BLANK_TESTIMONIAL }]); }
  function updateTestimonial(i, field, val) { setTestimonials((p) => p.map((t, idx) => idx === i ? { ...t, [field]: val } : t)); }
  function deleteTestimonial(i) { setTestimonials((p) => p.filter((_, idx) => idx !== i)); }

  /* Instagram */
  function addInstaPost() {
    if (instagramFeed.length >= 6) { toast.error('Maximum 6 Instagram posts allowed'); return; }
    setInstagramFeed((p) => [...p, { ...BLANK_INSTA_POST }]);
  }
  function updateInstaPost(i, field, val) { setInstagramFeed((p) => p.map((post, idx) => idx === i ? { ...post, [field]: val } : post)); }
  function deleteInstaPost(i) { setInstagramFeed((p) => p.filter((_, idx) => idx !== i)); }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, heroSlides, testimonials, instagramFeed, categoryImages }),
      });
      const data = await res.json();
      if (data.success) toast.success('Settings saved!');
      else toast.error(data.message || 'Failed to save');
    } catch { toast.error('Network error'); }
    finally { setSaving(false); }
  }

  /* ── Tab content renderers ── */

  function renderBusiness() {
    return (
      <div className="space-y-5">
        <SectionCard title="Business Information" description="Your store name, contact info, and tax details">
          <div className="grid md:grid-cols-2 gap-4">
            {[
              { key: 'businessName', label: 'Business Name', placeholder: 'Tulsi Bridal Jewellery' },
              { key: 'tagline',      label: 'Tagline',        placeholder: 'Premium Bridal Jewellery Rentals' },
              { key: 'phone',        label: 'Phone / WhatsApp', placeholder: '+91 76958 68787' },
              { key: 'email',        label: 'Contact Email',  placeholder: 'info@tulsibridal.com' },
              { key: 'address',      label: 'Address',        placeholder: 'Your city, State' },
              { key: 'gstin',        label: 'GSTIN (optional)', placeholder: '22ABCDE1234F1Z5' },
            ].map(({ key, label, placeholder }) => (
              <Field key={key} label={label}>
                <input value={settings[key] || ''} onChange={(e) => upd(key, e.target.value)} placeholder={placeholder} className={inputCls} />
              </Field>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Rental Policy" description="Deposit and delivery settings for rentals">
          <div className="grid md:grid-cols-2 gap-4">
            {[
              { key: 'depositPercent',   label: 'Security Deposit (%)',    placeholder: '30' },
              { key: 'minRentalDays',    label: 'Minimum Rental Days',     placeholder: '1' },
              { key: 'deliveryCharge',   label: 'Delivery Charge (₹)',     placeholder: '200' },
              { key: 'freeDeliveryAbove', label: 'Free Delivery Above (₹)', placeholder: '2000' },
            ].map(({ key, label, placeholder }) => (
              <Field key={key} label={label}>
                <input type="number" value={settings[key] || ''} onChange={(e) => upd(key, e.target.value)} placeholder={placeholder} className={inputCls} />
              </Field>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Notifications" description="Where to send admin alerts">
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="WhatsApp for new orders">
              <input value={settings.whatsappNotify || ''} onChange={(e) => upd('whatsappNotify', e.target.value)} placeholder="+91 76958 68787" className={inputCls} />
            </Field>
            <Field label="Email for notifications">
              <input value={settings.emailNotify || ''} onChange={(e) => upd('emailNotify', e.target.value)} placeholder="admin@tulsibridal.com" className={inputCls} />
            </Field>
          </div>
        </SectionCard>

        {/* Marketing Features */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-bold text-gray-800 mb-1">Marketing Features</h2>
          <p className="text-xs text-gray-400 mb-5">Enable or disable customer loyalty and referral programs.</p>
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4 p-4 bg-amber-50 border border-amber-100 rounded-xl">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1"><span className="text-lg">🏆</span><p className="font-semibold text-gray-800 text-sm">Loyalty Points Program</p></div>
                <p className="text-xs text-gray-500 leading-relaxed">Customers earn 1 point per ₹100 spent. 50 points = ₹50 discount.</p>
                <div className="flex flex-wrap gap-3 mt-2 text-xs text-amber-700 font-medium">
                  <span className="bg-amber-100 px-2 py-0.5 rounded-full">₹100 = 1 point</span>
                  <span className="bg-amber-100 px-2 py-0.5 rounded-full">50 points = ₹50 off</span>
                </div>
              </div>
              <button type="button" onClick={() => upd('loyaltyEnabled', !settings.loyaltyEnabled)}
                className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none ${settings.loyaltyEnabled ? 'bg-amber-500' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${settings.loyaltyEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
              </button>
            </div>
            <div className="flex items-start justify-between gap-4 p-4 bg-purple-50 border border-purple-100 rounded-xl">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1"><span className="text-lg">🔁</span><p className="font-semibold text-gray-800 text-sm">Referral Program</p></div>
                <p className="text-xs text-gray-500 leading-relaxed">Each customer gets a unique referral code. Both earn 20 loyalty points.</p>
                <div className="flex flex-wrap gap-3 mt-2 text-xs text-purple-700 font-medium">
                  <span className="bg-purple-100 px-2 py-0.5 rounded-full">Referrer earns 20 pts</span>
                  <span className="bg-purple-100 px-2 py-0.5 rounded-full">New customer earns 20 pts</span>
                </div>
              </div>
              <button type="button" onClick={() => upd('referralEnabled', !settings.referralEnabled)}
                className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none ${settings.referralEnabled ? 'bg-amber-500' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${settings.referralEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
              </button>
            </div>
          </div>
        </div>

        <TestEmailPanel />
      </div>
    );
  }

  function renderWebsite() {
    return (
      <div className="space-y-5">
        <SectionCard title="Store Status" description="Control whether the store is online or in maintenance mode">
          <Toggle value={!!settings.bizOnline} onChange={(v) => upd('bizOnline', v)} label="Store Online?" description="When OFF, customers see maintenance/offline message" />
          <div className="grid md:grid-cols-2 gap-4 mt-4">
            <Field label="Open Time">
              <input value={settings.openTime || ''} onChange={(e) => upd('openTime', e.target.value)} placeholder="09:00 AM" className={inputCls} />
            </Field>
            <Field label="Close Time">
              <input value={settings.closeTime || ''} onChange={(e) => upd('closeTime', e.target.value)} placeholder="09:00 PM" className={inputCls} />
            </Field>
            <div className="md:col-span-2">
              <Field label="Offline Message (shown to customers)">
                <textarea value={settings.offlineNotes || ''} onChange={(e) => upd('offlineNotes', e.target.value)}
                  placeholder="We are currently closed. Please check back during our opening hours." rows={3}
                  className={`${inputCls} resize-none`} />
              </Field>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Banner Video" description="Video shown as the homepage background banner">
          <div className="space-y-4">
            <Field label="Banner Video URL (YouTube embed or direct mp4 link)">
              <input value={settings.bannerVideoUrl || ''} onChange={(e) => upd('bannerVideoUrl', e.target.value)}
                placeholder="https://www.youtube.com/embed/… or https://…/video.mp4" className={inputCls} />
            </Field>
            <Field label="Video Center Text">
              <input value={settings.bannerVideoCenterText || ''} onChange={(e) => upd('bannerVideoCenterText', e.target.value)}
                placeholder="Crafted for Your Perfect Day" className={inputCls} />
            </Field>
            <Field label="Video Bottom Text">
              <input value={settings.bannerVideoBottomText || ''} onChange={(e) => upd('bannerVideoBottomText', e.target.value)}
                placeholder="Explore our latest collection" className={inputCls} />
            </Field>
          </div>
        </SectionCard>

        <SectionCard title="Customer Portal Flags" description="Show or hide sections on the customer-facing website">
          <Toggle value={!!settings.showDisplayCounters} onChange={(v) => upd('showDisplayCounters', v)} label="Show Product View Counters" description="Display how many people viewed a product" />
          <Toggle value={!!settings.showCertificates}    onChange={(v) => upd('showCertificates', v)}    label="Show Certificates Section"   description="Display hallmark / quality certification badges" />
          <Toggle value={!!settings.showTestimonials}    onChange={(v) => upd('showTestimonials', v)}    label="Show Testimonials Section"   description="Customer review carousel on homepage" />
          <Toggle value={!!settings.showClientLogos}     onChange={(v) => upd('showClientLogos', v)}     label="Show Client Logos"           description="Logos of notable clients or press mentions" />
          <Toggle value={!!settings.showVlogs}           onChange={(v) => upd('showVlogs', v)}           label="Show Vlogs Section"          description="Behind-the-scenes / YouTube vlog section" />
          <Toggle value={!!settings.showBlogs}           onChange={(v) => upd('showBlogs', v)}           label="Show Blogs Section"          description="Blog articles shown on the website" />
        </SectionCard>
      </div>
    );
  }

  function renderMarketing() {
    return (
      <div className="space-y-5">
        {/* Hero Slides */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-100">
            <div>
              <h2 className="font-bold text-gray-800">Homepage Hero Banners</h2>
              <p className="text-xs text-gray-400 mt-0.5">Full-screen model images shown on the homepage slider</p>
            </div>
            <button type="button" onClick={addSlide}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 transition">
              <FiPlus /> Add Slide
            </button>
          </div>
          {heroSlides.length === 0 ? (
            <div className="text-center py-10 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
              <FiImage className="text-3xl mx-auto mb-2 opacity-40" />
              <p className="text-sm font-medium">No hero slides yet</p>
              <p className="text-xs mt-1">Click "Add Slide" to add your first model banner image</p>
              <button type="button" onClick={addSlide} className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 transition">
                <FiPlus /> Add First Slide
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {heroSlides.map((slide, i) => (
                <SlideRow key={slide.id || i} slide={slide} index={i} onChange={(field, val) => updateSlide(i, field, val)} onDelete={() => deleteSlide(i)} />
              ))}
              <button type="button" onClick={addSlide}
                className="w-full py-3 border-2 border-dashed border-gray-200 text-sm text-gray-500 hover:border-amber-400 hover:text-amber-600 rounded-xl flex items-center justify-center gap-2 transition">
                <FiPlus /> Add Another Slide
              </button>
            </div>
          )}
        </div>

        {/* Category Photos */}
        <CategoryImagesPanel images={categoryImages} onChange={setCategoryImages}
          shape={settings.categoryShape || 'square'} size={settings.categorySize || 'large'}
          onShapeChange={(v) => upd('categoryShape', v)} onSizeChange={(v) => upd('categorySize', v)} />

        {/* Testimonials */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-100">
            <div>
              <h2 className="font-bold text-gray-800">Happy Customers (Testimonials)</h2>
              <p className="text-xs text-gray-400 mt-0.5">Customer reviews shown in the "Happy Customers" section on the homepage</p>
            </div>
            <button type="button" onClick={addTestimonial}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 transition">
              <FiPlus /> Add Review
            </button>
          </div>
          {testimonials.length === 0 ? (
            <div className="text-center py-10 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
              <p className="text-sm font-medium">No testimonials configured</p>
              <p className="text-xs mt-1">Default reviews will be shown until you add custom ones here</p>
              <button type="button" onClick={addTestimonial} className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 transition">
                <FiPlus /> Add First Review
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {testimonials.map((t, i) => (
                <TestimonialRow key={i} testimonial={t} index={i} onChange={(field, val) => updateTestimonial(i, field, val)} onDelete={() => deleteTestimonial(i)} />
              ))}
              <button type="button" onClick={addTestimonial}
                className="w-full py-3 border-2 border-dashed border-gray-200 text-sm text-gray-500 hover:border-amber-400 hover:text-amber-600 rounded-xl flex items-center justify-center gap-2 transition">
                <FiPlus /> Add Another Review
              </button>
            </div>
          )}
        </div>

        {/* Instagram Feed */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-100">
            <div>
              <h2 className="font-bold text-gray-800">Instagram Feed</h2>
              <p className="text-xs text-gray-400 mt-0.5">Up to 6 posts shown in the Instagram grid on the homepage</p>
            </div>
            <button type="button" onClick={addInstaPost} disabled={instagramFeed.length >= 6}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition">
              <FiPlus /> Add Post
            </button>
          </div>
          {instagramFeed.length === 0 ? (
            <div className="text-center py-10 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
              <FiImage className="text-3xl mx-auto mb-2 opacity-40" />
              <p className="text-sm font-medium">No Instagram posts configured</p>
              <button type="button" onClick={addInstaPost} className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 transition">
                <FiPlus /> Add First Post
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {instagramFeed.map((post, i) => (
                <InstaPostRow key={i} post={post} index={i} onChange={(field, val) => updateInstaPost(i, field, val)} onDelete={() => deleteInstaPost(i)} />
              ))}
              {instagramFeed.length < 6 && (
                <button type="button" onClick={addInstaPost}
                  className="w-full py-3 border-2 border-dashed border-gray-200 text-sm text-gray-500 hover:border-amber-400 hover:text-amber-600 rounded-xl flex items-center justify-center gap-2 transition">
                  <FiPlus /> Add Another Post ({instagramFeed.length}/6)
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderSocialEmail() {
    return (
      <div className="space-y-5">
        <SectionCard title="Social Media" description="Links displayed on the website and in emails">
          <div className="grid md:grid-cols-2 gap-4">
            {[
              { key: 'instagram', label: 'Instagram URL',    placeholder: 'https://instagram.com/yourpage' },
              { key: 'facebook',  label: 'Facebook URL',     placeholder: 'https://facebook.com/yourpage' },
              { key: 'whatsapp',  label: 'WhatsApp Number',  placeholder: '917695868787' },
              { key: 'youtube',   label: 'YouTube URL',      placeholder: 'https://youtube.com/…' },
              { key: 'twitter',   label: 'Twitter / X URL',  placeholder: 'https://x.com/yourpage' },
              { key: 'linkedin',  label: 'LinkedIn URL',     placeholder: 'https://linkedin.com/company/yourpage' },
            ].map(({ key, label, placeholder }) => (
              <Field key={key} label={label}>
                <input value={settings[key] || ''} onChange={(e) => upd(key, e.target.value)} placeholder={placeholder} className={inputCls} />
              </Field>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Email Configuration" description="Sender details for transactional emails">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Field label="From Email Address">
                <input value={settings.emailFrom || ''} onChange={(e) => upd('emailFrom', e.target.value)} placeholder="support@tulsibridal.com" className={inputCls} />
              </Field>
            </div>
            <Field label="Sender First Name">
              <input value={settings.emailFirstName || ''} onChange={(e) => upd('emailFirstName', e.target.value)} placeholder="Tulsi" className={inputCls} />
            </Field>
            <Field label="Sender Last Name">
              <input value={settings.emailLastName || ''} onChange={(e) => upd('emailLastName', e.target.value)} placeholder="Bridal Jewellery" className={inputCls} />
            </Field>
          </div>
        </SectionCard>

        <TestEmailPanel />
      </div>
    );
  }

  function renderDefaults() {
    return (
      <div className="space-y-5">
        <SectionCard title="Pages Loading Time" description="Loading delays for smoother UX transitions (in milliseconds)">
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Retail Portal Loading Time (ms)">
              <input type="number" value={settings.retailPortalLoadingMs ?? 1000} onChange={(e) => upd('retailPortalLoadingMs', Number(e.target.value))} placeholder="1000" className={inputCls} />
            </Field>
            <Field label="Product List Loading Time (ms)">
              <input type="number" value={settings.productListLoadingMs ?? 500} onChange={(e) => upd('productListLoadingMs', Number(e.target.value))} placeholder="500" className={inputCls} />
            </Field>
            <Field label="Search Threshold (Fuse.js)">
              <input type="number" step="0.01" min="0" max="1" value={settings.searchThreshold ?? 0.2} onChange={(e) => upd('searchThreshold', Number(e.target.value))} placeholder="0.2" className={inputCls} />
            </Field>
          </div>
          <p className="text-xs text-gray-400 mt-3">Lower search threshold = stricter matching. Range: 0.0 (exact) to 1.0 (very fuzzy)</p>
        </SectionCard>

        <SectionCard title="Defaults & Limits" description="System-wide default values and validations">
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Phone Number Length">
              <input type="number" value={settings.phoneNumberLength ?? 10} onChange={(e) => upd('phoneNumberLength', Number(e.target.value))} placeholder="10" className={inputCls} />
            </Field>
            <Field label="Pincode / ZIP Length">
              <input type="number" value={settings.pincodeLength ?? 6} onChange={(e) => upd('pincodeLength', Number(e.target.value))} placeholder="6" className={inputCls} />
            </Field>
            <Field label="Max Cart Items">
              <input type="number" value={settings.maxCartItems ?? 20} onChange={(e) => upd('maxCartItems', Number(e.target.value))} placeholder="20" className={inputCls} />
            </Field>
            <Field label="Loyalty Points per ₹1 Spent">
              <input type="number" step="0.1" value={settings.loyaltyPointsPerRupee ?? 0.1} onChange={(e) => upd('loyaltyPointsPerRupee', Number(e.target.value))} placeholder="0.1" className={inputCls} />
            </Field>
          </div>
        </SectionCard>
      </div>
    );
  }

  const TAB_CONTENT = {
    Business:      renderBusiness,
    Website:       renderWebsite,
    Marketing:     renderMarketing,
    'Social & Email': renderSocialEmail,
    Defaults:      renderDefaults,
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><FiSettings /> Admin Settings</h1>
          <p className="text-gray-500 text-sm mt-0.5">Configure your business details and homepage</p>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 text-white font-bold rounded-xl hover:bg-amber-600 disabled:opacity-60 transition shadow-sm"
        >
          <FiSave /> {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-white border border-gray-100 rounded-xl p-1 shadow-sm overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
              activeTab === tab
                ? 'bg-amber-500 text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <form onSubmit={save}>
        {TAB_CONTENT[activeTab]?.()}
      </form>
    </div>
  );
}
