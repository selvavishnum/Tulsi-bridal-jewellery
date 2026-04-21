'use client';
import { useState, useEffect } from 'react';
import { FiDollarSign, FiPlus, FiTrendingUp, FiTrendingDown, FiEdit2, FiTrash2, FiFilter } from 'react-icons/fi';
import toast from 'react-hot-toast';

const TYPES = ['income', 'expense'];
const INCOME_CATS = ['Rental Revenue', 'Sale Revenue', 'Other Income'];
const EXPENSE_CATS = ['Purchase', 'Salary', 'Rent', 'Transport', 'Marketing', 'Maintenance', 'Other'];
const EMPTY = { type: 'income', category: '', amount: '', description: '', date: new Date().toISOString().split('T')[0], notes: '' };

export default function AccountingPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('all');

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/accounting');
      const data = await res.json();
      if (data.success) setEntries(data.data);
    } finally { setLoading(false); }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/accounting' + (editId ? `/${editId}` : ''), {
        method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
      });
      const data = await res.json();
      if (data.success) { toast.success('Saved'); setShowForm(false); setForm(EMPTY); setEditId(null); fetchData(); }
      else toast.error(data.message);
    } finally { setSaving(false); }
  }

  async function del(id) {
    if (!confirm('Delete this entry?')) return;
    const res = await fetch(`/api/admin/accounting/${id}`, { method: 'DELETE' });
    if ((await res.json()).success) { toast.success('Deleted'); fetchData(); }
  }

  function edit(en) { setForm({ type: en.type, category: en.category, amount: String(en.amount), description: en.description, date: en.date, notes: en.notes || '' }); setEditId(en.id); setShowForm(true); }

  const filtered = entries.filter((e) => filter === 'all' || e.type === filter);
  const totalIncome = entries.filter((e) => e.type === 'income').reduce((s, e) => s + (e.amount || 0), 0);
  const totalExpense = entries.filter((e) => e.type === 'expense').reduce((s, e) => s + (e.amount || 0), 0);
  const profit = totalIncome - totalExpense;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><FiDollarSign /> Accounting</h1>
          <p className="text-gray-500 text-sm mt-0.5">Track income and expenses</p>
        </div>
        <button onClick={() => { setShowForm(true); setForm(EMPTY); setEditId(null); }}
          className="flex items-center gap-2 px-4 py-2 bg-maroon-950 text-white rounded-lg text-sm font-semibold hover:bg-maroon-900 transition">
          <FiPlus /> Add Entry
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-green-50 border border-green-100 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1"><FiTrendingUp className="text-green-600" /><span className="text-xs text-green-600 font-semibold">Total Income</span></div>
          <p className="text-2xl font-bold text-green-700">₹{totalIncome.toLocaleString()}</p>
        </div>
        <div className="bg-red-50 border border-red-100 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1"><FiTrendingDown className="text-red-500" /><span className="text-xs text-red-500 font-semibold">Total Expense</span></div>
          <p className="text-2xl font-bold text-red-600">₹{totalExpense.toLocaleString()}</p>
        </div>
        <div className={`rounded-xl p-4 border ${profit >= 0 ? 'bg-blue-50 border-blue-100' : 'bg-orange-50 border-orange-100'}`}>
          <div className="flex items-center gap-2 mb-1"><FiDollarSign className={profit >= 0 ? 'text-blue-600' : 'text-orange-600'} /><span className={`text-xs font-semibold ${profit >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>Net Profit</span></div>
          <p className={`text-2xl font-bold ${profit >= 0 ? 'text-blue-700' : 'text-orange-700'}`}>₹{Math.abs(profit).toLocaleString()}</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-4">
        {['all', 'income', 'expense'].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition ${filter === f ? 'bg-maroon-950 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {f}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-4">{editId ? 'Edit' : 'Add'} Entry</h2>
            <form onSubmit={save} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Type</label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, category: '' })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400">
                    <option value="income">Income</option>
                    <option value="expense">Expense</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Category</label>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400">
                    <option value="">Select</option>
                    {(form.type === 'income' ? INCOME_CATS : EXPENSE_CATS).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Amount (₹) *</label>
                  <input required type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Date</label>
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Description *</label>
                <input required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Brief description of transaction"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400" />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={saving} className="flex-1 py-2.5 bg-maroon-950 text-white font-bold rounded-lg text-sm disabled:opacity-60">
                  {saving ? 'Saving…' : 'Save Entry'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? <p className="text-center py-12 text-gray-400">Loading…</p> : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <FiDollarSign className="text-5xl mx-auto mb-3 opacity-30" />
          <p className="font-semibold">No entries yet</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Date', 'Description', 'Category', 'Amount', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.sort((a, b) => b.date?.localeCompare(a.date)).map((en) => (
                <tr key={en.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{en.date}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{en.description}</td>
                  <td className="px-4 py-3"><span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{en.category}</span></td>
                  <td className={`px-4 py-3 font-bold ${en.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                    {en.type === 'income' ? '+' : '-'}₹{(en.amount || 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => edit(en)} className="p-1 text-gray-400 hover:text-blue-600"><FiEdit2 /></button>
                      <button onClick={() => del(en.id)} className="p-1 text-gray-400 hover:text-red-600"><FiTrash2 /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
