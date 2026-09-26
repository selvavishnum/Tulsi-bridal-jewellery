'use client';
import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { FiBriefcase, FiPlus, FiEdit2, FiSend, FiRefreshCw, FiX, FiAlertTriangle, FiChevronDown, FiChevronUp } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { RETURN_WINDOW_DAYS } from '@/lib/settlement';

const inr = (paise) => ((paise || 0) / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const date = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—');
const inp = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white';

const EMPTY_VENDOR = {
  name: '', contactName: '', phone: '', email: '', password: '', platformFeePercent: '0', defaultMarginPercent: '', selfFulfil: false, shiprocketPickupLocation: '',
  payoutMethod: 'upi', upiId: '', accountName: '', accountNumber: '', ifsc: '',
};

function destination(p) {
  if (!p) return 'Not set';
  if (p.masked !== undefined) return p.masked; // non-owner staff get a masked copy
  if (p.method === 'upi') return `UPI · ${p.upiId}`;
  return `${p.accountName} · A/c ${p.accountNumber} · ${p.ifsc}`;
}

function StatusChip({ status }) {
  const map = {
    unsettled: 'bg-amber-50 text-amber-700',
    settled: 'bg-green-50 text-green-700',
    reversed: 'bg-gray-100 text-gray-500 line-through',
    active: 'bg-green-50 text-green-700',
    suspended: 'bg-red-50 text-red-700',
  };
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${map[status] || 'bg-gray-100 text-gray-600'}`}>{status}</span>;
}

export default function VendorsPage() {
  const { data: session } = useSession();
  /* This page is SUPER_ADMIN-only (middleware + API); kept as a guard so
     money buttons never render for anyone else if that ever changes. */
  const isOwner = session?.user?.tier === 'SUPER_ADMIN'
    || (process.env.NEXT_PUBLIC_ADMIN_BYPASS === 'true' && process.env.NODE_ENV !== 'production');

  const [data, setData] = useState({ vendors: [], totals: null });
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [form, setForm] = useState(null); // { mode: 'create'|'edit', id?, values }
  const [payout, setPayout] = useState(null); // { vendor } | { all: true }
  const [busy, setBusy] = useState(false);
  const [settleOrder, setSettleOrder] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/vendors');
      const json = await res.json();
      if (json.success) setData(json.data); else toast.error(json.message);
    } catch { toast.error('Could not load vendors'); }
    finally { setLoading(false); }
  }, []);

  const loadLedger = useCallback(async (vendorId) => {
    setLedger(null);
    try {
      const res = await fetch(`/api/admin/vendor-ledger?vendorId=${encodeURIComponent(vendorId)}`);
      const json = await res.json();
      if (json.success) setLedger(json.data); else toast.error(json.message);
    } catch { toast.error('Could not load ledger'); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function decidePayout(v, decision) {
    if (decision === 'approve' && !window.confirm(`Send all future payouts for ${v.name} to ${destination(v.pendingPayout)}?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/vendors?id=${encodeURIComponent(v.id)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pendingPayoutDecision: decision }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
      toast.success(decision === 'approve' ? 'Payout account updated' : 'Request rejected');
      load();
    } catch (err) { toast.error(err.message || 'Could not save'); }
    finally { setBusy(false); }
  }

  function toggle(id) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    loadLedger(id);
  }

  function openCreate() { setForm({ mode: 'create', values: { ...EMPTY_VENDOR } }); }
  function openEdit(v) {
    setForm({
      mode: 'edit', id: v.id,
      values: {
        ...EMPTY_VENDOR,
        name: v.name, contactName: v.contactName, phone: v.phone,
        platformFeePercent: String(v.platformFeePercent),
        defaultMarginPercent: v.defaultMarginPercent ? String(v.defaultMarginPercent) : '',
        selfFulfil: v.selfFulfil === true,
        shiprocketPickupLocation: v.shiprocketPickupLocation || '',
        status: v.status,
        loginActive: v.login?.status === 'Active',
        payoutMethod: v.payout?.method || 'upi',
        upiId: v.payout?.upiId || '',
        accountName: v.payout?.accountName || '',
        accountNumber: v.payout?.accountNumber || '',
        ifsc: v.payout?.ifsc || '',
        newPassword: '',
      },
    });
  }
  const setField = (k, val) => setForm((f) => ({ ...f, values: { ...f.values, [k]: val } }));

  async function saveVendor(e) {
    e.preventDefault();
    const v = form.values;
    const payoutBody = v.payoutMethod === 'upi'
      ? { method: 'upi', upiId: v.upiId }
      : { method: 'bank', accountName: v.accountName, accountNumber: v.accountNumber, ifsc: v.ifsc };
    const body = {
      name: v.name, contactName: v.contactName, phone: v.phone,
      platformFeePercent: v.platformFeePercent, defaultMarginPercent: v.defaultMarginPercent, payout: payoutBody,
      selfFulfil: v.selfFulfil, shiprocketPickupLocation: v.shiprocketPickupLocation,
      ...(form.mode === 'create'
        ? { email: v.email, password: v.password }
        : { status: v.status, loginActive: v.loginActive, ...(v.newPassword && { newPassword: v.newPassword }) }),
    };
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/vendors${form.mode === 'edit' ? `?id=${form.id}` : ''}`, {
        method: form.mode === 'edit' ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(form.mode === 'edit' ? 'Vendor updated' : 'Vendor added — share the login email and password with them');
        setForm(null);
        load();
      } else toast.error(json.message);
    } catch { toast.error('Network error — nothing was saved'); }
    finally { setBusy(false); }
  }

  async function submitPayout(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = payout.all
      ? { action: 'payout_all', reference: fd.get('reference'), note: fd.get('note') }
      : { action: 'payout', vendorId: payout.vendor.id, reference: fd.get('reference'), note: fd.get('note') };
    setBusy(true);
    try {
      const res = await fetch('/api/admin/vendor-ledger', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) { toast.error(json.message); return; }
      if (payout.all) {
        const paid = json.data.results.filter((r) => r.ok);
        const failed = json.data.results.filter((r) => !r.ok);
        toast.success(paid.length ? `Recorded ${paid.length} payout(s): ${inr(paid.reduce((s, r) => s + r.amountPaise, 0))}` : 'No vendor had a balance to pay out');
        failed.forEach((f) => toast.error(`${f.name}: ${f.message}`));
      } else {
        toast.success(`Payout of ${inr(json.data.amountPaise)} recorded`);
      }
      setPayout(null);
      load();
      if (openId) loadLedger(openId);
    } catch { toast.error('Network error — check the ledger before retrying'); }
    finally { setBusy(false); }
  }

  async function settle(orderId, recalculate) {
    if (!orderId) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/vendor-ledger', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'settle_order', orderId, recalculate }),
      });
      const json = await res.json();
      if (!json.success) { toast.error(json.message); return; }
      const r = json.data;
      toast.success(r.skipped ? r.skipped : `Posted ${r.posted}, updated ${r.updated}`);
      setSettleOrder('');
      load();
      if (openId) loadLedger(openId);
    } catch { toast.error('Network error'); }
    finally { setBusy(false); }
  }

  const t = data.totals;
  const payableVendors = data.vendors.filter((v) => v.summary.availablePaise > 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><FiBriefcase /> Vendors &amp; Payouts</h1>
          <p className="text-gray-500 text-sm mt-0.5">All customer payments land in your Razorpay account and ship through your Shiprocket account. Vendors are paid their net earnings from here.</p>
        </div>
        <div className="flex gap-2">
          {isOwner && (
            <button onClick={() => setPayout({ all: true })} disabled={!payableVendors.length}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
              <FiSend /> Pay out all ({payableVendors.length})
            </button>
          )}
          {isOwner && (
            <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-maroon-950 text-white rounded-lg text-sm font-semibold hover:bg-maroon-900">
              <FiPlus /> Add vendor
            </button>
          )}
        </div>
      </div>

      {t && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          {[
            ['Vendor sales collected', t.grossPaise],
            ['Margin retained', t.supplyCostPaise],
            ['Shipping recovered', t.shippingPaise],
            ['Platform fees earned', t.platformFeePaise],
            ['Owed to vendors', t.availablePaise + t.pendingPaise],
            ['Paid out to vendors', t.paidOutPaise],
          ].map(([label, v]) => (
            <div key={label} className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">{label}</p>
              <p className="text-lg font-bold text-gray-900 mt-1 tabular-nums">{inr(v)}</p>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : data.vendors.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center text-gray-500 text-sm">
          No vendors yet.{isOwner ? ' Add one to give them a dashboard login, then assign products to them from the Products page.' : ''}
        </div>
      ) : (
        <div className="space-y-3">
          {data.vendors.map((v) => (
            <div key={v.id} className="bg-white rounded-xl border border-gray-100">
              <div className="p-4 flex flex-wrap items-center gap-4">
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900">{v.name}</p>
                    <StatusChip status={v.status} />
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {v.productCount} product{v.productCount !== 1 ? 's' : ''} · fee {v.platformFeePercent}%{v.defaultMarginPercent ? ` · default margin ${v.defaultMarginPercent}%` : ''}{v.selfFulfil ? ' · ships own orders' : ''} · login {v.login ? `${v.login.email} (${v.login.status})` : 'none'}
                  </p>
                  <p className="text-xs text-gray-500">Pays to: {destination(v.payout)}</p>
                  {v.pickupAddress && (
                    <p className="text-xs text-gray-500">Pickup: {[v.pickupAddress.line1, v.pickupAddress.line2, v.pickupAddress.city, v.pickupAddress.state, v.pickupAddress.pincode].filter(Boolean).join(', ')}</p>
                  )}
                  {v.inReviewCount > 0 && (
                    <a href="/admin/products" className="inline-block mt-1 text-xs font-semibold text-blue-700 hover:underline">
                      {v.inReviewCount} new product{v.inReviewCount !== 1 ? 's' : ''} to review — check the margin and publish →
                    </a>
                  )}
                  {v.pendingPayout && (
                    <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs text-amber-900">
                      <p><span className="font-semibold">Vendor asked to change payouts to:</span> <span className="font-mono">{destination(v.pendingPayout)}</span></p>
                      <p className="text-amber-700">Confirm it with the vendor by phone before approving.</p>
                      {isOwner && (
                        <div className="flex gap-2 mt-1.5">
                          <button onClick={() => decidePayout(v, 'approve')} disabled={busy} className="px-2.5 py-1 rounded bg-green-600 text-white font-semibold disabled:opacity-40">Approve</button>
                          <button onClick={() => decidePayout(v, 'reject')} disabled={busy} className="px-2.5 py-1 rounded border border-amber-300 font-semibold disabled:opacity-40">Reject</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Available</p>
                  <p className={`text-lg font-bold tabular-nums ${v.summary.availablePaise < 0 ? 'text-red-600' : 'text-gray-900'}`}>{inr(v.summary.availablePaise)}</p>
                  <p className="text-xs text-gray-400 tabular-nums">+ {inr(v.summary.pendingPaise)} in return window</p>
                </div>
                <div className="flex gap-2">
                  {isOwner && (
                    <button onClick={() => setPayout({ vendor: v })} disabled={v.summary.availablePaise <= 0}
                      className="px-3 py-2 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed">
                      Pay out
                    </button>
                  )}
                  {isOwner && (
                    <button onClick={() => openEdit(v)} className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50" aria-label={`Edit ${v.name}`}><FiEdit2 /></button>
                  )}
                  <button onClick={() => toggle(v.id)} className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50" aria-label="Show ledger">
                    {openId === v.id ? <FiChevronUp /> : <FiChevronDown />}
                  </button>
                </div>
              </div>
              {v.summary.estimatedShippingCount > 0 && (
                <p className="px-4 pb-3 text-xs text-amber-700 flex items-center gap-1.5">
                  <FiAlertTriangle /> {v.summary.estimatedShippingCount} unpaid order(s) use an estimated shipping cost — enter the actual courier charge on the order, then Recalculate below, before paying out.
                </p>
              )}

              {openId === v.id && (
                <div className="border-t border-gray-100 p-4">
                  {!ledger ? <p className="text-sm text-gray-400">Loading ledger…</p> : (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4 text-sm">
                        {[
                          ['Gross collected', ledger.summary.grossPaise],
                          ['Margin', -ledger.summary.supplyCostPaise],
                          ['Shipping', -ledger.summary.shippingPaise],
                          ['Platform fee', -ledger.summary.platformFeePaise],
                          ['Net earned', ledger.summary.netPaise],
                        ].map(([label, val]) => (
                          <div key={label}><p className="text-xs text-gray-400">{label}</p><p className="font-semibold tabular-nums">{inr(val)}</p></div>
                        ))}
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="text-gray-400 uppercase tracking-wide">
                            <tr className="text-left">
                              <th className="py-2 pr-3">Order</th><th className="pr-3">Delivered</th>
                              <th className="pr-3 text-right">Collected</th><th className="pr-3 text-right">Margin</th>
                              <th className="pr-3 text-right">Shipping</th><th className="pr-3 text-right">Fee</th>
                              <th className="pr-3 text-right">Net</th><th className="pr-3">Status</th><th />
                            </tr>
                          </thead>
                          <tbody className="tabular-nums">
                            {ledger.entries.length === 0 && (
                              <tr><td colSpan={9} className="py-4 text-gray-400">No delivered orders yet.</td></tr>
                            )}
                            {ledger.entries.map((e) => (
                              <tr key={e.id} className="border-t border-gray-50">
                                <td className="py-2 pr-3 font-mono">{e.orderNumber}{e.type === 'reversal' && <span className="ml-1 text-red-600">(refund)</span>}</td>
                                <td className="pr-3">{date(e.deliveredAt || e.createdAt)}</td>
                                <td className="pr-3 text-right">{inr(e.grossPaise)}</td>
                                <td className="pr-3 text-right">{inr(e.supplyCostPaise)}</td>
                                <td className="pr-3 text-right">{inr(e.shippingPaise)}{e.shippingSource === 'estimate' && <span className="ml-1 text-amber-600" title="Estimated — no actual courier charge recorded">est.</span>}{e.shippingSource === 'vendor_set' && <span className="ml-1 text-gray-400" title="The vendor's own shipping charge">set</span>}</td>
                                <td className="pr-3 text-right">{inr(e.platformFeePaise)}</td>
                                <td className={`pr-3 text-right font-semibold ${e.netPaise < 0 ? 'text-red-600' : ''}`}>{inr(e.netPaise)}</td>
                                <td className="pr-3"><StatusChip status={e.status} />{e.status === 'unsettled' && <span className="block text-gray-400 mt-0.5">from {date(e.availableAt)}</span>}</td>
                                <td>{e.type === 'order_settlement' && e.status === 'unsettled' && (
                                  <button onClick={() => settle(e.orderId, true)} disabled={busy} className="text-amber-700 hover:underline flex items-center gap-1"><FiRefreshCw /> Recalculate</button>
                                )}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {ledger.payouts.length > 0 && (
                        <div className="mt-4">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Payouts</p>
                          {ledger.payouts.map((p) => (
                            <p key={p.id} className="text-xs text-gray-600 tabular-nums">
                              {date(p.createdAt)} · <span className="font-semibold">{inr(p.amountPaise)}</span> · {p.destination} · ref {p.reference} · {p.entryCount} order line(s)
                            </p>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 bg-white rounded-xl border border-gray-100 p-4">
        <p className="font-semibold text-sm text-gray-800">Post or recalculate an order&apos;s vendor earnings</p>
        <p className="text-xs text-gray-500 mt-0.5 mb-3">Earnings are posted automatically when an order is marked delivered. Use this if that step failed, or after correcting an order&apos;s actual shipping cost.</p>
        <div className="flex flex-wrap gap-2">
          <input id="settle-order" value={settleOrder} onChange={(e) => setSettleOrder(e.target.value)} placeholder="Order number, e.g. TBJ1727…" className={`${inp} max-w-xs`} />
          <button onClick={() => settle(settleOrder.trim(), true)} disabled={busy || !settleOrder.trim()}
            className="px-4 py-2 bg-maroon-950 text-white rounded-lg text-sm font-semibold disabled:opacity-40">Post / recalculate</button>
        </div>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form onSubmit={saveVendor} className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">{form.mode === 'create' ? 'Add vendor' : 'Edit vendor'}</h2>
              <button type="button" onClick={() => setForm(null)} aria-label="Close"><FiX /></button>
            </div>
            <input id="v-name" required placeholder="Business name" value={form.values.name} onChange={(e) => setField('name', e.target.value)} className={inp} />
            <div className="grid grid-cols-2 gap-3">
              <input id="v-contact" placeholder="Contact person" value={form.values.contactName} onChange={(e) => setField('contactName', e.target.value)} className={inp} />
              <input id="v-phone" placeholder="Phone" value={form.values.phone} onChange={(e) => setField('phone', e.target.value)} className={inp} />
            </div>
            {form.mode === 'create' ? (
              <div className="grid grid-cols-2 gap-3">
                <input id="v-email" required type="email" placeholder="Login email" value={form.values.email} onChange={(e) => setField('email', e.target.value)} className={inp} />
                <input id="v-password" required minLength={8} type="password" placeholder="Login password (8+ chars)" value={form.values.password} onChange={(e) => setField('password', e.target.value)} className={inp} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <select id="v-status" value={form.values.status} onChange={(e) => setField('status', e.target.value)} className={inp}>
                  <option value="active">Selling (active)</option>
                  <option value="suspended">Suspended — products can&apos;t be ordered</option>
                </select>
                <label className="flex items-center gap-2 text-sm"><input id="v-login" type="checkbox" checked={!!form.values.loginActive} onChange={(e) => setField('loginActive', e.target.checked)} /> Dashboard login enabled</label>
                <input id="v-newpw" type="password" minLength={8} placeholder="New login password (optional)" value={form.values.newPassword} onChange={(e) => setField('newPassword', e.target.value)} className={`${inp} col-span-2`} />
              </div>
            )}
            <label className="block text-xs font-semibold text-gray-500">Platform fee (% of item sales)
              <input id="v-fee" type="number" min="0" max="50" step="0.01" value={form.values.platformFeePercent} onChange={(e) => setField('platformFeePercent', e.target.value)} className={`${inp} mt-1`} />
            </label>
            <label className="block text-xs font-semibold text-gray-500">Default margin % for products this vendor adds
              <input id="v-margin" type="number" min="0" max="99.99" step="0.01" placeholder="Blank = set each product’s margin yourself" value={form.values.defaultMarginPercent} onChange={(e) => setField('defaultMarginPercent', e.target.value)} className={`${inp} mt-1`} />
              <span className="block font-normal text-gray-400 mt-1">Tulsi keeps this % of the selling price on each new piece. You can still change any product&apos;s margin.</span>
            </label>
            <div className="border-t border-gray-100 pt-3 space-y-2">
              <label className="flex items-start gap-2 text-sm">
                <input id="v-selffulfil" type="checkbox" className="mt-1" checked={!!form.values.selfFulfil} onChange={(e) => setField('selfFulfil', e.target.checked)} />
                <span><span className="font-semibold text-gray-700">Vendor ships their own orders</span>
                  <span className="block text-xs text-gray-400">On orders with only this vendor&apos;s pieces, they see the delivery address and confirm, pack, ship and deliver from their portal. Orders mixing several sellers stay with Tulsi.</span></span>
              </label>
              {form.values.selfFulfil && (
                <label className="block text-xs font-semibold text-gray-500">Their pickup nickname in Tulsi&apos;s Shiprocket (optional)
                  <input id="v-pickup" maxLength={60} placeholder="Blank = they enter their own courier's tracking" value={form.values.shiprocketPickupLocation} onChange={(e) => setField('shiprocketPickupLocation', e.target.value)} className={`${inp} mt-1`} />
                </label>
              )}
            </div>
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-semibold text-gray-500 mb-2">Payout destination</p>
              <div className="flex gap-4 text-sm mb-2">
                <label className="flex items-center gap-1.5"><input type="radio" name="pm" checked={form.values.payoutMethod === 'upi'} onChange={() => setField('payoutMethod', 'upi')} /> UPI</label>
                <label className="flex items-center gap-1.5"><input type="radio" name="pm" checked={form.values.payoutMethod === 'bank'} onChange={() => setField('payoutMethod', 'bank')} /> Bank account</label>
              </div>
              {form.values.payoutMethod === 'upi' ? (
                <input id="v-upi" required placeholder="UPI ID, e.g. lakshmigold@okaxis" value={form.values.upiId} onChange={(e) => setField('upiId', e.target.value)} className={inp} />
              ) : (
                <div className="space-y-2">
                  <input id="v-acname" required placeholder="Account holder name" value={form.values.accountName} onChange={(e) => setField('accountName', e.target.value)} className={inp} />
                  <div className="grid grid-cols-2 gap-2">
                    <input id="v-acno" required inputMode="numeric" placeholder="Account number" value={form.values.accountNumber} onChange={(e) => setField('accountNumber', e.target.value)} className={inp} />
                    <input id="v-ifsc" required placeholder="IFSC" value={form.values.ifsc} onChange={(e) => setField('ifsc', e.target.value.toUpperCase())} className={inp} />
                  </div>
                </div>
              )}
            </div>
            <button disabled={busy} className="w-full py-2.5 bg-maroon-950 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
              {busy ? 'Saving…' : form.mode === 'create' ? 'Add vendor' : 'Save changes'}
            </button>
          </form>
        </div>
      )}

      {payout && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form onSubmit={submitPayout} className="bg-white rounded-2xl w-full max-w-md p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">{payout.all ? 'Record bulk payout' : `Pay out ${payout.vendor.name}`}</h2>
              <button type="button" onClick={() => setPayout(null)} aria-label="Close"><FiX /></button>
            </div>
            {payout.all ? (
              <div className="text-sm text-gray-600 space-y-1">
                <p>Transfer each vendor&apos;s available balance from your bank, then record the batch here:</p>
                {payableVendors.map((v) => (
                  <p key={v.id} className="tabular-nums">• {v.name}: <span className="font-semibold">{inr(v.summary.availablePaise)}</span> → {destination(v.payout)}</p>
                ))}
              </div>
            ) : (
              <div className="text-sm text-gray-600">
                <p>Transfer <span className="font-bold text-gray-900 tabular-nums">{inr(payout.vendor.summary.availablePaise)}</span> to:</p>
                <p className="font-mono text-xs bg-gray-50 rounded p-2 mt-1 select-all">{destination(payout.vendor.payout)}</p>
                <p className="text-xs text-gray-400 mt-1">Only earnings past the {RETURN_WINDOW_DAYS}-day return window are included.</p>
              </div>
            )}
            <input id="p-ref" name="reference" required placeholder={payout.all ? 'Bank batch reference' : 'UTR / transaction reference'} className={inp} />
            <input id="p-note" name="note" placeholder="Note (optional)" className={inp} />
            <p className="text-xs text-gray-500">This records the payout and marks those earnings as settled. It does not move money — make the transfer first.</p>
            <button disabled={busy} className="w-full py-2.5 bg-green-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
              {busy ? 'Recording…' : 'Record payout'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
