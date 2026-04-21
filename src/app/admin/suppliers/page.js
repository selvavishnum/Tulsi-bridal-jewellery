'use client';
import { useState, useEffect } from 'react';
import { FiTruck, FiPlus, FiPhone, FiMail, FiMapPin, FiEdit2, FiTrash2, FiSearch } from 'react-icons/fi';
import toast from 'react-hot-toast';

const EMPTY = { name: '', contact: '', phone: '', email: '', address: '', category: '', notes: '' };

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchSuppliers(); }, []);

  async function fetchSuppliers() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/suppliers');
      const data = await res.json();
      if (data.success) setSuppliers(data.data);
    } finally { setLoading(false); }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/suppliers' + (editId ? `/${editId}` : ''), {
        method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(editId ? 'Supplier updated' : 'Supplier added');
        setShowForm(false); setForm(EMPTY); setEditId(null);
        fetchSuppliers();
      } else toast.error(data.message);
    } finally { setSaving(false); }
  }

  async function del(id) {
    if (!confirm('Delete this supplier?')) return;
    const res = await fetch(`/api/admin/suppliers/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) { toast.success('Deleted'); fetchSuppliers(); }
    else toast.error(data.message);
  }

  function edit(s) { setForm({ name: s.name, contact: s.contact, phone: s.phone, email: s.email, address: s.address, category: s.category, notes: s.notes }); setEditId(s.id); setShowForm(true); }

  const filtered = suppliers.filter((s) => s.name?.toLowerCase().includes(search.toLowerCase()) || s.category?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><FiTruck /> Suppliers</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage your jewellery suppliers</p>
        </div>
        <button onClick={() => { setShowForm(true); setForm(EMPTY); setEditId(null); }}
          className="flex items-center gap-2 px-4 py-2 bg-maroon-950 text-white rounded-lg text-sm font-semibold hover:bg-maroon-900 transition">
          <FiPlus /> Add Supplier
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search suppliers…"
          className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400" />
      </div>

      {/* Form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold mb-4">{editId ? 'Edit' : 'Add'} Supplier</h2>
            <form onSubmit={save} className="space-y-3">
              {[
                { key: 'name', label: 'Supplier Name *', required: true },
                { key: 'contact', label: 'Contact Person' },
                { key: 'phone', label: 'Phone Number' },
                { key: 'email', label: 'Email' },
                { key: 'address', label: 'Address' },
                { key: 'category', label: 'Category (e.g. Necklaces, Sets)' },
              ].map(({ key, label, required }) => (
                <div key={key}>
                  <label className="text-xs text-gray-500 mb-1 block">{label}</label>
                  <input required={required} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}
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
                  {saving ? 'Saving…' : editId ? 'Update' : 'Add Supplier'}
                </button>
                <button type="button" onClick={() => { setShowForm(false); setEditId(null); }} className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? <p className="text-gray-500 text-center py-12">Loading…</p> : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <FiTruck className="text-5xl mx-auto mb-3 opacity-30" />
          <p className="font-semibold">No suppliers yet</p>
          <p className="text-sm mt-1">Add your jewellery suppliers to get started</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => (
            <div key={s.id} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-bold text-gray-900">{s.name}</h3>
                  {s.category && <span className="text-xs bg-gold-100 text-gold-700 px-2 py-0.5 rounded-full">{s.category}</span>}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => edit(s)} className="p-1.5 text-gray-400 hover:text-blue-600 transition"><FiEdit2 /></button>
                  <button onClick={() => del(s.id)} className="p-1.5 text-gray-400 hover:text-red-600 transition"><FiTrash2 /></button>
                </div>
              </div>
              <div className="space-y-1 text-xs text-gray-500">
                {s.contact && <p className="flex items-center gap-1.5"><FiPhone className="flex-shrink-0" />{s.contact}</p>}
                {s.phone && <p className="flex items-center gap-1.5"><FiPhone className="flex-shrink-0" />{s.phone}</p>}
                {s.email && <p className="flex items-center gap-1.5"><FiMail className="flex-shrink-0" />{s.email}</p>}
                {s.address && <p className="flex items-center gap-1.5"><FiMapPin className="flex-shrink-0" />{s.address}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
