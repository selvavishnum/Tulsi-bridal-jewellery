'use client';
import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { FiUploadCloud, FiX, FiArrowLeft, FiArrowRight } from 'react-icons/fi';
import toast from 'react-hot-toast';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { cldThumb } from '@/lib/cloudinaryImage';
import { PRODUCT_CATEGORIES, PRODUCT_MATERIALS } from '@/lib/vendorCatalog';
import { sendJson, inr } from '@/components/vendor/ui';

const field = 'w-full px-3 py-2.5 border border-stone-300 rounded-xl text-sm bg-white outline-none focus:border-wine-700 focus:ring-2 focus:ring-wine-700/15';
const label = (s) => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const BLANK = {
  name: '', sku: '', category: 'necklace', material: '', description: '', images: [],
  price: '', discountPrice: '', shippingCharge: '', stock: '0', weight: '', color: '', occasion: '',
};

function Field({ label: text, hint, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-stone-600 mb-1">{text}</span>
      {children}
      {hint && <span className="block text-xs text-stone-400 mt-1">{hint}</span>}
    </label>
  );
}

/* Add / edit one of the vendor's own products. Sends only the fields a
   vendor may write (see VENDOR_EDITABLE_FIELDS) — the API refuses others. */
export default function ProductForm({ product }) {
  const router = useRouter();
  const editing = !!product;
  const [form, setForm] = useState(() => (product
    ? { ...BLANK, ...product, price: String(product.price || ''), discountPrice: product.discountPrice ? String(product.discountPrice) : '', stock: String(product.stock ?? 0), shippingCharge: product.shippingCharge === null || product.shippingCharge === undefined ? '' : String(product.shippingCharge) }
    : BLANK));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(0);
  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const price = Number(form.price) || 0;
  const offer = Number(form.discountPrice) || 0;
  const offerPct = price > 0 && offer > 0 && offer < price ? Math.round((1 - offer / price) * 100) : 0;

  async function uploadFiles(files) {
    const list = [...files].slice(0, 8 - form.images.length);
    setUploading((n) => n + list.length);
    for (const file of list) {
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/vendor/upload', { method: 'POST', body: fd });
        const d = await res.json();
        if (!d.success) throw new Error(d.message);
        setForm((f) => ({ ...f, images: [...f.images, d.data.url] }));
      } catch (e) {
        toast.error(`${file.name}: ${e.message || 'upload failed'}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  const moveImage = (i, dir) => setForm((f) => {
    const images = [...f.images];
    const j = i + dir;
    if (j < 0 || j >= images.length) return f;
    [images[i], images[j]] = [images[j], images[i]];
    return { ...f, images };
  });

  async function onSubmit(e) {
    e.preventDefault();
    if (offer > 0 && offer >= price) { toast.error('Offer price must be lower than the retail price.'); return; }
    setSaving(true);
    const body = {
      name: form.name, sku: form.sku.trim(), category: form.category, material: form.material,
      description: form.description, images: form.images,
      price: Number(form.price), discountPrice: form.discountPrice === '' ? 0 : Number(form.discountPrice),
      shippingCharge: form.shippingCharge === '' ? null : Number(form.shippingCharge),
      stock: Number(form.stock), weight: form.weight, color: form.color, occasion: form.occasion,
    };
    if (!editing && !body.sku) delete body.sku;
    try {
      await sendJson(editing ? `/api/vendor/products/${product.id}` : '/api/vendor/products', editing ? 'PUT' : 'POST', body);
      toast.success(editing ? 'Saved' : 'Submitted — Tulsi will review it and put it live');
      router.push('/vendor/products');
      router.refresh();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 max-w-3xl">
      <section className="bg-white rounded-xl border border-stone-200 p-4 sm:p-5 space-y-4">
        <h2 className="font-semibold text-stone-800">Details</h2>
        <Field label="Title *">
          <input required maxLength={120} value={form.name} onChange={(e) => upd('name', e.target.value)} className={field} placeholder="e.g. Temple Lakshmi haaram" />
        </Field>
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Category *">
            <select value={form.category} onChange={(e) => upd('category', e.target.value)} className={field}>
              {PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
            </select>
          </Field>
          <Field label="Material">
            <select value={form.material} onChange={(e) => upd('material', e.target.value)} className={field}>
              <option value="">—</option>
              {PRODUCT_MATERIALS.map((m) => <option key={m} value={m}>{label(m)}</option>)}
            </select>
          </Field>
          <Field label="SKU" hint={editing ? undefined : 'Leave blank to generate one'}>
            <input maxLength={40} value={form.sku} onChange={(e) => upd('sku', e.target.value)} className={`${field} font-mono`} placeholder="TL-NK-001" />
          </Field>
        </div>
        <Field label="Description">
          <textarea rows={5} maxLength={5000} value={form.description} onChange={(e) => upd('description', e.target.value)} className={field} placeholder="Design, stones, finish, what's in the set…" />
        </Field>
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Weight"><input maxLength={40} value={form.weight} onChange={(e) => upd('weight', e.target.value)} className={field} placeholder="45 g" /></Field>
          <Field label="Colour"><input maxLength={40} value={form.color} onChange={(e) => upd('color', e.target.value)} className={field} placeholder="Ruby red" /></Field>
          <Field label="Occasion"><input maxLength={60} value={form.occasion} onChange={(e) => upd('occasion', e.target.value)} className={field} placeholder="Wedding" /></Field>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-stone-200 p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-stone-800">Photos</h2>
          <span className="text-xs text-stone-400">{form.images.length}/8 · first photo is the cover</span>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {form.images.map((url, i) => (
            <div key={url} className="relative aspect-square rounded-lg overflow-hidden bg-stone-100 border border-stone-200">
              <Image src={cldThumb(url, 300)} alt={`Photo ${i + 1}`} fill unoptimized className="object-cover" />
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/45 text-white">
                <button type="button" aria-label="Move left" onClick={() => moveImage(i, -1)} className="p-1.5 disabled:opacity-30" disabled={i === 0}><FiArrowLeft /></button>
                <button type="button" aria-label="Remove photo" onClick={() => upd('images', form.images.filter((u) => u !== url))} className="p-1.5"><FiX /></button>
                <button type="button" aria-label="Move right" onClick={() => moveImage(i, 1)} className="p-1.5 disabled:opacity-30" disabled={i === form.images.length - 1}><FiArrowRight /></button>
              </div>
            </div>
          ))}
          {form.images.length + uploading < 8 && (
            <label className="aspect-square rounded-lg border-2 border-dashed border-stone-300 hover:border-wine-700 flex flex-col items-center justify-center gap-1 text-stone-500 cursor-pointer text-xs text-center p-2">
              {uploading ? <LoadingSpinner size="sm" /> : <FiUploadCloud className="text-2xl" />}
              {uploading ? 'Uploading…' : 'Add photos'}
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only"
                onChange={(e) => { uploadFiles(e.target.files); e.target.value = ''; }} />
            </label>
          )}
        </div>
        <p className="text-xs text-stone-400">High-resolution JPG, PNG or WebP, up to 8 MB each. Plain backgrounds sell best.</p>
      </section>

      <section className="bg-white rounded-xl border border-stone-200 p-4 sm:p-5 space-y-4">
        <h2 className="font-semibold text-stone-800">Price and stock</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Field label="Retail price (₹) *">
            <input required type="number" min="1" step="0.01" inputMode="decimal" value={form.price} onChange={(e) => upd('price', e.target.value)} className={`${field} tabular-nums`} />
          </Field>
          <Field label="Offer price (₹)" hint={offerPct ? `${offerPct}% off — customers pay ${inr(offer)}` : 'Leave blank for no offer'}>
            <input type="number" min="0" step="0.01" inputMode="decimal" value={form.discountPrice} onChange={(e) => upd('discountPrice', e.target.value)} className={`${field} tabular-nums`} />
          </Field>
          <Field label="Your shipping charge (₹ per piece)" hint="Deducted from your payout. Blank = actual courier cost.">
            <input type="number" min="0" step="0.01" inputMode="decimal" value={form.shippingCharge} onChange={(e) => upd('shippingCharge', e.target.value)} className={`${field} tabular-nums`} />
          </Field>
          <Field label="Stock quantity">
            <input type="number" min="0" step="1" inputMode="numeric" value={form.stock} onChange={(e) => upd('stock', e.target.value)} className={`${field} tabular-nums`} />
          </Field>
        </div>
        {!editing && <p className="text-xs text-stone-500">New products go live after Tulsi reviews them.</p>}
      </section>

      <div className="flex gap-3">
        <button disabled={saving || uploading > 0} className="px-5 py-2.5 rounded-xl bg-wine-700 hover:bg-wine-800 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
          {saving && <LoadingSpinner size="sm" />} {editing ? 'Save changes' : 'Submit for review'}
        </button>
        <button type="button" onClick={() => router.push('/vendor/products')} className="px-5 py-2.5 rounded-xl border border-stone-300 text-sm font-semibold text-stone-600">Cancel</button>
      </div>
    </form>
  );
}
