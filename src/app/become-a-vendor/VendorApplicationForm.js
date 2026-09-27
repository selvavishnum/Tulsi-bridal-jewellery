'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { FiCheck, FiUploadCloud, FiFileText, FiX, FiArrowLeft, FiArrowRight } from 'react-icons/fi';
import { parseVendorApplication, STEP_FIELDS, INDIAN_STATES } from '@/lib/vendorApplication';

const STEPS = [
  { title: 'Store & contact', hint: 'Who you are and how we reach you' },
  { title: 'Tax details', hint: 'GST or Enrolment ID' },
  { title: 'Pickup address', hint: 'Where the courier collects parcels' },
  { title: 'Bank & settlement', hint: 'Where your earnings are paid' },
];

const EMPTY = {
  fullName: '', businessName: '', phone: '', email: '', instagram: '',
  taxType: 'GST', gstin: '', gstCertificateUrl: '', enrolmentId: '', pan: '',
  address: '', landmark: '', city: '', state: 'Tamil Nadu', pincode: '',
  accountHolder: '', bankName: '', accountNumber: '', confirmAccountNumber: '', ifsc: '', upiId: '',
  agree: false, website: '',
};

const inputCls = (err) => `w-full rounded-xl border bg-white px-3.5 py-3 text-[15px] text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 ${
  err ? 'border-red-400 focus:ring-red-200' : 'border-stone-300 focus:border-maroon-700 focus:ring-maroon-100'}`;

function Field({ id, label, error, hint, optional, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-stone-700">
        {label}{optional && <span className="ml-1 font-normal text-stone-400">(optional)</span>}
      </label>
      {children}
      {error ? <p id={`${id}-err`} className="text-xs text-red-600">{error}</p> : hint ? <p className="text-xs text-stone-400">{hint}</p> : null}
    </div>
  );
}

