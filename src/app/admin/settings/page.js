'use client';
import { useState, useEffect } from 'react';
import { FiSettings, FiSave } from 'react-icons/fi';
import toast from 'react-hot-toast';
import CategoryShowcaseManager from '@/components/admin/showcase/CategoryShowcaseManager';
import AnnouncementSettingsPanel from '@/components/admin/AnnouncementSettingsPanel';
import CollapsibleSection from '@/components/admin/marketing/CollapsibleSection';
import { HeroPhotosPanel, TestimonialsPanel, InstagramPanel } from '@/components/admin/marketing/MarketingPanels';
import AdvertisementsManager from '@/components/admin/marketing/AdvertisementsManager';
import { normalizeHeroSlides, normalizeTestimonialItems, normalizeInstagramItems, normalizeAdvertisements, normalizeLayout, visible } from '@/lib/marketing';
import DeliveryMessagePanel from '@/components/admin/DeliveryMessagePanel';
import { useCart } from '@/context/CartContext';

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

/* ─────────────── Shipping & Payment Charges (own save) ───────────────
   Stored in settings/store_settings; the server reads it for every order
   and open checkouts pick changes up within a minute. */
function ChargesCard() {
  /* The Delivery Message card (Marketing tab) checks the message against the shop's shipping rule
     as the storefront's cart holds it: refresh that copy after a save so the card never judges by the old rule. */
  const { refreshCharges } = useCart();
  const [c, setC] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  useEffect(() => {
    fetch('/api/admin/store-charges', { cache: 'no-store' }).then((r) => r.json())
      .then((d) => (d.success ? setC({ ...d.data, cod_fee_waive_above: d.data.cod_fee_waive_above ?? '' }) : toast.error(d.message || 'Could not load charges')))
      .catch(() => toast.error('Could not load charges'));
  }, []);
  if (!c) return <SectionCard title="Shipping & Payment Charges" description="Loading…"><div className="h-10" /></SectionCard>;
  const set = (k, v) => { setC((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); };

  function validate() {
    const e = {};
    const need = (k, label, required) => {
      const v = c[k];
      if (v === '' || v === null || v === undefined) { if (required) e[k] = `${label} is required`; return; }
      if (!Number.isFinite(Number(v))) e[k] = 'Enter a number';
      else if (Number(v) < 0) e[k] = 'Can’t be negative';
    };
    need('shipping_fee_amount', 'Shipping amount', c.enable_shipping_fee);
    need('free_shipping_threshold', 'Threshold', false);
    need('cod_fee_amount', 'COD fee', c.enable_cod_fee);
    need('cod_fee_waive_above', 'Amount', false);
    if (c.enable_shipping_fee && Number(c.shipping_fee_amount) === 0) e.shipping_fee_amount = 'Switch shipping off instead of ₹0';
    if (c.enable_cod_fee && Number(c.cod_fee_amount) === 0) e.cod_fee_amount = 'Switch the COD fee off instead of ₹0';
    setErrors(e);
    return !Object.values(e).some(Boolean);
  }

  async function save() {
    if (!validate()) { toast.error('Fix the highlighted fields'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/store-charges', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enable_shipping_fee: !!c.enable_shipping_fee,
          shipping_fee_amount: Number(c.shipping_fee_amount) || 0,
          free_shipping_threshold: c.free_shipping_threshold === '' ? 0 : Number(c.free_shipping_threshold),
          enable_cod_fee: !!c.enable_cod_fee,
          cod_fee_amount: Number(c.cod_fee_amount) || 0,
          cod_fee_waive_above: c.cod_fee_waive_above === '' ? null : Number(c.cod_fee_waive_above),
        }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.message);
      setC({ ...d.data, cod_fee_waive_above: d.data.cod_fee_waive_above ?? '' });
      refreshCharges?.();
      toast.success('Charges saved — applies to new orders now');
    } catch (err) {
      toast.error(err.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const money = (k, label, hint, disabled) => (
    <Field label={label}>
      <input id={`charges-${k}`} type="number" min="0" step="1" inputMode="decimal" disabled={disabled} value={c[k] ?? ''}
        onChange={(e) => set(k, e.target.value)} aria-invalid={!!errors[k]}
        className={`${inputCls} ${disabled ? 'opacity-50' : ''} ${errors[k] ? 'border-red-400 focus:ring-red-300' : ''}`} />
      {errors[k] ? <p className="text-xs text-red-600 mt-1">{errors[k]}</p> : hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </Field>
  );

  return (
    <SectionCard title="Shipping & Payment Charges" description="What customers pay on top of their items. Checked again on the server for every order.">
      <Toggle value={!!c.enable_shipping_fee} onChange={(v) => set('enable_shipping_fee', v)} label="Enable Shipping Fee" description="Off = shipping included in product prices — customers see no shipping charge or shipping line anywhere" />
      <div className="grid md:grid-cols-2 gap-4 py-3">
        {money('shipping_fee_amount', 'Standard Shipping Amount (₹)', null, !c.enable_shipping_fee)}
        {money('free_shipping_threshold', 'Free Shipping Above Order Value (₹)', '0 = never free', !c.enable_shipping_fee)}
      </div>
      <Toggle value={!!c.enable_cod_fee} onChange={(v) => set('enable_cod_fee', v)} label="Enable COD Additional Fee" description="Added only when the customer chooses Cash on Delivery" />
      <div className="grid md:grid-cols-2 gap-4 py-3">
        {money('cod_fee_amount', 'COD Handling Fee (₹)', null, !c.enable_cod_fee)}
        {money('cod_fee_waive_above', 'No COD Fee on Orders Above (₹)', 'Blank = charge on every COD order', !c.enable_cod_fee)}
      </div>
      <div className="flex items-center justify-between gap-3 pt-2">
        <p className="text-xs text-gray-400">{c.updatedAt ? `Last changed ${new Date(c.updatedAt).toLocaleString('en-IN')}` : 'Using default charges'}</p>
        <button type="button" onClick={save} disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
          <FiSave /> {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>
    </SectionCard>
  );
}

const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400';

/* The homepage category showcase saves through its own endpoint (instant
   per-card changes), and the fields it replaced are retired: the global
   Save never sends any of them, so it can't undo a showcase change. */
const SHOWCASE_FIELDS = ['categoryShowcase', 'categoryImages', 'categoryShape', 'categorySize'];
const withoutShowcase = (s) => Object.fromEntries(Object.entries(s).filter(([k]) => !SHOWCASE_FIELDS.includes(k)));

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════════════════ */
const TABS = ['Business', 'Website', 'Marketing', 'Social & Email', 'Defaults'];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('Business');
  const [settings, setSettings] = useState({
    /* Business */
    businessName: 'Tulsi Fashion Jewellery',
    tagline: 'Modern Fashion Jewellery',
    phone: '+91 76958 68787',
    email: '',
    address: '',
    gstin: '',
    depositPercent: '30',
    minRentalDays: '1',
    deliveryCharge: '200',
    whatsappNotify: '',
    emailNotify: '',
    loyaltyEnabled: false,
    referralEnabled: false,
    onlinePaymentEnabled: true,
    codPincodeCheckEnabled: true,
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
  });
  const [heroSlides, setHeroSlides] = useState([]);
  const [heroLayout, setHeroLayout] = useState(() => normalizeLayout(null, 'hero'));
  const [testimonials, setTestimonials] = useState([]);
  const [testimonialsLayout, setTestimonialsLayout] = useState(() => normalizeLayout(null, 'testimonials'));
  const [instagramFeed, setInstagramFeed] = useState([]);
  const [instagramLayout, setInstagramLayout] = useState(() => normalizeLayout(null, 'instagram'));
  const [advertisements, setAdvertisements] = useState(() => normalizeAdvertisements(null));
  /* What the server has (JSON per section), to show which sections have unsaved changes. */
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.data) {
          setSettings((prev) => ({ ...prev, ...d.data }));
          const loaded = {
            heroSlides: normalizeHeroSlides(d.data.heroSlides),
            heroLayout: normalizeLayout(d.data.heroLayout, 'hero'),
            testimonials: normalizeTestimonialItems(d.data.testimonials),
            testimonialsLayout: normalizeLayout(d.data.testimonialsLayout, 'testimonials'),
            instagramFeed: normalizeInstagramItems(d.data.instagramFeed),
            instagramLayout: normalizeLayout(d.data.instagramLayout, 'instagram'),
            advertisements: normalizeAdvertisements(d.data.advertisements),
          };
          setHeroSlides(loaded.heroSlides);
          setHeroLayout(loaded.heroLayout);
          setTestimonials(loaded.testimonials);
          setTestimonialsLayout(loaded.testimonialsLayout);
          setInstagramFeed(loaded.instagramFeed);
          setInstagramLayout(loaded.instagramLayout);
          setAdvertisements(loaded.advertisements);
          setSaved(Object.fromEntries(Object.entries(loaded).map(([k, v]) => [k, JSON.stringify(v)])));
        }
      })
      .catch(() => {});
  }, []);

  function upd(key, value) { setSettings((prev) => ({ ...prev, [key]: value })); }

  /* The Marketing sections kept in this page's state (saved by Save Settings). */
  const marketingDraft = { heroSlides, heroLayout, testimonials, testimonialsLayout, instagramFeed, instagramLayout, advertisements };
  const dirty = (...keys) => !!saved && keys.some((k) => JSON.stringify(marketingDraft[k]) !== saved[k]);
  const shownOf = (items, section) => visible(items, section).length;




  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...withoutShowcase(settings), ...marketingDraft }),
      });
      const data = await res.json();
      if (data.success) {
        setSaved(Object.fromEntries(Object.entries(marketingDraft).map(([k, v]) => [k, JSON.stringify(v)])));
        toast.success('Settings saved!');
      }
      else toast.error(data.message || 'Failed to save');
    } catch { toast.error('Network error'); }
    finally { setSaving(false); }
  }

  /* ── Tab content renderers ── */

  function renderBusiness() {
    return (
      <div className="space-y-5">
        <ChargesCard />
        <SectionCard title="Business Information" description="Your store name, contact info, and tax details">
          <div className="grid md:grid-cols-2 gap-4">
            {[
              { key: 'businessName', label: 'Business Name', placeholder: 'Tulsi Fashion Jewellery' },
              { key: 'tagline',      label: 'Tagline',        placeholder: 'Modern Fashion Jewellery' },
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

        <SectionCard title="Store Location for Google & AI Search" description="Used in the store's structured data (JewelryStore). Leave blank what you don't want published — nothing is guessed.">
          <div className="grid md:grid-cols-2 gap-4">
            {[
              { key: 'legalName',       label: 'Registered / Legal Name', placeholder: 'Tulsi Fashion Jewellery' },
              { key: 'priceRange',      label: 'Price Range',             placeholder: '₹500 – ₹25,000' },
              { key: 'streetAddress',   label: 'Street Address',          placeholder: 'Shop no., street' },
              { key: 'addressLocality', label: 'City / Town',             placeholder: 'Thuckalay' },
              { key: 'addressRegion',   label: 'State',                   placeholder: 'Tamil Nadu' },
              { key: 'postalCode',      label: 'Pincode',                 placeholder: '629175' },
              { key: 'geoLat',          label: 'Latitude',                placeholder: 'e.g. 8.2447 (Google Maps → right-click)' },
              { key: 'geoLng',          label: 'Longitude',               placeholder: 'e.g. 77.3040' },
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

        {/* Payment Settings */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-bold text-gray-800 mb-1">Payment Settings</h2>
          <p className="text-xs text-gray-400 mb-5">Control which payment methods customers can choose at checkout.</p>
          <div className="flex items-start justify-between gap-4 p-4 bg-blue-50 border border-blue-100 rounded-xl">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1"><span className="text-lg">💳</span><p className="font-semibold text-gray-800 text-sm">Online Payment (Razorpay)</p></div>
              <p className="text-xs text-gray-500 leading-relaxed">
                When OFF, "Pay Online" is hidden at checkout and shows as "Coming Soon" — customers can only pay Cash on Delivery. Turn this back on once your Razorpay account is approved for live payments.
              </p>
            </div>
            <button type="button" onClick={() => upd('onlinePaymentEnabled', !settings.onlinePaymentEnabled)}
              className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none ${settings.onlinePaymentEnabled ? 'bg-amber-500' : 'bg-gray-300'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${settings.onlinePaymentEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
            </button>
          </div>

          <div className="flex items-start justify-between gap-4 p-4 bg-purple-50 border border-purple-100 rounded-xl mt-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1"><span className="text-lg">📍</span><p className="font-semibold text-gray-800 text-sm">COD Pincode Availability Check</p></div>
              <p className="text-xs text-gray-500 leading-relaxed">
                When ON, Cash on Delivery is only offered where Shiprocket reports a COD-capable courier. If your Shiprocket pickup address isn't fully set up yet, this can block COD everywhere — turn it OFF to offer COD to every pincode until that's sorted out.
              </p>
            </div>
            <button type="button" onClick={() => upd('codPincodeCheckEnabled', !settings.codPincodeCheckEnabled)}
              className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none ${settings.codPincodeCheckEnabled ? 'bg-amber-500' : 'bg-gray-300'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${settings.codPincodeCheckEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>

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
        {/* Welcome offer strip at the top of every storefront page (saved with Save Settings) */}
        <CollapsibleSection title="Welcome Offer Bar" status={settings.announcement?.enabled === false ? 'Off' : 'On'}>
          <AnnouncementSettingsPanel value={settings.announcement} onChange={(a) => upd('announcement', a)} phone={settings.phone} deliveryMessage={settings.deliveryMessage} />
        </CollapsibleSection>

        {/* The "Free Delivery across India" line: on/off, words, font, model, colours (saved with Save Settings) */}
        <CollapsibleSection title="Delivery Message" status={settings.deliveryMessage?.enabled === false ? 'Off' : 'On'}>
          <DeliveryMessagePanel value={settings.deliveryMessage} onChange={(d) => upd('deliveryMessage', d)} />
        </CollapsibleSection>

        {/* Hero photos (shape, slider, preview, crop — saved with Save Settings) */}
        <CollapsibleSection title="Homepage Hero Photo" dirty={dirty('heroSlides', 'heroLayout')}
          status={`${shownOf(heroSlides, 'hero')} of ${heroSlides.length} shown · ${heroLayout.displayMode === 'slider' ? 'Slider' : 'Single photo'}`}>
          <HeroPhotosPanel items={heroSlides} onItemsChange={setHeroSlides} layout={heroLayout} onLayoutChange={setHeroLayout} />
        </CollapsibleSection>

        {/* Category Showcase — saves on its own (/api/admin/category-showcase) */}
        <CollapsibleSection title="Category Showcase" status="Saves instantly">
          <CategoryShowcaseManager />
        </CollapsibleSection>

        {/* Testimonials (shape, grid / slider, preview, crop — saved with Save Settings) */}
        <CollapsibleSection title="Happy Customers (Testimonials)" dirty={dirty('testimonials', 'testimonialsLayout')}
          status={`${shownOf(testimonials, 'testimonials')} of ${testimonials.length} shown`}>
          <TestimonialsPanel items={testimonials} onItemsChange={setTestimonials} layout={testimonialsLayout} onLayoutChange={setTestimonialsLayout} />
        </CollapsibleSection>

        {/* Instagram feed (shape, grid / slider, preview, crop — saved with Save Settings) */}
        <CollapsibleSection title="Instagram Feed" dirty={dirty('instagramFeed', 'instagramLayout')}
          status={`${shownOf(instagramFeed, 'instagram')} of ${instagramFeed.length} shown`}>
          <InstagramPanel items={instagramFeed} onItemsChange={setInstagramFeed} layout={instagramLayout} onLayoutChange={setInstagramLayout} />
        </CollapsibleSection>

        {/* Website advertisements: banners on the home, shop, category, product, cart, checkout and order pages (saved with Save Settings) */}
        <CollapsibleSection title="Website Advertisements" dirty={dirty('advertisements')}
          status={`${shownOf(advertisements.items, 'ads')} of ${advertisements.items.length} shown`}>
          <AdvertisementsManager value={advertisements} onChange={setAdvertisements} />
        </CollapsibleSection>
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
              <input value={settings.emailLastName || ''} onChange={(e) => upd('emailLastName', e.target.value)} placeholder="Fashion Jewellery" className={inputCls} />
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
