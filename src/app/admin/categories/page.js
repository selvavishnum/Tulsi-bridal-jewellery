'use client';

import { useState, useEffect } from 'react';
import {
  FiPlus, FiEdit2, FiTrash2, FiChevronDown, FiChevronRight,
  FiEye, FiEyeOff, FiFolder, FiFolderPlus, FiSave, FiX, FiList,
} from 'react-icons/fi';
import toast from 'react-hot-toast';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import Badge from '@/components/ui/Badge';

const JEWELLERY_PRESETS = [
  'Necklace', 'Earrings', 'Bangles', 'Bracelet', 'Ring', 'Maang Tikka',
  'Nose Ring', 'Anklet', 'Set', 'Mala', 'Haar', 'Jhumka', 'Kada',
  'Choker', 'Pendant', 'Mangalsutra',
];

const EMPTY_FORM = {
  name: '', slug: '', description: '', seqNo: '', isVisible: true, parentId: null,
};

const inp = 'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white transition';

function slugify(str) {
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formTitle, setFormTitle] = useState('Add Main Category');

  const upd = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const mainCats = categories.filter((c) => !c.parentId);
  const subCats = (parentId) => categories.filter((c) => c.parentId === parentId);

  async function fetchCategories() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/categories');
      const data = await res.json();
      if (data.success) setCategories(data.data);
    } catch { toast.error('Failed to load categories'); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchCategories(); }, []);

  function openAddMain() {
    setForm({ ...EMPTY_FORM });
    setEditId(null);
    setFormTitle('Add Main Category');
  }

  function openAddSub(parent) {
    setForm({ ...EMPTY_FORM, parentId: parent.id });
    setEditId(null);
    setFormTitle(`Add Subcategory under "${parent.name}"`);
  }

  function openEdit(cat) {
    setForm({
      name: cat.name,
      slug: cat.slug,
      description: cat.description || '',
      seqNo: cat.seqNo?.toString() || '',
      isVisible: cat.isVisible !== false,
      parentId: cat.parentId || null,
    });
    setEditId(cat.id);
    setFormTitle(cat.parentId ? 'Edit Subcategory' : 'Edit Category');
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        slug: form.slug || slugify(form.name),
        seqNo: parseInt(form.seqNo) || 0,
      };
      if (editId) payload.id = editId;
      const res = await fetch('/api/admin/categories', {
        method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(editId ? 'Category updated!' : 'Category created!');
        setForm(EMPTY_FORM);
        setEditId(null);
        setFormTitle('Add Main Category');
        fetchCategories();
      } else { toast.error(data.message); }
    } finally { setSaving(false); }
  }

  async function handleToggleVisible(cat) {
    try {
      const res = await fetch('/api/admin/categories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cat.id, isVisible: !cat.isVisible }),
      });
      const data = await res.json();
      if (data.success) { fetchCategories(); toast.success('Visibility updated'); }
      else toast.error(data.message);
    } catch { toast.error('Update failed'); }
  }

  async function handleDelete(cat) {
    const subs = subCats(cat.id);
    const msg = subs.length > 0
      ? `Delete "${cat.name}" and its ${subs.length} subcategory(s)? This cannot be undone.`
      : `Delete "${cat.name}"? This cannot be undone.`;
    if (!confirm(msg)) return;
    try {
      const url = `/api/admin/categories?id=${cat.id}${subs.length > 0 ? '&deleteChildren=true' : ''}`;
      const res = await fetch(url, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) { toast.success('Deleted'); fetchCategories(); }
      else toast.error(data.message);
    } catch { toast.error('Delete failed'); }
  }

  function usePreset(name) {
    setForm((p) => ({ ...p, name, slug: slugify(name) }));
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Category Management</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {mainCats.length} main categories · {categories.filter((c) => c.parentId).length} subcategories
          </p>
        </div>
        <button
          onClick={openAddMain}
          className="flex items-center gap-2 px-5 py-2.5 bg-maroon-950 text-white text-sm font-bold rounded-xl hover:bg-maroon-900 transition shadow-sm"
        >
          <FiPlus /> Add Category
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Left: Category list */}
        <div className="lg:col-span-3 space-y-2">
          {loading ? (
            <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
          ) : mainCats.length === 0 ? (
            <div className="bg-white rounded-xl p-10 text-center border border-dashed border-gray-200">
              <FiFolder className="text-5xl text-gray-200 mx-auto mb-3" />
              <p className="text-gray-400 text-sm">No categories yet.</p>
              <p className="text-gray-400 text-xs mt-1">Use the presets below or add your own.</p>
              <div className="flex flex-wrap gap-2 mt-4 justify-center">
                {JEWELLERY_PRESETS.slice(0, 6).map((p) => (
                  <button
                    key={p}
                    onClick={() => usePreset(p)}
                    className="px-3 py-1.5 bg-amber-50 text-amber-700 text-xs rounded-lg font-medium hover:bg-amber-100 transition"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            mainCats.map((cat) => {
              const subs = subCats(cat.id);
              const isExpanded = expanded[cat.id];
              return (
                <div key={cat.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
                  {/* Main category row */}
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition">
                    <button
                      onClick={() => setExpanded((p) => ({ ...p, [cat.id]: !p[cat.id] }))}
                      className="text-gray-400 hover:text-gray-600 transition flex-shrink-0"
                    >
                      {isExpanded ? <FiChevronDown /> : <FiChevronRight />}
                    </button>
                    <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center flex-shrink-0">
                      <FiFolder className="text-amber-600 text-sm" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-800 text-sm">{cat.name}</span>
                        {!cat.isVisible && <Badge variant="warning">Hidden</Badge>}
                        {subs.length > 0 && (
                          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                            {subs.length} sub
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 truncate">{cat.slug}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => openAddSub(cat)}
                        title="Add subcategory"
                        className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition"
                      >
                        <FiFolderPlus className="text-sm" />
                      </button>
                      <button
                        onClick={() => handleToggleVisible(cat)}
                        title={cat.isVisible ? 'Hide' : 'Show'}
                        className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition"
                      >
                        {cat.isVisible ? <FiEye className="text-sm" /> : <FiEyeOff className="text-sm" />}
                      </button>
                      <button
                        onClick={() => openEdit(cat)}
                        title="Edit"
                        className="p-1.5 text-amber-500 hover:bg-amber-50 rounded-lg transition"
                      >
                        <FiEdit2 className="text-sm" />
                      </button>
                      <button
                        onClick={() => handleDelete(cat)}
                        title="Delete"
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition"
                      >
                        <FiTrash2 className="text-sm" />
                      </button>
                    </div>
                  </div>

                  {/* Subcategories */}
                  {isExpanded && (
                    <div className="border-t border-gray-50">
                      {subs.length === 0 ? (
                        <div className="px-12 py-3 text-xs text-gray-400 italic">
                          No subcategories.{' '}
                          <button onClick={() => openAddSub(cat)} className="text-amber-600 hover:underline">
                            Add one
                          </button>
                        </div>
                      ) : (
                        subs.map((sub) => (
                          <div key={sub.id} className="flex items-center gap-3 px-4 py-2.5 pl-12 hover:bg-gray-50 transition border-b border-gray-50 last:border-0">
                            <div className="w-6 h-6 rounded bg-gray-100 flex items-center justify-center flex-shrink-0">
                              <FiList className="text-gray-400 text-xs" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-700 font-medium">{sub.name}</span>
                                {!sub.isVisible && <Badge variant="warning">Hidden</Badge>}
                              </div>
                              <p className="text-xs text-gray-400">{sub.slug}</p>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button onClick={() => handleToggleVisible(sub)} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition">
                                {sub.isVisible ? <FiEye className="text-xs" /> : <FiEyeOff className="text-xs" />}
                              </button>
                              <button onClick={() => openEdit(sub)} className="p-1.5 text-amber-500 hover:bg-amber-50 rounded-lg transition">
                                <FiEdit2 className="text-xs" />
                              </button>
                              <button onClick={() => handleDelete(sub)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition">
                                <FiTrash2 className="text-xs" />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Right: Add/Edit form */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl shadow-sm p-5 sticky top-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-800 text-base">{formTitle}</h2>
              {editId && (
                <button
                  onClick={() => { setForm(EMPTY_FORM); setEditId(null); setFormTitle('Add Main Category'); }}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition"
                >
                  <FiX />
                </button>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Name <span className="text-red-400">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={(e) => upd('name', e.target.value)}
                  onBlur={() => { if (!editId && !form.slug) upd('slug', slugify(form.name)); }}
                  className={inp}
                  placeholder="e.g. Necklace"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Slug</label>
                <input
                  value={form.slug}
                  onChange={(e) => upd('slug', e.target.value)}
                  className={inp}
                  placeholder="auto-generated"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => upd('description', e.target.value)}
                  rows={2}
                  className={`${inp} resize-none`}
                  placeholder="Optional description..."
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Sequence No.</label>
                <input
                  type="number"
                  value={form.seqNo}
                  onChange={(e) => upd('seqNo', e.target.value)}
                  className={inp}
                  placeholder="0"
                  min="0"
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => upd('isVisible', !form.isVisible)}
                  className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${form.isVisible ? 'bg-amber-500' : 'bg-gray-200'}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${form.isVisible ? 'right-0.5' : 'left-0.5'}`} />
                </button>
                <span className="text-sm text-gray-600 font-medium">Visible in storefront</span>
              </div>

              {form.parentId && (
                <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg text-xs text-blue-700">
                  <FiFolderPlus />
                  <span>Adding as subcategory</span>
                  <button
                    onClick={() => { upd('parentId', null); setFormTitle('Add Main Category'); }}
                    className="ml-auto text-blue-400 hover:text-blue-600"
                  >
                    <FiX />
                  </button>
                </div>
              )}

              <button
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
                className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-maroon-950 text-white text-sm font-bold rounded-xl hover:bg-maroon-900 disabled:opacity-50 transition shadow-sm"
              >
                {saving ? <LoadingSpinner size="sm" /> : <FiSave />}
                {editId ? 'Update Category' : 'Save Category'}
              </button>
            </div>

            {/* Preset chips */}
            {!editId && !form.parentId && (
              <div className="mt-5 pt-4 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Quick Presets</p>
                <div className="flex flex-wrap gap-1.5">
                  {JEWELLERY_PRESETS.map((p) => (
                    <button
                      key={p}
                      onClick={() => usePreset(p)}
                      className="px-2.5 py-1 bg-amber-50 text-amber-700 text-xs rounded-md font-medium hover:bg-amber-100 transition"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
