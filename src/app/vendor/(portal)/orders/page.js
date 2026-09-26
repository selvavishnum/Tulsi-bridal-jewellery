'use client';
import { useMemo, useState } from 'react';
import Image from 'next/image';
import toast from 'react-hot-toast';
import {
  FiSearch, FiRefreshCw, FiChevronDown, FiChevronUp, FiPrinter, FiTruck, FiPhone, FiMail, FiX, FiMenu, FiExternalLink, FiEdit2,
} from 'react-icons/fi';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { cldThumb } from '@/lib/cloudinaryImage';
import { escapeHtml } from '@/lib/escapeHtml';
import {
  VENDOR_ORDER_TABS, VENDOR_ORDER_STATUSES, STATUS_LABEL, filterVendorOrders,
} from '@/lib/vendorOrders';
import { Loading, Pill, inr, shortDate, sendJson, useVendorData } from '@/components/vendor/ui';

const POLL_MS = 30000;
const STATUS_STYLE = {
  pending: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-700',
  processing: 'bg-orange-100 text-orange-700',
  shipped: 'bg-purple-100 text-purple-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};
const TAB_DOT = {
  new: 'bg-yellow-500', confirmed: 'bg-blue-500', processing: 'bg-orange-500', shipped: 'bg-purple-500',
  delivered: 'bg-green-600', cod: 'bg-amber-500', action: 'bg-red-500', cancelled: 'bg-red-400', all: 'bg-stone-400',
};
const COURIERS = ['Shiprocket', 'BlueDart', 'Delhivery', 'DTDC', 'Ecom Express', 'India Post', 'XpressBees', 'Shadowfax', 'Professional', 'Other'];

/* ── Delivery label: vendor warehouse → customer. Every value is escaped —
   it's written into a same-origin popup. ── */
function printLabel(order, profile) {
  const e = escapeHtml;
  const c = order.customer;
  const p = profile?.pickupAddress || {};
  const from = [p.line1, p.line2, [p.city, p.state].filter(Boolean).join(', '), p.pincode].filter(Boolean).map(e).join('<br/>');
  const items = order.items.map((i) => `<tr><td>${e(i.name)}${i.sku ? ` <small>(${e(i.sku)})</small>` : ''}</td><td style="text-align:center">× ${e(i.quantity)}</td></tr>`).join('');
  const cod = order.paymentMethod === 'cod' && order.paymentStatus !== 'paid';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Label #${e(order.orderNumber)}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;color:#000}@page{size:A6 portrait;margin:0}
.page{width:105mm;padding:5mm;display:flex;flex-direction:column;gap:3mm}.box{border:1.5px solid #000;border-radius:2px;padding:3mm}
.lbl{font-size:7pt;font-weight:700;letter-spacing:1.5px;color:#555;text-transform:uppercase;margin-bottom:1mm}
.to{font-size:13pt;font-weight:900;text-transform:uppercase}.addr{font-size:10pt;line-height:1.5;font-weight:600}
.bar{background:#000;color:#fff;padding:2mm 3mm;display:flex;justify-content:space-between;font-size:9pt;font-weight:700}
table{width:100%;font-size:8pt;border-collapse:collapse}td{padding:1mm 0;border-bottom:1px solid #eee}
.cod{border:2px solid #000;text-align:center;font-weight:900;font-size:12pt;padding:2mm}</style></head><body><div class="page">
<div class="bar"><span>ORDER #${e(order.orderNumber)}</span><span>${e(order.courierName || '')} ${e(order.trackingNumber || '')}</span></div>
<div class="box"><div class="lbl">Ship to</div><div class="to">${e(c.name)}</div>
<div class="addr">${e(c.street)}<br/>${e(c.city)}${c.city && c.state ? ', ' : ''}${e(c.state)} — ${e(c.pincode)}<br/>📞 ${e(c.phone)}</div></div>
${cod ? `<div class="cod">COLLECT CASH ₹${e(order.charges?.total ?? order.itemsTotal)}</div>` : '<div class="cod">PREPAID — DO NOT COLLECT</div>'}
<div class="box"><div class="lbl">From (return address)</div><div style="font-size:8.5pt;line-height:1.5"><b>${e(profile?.name || '')}</b> for Tulsi Bridal Jewellery<br/>${from || '—'}${profile?.phone ? `<br/>📞 ${e(profile.phone)}` : ''}</div></div>
<div class="box"><div class="lbl">Contents</div><table>${items}</table></div>
</div><script>window.onload=function(){window.print();}</script></body></html>`;
  const w = window.open('', '_blank', 'width=480,height=720');
  if (w) { w.document.write(html); w.document.close(); } else toast.error('Allow pop-ups to print the label.');
}

function whatsappLink(order) {
  const phone = String(order.customer.phone || '').replace(/\D/g, '').slice(-10);
  if (phone.length !== 10) return null;
  const text = `Hi ${order.customer.name || ''}, regarding your Tulsi Jewels order #${order.orderNumber} — `;
  return `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`;
}

/* ── Update status modal ── */
function StatusModal({ order, onClose, onSaved, onShip }) {
  const [saving, setSaving] = useState(null);
  async function choose(status) {
    setSaving(status);
    try {
      const res = await fetch(`/api/vendor/orders/${order.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      const d = await res.json();
      if (!d.success) throw new Error(d.message);
      toast.success(d.note || `Order #${order.orderNumber} is now ${STATUS_LABEL[status]}`, { duration: d.note ? 8000 : 4000 });
      /* Packed books the courier automatically — say what happened. */
      for (const r of d.dispatch?.results || []) {
        if (r.ok) toast.success(`Courier booked — AWB ${r.awb}${r.courierName ? ` (${r.courierName})` : ''}`, { duration: 8000 });
        else toast.error(`Courier not booked: ${r.error}`, { duration: 12000 });
      }
      onSaved(d.data);
      onClose();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(null);
    }
  }
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="status-title">
      <div className="bg-white rounded-2xl w-full max-w-sm p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 id="status-title" className="font-bold text-stone-800">Update order #{order.orderNumber}</h3>
          <button onClick={onClose} aria-label="Close" className="text-stone-400 hover:text-stone-600"><FiX /></button>
        </div>
        <div className="space-y-2">
          {VENDOR_ORDER_STATUSES.map((s) => {
            const current = order.status === s;
            const allowed = order.nextStatuses.includes(s);
            /* Shipped needs a courier + tracking number: open that form
               instead of refusing the click. */
            const needsTracking = s === 'shipped' && !order.trackingNumber;
            return (
              <button key={s} disabled={!allowed || saving} onClick={() => (needsTracking ? (onClose(), onShip(order)) : choose(s))}
                className={`w-full py-2.5 px-4 rounded-xl text-sm font-semibold flex items-center justify-between transition
                  ${current ? 'bg-wine-700 text-white' : allowed ? 'bg-stone-100 text-stone-800 hover:bg-wine-700/10 hover:text-wine-700' : 'bg-stone-50 text-stone-300 cursor-not-allowed'}`}>
                <span className="flex items-center gap-2">{s === 'shipped' && <FiTruck />}{STATUS_LABEL[s]}</span>
                {current ? <span className="text-xs opacity-75">Current</span> : saving === s ? <LoadingSpinner size="sm" /> : needsTracking && allowed ? <span className="text-xs text-stone-500 font-normal">add tracking →</span> : null}
              </button>
            );
          })}
        </div>
        {order.nextStatuses.includes('shipped') && !order.trackingNumber && (
          <p className="text-xs text-stone-500 mt-3">Choosing <b>Shipped</b> asks for the courier and tracking number — the customer gets them by email.</p>
        )}
        {order.paymentMethod !== 'cod' && ['pending', 'confirmed', 'processing'].includes(order.status) && (
          <p className="text-xs text-stone-500 mt-3">Prepaid orders are cancelled by Tulsi so the customer is refunded.</p>
        )}
        <button onClick={onClose} className="w-full mt-3 py-2.5 border border-stone-200 text-stone-500 text-sm rounded-xl hover:bg-stone-50">Close</button>
      </div>
    </div>
  );
}

/* ── Add tracking / ship modal ── */
function ShipModal({ order, canShiprocket, onClose, onSaved, profile }) {
  const pa = profile?.pickupAddress || {};
  const pickupText = [pa.line1, pa.line2, pa.city, pa.pincode].filter(Boolean).join(', ');
  const [courierName, setCourierName] = useState(order.courierName || 'Delhivery');
  const [trackingNumber, setTrackingNumber] = useState(order.trackingNumber || '');
  const [busy, setBusy] = useState(null);
  async function submit(body, kind) {
    setBusy(kind);
    try {
      const res = await fetch(`/api/vendor/orders/${order.id}/ship`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!d.success) throw new Error(d.message || 'Could not ship');
      const saved = d.data;
      toast.success(d.message || `Shipped — tracking ${saved.trackingNumber}. The customer has been notified.`, { duration: 8000 });
      onSaved(saved);
      onClose();
    } catch (e) {
      toast.error(e.message, { duration: 8000 });
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="ship-title">
      <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 id="ship-title" className="font-bold text-stone-800 flex items-center gap-2"><FiTruck /> Ship order #{order.orderNumber}</h3>
          <button onClick={onClose} aria-label="Close" className="text-stone-400 hover:text-stone-600"><FiX /></button>
        </div>
        {canShiprocket && (
          <div className="rounded-xl border border-wine-700/20 bg-wine-700/5 p-3">
            <p className="text-sm font-semibold text-stone-800">Book with Tulsi’s Shiprocket</p>
            <p className="text-xs text-stone-500 mb-2">The courier collects from your warehouse{pickupText ? <>: <b className="text-stone-700">{pickupText}</b></> : ''} (change it in Store Profile). The courier charge is taken from your earnings.</p>
            <button onClick={() => submit({ shiprocket: true }, 'sr')} disabled={!!busy}
              className="px-4 py-2 rounded-lg bg-wine-700 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
              {busy === 'sr' && <LoadingSpinner size="sm" />} Book pickup
            </button>
          </div>
        )}
        {order.fulfilledBy === 'vendor' && <form onSubmit={(e) => { e.preventDefault(); submit({ courierName, trackingNumber }, 'manual'); }} className="space-y-3">
          <p className="text-sm font-semibold text-stone-800">{canShiprocket ? 'Or enter your own courier' : 'Your courier'}</p>
          <label className="block">
            <span className="block text-xs font-semibold text-stone-600 mb-1">Courier partner</span>
            <select id="ship-courier" value={courierName} onChange={(e) => setCourierName(e.target.value)} className="w-full px-3 py-2.5 border border-stone-300 rounded-xl text-sm bg-white">
              {COURIERS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-stone-600 mb-1">Tracking / AWB number</span>
            <input id="ship-awb" required value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value.replace(/[^A-Za-z0-9-]/g, ''))}
              className="w-full px-3 py-2.5 border border-stone-300 rounded-xl text-sm font-mono" placeholder="e.g. 1234567890" />
          </label>
          <button disabled={!!busy || trackingNumber.length < 4} className="w-full py-2.5 rounded-xl bg-stone-900 text-white text-sm font-semibold disabled:opacity-50 flex justify-center gap-2">
            {busy === 'manual' && <LoadingSpinner size="sm" />} {order.status === 'shipped' ? 'Update tracking' : 'Save & mark shipped'}
          </button>
        </form>}
      </div>
    </div>
  );
}

function ResendEmailButton({ order }) {
  const [state, setState] = useState('idle');
  async function resend() {
    setState('loading');
    try {
      await sendJson(`/api/vendor/orders/${order.id}/resend-email`, 'POST');
      setState('ok');
      toast.success('Email sent to the customer');
    } catch (e) {
      setState('idle');
      toast.error(e.message);
    }
  }
  return (
    <button onClick={resend} disabled={state === 'loading' || state === 'ok'}
      className="flex items-center gap-2 w-full px-3 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-lg disabled:opacity-60">
      <FiMail /> {state === 'ok' ? 'Customer email sent ✓' : state === 'loading' ? 'Sending…' : 'Resend customer email'}
    </button>
  );
}

/* Shiprocket's own label once the parcel is booked (the courier scans
   its barcode); before that, a printable packing slip. */
function LabelButton({ order, profile }) {
  const [busy, setBusy] = useState(false);
  const booked = order.parcels.some((p) => p.booked);
  async function print() {
    if (!booked) { printLabel(order, profile); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/vendor/orders/${order.id}/label`, { method: 'POST' });
      const d = await res.json();
      if (!d.success) throw new Error(d.message);
      window.open(d.data.labelUrl, '_blank', 'noopener');
    } catch (e) {
      toast.error(e.message || 'Label not available yet', { duration: 8000 });
    } finally {
      setBusy(false);
    }
  }
  return (
    <button onClick={print} disabled={busy} className="flex items-center gap-2 w-full px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg disabled:opacity-60">
      <FiPrinter /> {busy ? 'Getting label…' : booked ? 'Print courier label' : 'Print packing slip'}
    </button>
  );
}

/* This vendor's parcel(s): AWB, courier, booking problems, live milestones. */
/* "Pickup from": the warehouse the courier collects this parcel from —
   the vendor's own (their Store Profile address, registered in Shiprocket
   as VENDOR_…) or Tulsi's. */
function PickupFrom({ pickupLocation, profile }) {
  const own = pickupLocation && pickupLocation.startsWith('VENDOR_');
  const a = profile?.pickupAddress || {};
  const address = [a.line1, a.line2, a.city, a.pincode].filter(Boolean).join(', ');
  return (
    <p className="text-stone-600">
      <span className="font-semibold text-stone-700">Pickup from:</span>{' '}
      {own ? <>your warehouse{address ? ` — ${address}` : ''}</> : 'Tulsi’s warehouse'}
      {pickupLocation && <span className="font-mono text-[11px] text-stone-400 ml-1">({pickupLocation})</span>}
    </p>
  );
}

function Parcels({ order, profile }) {
  const [tracking, setTracking] = useState(null);
  const [loading, setLoading] = useState(false);
  if (!order.parcels.length) return null;
  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/vendor/orders/${order.id}/tracking`, { cache: 'no-store' });
      const d = await res.json();
      if (!d.success) throw new Error(d.message);
      setTracking(d.data);
    } catch (e) {
      toast.error(e.message || 'Tracking unavailable');
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="mt-3 space-y-2">
      <h4 className="text-xs font-bold text-stone-500 uppercase tracking-wider">Your parcel</h4>
      {order.parcels.map((p) => (
        <div key={p.key} className="bg-white rounded-lg border border-stone-100 p-3 text-xs space-y-1">
          <PickupFrom pickupLocation={p.pickupLocation} profile={profile} />
          {p.tracking && (
            <p className={['undelivered', 'rto_initiated', 'rto_delivered', 'lost', 'cancelled'].includes(p.tracking.stage) ? 'text-red-700 font-semibold' : 'text-stone-700'}>
              Courier status: {p.tracking.text}<span className="text-stone-400 font-normal"> · {shortDate(p.tracking.at)}</span>
            </p>
          )}
          {p.booked ? (
            <p>AWB <span className="font-mono font-semibold text-stone-800">{p.awb}</span>{p.courierName ? ` · ${p.courierName}` : ''}
              {p.trackingUrl && <a href={p.trackingUrl} target="_blank" rel="noopener noreferrer" className="ml-1 text-wine-700 inline-flex items-center gap-0.5">track <FiExternalLink /></a>}
              {!p.pickupRequested && <span className="block text-amber-700">Pickup not scheduled yet — Shiprocket will schedule it, or ask Tulsi.</span>}
            </p>
          ) : (
            <p className="text-red-700">Not booked{p.error ? `: ${p.error}` : ''}</p>
          )}
        </div>
      ))}
      {order.parcels.some((p) => p.booked) && (
        <button onClick={load} disabled={loading} className="text-xs font-semibold text-wine-700 underline disabled:opacity-50">{loading ? 'Loading…' : tracking ? 'Refresh tracking' : 'Show tracking'}</button>
      )}
      {tracking && (
        <ol className="text-xs border-l-2 border-stone-200 pl-3 space-y-1.5">
          {tracking.status && <li className="font-semibold text-stone-800">{tracking.status}{tracking.etd ? ` · expected ${shortDate(tracking.etd)}` : ''}</li>}
          {(tracking.activities || []).slice(0, 8).map((a, i) => (
            <li key={i} className="text-stone-600"><span className="text-stone-400">{a.date}</span> — {a.activity}{a.location ? `, ${a.location}` : ''}</li>
          ))}
          {!tracking.activities?.length && <li className="text-stone-400">No scans yet.</li>}
        </ol>
      )}
    </div>
  );
}

/* ── One order: summary row + detail card ── */
function OrderCard({ order, open, onToggle, onStatus, onShip, profile }) {
  const fulfils = order.fulfilledBy === 'vendor';
  const wa = fulfils ? whatsappLink(order) : null;
  const e = order.earnings;
  return (
    <article className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      <button onClick={onToggle} aria-expanded={open} className="w-full text-left p-4 flex flex-wrap items-center gap-x-4 gap-y-2 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-wine-700">
        <div className="min-w-0 flex-1 basis-40">
          <p className="font-mono text-sm font-bold text-stone-800">#{order.orderNumber}</p>
          <p className="text-xs text-stone-500 truncate">{shortDate(order.createdAt)} · {order.customer.name || 'Customer'}{order.customer.city ? `, ${order.customer.city}` : ''}</p>
        </div>
        <span className="text-sm tabular-nums font-semibold">{inr(order.itemsTotal)}</span>
        <Pill className={STATUS_STYLE[order.status] || 'bg-stone-100'}>{STATUS_LABEL[order.status] || order.status}</Pill>
        <Pill className={order.paymentStatus === 'paid' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-800'}>
          {order.paymentMethod === 'cod' ? 'COD' : 'Prepaid'} · {order.paymentStatus === 'paid' ? 'paid' : 'pending'}
        </Pill>
        {open ? <FiChevronUp className="text-stone-400" /> : <FiChevronDown className="text-stone-400" />}
      </button>

      {open && (
        <div className="border-t border-stone-100 p-4 grid gap-5 lg:grid-cols-3 bg-stone-50/60">
          <section className="lg:col-span-2 space-y-4">
            <div>
              <h4 className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">Items ordered</h4>
              <ul className="space-y-2">
                {order.items.map((i, idx) => (
                  <li key={idx} className="flex items-center gap-3 bg-white rounded-lg border border-stone-100 p-2">
                    <div className="w-12 h-12 rounded-md bg-stone-100 overflow-hidden flex-shrink-0">
                      {i.image && <Image src={cldThumb(i.image, 96)} alt="" width={48} height={48} unoptimized className="w-full h-full object-cover" />}
                    </div>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-semibold text-stone-800 truncate">{i.name}</p>
                      <p className="text-xs text-stone-500">{[i.sku, i.variant].filter(Boolean).join(' · ') || '—'} · × {i.quantity}</p>
                    </div>
                    <span className="text-sm tabular-nums font-semibold">{inr(i.price * i.quantity)}</span>
                  </li>
                ))}
              </ul>
              {order.mixedSellers && <p className="text-xs text-stone-500 mt-2">This order also has pieces from other sellers — only yours are shown. Tulsi packs and ships it.</p>}
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <h4 className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">Money</h4>
                <dl className="text-sm tabular-nums bg-white rounded-lg border border-stone-100 divide-y divide-stone-100">
                  <div className="flex justify-between p-2"><dt className="text-stone-600">Your items (retail)</dt><dd>{inr(order.itemsTotal)}</dd></div>
                  {order.charges && <div className="flex justify-between p-2"><dt className="text-stone-600">Customer paid shipping{order.charges.codFee ? ' + COD fee' : ''}</dt><dd>{inr(order.charges.shipping + order.charges.codFee)}</dd></div>}
                  {e && <>
                    <div className="flex justify-between p-2"><dt className="text-stone-600">− Shipping{e.shippingIsEstimate ? ' (estimate)' : ''}</dt><dd>{inr(-e.shipping)}</dd></div>
                    <div className="flex justify-between p-2"><dt className="text-stone-600">− Tulsi margin &amp; fee</dt><dd>{inr(-e.tulsiCharges)}</dd></div>
                    <div className="flex justify-between p-2 font-bold"><dt>Your net earning</dt><dd className="text-wine-700">{inr(e.net)}</dd></div>
                  </>}
                </dl>
                <p className="text-[11px] text-stone-400 mt-1">Becomes withdrawable 7 days after delivery.</p>
              </div>
              <div>
                <h4 className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">{fulfils ? 'Ship to' : 'Customer'}</h4>
                <div className="text-sm bg-white rounded-lg border border-stone-100 p-3 space-y-0.5">
                  <p className="font-semibold text-stone-800">{order.customer.name || 'Customer'}</p>
                  {fulfils ? <>
                    <p className="text-stone-600">{order.customer.street}</p>
                    <p className="text-stone-600">{order.customer.city}{order.customer.state ? `, ${order.customer.state}` : ''} — {order.customer.pincode}</p>
                    <p className="text-stone-600 font-mono">{order.customer.phone}</p>
                  </> : <p className="text-stone-500">{order.customer.city}{order.customer.state ? `, ${order.customer.state}` : ''}</p>}
                </div>
                <p className="text-xs text-stone-500 mt-2">Payment: <b>{order.paymentMethod || '—'}</b> — {order.paymentStatus || 'pending'}</p>
                {order.trackingNumber && (
                  <p className="text-xs text-stone-500 mt-1">Tracking: <span className="font-mono text-stone-800">{order.trackingNumber}</span>{order.courierName ? ` (${order.courierName})` : ''}
                    {order.trackingUrl && <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer" className="ml-1 text-wine-700 inline-flex items-center gap-0.5">track <FiExternalLink /></a>}</p>
                )}
              </div>
            </div>
          </section>

          <section>
            <h4 className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">Quick actions</h4>
            {fulfils ? (
              <div className="space-y-2">
                <button onClick={() => onStatus(order)} disabled={!order.nextStatuses.length}
                  className="flex items-center gap-2 w-full px-3 py-2 bg-wine-700 hover:bg-wine-800 text-white text-xs font-semibold rounded-lg disabled:opacity-40">
                  <FiEdit2 /> Update status
                </button>
                <LabelButton order={order} profile={profile} />
                {['confirmed', 'processing', 'shipped'].includes(order.status) && (
                  <button onClick={() => onShip(order)} className="flex items-center gap-2 w-full px-3 py-2 bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-semibold rounded-lg">
                    <FiTruck /> {order.trackingNumber ? 'Update tracking' : 'Add tracking / Ship'}
                  </button>
                )}
                {wa && (
                  <a href={wa} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 w-full px-3 py-2 bg-green-500 hover:bg-green-400 text-white text-xs font-semibold rounded-lg">
                    <FiPhone /> WhatsApp customer
                  </a>
                )}
                <ResendEmailButton order={order} />
              </div>
            ) : order.canBookParcel || order.parcels.length ? (
              <div className="space-y-2">
                <p className="text-xs text-stone-500">This order has pieces from other sellers. Ship <b>your</b> pieces from your warehouse; Tulsi handles the rest.</p>
                {order.canBookParcel && (
                  <button onClick={() => onShip(order)} className="flex items-center gap-2 w-full px-3 py-2 bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-semibold rounded-lg">
                    <FiTruck /> Book my parcel
                  </button>
                )}
                {order.parcels.some((p) => p.booked) && <LabelButton order={order} profile={profile} />}
              </div>
            ) : (
              <p className="text-sm text-stone-500 bg-white rounded-lg border border-stone-100 p-3">
                Tulsi packs and ships this order. You&apos;ll see the tracking here once it&apos;s dispatched.
              </p>
            )}
            <Parcels order={order} profile={profile} />
          </section>
        </div>
      )}
    </article>
  );
}

export default function VendorOrdersPage() {
  const { data, error, refresh, setData } = useVendorData('/api/vendor/orders', { pollMs: POLL_MS });
  const profile = useVendorData('/api/vendor/profile');
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(null);
  const [drawer, setDrawer] = useState(false);
  const [statusFor, setStatusFor] = useState(null);
  const [shipFor, setShipFor] = useState(null);

  const orders = useMemo(() => data?.orders || [], [data]);
  const visible = useMemo(() => filterVendorOrders(orders, tab, query), [orders, tab, query]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <Loading />;

  const counts = data.counts;
  const replace = (updated) => setData((d) => {
    const list = d.orders.map((o) => (o.id === updated.id ? updated : o));
    return { ...d, orders: list };
  });
  const tabs = VENDOR_ORDER_TABS.filter((t) => t.filter);
  const pickTab = (id) => { setTab(id); setDrawer(false); };

  return (
    <div className="flex gap-5">
      {/* Filter drawer: always visible on large screens, slides in on phones */}
      {drawer && <button aria-label="Close filters" className="fixed inset-0 bg-black/30 z-30 lg:hidden" onClick={() => setDrawer(false)} />}
      <aside className={`fixed lg:static inset-y-0 left-0 z-40 w-60 bg-white lg:bg-transparent border-r lg:border-0 border-stone-200 p-3 transition-transform lg:translate-x-0 ${drawer ? 'translate-x-0' : '-translate-x-full'} lg:block flex-shrink-0`}>
        <nav aria-label="Order filters" className="space-y-0.5 lg:sticky lg:top-28">
          <button onClick={() => pickTab('dashboard')} className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-semibold ${tab === 'dashboard' ? 'bg-wine-700 text-white' : 'text-stone-700 hover:bg-stone-100'}`}>
            Overview
          </button>
          {tabs.map((t) => (
            <button key={t.id} onClick={() => pickTab(t.id)} aria-pressed={tab === t.id}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm ${tab === t.id ? 'bg-wine-700 text-white font-semibold' : 'text-stone-700 hover:bg-stone-100'}`}>
              <span className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${TAB_DOT[t.id]}`} />{t.label}</span>
              <span className={`text-xs tabular-nums px-1.5 rounded ${tab === t.id ? 'bg-white/20' : 'bg-stone-100 text-stone-600'}`}>{counts[t.id]}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setDrawer(true)} className="lg:hidden p-2 rounded-lg border border-stone-200 bg-white" aria-label="Show filters"><FiMenu /></button>
            <h1 className="font-serif text-2xl font-bold text-stone-900">Orders</h1>
          </div>
          <button onClick={refresh} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-wine-700"><FiRefreshCw /> Refresh</button>
        </div>

        {!data.selfFulfil && (
          <p className="text-sm text-stone-600 bg-white border border-stone-200 rounded-xl p-3">Tulsi packs and ships your orders. To ship them yourself, ask Tulsi to turn on self-shipping for your store.</p>
        )}

        {/* Status bar */}
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Order status">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border ${tab === t.id ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-stone-700 border-stone-200'}`}>
              {t.label} <span className="tabular-nums opacity-70">{counts[t.id]}</span>
            </button>
          ))}
        </div>

        <label className="relative block">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input id="order-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search order number, customer name or phone"
            className="w-full pl-9 pr-3 py-2.5 border border-stone-300 rounded-xl text-sm bg-white outline-none focus:border-wine-700" />
        </label>

        {tab === 'dashboard' ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className="bg-white rounded-xl border border-stone-200 p-4 text-left hover:border-wine-700/40">
                <p className="text-[11px] uppercase tracking-wide text-stone-400 font-semibold">{t.label}</p>
                <p className="text-2xl font-bold tabular-nums mt-1">{counts[t.id]}</p>
              </button>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="text-sm text-stone-500 bg-white border border-stone-200 rounded-xl p-6">
            {orders.length === 0 ? 'No orders with your pieces yet.' : query ? 'No orders match that search.' : 'No orders in this list.'}
          </p>
        ) : (
          <div className="space-y-3">
            {visible.map((o) => (
              <OrderCard key={o.id} order={o} open={openId === o.id} onToggle={() => setOpenId(openId === o.id ? null : o.id)}
                onStatus={setStatusFor} onShip={setShipFor} profile={profile.data} />
            ))}
          </div>
        )}
      </div>

      {statusFor && <StatusModal order={statusFor} onClose={() => setStatusFor(null)} onShip={setShipFor} onSaved={(u) => { replace(u); refresh(); }} />}
      {shipFor && <ShipModal order={shipFor} profile={profile.data} canShiprocket={!!profile.data?.shiprocketReady} onClose={() => setShipFor(null)} onSaved={(u) => { replace(u); refresh(); }} />}
    </div>
  );
}
