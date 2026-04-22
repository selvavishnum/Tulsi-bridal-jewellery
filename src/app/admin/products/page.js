'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { FiPlus, FiEdit2, FiTrash2, FiSearch, FiX, FiUpload, FiImage, FiPackage } from 'react-icons/fi';
import { formatPrice } from '@/lib/utils';
import Badge from '@/components/ui/Badge';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import toast from 'react-hot-toast';

const CATEGORIES = ['necklace', 'earrings', 'bangles', 'bracelet', 'ring', 'maang-tikka', 'nose-ring', 'anklet', 'set', 'other'];
const MATERIALS  = ['gold', 'silver', 'gold-plated', 'silver-plated', 'kundan', 'meenakari', 'polki', 'other'];

const EMPTY_FORM = {
  name: '', slug: '', description: '', shortDescription: '',
  price: '', discountPrice: '', rentalPrice: '',
  category: 'necklace', material: 'gold-plated',
  stock: 1, rentalStock: 0,
  isAvailableForRent: false, featured: false,
  images: [], tags: '', weight: '', purity: '',
};

function Field({ label, children, required }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const inp = 'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400 bg-white transition';
const sel = `${inp} cursor-pointer`;

export default function AdminProductsPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [editId, setEditId]       = useState(null);
  const [search, setSearch]       = useState('');
  const [catFilter, setCat]       = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const upd = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  async function fetchProducts() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (search) params.set('search', search);
      if (catFilter) params.set('category', catFilter);
      const res = await fetch(`/api/products?${params}`);
      const data = await res.json();
      if (data.success) setProducts(data.data.products);
    } finally { setLoading(false); }
  }

  useEffect(() => { fetchProducts(); }, [search, catFilter]);

  function openCreate() { setForm(EMPTY_FORM); setEditId(null); setModalOpen(true); }
  function openEdit(p) {
    setForm({
      ...p,
      price: p.price?.toString() || '',
      discountPrice: p.discountPrice?.toString() || '',
      rentalPrice: p.rentalPrice?.toString() || '',
      tags: p.tags?.join(', ') || '',
      images: p.images || [],
      weight: p.weight?.toString() || '',
      purity: p.purity || '',
    });
    setEditId(p._id);
    setModalOpen(true);
  }

  async function uploadImage(file) {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.success && data.url) {
        upd('images', [...form.images, data.url]);
        toast.success('Image uploaded!');
      } else {
        toast.error(data.message || 'Upload failed');
      }
    } catch {
      toast.error('Upload failed');
    } finally { setUploading(false); }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        ...form,
        price:         parseFloat(form.price),
        discountPrice: form.discountPrice ? parseFloat(form.discountPrice) : undefined,
        rentalPrice:   form.rentalPrice   ? parseFloat(form.rentalPrice)   : undefined,
        stock:         parseInt(form.stock),
        rentalStock:   parseInt(form.rentalStock) || 0,
        weight:        form.weight ? parseFloat(form.weight) : undefined,
        tags:          form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        slug:          form.slug || form.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      };
      const url    = editId ? `/api/products/${editId}` : '/api/products';
      const method = editId ? 'PUT' : 'POST';
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data   = await res.json();
      if (data.success) {
        toast.success(editId ? 'Product updated!' : 'Product created!');
        setModalOpen(false);
        fetchProducts();
      } else { toast.error(data.message); }
    } finally { setSaving(false); }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this product? This cannot be undone.')) return;
    const res  = await fetch(`/api/products/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) { toast.success('Product deleted'); fetchProducts(); }
    else toast.error(data.message);
  }

  const margin = form.price && form.discountPrice
    ? Math.round(((parseFloat(form.price) - parseFloat(form.discountPrice)) / parseFloat(form.price)) * 100)
    : 0;

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Products</h1>
          <p className="text-sm text-gray-400 mt-0.5">{products.length} product{products.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-5 py-2.5 bg-maroon-950 text-white text-sm font-bold rounded-xl hover:bg-maroon-900 transition shadow-sm"
        >
          <FiPlus /> Add Product
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="w-full pl-9 pr-9 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400 bg-white"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <FiX className="text-sm" />
            </button>
          )}
        </div>
        <select
          value={catFilter}
          onChange={(e) => setCat(e.target.value)}
          className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400 bg-white capitalize"
        >
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c} className="capitalize">{c.replace(/-/g, ' ')}</option>)}
        </select>
      </div>

      {/* Product table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Product</th>
                  <th className="px-4 py-3 text-left hidden md:table-cell">Category</th>
                  <th className="px-4 py-3 text-left">Price</th>
                  <th className="px-4 py-3 text-left hidden sm:table-cell">Stock</th>
                  <th className="px-4 py-3 text-left hidden lg:table-cell">Rental</th>
                  <th className="px-4 py-3 text-left hidden md:table-cell">Featured</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {products.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-16 text-center">
                      <FiPackage className="text-4xl text-gray-200 mx-auto mb-3" />
                      <p className="text-gray-400 text-sm">{search || catFilter ? 'No products match your filters.' : 'No products yet. Add your first product!'}</p>
                    </td>
                  </tr>
                ) : products.map((p) => (
                  <tr key={p._id} className="hover:bg-gray-50/70 transition">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl overflow-hidden bg-cream-100 flex-shrink-0">
                          {p.images?.[0]
                            ? <Image src={p.images[0]} alt={p.name} width={44} height={44} className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center text-xl">💍</div>
                          }
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-800 truncate">{p.name}</p>
                          <p className="text-xs text-gray-400">{p.sku || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 capitalize text-gray-600 hidden md:table-cell">{p.category?.replace(/-/g, ' ')}</td>
                    <td className="px-4 py-3">
                      <p className="font-bold text-gray-800">{formatPrice(p.price)}</p>
                      {p.discountPrice && (
                        <p className="text-xs text-green-600 font-semibold">
                          {Math.round(((p.price - p.discountPrice) / p.price) * 100)}% off
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <Badge variant={p.stock > 5 ? 'success' : p.stock > 0 ? 'warning' : 'danger'}>
                        {p.stock} {p.stock === 1 ? 'pc' : 'pcs'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 hidden lg:table-cell">
                      {p.isAvailableForRent ? formatPrice(p.rentalPrice || 0) + '/day' : '—'}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className={`text-xs font-semibold ${p.featured ? 'text-gold-600' : 'text-gray-300'}`}>
                        {p.featured ? '⭐ Featured' : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => openEdit(p)}
                          className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition"
                          title="Edit"
                        >
                          <FiEdit2 className="text-sm" />
                        </button>
                        <button
                          onClick={() => handleDelete(p._id)}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition"
                          title="Delete"
                        >
                          <FiTrash2 className="text-sm" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Product form modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
          <div className="bg-white w-full md:rounded-2xl max-w-2xl max-h-[95vh] overflow-y-auto shadow-2xl">

            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white z-10">
              <h2 className="font-bold text-gray-800 text-lg">{editId ? 'Edit Product' : 'Add New Product'}</h2>
              <button onClick={() => setModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-lg transition text-gray-400 hover:text-gray-700">
                <FiX />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">

              {/* Basic info */}
              <div className="grid grid-cols-1 gap-4">
                <Field label="Product Name" required>
                  <input value={form.name} onChange={(e) => upd('name', e.target.value)} className={inp} placeholder="e.g. Kundan Bridal Necklace Set" />
                </Field>
                <Field label="Description" required>
                  <textarea value={form.description} onChange={(e) => upd('description', e.target.value)} rows={3} className={`${inp} resize-none`} placeholder="Describe the product…" />
                </Field>
              </div>

              {/* Category + Material */}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Category" required>
                  <select value={form.category} onChange={(e) => upd('category', e.target.value)} className={sel}>
                    {CATEGORIES.map((c) => <option key={c} value={c} className="capitalize">{c.replace(/-/g, ' ')}</option>)}
                  </select>
                </Field>
                <Field label="Material">
                  <select value={form.material} onChange={(e) => upd('material', e.target.value)} className={sel}>
                    {MATERIALS.map((m) => <option key={m} value={m} className="capitalize">{m.replace(/-/g, ' ')}</option>)}
                  </select>
                </Field>
              </div>

              {/* Pricing */}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Price (₹)" required>
                  <input type="number" value={form.price} onChange={(e) => upd('price', e.target.value)} className={inp} placeholder="0" min="0" />
                </Field>
                <Field label="Discount Price (₹)">
                  <input type="number" value={form.discountPrice} onChange={(e) => upd('discountPrice', e.target.value)} className={inp} placeholder="Leave blank if no discount" min="0" />
                </Field>
              </div>

              {/* Margin indicator */}
              {form.price && form.discountPrice && (
                <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold ${margin > 20 ? 'bg-green-50 text-green-700' : margin > 0 ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-700'}`}>
                  Discount: {margin}% off &nbsp;·&nbsp; Customer saves {formatPrice(parseFloat(form.price) - parseFloat(form.discountPrice))}
                </div>
              )}

              {/* Stock + Weight + Purity */}
              <div className="grid grid-cols-3 gap-4">
                <Field label="Stock" required>
                  <input type="number" value={form.stock} onChange={(e) => upd('stock', e.target.value)} className={inp} min="0" />
                </Field>
                <Field label="Weight (g)">
                  <input type="number" value={form.weight} onChange={(e) => upd('weight', e.target.value)} className={inp} placeholder="e.g. 45" step="0.1" />
                </Field>
                <Field label="Purity">
                  <input value={form.purity} onChange={(e) => upd('purity', e.target.value)} className={inp} placeholder="e.g. 22KT, 925" />
                </Field>
              </div>

              {/* Tags */}
              <Field label="Tags (comma separated)">
                <input value={form.tags} onChange={(e) => upd('tags', e.target.value)} className={inp} placeholder="bridal, kundan, gold, heavy set" />
              </Field>

              {/* Images */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Product Images</label>

                {/* Upload button */}
                <input type="file" ref={fileRef} accept="image/*" className="hidden" onChange={(e) => uploadImage(e.target.files[0])} />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-2 px-4 py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-500 hover:border-gold-400 hover:text-gold-600 transition w-full justify-center disabled:opacity-50 mb-3"
                >
                  {uploading ? <LoadingSpinner size="sm" /> : <FiUpload />}
                  {uploading ? 'Uploading…' : 'Upload Image'}
                </button>

                {/* Image preview grid */}
                {form.images.length > 0 && (
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    {form.images.map((url, i) => (
                      <div key={i} className="relative group aspect-square rounded-lg overflow-hidden bg-gray-100">
                        <Image src={url} alt={`Image ${i + 1}`} fill className="object-cover" />
                        <button
                          onClick={() => upd('images', form.images.filter((_, j) => j !== i))}
                          className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition text-xs"
                        >
                          <FiX />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => fileRef.current?.click()}
                      className="aspect-square rounded-lg border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-gold-400 hover:text-gold-600 transition"
                    >
                      <FiImage className="text-lg" />
                      <span className="text-[10px]">Add</span>
                    </button>
                  </div>
                )}

                {/* Manual URL input */}
                <details className="text-sm">
                  <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">Or paste image URLs manually</summary>
                  <textarea
                    value={form.images.join('\n')}
                    onChange={(e) => upd('images', e.target.value.split('\n').filter(Boolean))}
                    rows={2}
                    placeholder="https://res.cloudinary.com/..."
                    className={`${inp} resize-none mt-2`}
                  />
                </details>
              </div>

              {/* Toggles */}
              <div className="flex items-center gap-6 py-2">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <div
                    onClick={() => upd('featured', !form.featured)}
                    className={`w-10 h-6 rounded-full transition-colors relative ${form.featured ? 'bg-gold-500' : 'bg-gray-200'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${form.featured ? 'left-5' : 'left-1'}`} />
                  </div>
                  <span className="text-sm font-medium text-gray-700">Featured Product</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <div
                    onClick={() => upd('isAvailableForRent', !form.isAvailableForRent)}
                    className={`w-10 h-6 rounded-full transition-colors relative ${form.isAvailableForRent ? 'bg-gold-500' : 'bg-gray-200'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${form.isAvailableForRent ? 'left-5' : 'left-1'}`} />
                  </div>
                  <span className="text-sm font-medium text-gray-700">Available for Rent</span>
                </label>
              </div>

              {/* Rental fields */}
              {form.isAvailableForRent && (
                <div className="grid grid-cols-2 gap-4 p-4 bg-gold-50 rounded-xl border border-gold-100">
                  <Field label="Rental Price/Day (₹)">
                    <input type="number" value={form.rentalPrice} onChange={(e) => upd('rentalPrice', e.target.value)} className={inp} placeholder="0" min="0" />
                  </Field>
                  <Field label="Rental Stock">
                    <input type="number" value={form.rentalStock} onChange={(e) => upd('rentalStock', e.target.value)} className={inp} min="0" />
                  </Field>
                </div>
              )}

            </div>

            {/* Modal footer */}
            <div className="px-6 py-4 border-t flex justify-end gap-3 sticky bottom-0 bg-white">
              <button
                onClick={() => setModalOpen(false)}
                className="px-5 py-2.5 border border-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name || !form.price}
                className="px-8 py-2.5 bg-maroon-950 text-white text-sm font-bold rounded-xl hover:bg-maroon-900 disabled:opacity-50 transition flex items-center gap-2 shadow"
              >
                {saving && <LoadingSpinner size="sm" />}
                {editId ? 'Update Product' : 'Create Product'}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
