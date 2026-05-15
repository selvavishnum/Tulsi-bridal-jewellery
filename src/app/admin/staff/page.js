'use client';
import { useState, useEffect } from 'react';
import { FiUsers, FiPlus, FiEdit2, FiTrash2, FiX, FiRefreshCw, FiShield } from 'react-icons/fi';
import toast from 'react-hot-toast';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

const ROLES = [
  'SuperAdmin',
  'ProductManager',
  'InventoryManager',
  'BusinessManager',
  'OrderManager',
  'SalesStaff',
];

const ROLE_COLORS = {
  SuperAdmin:       'bg-purple-100 text-purple-700',
  ProductManager:   'bg-blue-100 text-blue-700',
  InventoryManager: 'bg-cyan-100 text-cyan-700',
  BusinessManager:  'bg-indigo-100 text-indigo-700',
  OrderManager:     'bg-orange-100 text-orange-700',
  SalesStaff:       'bg-gray-100 text-gray-700',
};

const STATUS_COLORS = {
  Active:   'bg-green-100 text-green-700',
  Inactive: 'bg-red-100 text-red-600',
  'On Leave': 'bg-yellow-100 text-yellow-700',
};

const EMPTY_FORM = { name: '', email: '', password: '', role: 'SalesStaff', phone: '', status: 'Active' };

export default function StaffPage() {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchStaff(); }, []);

  async function fetchStaff() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/staff');
      const data = await res.json();
      if (data.success) setStaff(data.data);
      else toast.error(data.message || 'Failed to load staff');
    } catch { toast.error('Network error'); }
    finally { setLoading(false); }
  }

  function openAdd() { setForm(EMPTY_FORM); setEditId(null); setShowModal(true); }
  function openEdit(member) {
    setForm({ name: member.name || '', email: member.email || '', password: '', role: member.role || 'SalesStaff', phone: member.phone || '', status: member.status || 'Active' });
    setEditId(member.id);
    setShowModal(true);
  }
  function closeModal() { setShowModal(false); setEditId(null); setForm(EMPTY_FORM); }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const url = editId ? `/api/admin/staff/${editId}` : '/api/admin/staff';
      const method = editId ? 'PUT' : 'POST';
      const body = editId
        ? { name: form.name, role: form.role, phone: form.phone, status: form.status, ...(form.password ? { password: form.password } : {}) }
        : form;
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.success) {
        toast.success(editId ? 'Staff updated!' : 'Staff added!');
        closeModal();
        fetchStaff();
      } else {
        toast.error(data.message || 'Failed to save');
      }
    } catch { toast.error('Network error'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id, name) {
    if (!confirm(`Delete staff member "${name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/staff/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) { toast.success('Staff member deleted'); fetchStaff(); }
      else toast.error(data.message || 'Failed to delete');
    } catch { toast.error('Network error'); }
  }

  // Stats
  const totalStaff = staff.length;
  const activeCount = staff.filter((s) => s.status === 'Active').length;
  const uniqueRoles = new Set(staff.map((s) => s.role).filter(Boolean)).size;
  const lastAdded = staff.length > 0 ? staff[0] : null;
  const lastAddedName = lastAdded ? lastAdded.name : '—';

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FiShield className="text-amber-500" /> Staff &amp; Access Management
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage admin users and their roles</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchStaff}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 transition"
          >
            <FiRefreshCw className={`text-sm ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:bg-amber-600 transition"
          >
            <FiPlus /> Add Staff
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Staff', value: totalStaff, color: 'text-gray-800' },
          { label: 'Active', value: activeCount, color: 'text-green-600' },
          { label: 'Roles', value: uniqueRoles, color: 'text-blue-600' },
          { label: 'Last Added', value: lastAddedName, color: 'text-amber-600', small: true },
        ].map(({ label, value, color, small }) => (
          <div key={label} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm text-center">
            <p className={`${small ? 'text-sm' : 'text-2xl'} font-bold ${color} truncate`}>{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <LoadingSpinner size="lg" />
          </div>
        ) : staff.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <FiUsers className="text-4xl mx-auto mb-3 opacity-40" />
            <p className="font-medium text-sm">No staff members yet</p>
            <p className="text-xs mt-1">Click "+ Add Staff" to add the first team member</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">#</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Staff Member</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Phone</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Password</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {staff.map((member, idx) => (
                <tr key={member.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3 text-gray-400 text-xs">{idx + 1}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-gray-800">{member.name}</p>
                    <p className="text-xs text-gray-400">{member.email}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{member.phone || '—'}</td>
                  <td className="px-4 py-3 text-gray-400 text-sm tracking-widest">••••••</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${ROLE_COLORS[member.role] || 'bg-gray-100 text-gray-700'}`}>
                      {member.role || 'SalesStaff'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[member.status] || 'bg-gray-100 text-gray-600'}`}>
                      {member.status || 'Active'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEdit(member)}
                        className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition"
                        title="Edit"
                      >
                        <FiEdit2 />
                      </button>
                      <button
                        onClick={() => handleDelete(member.id, member.name)}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition"
                        title="Delete"
                      >
                        <FiTrash2 />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add/Edit Modal — slide-over from right */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex">
          {/* Overlay */}
          <div className="flex-1 bg-black/40" onClick={closeModal} />
          {/* Panel */}
          <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-800">{editId ? 'Edit Staff Member' : 'Add New Staff'}</h2>
              <button onClick={closeModal} className="p-2 hover:bg-gray-100 rounded-lg transition">
                <FiX />
              </button>
            </div>

            <form onSubmit={handleSave} className="flex-1 p-6 space-y-4 overflow-y-auto">
              {/* Name */}
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Full Name <span className="text-red-400">*</span></label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Priya Sharma"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              {/* Email */}
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Email Address <span className="text-red-400">*</span></label>
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="priya@tulsibridal.com"
                  disabled={!!editId}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 disabled:bg-gray-50 disabled:text-gray-400"
                />
                {editId && <p className="text-xs text-gray-400 mt-1">Email cannot be changed after creation</p>}
              </div>

              {/* Password */}
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">
                  Password {!editId && <span className="text-red-400">*</span>}
                </label>
                <input
                  type="password"
                  required={!editId}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={editId ? 'Leave blank to keep existing' : 'Enter password'}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              {/* Role */}
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Role</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              {/* Phone */}
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Phone</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+91 98765 43210"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              {/* Status */}
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                  <option value="On Leave">On Leave</option>
                </select>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full py-2.5 bg-amber-500 text-white font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-60 transition"
                >
                  {saving ? 'Saving…' : editId ? 'Update Staff' : 'Add Staff'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