export default function VendorApplicationForm({ tamilClass = '' }) {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState({ state: 'idle', name: '' });
  const [done, setDone] = useState(false);
  const topRef = useRef(null);

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors(({ [k]: _drop, ...rest }) => rest);
  };
  /* Props shared by every text input. */
  const bind = (k, extra = {}) => ({
    id: k, name: k, value: form[k], onChange: set(k),
    'aria-invalid': !!errors[k], 'aria-describedby': errors[k] ? `${k}-err` : undefined,
    className: inputCls(errors[k]), ...extra,
  });

  function errorsFor(stepIdx) {
    const r = parseVendorApplication(form);
    if (!r.errors) return {};
    return Object.fromEntries(Object.entries(r.errors).filter(([k]) => STEP_FIELDS[stepIdx].includes(k)));
  }

  function goTo(i) {
    setStep(i);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function next() {
    const e = errorsFor(step);
    setErrors(e);
    if (Object.keys(e).length) {
      toast.error('Please fix the highlighted fields.');
      document.getElementById(Object.keys(e)[0])?.focus();
      return;
    }
    goTo(step + 1);
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('File must be 5 MB or smaller.'); return; }
    setUpload({ state: 'uploading', name: file.name });
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/vendor-applications/upload', { method: 'POST', body: fd });
      const d = await res.json().catch(() => ({}));
      if (!d.success) throw new Error(d.message || 'Upload failed.');
      setForm((f) => ({ ...f, gstCertificateUrl: d.data.url }));
      setErrors(({ gstCertificateUrl: _drop, ...rest }) => rest);
      setUpload({ state: 'done', name: file.name });
      toast.success('GST certificate uploaded');
    } catch (err) {
      setUpload({ state: 'idle', name: '' });
      toast.error(err.message);
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (step < STEPS.length - 1) { next(); return; }
    const r = parseVendorApplication(form);
    if (r.errors) {
      setErrors(r.errors);
      const first = STEP_FIELDS.findIndex((fields) => fields.some((k) => r.errors[k]));
      if (first >= 0 && first !== step) goTo(first);
      toast.error('Please fix the highlighted fields.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/vendor-applications', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const d = await res.json().catch(() => ({}));
      if (!d.success) {
        if (d.errors) {
          setErrors(d.errors);
          const first = STEP_FIELDS.findIndex((fields) => fields.some((k) => d.errors[k]));
          if (first >= 0) goTo(first);
        }
        toast.error(d.message || 'Could not submit. Please try again.');
        return;
      }
      setDone(true);
    } catch {
      toast.error('Network problem — please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const gst = form.taxType === 'GST';

  return (
    <>
      <div ref={topRef} className="scroll-mt-24" />
      {/* Progress */}
      <ol className="mb-6 grid grid-cols-4 gap-2" aria-label="Application steps">
        {STEPS.map((s, i) => (
          <li key={s.title} aria-current={i === step ? 'step' : undefined} className="flex flex-col gap-2">
            <span className={`h-1.5 rounded-full ${i <= step ? 'bg-maroon-800' : 'bg-stone-200'}`} />
            <span className={`hidden sm:block text-xs ${i === step ? 'font-semibold text-maroon-900' : 'text-stone-400'}`}>{s.title}</span>
          </li>
        ))}
      </ol>

      <form onSubmit={submit} noValidate className="rounded-2xl bg-white shadow-card ring-1 ring-stone-200/70 p-5 sm:p-8">
        <p className="text-xs uppercase tracking-[0.2em] text-stone-400">Step {step + 1} of {STEPS.length}</p>
        <h3 className="mt-1 font-serif text-2xl font-bold text-stone-800">{STEPS[step].title}</h3>
        <p className="mb-6 text-sm text-stone-500">{STEPS[step].hint}</p>

        {/* Honeypot — hidden from people, filled by bots. */}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label htmlFor="website">Website</label>
          <input id="website" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
        </div>

        {step === 0 && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="fullName" label="Full legal name" error={errors.fullName}>
              <input {...bind('fullName', { autoComplete: 'name', placeholder: 'As on PAN / bank account' })} />
            </Field>
            <Field id="businessName" label="Business / brand name" error={errors.businessName}>
              <input {...bind('businessName', { autoComplete: 'organization', placeholder: 'e.g. Meena Bridal Collections' })} />
            </Field>
            <Field id="phone" label="WhatsApp number" error={errors.phone} hint="10-digit Indian mobile">
              <div className="flex">
                <span className="inline-flex items-center rounded-l-xl border border-r-0 border-stone-300 bg-stone-50 px-3 text-sm text-stone-500">+91</span>
                <input {...bind('phone', { type: 'tel', inputMode: 'numeric', autoComplete: 'tel-national', maxLength: 14, placeholder: '98765 43210' })}
                  className={`${inputCls(errors.phone)} rounded-l-none`} />
              </div>
            </Field>
            <Field id="email" label="Email" error={errors.email} hint="Your Vendor Dashboard login">
              <input {...bind('email', { type: 'email', inputMode: 'email', autoComplete: 'email', placeholder: 'you@example.com' })} />
            </Field>
            <div className="sm:col-span-2">
              <Field id="instagram" label="Instagram shop handle" error={errors.instagram} hint="Handle or profile link">
                <input {...bind('instagram', { autoCapitalize: 'none', autoCorrect: 'off', placeholder: '@your_jewellery_shop' })} />
              </Field>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-5">
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-stone-700">How are you registered?</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ['GST', 'I have a regular GST registration', 'GSTIN + GST certificate'],
                  ['ENROLMENT_ID', 'Composition / Non-GST seller', 'GST Enrolment ID + PAN'],
                ].map(([v, title, sub]) => (
                  <label key={v} className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors ${form.taxType === v ? 'border-maroon-700 bg-maroon-50/60 ring-1 ring-maroon-700' : 'border-stone-300 hover:border-stone-400'}`}>
                    <input type="radio" name="taxType" value={v} checked={form.taxType === v} onChange={set('taxType')} className="mt-1 accent-maroon-800" />
                    <span>
                      <span className="block text-sm font-semibold text-stone-800">{title}</span>
                      <span className="block text-xs text-stone-500">{sub}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {gst ? (
              <>
                <Field id="gstin" label="GSTIN" error={errors.gstin} hint="15 characters, e.g. 33ABCDE1234F1Z5">
                  <input {...bind('gstin', { autoCapitalize: 'characters', autoCorrect: 'off', maxLength: 15, placeholder: '33ABCDE1234F1Z5', className: `${inputCls(errors.gstin)} uppercase font-mono tracking-wider` })} />
                </Field>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-stone-700">GST registration certificate</span>
                  {upload.state === 'done' ? (
                    <div className="flex items-center gap-3 rounded-xl border border-green-300 bg-green-50 px-4 py-3">
                      <FiFileText className="shrink-0 text-green-700" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm text-green-800">{upload.name}</span>
                      <button type="button" onClick={() => { setUpload({ state: 'idle', name: '' }); setForm((f) => ({ ...f, gstCertificateUrl: '' })); }}
                        className="rounded-lg p-1 text-green-800 hover:bg-green-100" aria-label="Remove file"><FiX /></button>
                    </div>
                  ) : (
                    <label htmlFor="gstCertificateUrl" className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center ${errors.gstCertificateUrl ? 'border-red-300 bg-red-50/40' : 'border-stone-300 hover:border-maroon-400'}`}>
                      <FiUploadCloud className="text-2xl text-maroon-700" aria-hidden />
                      <span className="text-sm font-medium text-stone-700">{upload.state === 'uploading' ? `Uploading ${upload.name}…` : 'Tap to upload PDF, JPG or PNG'}</span>
                      <span className="text-xs text-stone-400">Max 5 MB</span>
                      <input id="gstCertificateUrl" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={onFile} disabled={upload.state === 'uploading'} className="sr-only" />
                    </label>
                  )}
                  {errors.gstCertificateUrl && <p className="text-xs text-red-600">{errors.gstCertificateUrl}</p>}
                </div>
              </>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2">
                <Field id="enrolmentId" label="GST Enrolment ID" error={errors.enrolmentId} hint="From the GST portal (unregistered supplier enrolment)">
                  <input {...bind('enrolmentId', { autoCapitalize: 'characters', autoCorrect: 'off', maxLength: 16, className: `${inputCls(errors.enrolmentId)} uppercase font-mono tracking-wider` })} />
                </Field>
                <Field id="pan" label="PAN" error={errors.pan} hint="e.g. ABCDE1234F">
                  <input {...bind('pan', { autoCapitalize: 'characters', autoCorrect: 'off', maxLength: 10, className: `${inputCls(errors.pan)} uppercase font-mono tracking-wider` })} />
                </Field>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field id="address" label="Pickup address" error={errors.address} hint="Door / shop number, street and area — the courier comes here">
                <textarea {...bind('address', { rows: 3, autoComplete: 'street-address', placeholder: 'No. 12, Bazaar Street, Main Road' })} />
              </Field>
            </div>
            <Field id="landmark" label="Landmark" optional error={errors.landmark}>
              <input {...bind('landmark', { placeholder: 'Near bus stand' })} />
            </Field>
            <Field id="city" label="City / town" error={errors.city}>
              <input {...bind('city', { autoComplete: 'address-level2' })} />
            </Field>
            <Field id="state" label="State" error={errors.state}>
              <select {...bind('state', { autoComplete: 'address-level1' })}>
                {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field id="pincode" label="Pincode" error={errors.pincode}>
              <input {...bind('pincode', { inputMode: 'numeric', autoComplete: 'postal-code', maxLength: 6, placeholder: '628203' })} />
            </Field>
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="accountHolder" label="Account holder name" error={errors.accountHolder}>
              <input {...bind('accountHolder', { autoComplete: 'off' })} />
            </Field>
            <Field id="bankName" label="Bank name" error={errors.bankName}>
              <input {...bind('bankName', { placeholder: 'e.g. Indian Bank' })} />
            </Field>
            <Field id="accountNumber" label="Account number" error={errors.accountNumber}>
              <input {...bind('accountNumber', { inputMode: 'numeric', autoComplete: 'off', maxLength: 18, className: `${inputCls(errors.accountNumber)} font-mono tracking-wider` })} />
            </Field>
            <Field id="confirmAccountNumber" label="Confirm account number" error={errors.confirmAccountNumber}>
              <input {...bind('confirmAccountNumber', { inputMode: 'numeric', autoComplete: 'off', maxLength: 18, className: `${inputCls(errors.confirmAccountNumber)} font-mono tracking-wider` })} />
            </Field>
            <Field id="ifsc" label="IFSC code" error={errors.ifsc} hint="11 characters, on your cheque book / passbook">
              <input {...bind('ifsc', { autoCapitalize: 'characters', autoCorrect: 'off', maxLength: 11, placeholder: 'IDIB000U001', className: `${inputCls(errors.ifsc)} uppercase font-mono tracking-wider` })} />
            </Field>
            <Field id="upiId" label="UPI ID" optional error={errors.upiId}>
              <input {...bind('upiId', { autoCapitalize: 'none', autoCorrect: 'off', placeholder: 'name@okaxis' })} />
            </Field>
            <div className="sm:col-span-2 rounded-xl bg-stone-50 px-4 py-3 text-xs text-stone-500">
              🔒 Your account number is encrypted and seen only by Tulsi&apos;s payouts team.
            </div>
            <label className="sm:col-span-2 flex items-start gap-3 text-sm text-stone-600">
              <input id="agree" type="checkbox" checked={form.agree} onChange={set('agree')} aria-invalid={!!errors.agree} className="mt-0.5 h-5 w-5 accent-maroon-800" />
              <span>
                I confirm these details are correct and agree to Tulsi&apos;s{' '}
                <Link href="/terms" target="_blank" className="text-maroon-800 underline">seller terms</Link>.
                {errors.agree && <span className="block text-xs text-red-600">{errors.agree}</span>}
              </span>
            </label>
          </div>
        )}

        <div className="mt-8 flex items-center justify-between gap-3">
          {step > 0 ? (
            <button type="button" onClick={() => goTo(step - 1)} className="inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-stone-600 hover:bg-stone-100">
              <FiArrowLeft aria-hidden /> Back
            </button>
          ) : <span />}
          <button type="submit" disabled={busy || upload.state === 'uploading'}
            className="inline-flex min-w-[9rem] items-center justify-center gap-2 rounded-xl bg-maroon-900 px-6 py-3 text-sm font-semibold text-white hover:bg-maroon-950 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon-800">
            {step < STEPS.length - 1 ? (<>Continue <FiArrowRight aria-hidden /></>) : busy ? 'Submitting…' : 'Submit application'}
          </button>
        </div>
      </form>

      {done && <SuccessModal tamilClass={tamilClass} name={form.fullName} />}
    </>
  );
}

function SuccessModal({ tamilClass, name }) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="applied-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white p-8 text-center shadow-2xl motion-safe:animate-[pop_0.35s_ease-out]">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 flex justify-around text-2xl">
          {['🎉', '💍', '✨', '🎊', '💛', '✨', '🎉'].map((c, i) => (
            <span key={i} className="motion-safe:animate-[fall_1.6s_ease-in_forwards]" style={{ animationDelay: `${i * 90}ms` }}>{c}</span>
          ))}
        </div>
        <div className="mx-auto mb-5 mt-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl text-green-700">
          <FiCheck aria-hidden />
        </div>
        <h2 id="applied-title" lang="ta" className={`${tamilClass} text-xl font-bold leading-relaxed text-stone-800`}>
          உங்கள் விண்ணப்பம் பெறப்பட்டது!
        </h2>
        <p lang="ta" className={`${tamilClass} mt-2 leading-relaxed text-stone-600`}>
          24 மணி நேரத்திற்குள் எங்கள் குழு உங்களைத் தொடர்பு கொள்ளும்.
        </p>
        <p className="mt-3 text-sm text-stone-400">Thank you{name ? `, ${name.split(' ')[0]}` : ''} — we&apos;ll reach you on WhatsApp and email.</p>
        <Link href="/" className="mt-7 inline-flex rounded-xl bg-maroon-900 px-6 py-3 text-sm font-semibold text-white hover:bg-maroon-950">Back to the store</Link>
      </div>
      <style>{`@keyframes pop{from{transform:scale(.9);opacity:0}to{transform:scale(1);opacity:1}}@keyframes fall{from{transform:translateY(-40px);opacity:0}30%{opacity:1}to{transform:translateY(140px) rotate(25deg);opacity:0}}`}</style>
    </div>
  );
}
