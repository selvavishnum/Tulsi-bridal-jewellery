'use client';

import { useState, useEffect } from 'react';
import {
  FiPlus, FiEdit2, FiTrash2, FiSave, FiX, FiLayers,
  FiInfo, FiChevronRight,
} from 'react-icons/fi';
import toast from 'react-hot-toast';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import Badge from '@/components/ui/Badge';

const DISPLAY_AS_OPTIONS = [
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'buttons', label: 'Buttons' },
  { value: 'swatches', label: 'Color Swatches' },
];

const EMPTY_TYPE = { name: '', displayAs: 'dropdown' };
const EMPTY_VALUE = { value: '', seqNo: '', hexColor: '' };

export default function VariantsPage() {
  const [variantTypes, setVariantTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [typeForm, setTypeForm] = useState(EMPTY_TYPE);
  const [editTypeId, setEditTypeId] = useState(null);
  const [typeFormOpen, setTypeFormOpen] = useState(false);
  const [savingType, setSavingType] = useState(false);
  const [valueForm, setValueForm] = useState(EMPTY_VALUE);
  const [savingValue, setSavingValue] = useState(false);

  useEffect(() => { fetchVariants(); }, []);

  async function fetchVariants() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/variants');
      const data = await res.json();
      if (data.success) {
        setVariantTypes(data.data);
        if (selected) {
          const updated = data.data.find((v) => v.id === selected.id);
          setSelected(updated || null);
        }
      }
    } catch { toast.error('Failed to load'); }
    finally { setLoading(false); }
  }

  function openAddType() {
    setTypeForm(EMPTY_TYPE);
    setEditTypeId(null);
    setTypeFormOpen(true);
  }

  function openEditType(vt) {
    setTypeForm({ name: vt.name, displayAs: vt.displayAs || 'dropdown' });
    setEditTypeId(vt.id);
    setTypeFormOpen(true);
  }

  async function saveType() {
    if (!typeForm.name.trim()) { toast.error('Name required'); return; }
    setSavingType(true);
    try {
      const payload = editTypeId
        ? { id: editTypeId, ...typeForm }
        : typeForm;
      const res = await fetch('/api/admin/variants', {
        method: editTypeId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(editTypeId ? 'Updated!' : 'Created!');
        setTypeFormOpen(false);
        setTypeForm(EMPTY_TYPE);
        setEditTypeId(null);
        fetchVariants();
      } else { toast.error(data.message); }
    } finally { setSavingType(false); }
  }

  async function deleteType(vt) {
    if (!confirm(`Delete variant type "${vt.name}"? All its values will be lost.`)) return;
    try {
      const res = await fetch(`/api/admin/variants?id=${vt.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success('Deleted');
        if (selected?.id === vt.id) setSelected(null);
        fetchVariants();
      } else { toast.error(data.message); }
    } catch { toast.error('Delete failed'); }
  }

  async function addValue() {
    if (!valueForm.value.trim()) { toast.error('Value text required'); return; }
    if (!selected) return;
    setSavingValue(true);
    try {
      const newValue = {
        value: valueForm.value.trim(),
        seqNo: parseInt(valueForm.seqNo) || (selected.values?.length || 0) + 1,
        ...(valueForm.hexColor ? { hexColor: valueForm.hexColor } : {}),
      };
      const updatedValues = [...(selected.values || []), newValue];
      const res = await fetch('/api/admin/variants', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id, values: updatedValues }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Value added!');
        setValueForm(EMPTY_VALUE);
        fetchVariants();
      } else { toast.error(data.message); }
    } finally { setSavingValue(false); }
  }

  async function deleteValue(valueIdx) {
    if (!selected) return;
    if (!confirm('Remove this value?')) return;
    const updatedValues = selected.values.filter((_, i) => i !== valueIdx);
    try {
      const res = await fetch('/api/admin/variants', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id, values: updatedValues }),
      });
      const data = await res.json();
      if (data.success) { toast.success('Removed'); fetchVariants(); }
      else toast.error(data.message);
    } catch { toast.error('Failed'); }
  }

  const inp = 'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white transition';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Multi-Variant DataTypes</h1>
        <p className="text-sm text-gray-400 mt-0.5">{variantTypes.length} variant types</p>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 px-4 py-3 bg-blue-50 rounded-xl border border-blue-100 text-sm text-blue-700">
        <FiInfo className="flex-shrink-0 mt-0.5 text-blue-500" />
        <p>
          This module enables you to create Data Types used for building Multi-Variant Products — such as jewellery that comes in various metal colors (Gold, Silver, Rose Gold).
          Once a Data Type is created, you can define and manage its associated values.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Left: Variant types list */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Variant Types</h2>
            <button onClick={openAddType}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-maroon-950 text-white text-xs font-bold rounded-lg hover:bg-maroon-900 transition"
            >
              <FiPlus /> Add Type
            </button>
          </div>

          {/* Add/Edit type form */}
          {typeFormOpen && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">{editTypeId ? 'Edit Type' : 'New Variant Type'}</p>
                <button onClick={() => { setTypeFormOpen(false); setTypeForm(EMPTY_TYPE); setEditTypeId(null); }}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded"
                >
                  <FiX className="text-sm" />
                </button>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Name</label>
                <input value={typeForm.name} onChange={(e) => setTypeForm((p) => ({ ...p, name: e.target.value }))}
                  className={inp} placeholder="e.g. Color, Size, Metal" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Display As</label>
                <select value={typeForm.displayAs} onChange={(e) => setTypeForm((p) => ({ ...p, displayAs: e.target.value }))}
                  className={inp}
                >
                  {DISPLAY_AS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <button onClick={saveType} disabled={savingType}
                className="w-full flex items-center justify-center gap-2 py-2 bg-maroon-950 text-white text-sm font-bold rounded-lg hover:bg-maroon-900 disabled:opacity-50 transition"
              >
                {savingType ? <LoadingSpinner size="sm" /> : <FiSave />}
                {editTypeId ? 'Update' : 'Create'}
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-8"><LoadingSpinner /></div>
          ) : variantTypes.length === 0 ? (
            <div className="bg-white rounded-xl p-8 text-center border border-dashed border-gray-200">
              <FiLayers className="text-4xl text-gray-200 mx-auto mb-2" />
              <p className="text-gray-400 text-sm">No variant types yet.</p>
            </div>
          ) : (
            variantTypes.map((vt) => (
              <div
                key={vt.id}
                onClick={() => setSelected(vt.id === selected?.id ? null : vt)}
                className={`bg-white rounded-xl p-4 cursor-pointer transition shadow-sm ${selected?.id === vt.id ? 'ring-2 ring-amber-400' : 'hover:shadow-md'}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center flex-shrink-0">
                      <FiLayers className="text-amber-600 text-sm" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 text-sm">{vt.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="default">{vt.displayAs}</Badge>
                        <span className="text-xs text-gray-400">{vt.values?.length || 0} values</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={(e) => { e.stopPropagation(); openEditType(vt); }}
                      className="p-1.5 text-amber-500 hover:bg-amber-50 rounded-lg transition"
                    >
                      <FiEdit2 className="text-sm" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); deleteType(vt); }}
                      className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition"
                    >
                      <FiTrash2 className="text-sm" />
                    </button>
                    <FiChevronRight className={`text-gray-400 transition ${selected?.id === vt.id ? 'rotate-90' : ''}`} />
                  </div>
                </div>

                {/* Value chips preview */}
                {vt.values && vt.values.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3 pl-11">
                    {vt.values.slice(0, 5).map((v, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                        {v.hexColor && (
                          <span className="w-3 h-3 rounded-full border border-gray-300 flex-shrink-0" style={{ backgroundColor: v.hexColor }} />
                        )}
                        {v.value}
                      </span>
                    ))}
                    {vt.values.length > 5 && (
                      <span className="text-xs text-gray-400">+{vt.values.length - 5} more</span>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Right: Values panel */}
        <div className="lg:col-span-3">
          {!selected ? (
            <div className="bg-white rounded-xl p-12 text-center border-2 border-dashed border-gray-200 h-full flex flex-col items-center justify-center">
              <FiLayers className="text-5xl text-gray-200 mb-3" />
              <p className="text-gray-500 font-medium">Select a variant type</p>
              <p className="text-gray-400 text-sm mt-1">Click on a type from the left to manage its values</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm p-5 space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-gray-800">{selected.name} — Values</h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Display as: <span className="font-medium capitalize">{selected.displayAs}</span>
                    &nbsp;·&nbsp; {selected.values?.length || 0} values
                  </p>
                </div>
              </div>

              {/* Values list */}
              {(!selected.values || selected.values.length === 0) ? (
                <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center">
                  <p className="text-gray-400 text-sm">No values yet. Add the first one below.</p>
                </div>
              ) : (
                <div className="border border-gray-100 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                      <tr>
                        <th className="px-4 py-2.5 text-left">Value</th>
                        <th className="px-4 py-2.5 text-center">Seq No</th>
                        {selected.displayAs === 'swatches' && <th className="px-4 py-2.5 text-center">Color</th>}
                        <th className="px-4 py-2.5 text-center">Remove</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {selected.values.sort((a, b) => (a.seqNo || 0) - (b.seqNo || 0)).map((v, idx) => (
                        <tr key={idx} className="hover:bg-gray-50 transition">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              {v.hexColor && (
                                <span className="w-5 h-5 rounded-full border border-gray-200 flex-shrink-0" style={{ backgroundColor: v.hexColor }} />
                              )}
                              <span className="font-medium text-gray-800">{v.value}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-center text-gray-500">{v.seqNo || idx + 1}</td>
                          {selected.displayAs === 'swatches' && (
                            <td className="px-4 py-2.5 text-center">
                              {v.hexColor ? (
                                <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                                  <span className="w-4 h-4 rounded border" style={{ backgroundColor: v.hexColor }} />
                                  {v.hexColor}
                                </span>
                              ) : '—'}
                            </td>
                          )}
                          <td className="px-4 py-2.5 text-center">
                            <button onClick={() => deleteValue(idx)}
                              className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition"
                            >
                              <FiTrash2 className="text-sm" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Add value form */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-gray-700">Add New Value</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      Value Text <span className="text-red-400">*</span>
                    </label>
                    <input value={valueForm.value} onChange={(e) => setValueForm((p) => ({ ...p, value: e.target.value }))}
                      className={inp} placeholder="e.g. Gold, Red, XL" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Seq No</label>
                    <input type="number" value={valueForm.seqNo}
                      onChange={(e) => setValueForm((p) => ({ ...p, seqNo: e.target.value }))}
                      className={inp} placeholder={`${(selected.values?.length || 0) + 1}`} min="1"
                    />
                  </div>
                </div>
                {selected.displayAs === 'swatches' && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Hex Color</label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={valueForm.hexColor || '#000000'}
                        onChange={(e) => setValueForm((p) => ({ ...p, hexColor: e.target.value }))}
                        className="w-10 h-10 rounded cursor-pointer border border-gray-200 p-0.5"
                      />
                      <input value={valueForm.hexColor}
                        onChange={(e) => setValueForm((p) => ({ ...p, hexColor: e.target.value }))}
                        className={`${inp} flex-1`} placeholder="#d4a853" />
                    </div>
                  </div>
                )}
                <button onClick={addValue} disabled={savingValue}
                  className="flex items-center gap-2 px-5 py-2 bg-maroon-950 text-white text-sm font-bold rounded-xl hover:bg-maroon-900 disabled:opacity-50 transition"
                >
                  {savingValue ? <LoadingSpinner size="sm" /> : <FiPlus />}
                  Add Value
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
