'use client';
/* Quick Add Product — add a new piece to stock in under a minute without
   leaving the Inventory table.

   Bottom sheet on phones, centred dialog on desktop. Images upload
   straight from the browser to Cloudinary while you type (shown with
   f_auto,q_auto:best thumbnails). "Save & Add Another" keeps the
   category and design type for batch entry.

   Props:
     open, onClose
     mode             — 'admin' (Inventory screen) or 'vendor' (Vendor Portal:
                        no purchase cost, own shipping charge, photos through
                        /api/vendor/upload, saved for Tulsi's review)
     categories       — slugs offered under "More…"
     pricing          — may set prices / purchase cost (Super Admin, Business Manager)
     onOptimistic(p)  — a pending row to show immediately
     onSaved(tempId, product) / onFailed(tempId)  — swap it for the real one / drop it */
import { useEffect, useId, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { FiX, FiImage, FiRefreshCw, FiZap } from 'react-icons/fi';
import { uploadToCloudinary } from '@/lib/cloudinaryUpload';
import { cldThumb } from '@/lib/cloudinaryImage';
import {
  QUICK_CATEGORIES, ALL_CATEGORIES, DESIGN_TYPES, MAX_IMAGES,
  generateSku, discountPercent, parseQuickAdd,
} from '@/lib/quickAddProduct';

const blank = (keep = {}) => ({
  name: '', category: keep.category || 'necklace', designType: keep.designType || '', sku: '',
  purchasePrice: '', mrp: '', salePrice: '', stock: '1', lowStockAt: '2', shippingCharge: keep.shippingCharge ?? '',
});

/* Vendor photos go through the portal's upload route (per-vendor folder),
   with progress via XHR. Resolves to the Cloudinary URL. */
function uploadVendorPhoto(file, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); });
    xhr.addEventListener('load', () => {
      try {
        const d = JSON.parse(xhr.responseText);
        if (d.success) resolve({ url: d.data.secure_url || d.data.url }); else reject(new Error(d.message));
      } catch { reject(new Error('Upload failed')); }
    });
    xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
    xhr.open('POST', '/api/vendor/upload');
    xhr.send(fd);
  });
}

const inp = (err) => `w-full rounded-xl border bg-white px-3 py-2.5 text-[15px] text-gray-900 outline-none placeholder:text-gray-400 focus:ring-2 ${
  err ? 'border-red-400 focus:ring-red-200' : 'border-gray-200 focus:border-amber-400 focus:ring-amber-200'}`;

function Field({ label, htmlFor, error, hint, children, className = '' }) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={htmlFor} className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</label>
      {children}
      {error ? <p className="text-xs text-red-600">{error}</p> : hint ? <p className="text-xs text-gray-400">{hint}</p> : null}
    </div>
  );
}

const onlyMoney = (v) => v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
const onlyInt = (v) => v.replace(/\D/g, '');

