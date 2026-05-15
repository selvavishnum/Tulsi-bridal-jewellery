'use client';

import { useState, useEffect, useMemo } from 'react';
import { FiAlertCircle, FiRefreshCw, FiTrash2 } from 'react-icons/fi';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { format, parseISO } from 'date-fns';
import toast from 'react-hot-toast';

function safeFormat(str) {
  if (!str) return '—';
  try { return format(parseISO(str), 'dd MMM yyyy'); } catch { return str; }
}

const STATUS_OPTIONS = ['open', 'in-progress', 'resolved', 'closed'];

const STATUS_COLORS = {
  open:          'bg-red-500',
  'in-progress': 'bg-yellow-400',
  resolved:      'bg-green-500',
  closed:        'bg-gray-400',
};

const STATUS_BADGE = {
  open:          'bg-red-100 text-red-700',
  'in-progress': 'bg-yellow-100 text-yellow-700',
  resolved:      'bg-green-100 text-green-700',
  closed:        'bg-gray-100 text-gray-600',
};

const PRIORITY_BADGE = {
  high:   'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low:    'bg-blue-100 text-blue-700',
};

const TABS = [
  { key: 'all',         label: 'All' },
  { key: 'open',        label: 'Open' },
  { key: 'in-progress', label: 'In Progress' },
  { key: 'resolved',    label: 'Resolved' },
  { key: 'closed',      label: 'Closed' },
];

function ComplaintCard({ complaint, onStatusChange, onNoteChange, onDelete }) {
  const status   = complaint.status || 'open';
  const [note, setNote] = useState(complaint.adminNote || '');
  const [saving, setSaving] = useState(false);

  async function saveNote() {
    if (note === (complaint.adminNote || '')) return;
    setSaving(true);
    await onNoteChange(complaint.id, note);
    setSaving(false);
  }

  const barColor   = STATUS_COLORS[status] || STATUS_COLORS.open;
  const badgeCls   = STATUS_BADGE[status] || STATUS_BADGE.open;
  const name       = complaint.customerName || complaint.name || 'Unknown';
  const phone      = complaint.phone || complaint.customerPhone || '';
  const email      = complaint.email || complaint.customerEmail || '';
  const subject    = complaint.subject || complaint.title || 'No Subject';
  const message    = complaint.message || complaint.description || '';
  const priority   = complaint.priority;

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden flex">
      {/* Left color bar */}
      <div className={`w-1 flex-shrink-0 ${barColor}`} />

      <div className="flex-1 p-4 space-y-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <p className="font-semibold text-gray-800">{name}</p>
            <div className="flex flex-wrap items-center gap-2 mt-0.5">
              {phone && <p className="text-xs text-gray-400">{phone}</p>}
              {email && <p className="text-xs text-gray-400">{email}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${badgeCls}`}>
              {status}
            </span>
            {priority && (
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${PRIORITY_BADGE[priority] || 'bg-gray-100 text-gray-600'}`}>
                {priority}
              </span>
            )}
            <button
              onClick={() => onDelete(complaint.id)}
              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition ml-1"
              title="Delete"
            >
              <FiTrash2 className="text-sm" />
            </button>
          </div>
        </div>

        {/* Subject + message */}
        <div>
          <p className="font-semibold text-gray-700 text-sm">{subject}</p>
          {message && <p className="text-sm text-gray-500 mt-1 leading-relaxed">{message}</p>}
          <p className="text-xs text-gray-400 mt-1">{safeFormat(complaint.createdAt)}</p>
        </div>

        {/* Admin note */}
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1">Admin Note</label>
          <div className="flex gap-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={saveNote}
              rows={2}
              placeholder="Add an internal note..."
              className="flex-1 text-sm px-3 py-2 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-amber-400 resize-none"
            />
            <button
              onClick={saveNote}
              disabled={saving}
              className="self-end px-3 py-2 text-xs font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-400 disabled:opacity-50 transition"
            >
              {saving ? '...' : 'Save'}
            </button>
          </div>
        </div>

        {/* Status dropdown */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-gray-500">Status:</label>
          <select
            value={status}
            onChange={(e) => onStatusChange(complaint.id, e.target.value)}
            className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-amber-400 capitalize"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s} className="capitalize">{s}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

export default function ComplaintsPage() {
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState('all');

  function fetchComplaints() {
    setLoading(true);
    fetch('/api/admin/complaints')
      .then((r) => r.json())
      .then((d) => { if (d.success) setComplaints(d.data); })
      .catch(() => toast.error('Failed to load complaints'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchComplaints(); }, []);

  const stats = useMemo(() => ({
    total:    complaints.length,
    open:     complaints.filter((c) => !c.status || c.status === 'open').length,
    resolved: complaints.filter((c) => c.status === 'resolved').length,
    closed:   complaints.filter((c) => c.status === 'closed').length,
  }), [complaints]);

  const filtered = useMemo(() => {
    if (tab === 'all') return complaints;
    return complaints.filter((c) => (c.status || 'open') === tab);
  }, [complaints, tab]);

  async function handleStatusChange(id, status) {
    try {
      const res = await fetch('/api/admin/complaints', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      const d = await res.json();
      if (d.success) {
        setComplaints((prev) => prev.map((c) => c.id === id ? { ...c, status } : c));
        toast.success('Status updated');
      } else {
        toast.error(d.message || 'Failed to update');
      }
    } catch {
      toast.error('Network error');
    }
  }

  async function handleNoteChange(id, adminNote) {
    try {
      const res = await fetch('/api/admin/complaints', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, adminNote }),
      });
      const d = await res.json();
      if (d.success) {
        setComplaints((prev) => prev.map((c) => c.id === id ? { ...c, adminNote } : c));
        toast.success('Note saved');
      } else {
        toast.error(d.message || 'Failed to save');
      }
    } catch {
      toast.error('Network error');
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this complaint?')) return;
    try {
      const res = await fetch(`/api/admin/complaints?id=${id}`, { method: 'DELETE' });
      const d = await res.json();
      if (d.success) {
        setComplaints((prev) => prev.filter((c) => c.id !== id));
        toast.success('Complaint deleted');
      } else {
        toast.error(d.message || 'Failed to delete');
      }
    } catch {
      toast.error('Network error');
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Complaints & Issues</h1>
          <p className="text-sm text-gray-400 mt-0.5">Track and resolve customer issues</p>
        </div>
        <button
          onClick={fetchComplaints}
          className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition"
        >
          <FiRefreshCw className={`text-sm ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total',    value: stats.total,    color: 'bg-blue-50 text-blue-700' },
          { label: 'Open',     value: stats.open,     color: 'bg-red-50 text-red-700' },
          { label: 'Resolved', value: stats.resolved, color: 'bg-green-50 text-green-700' },
          { label: 'Closed',   value: stats.closed,   color: 'bg-gray-50 text-gray-700' },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl px-4 py-3 flex items-center gap-3 ${s.color}`}>
            <FiAlertCircle className="text-xl flex-shrink-0 opacity-60" />
            <div>
              <p className="text-2xl font-bold leading-none">{s.value}</p>
              <p className="text-xs font-medium opacity-70 mt-0.5">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              tab === t.key
                ? 'bg-amber-500 text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm px-6 py-16 text-center">
          <FiAlertCircle className="text-4xl text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No complaints.</p>
          <p className="text-gray-400 text-sm mt-1">Customer complaints submitted via the contact form will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((complaint) => (
            <ComplaintCard
              key={complaint.id}
              complaint={complaint}
              onStatusChange={handleStatusChange}
              onNoteChange={handleNoteChange}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
