'use client';
import { useState, useEffect, useCallback } from 'react';
import { FiUserPlus, FiRefreshCw, FiX, FiExternalLink, FiCheck, FiCopy, FiInstagram } from 'react-icons/fi';
import toast from 'react-hot-toast';

const date = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—');
const inp = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white';
const TABS = [['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['', 'All']];

const CHIP = {
  PENDING: 'bg-amber-50 text-amber-700', PROCESSING: 'bg-blue-50 text-blue-700',
  APPROVED: 'bg-green-50 text-green-700', REJECTED: 'bg-red-50 text-red-700',
};

/* Where staff verify the tax ID on the GST portal. */
const GST_SEARCH = 'https://services.gst.gov.in/services/searchtp';

function Row({ k, children }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-gray-400">{k}</dt>
      <dd className="text-gray-800 break-words">{children}</dd>
    </div>
  );
}

export default function VendorApplicationsPage() {
  const [tab, setTab] = useState('PENDING');
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [approved, setApproved] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/vendor-applications${tab ? `?status=${tab}` : ''}`);
      const d = await res.json();
      if (!d.success) throw new Error(d.message);
      setApps(d.data);
    } catch (e) {
      toast.error(e.message || 'Could not load applications');
    } finally {
      setLoading(false);
    }
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  const close = () => { setOpen(null); setRejecting(false); setReason(''); };

  async function decide(action) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/vendor-applications/${open.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'reject' ? { action, reason } : { action }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.message);
      if (action === 'approve') {
        setApproved({ ...d.data, name: open.full_name, business: open.business_name });
        toast.success(`${open.business_name} is now a vendor`);
      } else {
        toast.success(d.data.emailed ? 'Rejected — applicant emailed' : 'Rejected (email not sent — check SMTP)');
      }
      close();
      load();
    } catch (e) {
      toast.error(e.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  const copy = (text) => navigator.clipboard?.writeText(text).then(() => toast.success('Copied'), () => {});

  return (
    <div className="p-4 md:p-6 max-w-6xl">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><FiUserPlus /> Seller Applications</h1>
          <p className="text-sm text-gray-500">Verify the tax ID, then approve to create the vendor&apos;s account.</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50" aria-label="Refresh"><FiRefreshCw /></button>
      </div>

      <div className="flex gap-1 mb-4 overflow-x-auto" role="tablist">
        {TABS.map(([v, label]) => (
          <button key={label} role="tab" aria-selected={tab === v} onClick={() => setTab(v)}
            className={`px-3.5 py-1.5 rounded-full text-sm whitespace-nowrap ${tab === v ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 py-10 text-center">Loading…</p>
      ) : apps.length === 0 ? (
        <p className="text-sm text-gray-400 py-10 text-center bg-white rounded-xl border border-gray-100">No applications here.</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-100">
          {apps.map((a) => (
            <button key={a.id} onClick={() => setOpen(a)} className="w-full text-left px-4 py-3 hover:bg-gray-50 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-semibold text-gray-900 min-w-[10rem]">{a.business_name}</span>
              <span className="text-sm text-gray-500">{a.full_name} · {a.city}</span>
              <span className="text-xs text-gray-400 font-mono">{a.tax_type === 'GST' ? 'GST' : 'Enrolment'} {a.tax_id_number}</span>
              <span className="ml-auto flex items-center gap-3">
                <span className="text-xs text-gray-400">{date(a.created_at)}</span>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${CHIP[a.status] || 'bg-gray-100 text-gray-600'}`}>{a.status}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={(e) => e.target === e.currentTarget && close()}>
          <aside className="w-full max-w-lg h-full bg-white overflow-y-auto p-5 md:p-6" role="dialog" aria-modal="true" aria-labelledby="app-title">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 id="app-title" className="text-lg font-bold text-gray-900">{open.business_name}</h2>
                <p className="text-xs text-gray-400">Applied {date(open.created_at)}</p>
              </div>
              <button onClick={close} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="Close"><FiX /></button>
            </div>

            <h3 className="text-[11px] uppercase tracking-widest text-gray-400 mt-2">Contact</h3>
            <dl className="divide-y divide-gray-50">
              <Row k="Name">{open.full_name}</Row>
              <Row k="WhatsApp"><a className="text-amber-700 underline" href={`https://wa.me/91${open.phone}`} target="_blank" rel="noopener noreferrer">+91 {open.phone}</a></Row>
              <Row k="Email">{open.email}</Row>
              <Row k="Instagram">
                <a className="inline-flex items-center gap-1 text-amber-700 underline" href={`https://instagram.com/${open.instagram_handle}`} target="_blank" rel="noopener noreferrer"><FiInstagram /> @{open.instagram_handle}</a>
              </Row>
            </dl>

            <h3 className="text-[11px] uppercase tracking-widest text-gray-400 mt-5">Tax — verify before approving</h3>
            <dl className="divide-y divide-gray-50">
              <Row k={open.tax_type === 'GST' ? 'GSTIN' : 'Enrolment ID'}>
                <span className="font-mono">{open.tax_id_number}</span>{' '}
                <button onClick={() => copy(open.tax_id_number)} className="text-gray-400 hover:text-gray-700 align-middle" aria-label="Copy"><FiCopy /></button>
              </Row>
              <Row k="PAN"><span className="font-mono">{open.pan_number || '—'}</span></Row>
              {open.gst_certificate_url && (
                <Row k="Certificate"><a className="inline-flex items-center gap-1 text-amber-700 underline" href={open.gst_certificate_url} target="_blank" rel="noopener noreferrer">Open file <FiExternalLink /></a></Row>
              )}
            </dl>
            <a href={GST_SEARCH} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-amber-700 underline">Search taxpayer on the GST portal <FiExternalLink /></a>

            <h3 className="text-[11px] uppercase tracking-widest text-gray-400 mt-5">Pickup warehouse</h3>
            <p className="text-sm text-gray-800 py-1.5">{open.warehouse_address}{open.landmark ? `, ${open.landmark}` : ''}, {open.city}, {open.state} — {open.pincode}</p>

            <h3 className="text-[11px] uppercase tracking-widest text-gray-400 mt-5">Bank</h3>
            <dl className="divide-y divide-gray-50">
              <Row k="Holder">{open.bank_details?.account_holder}</Row>
              <Row k="Bank">{open.bank_details?.bank_name}</Row>
              <Row k="Account"><span className="font-mono">{open.bank_details?.account_masked}</span> <span className="text-xs text-gray-400">(encrypted)</span></Row>
              <Row k="IFSC"><span className="font-mono">{open.bank_details?.ifsc}</span></Row>
              {open.bank_details?.upi_id && <Row k="UPI">{open.bank_details.upi_id}</Row>}
            </dl>

            {open.status === 'REJECTED' && open.rejection_reason && (
              <p className="mt-4 text-sm rounded-lg bg-red-50 text-red-700 px-3 py-2">Rejected: {open.rejection_reason}</p>
            )}
            {open.last_error && open.status === 'PENDING' && (
              <p className="mt-4 text-sm rounded-lg bg-amber-50 text-amber-800 px-3 py-2">Last approval failed: {open.last_error}</p>
            )}

            {open.status === 'PENDING' && (
              <div className="mt-6 border-t border-gray-100 pt-5">
                {rejecting ? (
                  <div className="space-y-3">
                    <label className="block text-sm font-medium text-gray-700" htmlFor="reject-reason">Reason (emailed to the applicant)</label>
                    <textarea id="reject-reason" rows={3} className={inp} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500}
                      placeholder="e.g. GSTIN is cancelled on the GST portal" />
                    <div className="flex gap-2">
                      <button onClick={() => setRejecting(false)} className="px-4 py-2 rounded-lg border border-gray-200 text-sm">Cancel</button>
                      <button onClick={() => decide('reject')} disabled={busy || !reason.trim()} className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold disabled:opacity-50">
                        {busy ? 'Rejecting…' : 'Reject application'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => decide('approve')} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold disabled:opacity-50">
                      <FiCheck /> {busy ? 'Creating account…' : 'Approve & Create Vendor Account'}
                    </button>
                    <button onClick={() => setRejecting(true)} className="px-4 py-2.5 rounded-lg border border-red-200 text-red-700 text-sm font-semibold hover:bg-red-50">Reject</button>
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      )}

      {approved && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl p-6" role="dialog" aria-modal="true" aria-labelledby="approved-title">
            <h2 id="approved-title" className="text-lg font-bold text-gray-900">{approved.business} is live 🎉</h2>
            <p className="text-sm text-gray-500 mt-1">
              {approved.emailed ? 'Login details were emailed.' : 'The welcome email did not send — share the details below.'} This password is shown only once.
            </p>
            <dl className="mt-4 rounded-xl bg-gray-50 px-4 py-2">
              <Row k="Login">{approved.email}</Row>
              <Row k="Password">
                <span className="font-mono">{approved.tempPassword}</span>{' '}
                <button onClick={() => copy(approved.tempPassword)} className="text-gray-400 hover:text-gray-700 align-middle" aria-label="Copy password"><FiCopy /></button>
              </Row>
              {approved.launchOfferUntil && <Row k="Launch offer">0% platform fee until {new Date(approved.launchOfferUntil).toLocaleDateString('en-IN')}</Row>}
              <Row k="Shiprocket">{approved.pickup?.status === 'active' ? 'Pickup address registered' : approved.pickup?.message || approved.pickup?.status || '—'}</Row>
            </dl>
            <div className="mt-5 flex flex-wrap gap-2">
              <a href={approved.whatsappUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#25D366] text-white text-sm font-semibold">
                Send on WhatsApp
              </a>
              <button onClick={() => setApproved(null)} className="px-4 py-2.5 rounded-lg border border-gray-200 text-sm">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
