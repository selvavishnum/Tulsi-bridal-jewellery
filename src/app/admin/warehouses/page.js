'use client';
import { useState, useEffect } from 'react';
import { FiArchive, FiPlus, FiMapPin, FiEdit2, FiTrash2, FiPackage } from 'react-icons/fi';
import toast from 'react-hot-toast';

const EMPTY = { name: '', location: '', manager: '', phone: '', capacity: '', notes: '' };

export default function WarehousesPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/warehouses');
      const data = await res.json();
      if (data.success) setItems(data.data);
    } finally { setLoading(false); }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/warehouses' + (editId ? `/${editId}` : ''), {
        method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) { toast.success('Saved'); setShowForm(false); setForm(EMPTY); setEditId(null); fetchData(); }
      else toast.error(data.message);
    } finally { setSaving(false); }
  }

  async function del(id) {
    if (!confirm('Delete this warehouse?')) return;
    const res = await fetch(`/api/admin/warehouses/${id}`, { method: 'DELETE' });
    if ((await res.json()).success) { toast.success('Deleted'); fetchData(); }
  }

  function edit(w) { setForm({ name: w.name, location: w.location, manager: w.manager, phone: w.phone, capacity: w.capacity, notes: w.notes }); setEditId(w.id); setShowForm(true); }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><FiArchive /> Warehouses</h1>
          <p className="text-gray-500 text-sm mt-0.5">Storage locations for your jewellery</p>
        </div>
        <button onClick={() => { setShowForm(true); setForm(EMPTY); setEditId(null); }}
          className="flex items-center gap-2 px-4 py-2 bg-maroon-950 text-white rounded-lg text-sm font-semibold hover:bg-maroon-900 transition">
          <FiPlus /> Add Location
        </button>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
            <h2 className="text-lg font-bold mb-4">{editId ? 'Edit' : 'Add'} Warehouse / Storage</h2>
            <form onSubmit={save} className="space-y-3">
              {[
                { key: 'name', label: 'Location Name *', required: true, placeholder: 'e.g. Main Store, Home Storage' },
                { key: 'location', label: 'Address / Location' },
                { key: 'manager', label: 'Manager Name' },
                { key: 'phone', label: 'Manager Phone' },
                { key: 'capacity', label: 'Capacity (no. of items)' },
              ].map(({ key, label, required, placeholder }) => (
                <div key={key}>
                  <label className="text-xs text-gray-500 mb-1 block">{label}</label>
                  <input required={required} placeholder={placeholder} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400" />
                </div>
              ))}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400" />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={saving} className="flex-1 py-2.5 bg-maroon-950 text-white font-bold rounded-lg text-sm disabled:opacity-60">
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? <p className="text-center py-12 text-gray-400">Loading…</p> : items.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <FiArchive className="text-5xl mx-auto mb-3 opacity-30" />
          <p className="font-semibold">No storage locations added</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((w) => (
            <div key={w.id} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 bg-maroon-100 rounded-lg flex items-center justify-center">
                    <FiArchive className="text-maroon-700" />
                  </div>
                  <h3 className="font-bold text-gray-900">{w.name}</h3>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => edit(w)} className="p-1.5 text-gray-400 hover:text-blue-600"><FiEdit2 /></button>
                  <button onClick={() => del(w.id)} className="p-1.5 text-gray-400 hover:text-red-600"><FiTrash2 /></button>
                </div>
              </div>
              <div className="space-y-1 text-xs text-gray-500">
                {w.location && <p className="flex items-center gap-1.5"><FiMapPin />{w.location}</p>}
                {w.manager && <p className="flex items-center gap-1.5"><span className="font-medium text-gray-700">Manager:</span> {w.manager}</p>}
                {w.capacity && <p className="flex items-center gap-1.5"><FiPackage />{w.capacity} items capacity</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
