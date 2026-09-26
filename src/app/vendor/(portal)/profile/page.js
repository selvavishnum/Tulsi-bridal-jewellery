'use client';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { Card, Loading, shortDate, sendJson, useVendorData } from '@/components/vendor/ui';

const field = 'w-full px-3 py-2.5 border border-stone-300 rounded-xl text-sm bg-white outline-none focus:border-wine-700 focus:ring-2 focus:ring-wine-700/15';

function Field({ label, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs font-semibold text-stone-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

const PICKUP_STATE = {
  active: ['Registered with Shiprocket', 'bg-green-50 text-green-700 border-green-200'],
  needs_verification: ['Waiting for Tulsi to verify the pickup phone in Shiprocket', 'bg-amber-50 text-amber-800 border-amber-200'],
  incomplete: ['Not registered — address incomplete', 'bg-amber-50 text-amber-800 border-amber-200'],
  error: ['Shiprocket rejected this address', 'bg-red-50 text-red-700 border-red-200'],
  not_registered: ['Not registered with Shiprocket yet', 'bg-stone-50 text-stone-600 border-stone-200'],
};

function PickupStatus({ sync, onRetried }) {
  const [busy, setBusy] = useState(false);
  if (!sync) return null;
  const [text, cls] = PICKUP_STATE[sync.status] || PICKUP_STATE.not_registered;
  async function retry() {
    setBusy(true);
    try {
      const res = await fetch('/api/vendor/profile/pickup-sync', { method: 'POST' });
      const d = await res.json();
      if (d.success) { toast.success(d.message || 'Registered'); onRetried({ ...sync, status: d.data.status, nickname: d.data.nickname || sync.nickname, lastError: null }); }
      else toast.error(d.message || 'Shiprocket rejected the address', { duration: 12000 });
    } catch {
      toast.error('Could not reach Shiprocket. Try again shortly.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`rounded-lg border p-3 text-sm flex flex-wrap items-center justify-between gap-2 ${cls}`} role="status">
      <span>
        <b>{text}</b>{sync.nickname ? <span className="font-mono text-xs ml-2">{sync.nickname}</span> : null}
        {sync.lastError && <span className="block text-xs mt-0.5">{sync.lastError}</span>}
      </span>
      {sync.status !== 'active' && (
        <button type="button" onClick={retry} disabled={busy} className="text-xs font-semibold underline disabled:opacity-50">{busy ? 'Trying…' : 'Retry registration'}</button>
      )}
    </div>
  );
}

export default function VendorProfilePage() {
  const { data, error, setData } = useVendorData('/api/vendor/profile');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [payout, setPayout] = useState({ method: 'upi', upiId: '', accountName: '', accountNumber: '', ifsc: '' });
  const [sendingPayout, setSendingPayout] = useState(false);

  useEffect(() => {
    if (data && !form) {
      setForm({ name: data.name, contactName: data.contactName, phone: data.phone, contactEmail: data.contactEmail, gstin: data.gstin, pickupAddress: { ...data.pickupAddress } });
    }
  }, [data, form]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data || !form) return <Loading />;

  const locked = data.status === 'suspended';
  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const updAddr = (k, v) => setForm((f) => ({ ...f, pickupAddress: { ...f.pickupAddress, [k]: v } }));

  async function saveProfile(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/vendor/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const d = await res.json();
      if (!d.success) throw new Error(d.message || 'Could not save');
      setData(d.data);
      toast.success('Store profile saved');
      /* Shiprocket's verdict on the warehouse address, in its own toast. */
      const sync = d.pickupSync;
      if (sync && ['active', 'needs_verification'].includes(sync.status)) toast.success(sync.message, { duration: 8000 });
      else if (sync && ['error', 'incomplete'].includes(sync.status)) toast.error(`Shiprocket pickup: ${sync.message}`, { duration: 12000 });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function requestPayoutChange(e) {
    e.preventDefault();
    setSendingPayout(true);
    try {
      const body = payout.method === 'upi'
        ? { method: 'upi', upiId: payout.upiId }
        : { method: 'bank', accountName: payout.accountName, accountNumber: payout.accountNumber, ifsc: payout.ifsc };
      const pending = await sendJson('/api/vendor/profile/payout', 'POST', { payout: body });
      setData((d) => ({ ...d, pendingPayout: pending }));
      setPayout((p) => ({ ...p, upiId: '', accountNumber: '' }));
      toast.success('Sent to Tulsi for approval');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSendingPayout(false);
    }
  }

  async function cancelPayoutChange() {
    try {
      await sendJson('/api/vendor/profile/payout', 'DELETE');
      setData((d) => ({ ...d, pendingPayout: null }));
      toast.success('Request withdrawn');
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <h1 className="font-serif text-2xl font-bold text-stone-900">Store Profile</h1>
      {locked && <p className="text-sm text-red-600">Your store is paused, so changes are locked. Contact Tulsi.</p>}

      <form onSubmit={saveProfile}>
        <Card title="Store and contact">
          <fieldset disabled={locked} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Store name *"><input required maxLength={80} value={form.name} onChange={(e) => upd('name', e.target.value)} className={field} /></Field>
              <Field label="Contact person"><input maxLength={80} value={form.contactName} onChange={(e) => upd('contactName', e.target.value)} className={field} /></Field>
              <Field label="Mobile number"><input inputMode="tel" value={form.phone} onChange={(e) => upd('phone', e.target.value)} className={field} placeholder="98765 43210" /></Field>
              <Field label="Contact email"><input type="email" value={form.contactEmail} onChange={(e) => upd('contactEmail', e.target.value)} className={field} placeholder={data.loginEmail} /></Field>
              <Field label="GSTIN (optional)"><input maxLength={15} value={form.gstin} onChange={(e) => upd('gstin', e.target.value.toUpperCase())} className={`${field} font-mono`} /></Field>
            </div>

            <h3 className="text-sm font-semibold text-stone-800 pt-2">Warehouse / pickup address</h3>
            <p className="text-xs text-stone-500 -mt-3">Couriers collect your parcels from here. Saving registers it with Tulsi’s Shiprocket.</p>
            <PickupStatus sync={data.pickupSync} onRetried={(v) => setData((d) => ({ ...d, pickupSync: v }))} />
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Address line 1 *" className="sm:col-span-2"><input value={form.pickupAddress.line1} onChange={(e) => updAddr('line1', e.target.value)} className={field} /></Field>
              <Field label="Address line 2" className="sm:col-span-2"><input value={form.pickupAddress.line2} onChange={(e) => updAddr('line2', e.target.value)} className={field} /></Field>
              <Field label="City *"><input value={form.pickupAddress.city} onChange={(e) => updAddr('city', e.target.value)} className={field} /></Field>
              <Field label="State *"><input value={form.pickupAddress.state} onChange={(e) => updAddr('state', e.target.value)} className={field} /></Field>
              <Field label="Pincode *"><input inputMode="numeric" maxLength={6} value={form.pickupAddress.pincode} onChange={(e) => updAddr('pincode', e.target.value.replace(/\D/g, ''))} className={`${field} tabular-nums`} /></Field>
            </div>
            <button disabled={saving} className="px-5 py-2.5 rounded-xl bg-wine-700 hover:bg-wine-800 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
              {saving && <LoadingSpinner size="sm" />} Save profile
            </button>
          </fieldset>
        </Card>
      </form>

      <Card title="Payout account">
        <p className="text-sm text-stone-700">
          Payouts go to: <span className="font-semibold">{data.payoutDestination || 'not set yet'}</span>
        </p>
        {data.pendingPayout && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 flex flex-wrap items-center justify-between gap-2">
            <span>Change to <strong>{data.pendingPayout.destination}</strong> sent {shortDate(data.pendingPayout.requestedAt)} — waiting for Tulsi to approve.</span>
            {!locked && <button onClick={cancelPayoutChange} className="text-xs font-semibold underline">Withdraw request</button>}
          </div>
        )}
        <form onSubmit={requestPayoutChange} className="mt-4 space-y-3">
          <fieldset disabled={locked} className="space-y-3">
            <p className="text-xs text-stone-500">For your security, a new bank account or UPI ID is used only after Tulsi confirms it with you. Until then payouts continue to the account above.</p>
            <div className="flex gap-2" role="radiogroup" aria-label="Payout method">
              {[['upi', 'UPI'], ['bank', 'Bank account']].map(([id, text]) => (
                <button type="button" key={id} role="radio" aria-checked={payout.method === id} onClick={() => setPayout((p) => ({ ...p, method: id }))}
                  className={`px-3 py-2 rounded-lg text-sm font-semibold ${payout.method === id ? 'bg-wine-700 text-white' : 'bg-white border border-stone-200 text-stone-600'}`}>
                  {text}
                </button>
              ))}
            </div>
            {payout.method === 'upi' ? (
              <Field label="UPI ID"><input required value={payout.upiId} onChange={(e) => setPayout((p) => ({ ...p, upiId: e.target.value.trim() }))} className={field} placeholder="name@okaxis" /></Field>
            ) : (
              <div className="grid sm:grid-cols-3 gap-4">
                <Field label="Account holder"><input required value={payout.accountName} onChange={(e) => setPayout((p) => ({ ...p, accountName: e.target.value }))} className={field} /></Field>
                <Field label="Account number"><input required inputMode="numeric" value={payout.accountNumber} onChange={(e) => setPayout((p) => ({ ...p, accountNumber: e.target.value.replace(/\D/g, '') }))} className={`${field} tabular-nums`} /></Field>
                <Field label="IFSC"><input required maxLength={11} value={payout.ifsc} onChange={(e) => setPayout((p) => ({ ...p, ifsc: e.target.value.toUpperCase() }))} className={`${field} font-mono`} /></Field>
              </div>
            )}
            <button disabled={sendingPayout} className="px-5 py-2.5 rounded-xl border border-wine-700 text-wine-700 hover:bg-wine-700/5 text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
              {sendingPayout && <LoadingSpinner size="sm" />} Request payout change
            </button>
          </fieldset>
        </form>
      </Card>

      <p className="text-xs text-stone-400">Signed in as {data.loginEmail}. To change your login email or password, contact Tulsi.</p>
    </div>
  );
}
