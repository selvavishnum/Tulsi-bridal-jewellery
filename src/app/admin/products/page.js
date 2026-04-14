'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { FiPlus, FiEdit2, FiTrash2, FiSearch, FiX } from 'react-icons/fi';
import { formatPrice } from '@/lib/utils';
import Badge from '@/components/ui/Badge';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import toast from 'react-hot-toast';

const EMPTY_FORM = {
  name: '', slug: '', description: '', shortDescription: '', price: '', discountPrice: '', rentalPrice: '',
  category: 'necklace', material: 'gold-plated', stock: 1, rentalStock: 0,
  isAvailableForRent: false, featured: false, images: [], tags: '',
};

export default function AdminProductsPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);
  const [search, setSearch] = useState('');

  async function fetchProducts() {
    setLoading(true);
    try {
      const res = await fetch(`/api/products?limit=100${search ? `&search=${search}` : ''}`);
      const data = await res.json();
      if (data.success) setProducts(data.data.products);
    } finally { setLoading(false); }
  }

  useEffect(() => { fetchProducts(); }, [search]);

  function openCreate() { setForm(EMPTY_FORM); setEditId(null); setModalOpen(true); }
  function openEdit(p) {
    setForm({ ...p, price: p.price.toString(), discountPrice: p.discountPrice?.toString() || '', rentalPrice: p.rentalPrice?.toString() || '', tags: p.tags?.join(', ') || '', images: p.images || [] });
    setEditId(p._id);
    setModalOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        ...form,
        price: parseFloat(form.price),
        discountPrice: form.discountPrice ? parseFloat(form.discountPrice) : undefined,
        rentalPrice: form.rentalPrice ? parseFloat(form.rentalPrice) : undefined,
        stock: parseInt(form.stock),
        rentalStock: parseInt(form.rentalStock) || 0,
        tags: form.tags ? form.tags.split(',').map((t) => t.trim()) : [],
        slug: form.slug || form.name.toLowerCase().replace(/\s+/g, '-'),
      };
      const url = editId ? `/api/products/${editId}` : '/api/products';
      const method = editId ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.success) {
        toast.success(editId ? 'Product updated!' : 'Product created!');
        setModalOpen(false);
        fetchProducts();
      } else { toast.error(data.message); }
    } finally { setSaving(false); }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this product?')) return;
    const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) { toast.success('Product deleted'); fetchProducts(); }
    else toast.error(data.message);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-800">Products</h1>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-maroon-950 text-white text-sm font-semibold rounded-lg hover:bg-maroon-900 transition">
          <FiPlus /> Add Product
        </button>
      </div>

      <div className="relative">
        <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products..."
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500 bg-white"
        />
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Product</th>
                  <th className="px-4 py-3 text-left">Category</th>
                  <th className="px-4 py-3 text-left">Price</th>
                  <th className="px-4 py-3 text-left">Stock</th>
                  <th className="px-4 py-3 text-left">Rental</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {products.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No products found</td></tr>
                ) : products.map((p) => (
                  <tr key={p._id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                          {p.images?.[0] ? <Image src={p.images[0]} alt={p.name} width={40} height={40} className="w-full h-full object-cover" /> : <span className="flex items-center justify-center h-full text-lg">💍</span>}
                        </div>
                        <div>
                          <p className="font-medium text-gray-800 line-clamp-1">{p.name}</p>
                          <p className="text-xs text-gray-400">{p.sku}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 capitalize text-gray-600">{p.category}</td>
                    <td className="px-4 py-3 font-semibold">{formatPrice(p.price)}</td>
                    <td className="px-4 py-3"><Badge variant={p.stock > 0 ? 'success' : 'danger'}>{p.stock}</Badge></td>
                    <td className="px-4 py-3 text-xs text-gray-500">{p.isAvailableForRent ? `${formatPrice(p.rentalPrice || 0)}/day` : '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => openEdit(p)} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition"><FiEdit2 /></button>
                        <button onClick={() => handleDelete(p._id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition"><FiTrash2 /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b">
              <h2 className="font-bold text-gray-800">{editId ? 'Edit Product' : 'Add Product'}</h2>
              <button onClick={() => setModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-lg"><FiX /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 mb-1 block">Product Name *</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 mb-1 block">Description *</label>
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500 resize-none" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Category *</label>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500">
                    {['necklace', 'earrings', 'bangles', 'bracelet', 'ring', 'maang-tikka', 'nose-ring', 'anklet', 'set', 'other'].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Material</label>
                  <select value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500">
                    {['gold', 'silver', 'gold-plated', 'silver-plated', 'kundan', 'meenakari', 'polki', 'other'].map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Price (₹) *</label>
                  <input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Discount Price (₹)</label>
                  <input type="number" value={form.discountPrice} onChange={(e) => setForm({ ...form, discountPrice: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Stock *</label>
                  <input type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Tags (comma separated)</label>
                  <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="bridal, gold, kundan" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 mb-1 block">Image URLs (one per line)</label>
                  <textarea
                    value={form.images?.join('\n') || ''}
                    onChange={(e) => setForm({ ...form, images: e.target.value.split('\n').filter(Boolean) })}
                    rows={2}
                    placeholder="https://res.cloudinary.com/..."
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500 resize-none"
                  />
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} className="accent-gold-600" /> Featured
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={form.isAvailableForRent} onChange={(e) => setForm({ ...form, isAvailableForRent: e.target.checked })} className="accent-gold-600" /> Available for Rent
                  </label>
                </div>
                {form.isAvailableForRent && (
                  <div className="grid grid-cols-2 gap-4 col-span-2">
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Rental Price/Day (₹)</label>
                      <input type="number" value={form.rentalPrice} onChange={(e) => setForm({ ...form, rentalPrice: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Rental Stock</label>
                      <input type="number" value={form.rentalStock} onChange={(e) => setForm({ ...form, rentalStock: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500" />
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="p-5 border-t flex justify-end gap-3">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 border border-gray-200 text-gray-600 text-sm font-semibold rounded-lg hover:bg-gray-50 transition">Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.name || !form.price} className="px-6 py-2 bg-maroon-950 text-white text-sm font-semibold rounded-lg hover:bg-maroon-900 disabled:opacity-60 transition flex items-center gap-2">
                {saving && <LoadingSpinner size="sm" />} {editId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
