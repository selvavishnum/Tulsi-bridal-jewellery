'use client';
import { useState, useEffect } from 'react';
import { FiUserCheck, FiPlus, FiPhone, FiMail, FiEdit2, FiTrash2, FiSearch } from 'react-icons/fi';
import toast from 'react-hot-toast';

const ROLES = ['Manager', 'Sales Staff', 'Delivery', 'Accountant', 'Cleaner', 'Other'];
const EMPTY = { name: '', role: '', phone: '', email: '', address: '', salary: '', joinDate: '', status: 'active', notes: '' };

export default function EmployeesPage() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/employees');
      const data = await res.json();
      if (data.success) setEmployees(data.data);
    } finally { setLoading(false); }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/employees' + (editId ? `/${editId}` : ''), {
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
    if (!confirm('Remove this employee?')) return;
    const res = await fetch(`/api/admin/employees/${id}`, { method: 'DELETE' });
    if ((await res.json()).success) { toast.success('Removed'); fetchData(); }
  }

  function edit(emp) { setForm({ name: emp.name, role: emp.role, phone: emp.phone, email: emp.email, address: emp.address, salary: emp.salary, joinDate: emp.joinDate, status: emp.status || 'active', notes: emp.notes }); setEditId(emp.id); setShowForm(true); }

  const filtered = employees.filter((e) => e.name?.toLowerCase().includes(search.toLowerCase()) || e.role?.toLowerCase().includes(search.toLowerCase()));

  const statusColor = { active: 'bg-green-100 text-green-700', inactive: 'bg-red-100 text-red-600', onleave: 'bg-yellow-100 text-yellow-700' };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><FiUserCheck /> Employees (HRM)</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage your team members</p>
        </div>
        <button onClick={() => { setShowForm(true); setForm(EMPTY); setEditId(null); }}
          className="flex items-center gap-2 px-4 py-2 bg-maroon-950 text-white rounded-lg text-sm font-semibold hover:bg-maroon-900 transition">
          <FiPlus /> Add Employee
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Total', value: employees.length, color: 'blue' },
          { label: 'Active', value: employees.filter((e) => e.status === 'active').length, color: 'green' },
          { label: 'On Leave', value: employees.filter((e) => e.status === 'onleave').length, color: 'yellow' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl p-3 text-center border border-gray-100 shadow-sm">
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            <p className="text-xs text-gray-500">{label}</p>
          </div>
        ))}
      </div>

      <div className="relative mb-4">
        <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employees…"
          className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400" />
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold mb-4">{editId ? 'Edit' : 'Add'} Employee</h2>
            <form onSubmit={save} className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Full Name *</label>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Role</label>
                  <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400">
                    <option value="">Select role</option>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Status</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400">
                    <option value="active">Active</option>
                    <option value="onleave">On Leave</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              {[
                { key: 'phone', label: 'Phone' },
                { key: 'email', label: 'Email' },
                { key: 'address', label: 'Address' },
                { key: 'salary', label: 'Monthly Salary (₹)' },
                { key: 'joinDate', label: 'Join Date', type: 'date' },
              ].map(({ key, label, type }) => (
                <div key={key}>
                  <label className="text-xs text-gray-500 mb-1 block">{label}</label>
                  <input type={type || 'text'} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}
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
                  {saving ? 'Saving…' : editId ? 'Update' : 'Add Employee'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? <p className="text-center py-12 text-gray-400">Loading…</p> : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <FiUserCheck className="text-5xl mx-auto mb-3 opacity-30" />
          <p className="font-semibold">No employees added yet</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((emp) => (
            <div key={emp.id} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-bold text-gray-900">{emp.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    {emp.role && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{emp.role}</span>}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor[emp.status] || 'bg-gray-100 text-gray-500'}`}>{emp.status}</span>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => edit(emp)} className="p-1.5 text-gray-400 hover:text-blue-600"><FiEdit2 /></button>
                  <button onClick={() => del(emp.id)} className="p-1.5 text-gray-400 hover:text-red-600"><FiTrash2 /></button>
                </div>
              </div>
              <div className="space-y-1 text-xs text-gray-500 mt-2">
                {emp.phone && <p className="flex items-center gap-1.5"><FiPhone />{emp.phone}</p>}
                {emp.email && <p className="flex items-center gap-1.5"><FiMail />{emp.email}</p>}
                {emp.salary && <p className="font-medium text-gray-700">₹{emp.salary}/month</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