export default function QuickAddModal({ open, onClose, mode = 'admin', categories = ALL_CATEGORIES, pricing: pricingProp = true, onOptimistic, onSaved, onFailed }) {
  const vendor = mode === 'vendor';
  const pricing = vendor || pricingProp;
  const uid = useId();
  const id = (k) => `${uid}-${k}`;
  const [form, setForm] = useState(blank);
  const [images, setImages] = useState([]); // { key, preview, url, progress, error }
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const nameRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => nameRef.current?.focus(), 60);
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  if (!open) return null;

  const set = (k, clean = (v) => v) => (e) => {
    setForm((f) => ({ ...f, [k]: clean(e.target.value) }));
    if (errors[k]) setErrors(({ [k]: _drop, ...rest }) => rest);
  };
  const off = discountPercent(form.mrp, form.salePrice);
  const uploading = images.some((i) => !i.url && !i.error);
  const cost = Number(form.purchasePrice); const sale = Number(form.salePrice || form.mrp);
  const grossMargin = pricing && !vendor && cost > 0 && sale > 0 ? { amt: sale - cost, pct: Math.round(((sale - cost) / sale) * 100) } : null;
  /* Vendor: what reaches them per piece (0% commission) after their own shipping. */
  const vendorGets = vendor && sale > 0 ? sale - (Number(form.shippingCharge) || 0) : null;

  function addFiles(files) {
    const room = MAX_IMAGES - images.length;
    const picked = [...files].filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type)).slice(0, room);
    if (files.length && !picked.length) toast.error(room ? 'Use JPG, PNG or WebP photos.' : `Up to ${MAX_IMAGES} photos.`);
    for (const file of picked) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`;
      const preview = URL.createObjectURL(file);
      setImages((list) => [...list, { key, preview, url: null, progress: 0, error: null }]);
      const progress = (pct) => setImages((list) => list.map((i) => (i.key === key ? { ...i, progress: pct } : i)));
      (vendor ? uploadVendorPhoto(file, progress) : uploadToCloudinary(file, 'tulsi-bridal/products', progress))
        .then((res) => setImages((list) => list.map((i) => (i.key === key ? { ...i, url: res.secure_url || res.url, progress: 100 } : i))))
        .catch((err) => {
          setImages((list) => list.map((i) => (i.key === key ? { ...i, error: 'Upload failed' } : i)));
          if (err?.message) toast.error(err.message);
        });
    }
  }
  function removeImage(key) {
    setImages((list) => {
      const gone = list.find((i) => i.key === key);
      if (gone) URL.revokeObjectURL(gone.preview);
      return list.filter((i) => i.key !== key);
    });
  }

  async function save(another) {
    const payload = {
      ...form,
      images: images.filter((i) => i.url).map((i) => i.url),
      ...(!pricing && { purchasePrice: undefined, mrp: undefined, salePrice: undefined }),
    };
    const check = parseQuickAdd(payload, { pricing });
    if (check.errors) {
      setErrors(check.errors);
      document.getElementById(id(Object.keys(check.errors)[0]))?.focus();
      toast.error('Please fix the highlighted fields.');
      return;
    }
    if (uploading) { toast('Photos are still uploading — one moment.', { icon: '⏳' }); return; }

    /* Show the row straight away; swap for the saved product (or drop it). */
    const tempId = `pending-${Date.now()}`;
    const d = check.data;
    onOptimistic?.({
      id: tempId, _id: tempId, pending: true, name: d.name, sku: d.sku || '…', category: d.category, subCategory: d.designType,
      price: d.mrp || 0, discountPrice: d.salePrice < d.mrp ? d.salePrice : 0, stock: d.stock, lowStockAt: d.lowStockAt,
      images: payload.images, showMe: pricing, createdAt: new Date().toISOString(),
    });
    setSaving(true);
    try {
      /* Vendors save through their own product API (reviewed by Tulsi). */
      const body = vendor ? {
        name: d.name, category: d.category, subCategory: d.designType, ...(d.sku && { sku: d.sku }),
        price: d.mrp, discountPrice: d.salePrice < d.mrp ? d.salePrice : 0,
        stock: d.stock, lowStockAt: d.lowStockAt, images: payload.images,
        shippingCharge: form.shippingCharge === '' ? null : Number(form.shippingCharge),
      } : payload;
      const res = await fetch(vendor ? '/api/vendor/products' : '/api/admin/products/quick-add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => ({}));
      if (!out.success) {
        onFailed?.(tempId);
        if (out.errors) setErrors(out.errors);
        toast.error(out.message || 'Could not add the product');
        return;
      }
      onSaved?.(tempId, out.data);
      toast.success(vendor ? `“${out.data.name}” sent to Tulsi for review`
        : pricing ? `Added “${out.data.name}” · ${out.data.stock} in stock` : `Draft “${out.data.name}” added — a Super Admin will price & publish it`);
      images.forEach((i) => URL.revokeObjectURL(i.preview));
      setImages([]);
      setErrors({});
      if (another) {
        setForm(blank({ category: form.category, designType: form.designType, shippingCharge: form.shippingCharge }));
        setTimeout(() => nameRef.current?.focus(), 30);
      } else {
        setForm(blank());
        onClose();
      }
    } catch {
      onFailed?.(tempId);
      toast.error('Network problem — the product was not saved.');
    } finally {
      setSaving(false);
    }
  }

  const quick = QUICK_CATEGORIES.map((c) => c.slug);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form role="dialog" aria-modal="true" aria-labelledby={id('title')} noValidate
        onSubmit={(e) => { e.preventDefault(); save(false); }}
        className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <div>
            <h2 id={id('title')} className="text-lg font-bold text-gray-900">Quick add product</h2>
            <p className="text-xs text-gray-400">{vendor ? 'Tulsi reviews it, then it goes live in the shop.' : pricing ? 'Goes live in the shop with its stock.' : 'Saved as a draft — prices are set by a Super Admin.'}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-gray-500 hover:bg-gray-100" aria-label="Close"><FiX size={18} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* 1. Identification */}
          <section className="space-y-3">
            <Field label="Product name" htmlFor={id('name')} error={errors.name}>
              <input ref={nameRef} id={id('name')} value={form.name} onChange={set('name')} maxLength={120} autoComplete="off"
                placeholder="Antique Matte Finish Lakshmi Choker" className={inp(errors.name)} />
            </Field>
            <Field label="Category" htmlFor={id('category')} error={errors.category}>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Category">
                {QUICK_CATEGORIES.map((c) => (
                  <button key={c.slug} type="button" role="radio" aria-checked={form.category === c.slug}
                    onClick={() => setForm((f) => ({ ...f, category: c.slug }))}
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${form.category === c.slug ? 'border-maroon-950 bg-maroon-950 text-white' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                    {c.label}
                  </button>
                ))}
                <select id={id('category')} value={quick.includes(form.category) ? '' : form.category}
                  onChange={(e) => e.target.value && setForm((f) => ({ ...f, category: e.target.value }))}
                  className={`rounded-full border px-3 py-1.5 text-sm capitalize ${quick.includes(form.category) ? 'border-gray-200 text-gray-500' : 'border-maroon-950 bg-maroon-950 text-white'}`}>
                  <option value="">More…</option>
                  {categories.filter((c) => !quick.includes(c)).map((c) => <option key={c} value={c}>{c.replace(/-/g, ' ')}</option>)}
                </select>
              </div>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Design type" htmlFor={id('designType')} error={errors.designType}>
                <input id={id('designType')} list={id('designs')} value={form.designType} onChange={set('designType')} maxLength={40}
                  placeholder="Temple, Matte, Kundan…" className={inp(errors.designType)} />
                <datalist id={id('designs')}>{DESIGN_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
              </Field>
              <Field label="SKU / Barcode" htmlFor={id('sku')} error={errors.sku} hint="Blank = auto">
                <div className="flex gap-2">
                  <input id={id('sku')} value={form.sku} onChange={set('sku', (v) => v.toUpperCase().replace(/\s+/g, '-'))} maxLength={40}
                    autoCapitalize="characters" autoComplete="off" placeholder="TJ-NK-1024" className={`${inp(errors.sku)} font-mono`} />
                  <button type="button" onClick={() => { setForm((f) => ({ ...f, sku: generateSku(f.category, Date.now(), vendor ? 'V' : 'TJ') })); setErrors(({ sku: _drop, ...r }) => r); }}
                    className="flex flex-shrink-0 items-center gap-1 rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50" title="Auto-generate">
                    <FiRefreshCw size={14} /> Auto
                  </button>
                </div>
              </Field>
            </div>
          </section>

          {/* 2. Pricing */}
          {pricing && (
            <section className="space-y-2">
              <div className={`grid gap-2 sm:gap-3 ${vendor ? 'grid-cols-2' : 'grid-cols-3'}`}>
                {!vendor && (
                  <Field label="Cost ₹" htmlFor={id('purchasePrice')} error={errors.purchasePrice} hint="Private">
                    <input id={id('purchasePrice')} inputMode="numeric" value={form.purchasePrice} onChange={set('purchasePrice', onlyMoney)} placeholder="0" className={`${inp(errors.purchasePrice)} tabular-nums`} />
                  </Field>
                )}
                <Field label="MRP ₹" htmlFor={id('mrp')} error={errors.mrp}>
                  <input id={id('mrp')} inputMode="numeric" value={form.mrp} onChange={set('mrp', onlyMoney)} placeholder="0" className={`${inp(errors.mrp)} tabular-nums`} />
                </Field>
                <Field label="Selling ₹" htmlFor={id('salePrice')} error={errors.salePrice}>
                  <input id={id('salePrice')} inputMode="numeric" value={form.salePrice} onChange={set('salePrice', onlyMoney)} placeholder="0" className={`${inp(errors.salePrice)} tabular-nums font-semibold`} />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs" aria-live="polite">
                {off > 0 && <span className="rounded-full bg-green-50 px-2.5 py-1 font-bold text-green-700 tabular-nums">{off}% OFF</span>}
                {grossMargin && (
                  <span className={`rounded-full px-2.5 py-1 font-semibold tabular-nums ${grossMargin.amt >= 0 ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700'}`}>
                    Margin ₹{grossMargin.amt.toLocaleString('en-IN')} ({grossMargin.pct}%)
                  </span>
                )}
                {vendorGets !== null && (
                  <span className={`rounded-full px-2.5 py-1 font-semibold tabular-nums ${vendorGets >= 0 ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700'}`}>
                    You get ₹{vendorGets.toLocaleString('en-IN')} per piece · 0% commission
                  </span>
                )}
                {!off && !grossMargin && vendorGets === null && <span className="text-gray-400">Enter the MRP above the selling price to show a discount.</span>}
              </div>
            </section>
          )}

          {/* 3. Stock */}
          <section className={`grid gap-3 ${vendor ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <Field label={vendor ? 'Stock' : 'Opening stock'} htmlFor={id('stock')} error={errors.stock}>
              <input id={id('stock')} inputMode="numeric" value={form.stock} onChange={set('stock', onlyInt)} className={`${inp(errors.stock)} tabular-nums`} />
            </Field>
            <Field label={vendor ? 'Alert at' : 'Low-stock alert at'} htmlFor={id('lowStockAt')} error={errors.lowStockAt}>
              <input id={id('lowStockAt')} inputMode="numeric" value={form.lowStockAt} onChange={set('lowStockAt', onlyInt)} className={`${inp(errors.lowStockAt)} tabular-nums`} />
            </Field>
            {vendor && (
              <Field label="Shipping ₹" htmlFor={id('shippingCharge')} hint="Per piece">
                <input id={id('shippingCharge')} inputMode="numeric" value={form.shippingCharge} onChange={set('shippingCharge', onlyMoney)} placeholder="—" className={`${inp()} tabular-nums`} />
              </Field>
            )}
          </section>

          {/* 4. Photos */}
          <section>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Photos <span className="font-normal normal-case text-gray-400">(up to {MAX_IMAGES})</span></p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {images.map((img) => (
                <div key={img.key} className="relative aspect-square overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url ? cldThumb(img.url, 240) : img.preview} alt="" className="h-full w-full object-cover" />
                  {!img.url && !img.error && (
                    <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/10"><div className="h-full bg-amber-500 transition-all" style={{ width: `${img.progress}%` }} /></div>
                  )}
                  {img.error && <p className="absolute inset-0 flex items-center justify-center bg-white/80 text-xs font-semibold text-red-600">{img.error}</p>}
                  <button type="button" onClick={() => removeImage(img.key)} aria-label="Remove photo"
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80">
                    <FiX size={12} />
                  </button>
                </div>
              ))}
              {images.length < MAX_IMAGES && (
                <button type="button" onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
                  className={`flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed text-xs font-medium transition ${dragOver ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  <FiImage size={20} aria-hidden />
                  <span>Tap or drop</span>
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only"
              onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </section>
        </div>

        {/* Actions */}
        <div className="flex flex-col-reverse gap-2 border-t border-gray-100 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
          <button type="button" onClick={() => save(true)} disabled={saving}
            className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            Save &amp; Add Another
          </button>
          <button type="submit" disabled={saving}
            className="flex items-center justify-center gap-2 rounded-xl bg-maroon-950 px-5 py-3 text-sm font-bold text-white hover:bg-maroon-900 disabled:opacity-50">
            <FiZap aria-hidden /> {saving ? 'Saving…' : uploading ? 'Photos uploading…' : 'Save & Add Stock'}
          </button>
        </div>
      </form>
    </div>
  );
}
