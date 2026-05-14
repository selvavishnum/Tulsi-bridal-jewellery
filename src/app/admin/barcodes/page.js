'use client';

import { useState, useEffect } from 'react';
import {
  FiPrinter, FiPlus, FiPackage, FiBarChart2,
  FiSettings, FiRefreshCw, FiX,
} from 'react-icons/fi';
import toast from 'react-hot-toast';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

const MODES = { manual: 'manual', bulk: 'bulk' };

const EMPTY_MANUAL = {
  barcode: '',
  label: '',
  count: '10',
  fontSize: '12',
  barcodeHeight: '40',
  barcodeWidth: '1',
};

export default function BarcodesPage() {
  const [mode, setMode] = useState(null);
  const [manualForm, setManualForm] = useState(EMPTY_MANUAL);
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [generating, setGenerating] = useState(false);

  const upd = (k, v) => setManualForm((p) => ({ ...p, [k]: v }));

  async function fetchProducts() {
    setLoadingProducts(true);
    try {
      const res = await fetch('/api/admin/products');
      const data = await res.json();
      if (data.success) setProducts(data.data.products || []);
    } catch { toast.error('Failed to load products'); }
    finally { setLoadingProducts(false); }
  }

  function toggleProduct(product) {
    setSelectedProducts((prev) => {
      const exists = prev.find((p) => (p.id || p._id) === (product.id || product._id));
      if (exists) return prev.filter((p) => (p.id || p._id) !== (product.id || product._id));
      return [...prev, product];
    });
  }

  function generateManualPrint() {
    const { barcode, label, count, fontSize, barcodeHeight, barcodeWidth } = manualForm;
    if (!barcode) { toast.error('Enter a barcode value'); return; }
    setGenerating(true);

    const numLabels = parseInt(count) || 10;
    const fs = parseInt(fontSize) || 12;
    const bh = parseInt(barcodeHeight) || 40;
    const bw = parseFloat(barcodeWidth) || 1;
    const labelText = label || barcode;

    const labelItems = Array.from({ length: numLabels }, (_, i) => `
      <div class="label">
        <svg class="barcode" data-barcode="${barcode}"></svg>
        <div class="label-text">${labelText}</div>
      </div>
    `).join('');

    printBarcodes(labelItems, fs, bh, bw, 'Manual Barcodes');
    setGenerating(false);
  }

  function generateBulkPrint() {
    if (selectedProducts.length === 0) { toast.error('Select at least one product'); return; }
    setGenerating(true);

    const fs = 11;
    const bh = 40;
    const bw = 1;

    const labelItems = selectedProducts.map((p) => {
      const barcodeVal = p.sku || p.id || p._id;
      const labelText = p.name?.substring(0, 30) || barcodeVal;
      return `
        <div class="label">
          <svg class="barcode" data-barcode="${barcodeVal}"></svg>
          <div class="label-text">${labelText}</div>
        </div>
      `;
    }).join('');

    printBarcodes(labelItems, fs, bh, bw, 'Product Barcodes');
    setGenerating(false);
  }

  function printBarcodes(labelItems, fontSize, barcodeHeight, barcodeWidth, title) {
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>${title} — Tulsi Bridal</title>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; background: #fff; padding: 10px; }
    h2 { font-size: 14px; color: #7f1d1d; margin-bottom: 12px; font-weight: bold; }
    .grid { display: flex; flex-wrap: wrap; gap: 8px; }
    .label {
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      padding: 6px 8px;
      text-align: center;
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      min-width: 120px;
    }
    .barcode { max-width: 150px; }
    .label-text {
      font-size: ${fontSize}px;
      color: #111;
      font-weight: 600;
      word-break: break-all;
      max-width: 150px;
      line-height: 1.3;
    }
    @media print {
      body { padding: 5px; }
      h2 { display: none; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <h2 class="no-print">${title} — Tulsi Bridal Jewellery</h2>
  <button onclick="window.print()" class="no-print" style="margin-bottom:12px;padding:8px 20px;background:#7f1d1d;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:bold;font-size:13px;">
    🖨️ Print
  </button>
  <div class="grid">${labelItems}</div>
  <script>
    document.addEventListener('DOMContentLoaded', function() {
      var svgs = document.querySelectorAll('.barcode');
      svgs.forEach(function(svg) {
        var val = svg.getAttribute('data-barcode');
        try {
          JsBarcode(svg, val, {
            format: 'CODE128',
            width: ${barcodeWidth},
            height: ${barcodeHeight},
            displayValue: false,
            margin: 4,
          });
        } catch(e) {
          svg.outerHTML = '<div style="font-size:10px;color:#dc2626;border:1px dashed #fca5a5;padding:4px;">Invalid: ' + val + '</div>';
        }
      });
    });
  <\/script>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { toast.error('Popup blocked. Allow popups and try again.'); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
  }

  const inp = 'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white transition';

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Barcode Generator</h1>
        <p className="text-sm text-gray-400 mt-0.5">Generate and print product barcodes (Code128 format)</p>
      </div>

      {/* Mode selection */}
      {!mode && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <button
            onClick={() => setMode(MODES.manual)}
            className="group flex flex-col items-center gap-4 bg-white rounded-2xl shadow-sm p-8 hover:shadow-md hover:ring-2 hover:ring-amber-400 transition text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center group-hover:bg-amber-100 transition">
              <FiPlus className="text-amber-600 text-2xl" />
            </div>
            <div>
              <p className="font-bold text-gray-800 text-lg">Create New Barcode</p>
              <p className="text-gray-400 text-sm mt-1">Manually enter a barcode value and label, set quantity and dimensions, then print.</p>
            </div>
          </button>

          <button
            onClick={() => { setMode(MODES.bulk); fetchProducts(); }}
            className="group flex flex-col items-center gap-4 bg-white rounded-2xl shadow-sm p-8 hover:shadow-md hover:ring-2 hover:ring-amber-400 transition text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-maroon-50 border border-red-100 flex items-center justify-center group-hover:bg-red-50 transition">
              <FiBarChart2 className="text-maroon-950 text-2xl" />
            </div>
            <div>
              <p className="font-bold text-gray-800 text-lg">Generate Barcodes</p>
              <p className="text-gray-400 text-sm mt-1">Select products from inventory and generate barcodes using their SKU codes.</p>
            </div>
          </button>
        </div>
      )}

      {/* Manual mode */}
      {mode === MODES.manual && (
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-800 flex items-center gap-2">
              <FiPlus className="text-amber-500" /> Manual Barcode
            </h2>
            <button onClick={() => { setMode(null); setManualForm(EMPTY_MANUAL); }}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition"
            >
              <FiX />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Enter / Scan Barcode <span className="text-red-400">*</span>
              </label>
              <input
                value={manualForm.barcode}
                onChange={(e) => upd('barcode', e.target.value)}
                className={inp}
                placeholder="e.g. TBJ-NCK-001 or scan"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Label Name
              </label>
              <input
                value={manualForm.label}
                onChange={(e) => upd('label', e.target.value)}
                className={inp}
                placeholder="Defaults to barcode value"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Total Barcodes
              </label>
              <input type="number" min="1" max="200" value={manualForm.count}
                onChange={(e) => upd('count', e.target.value)}
                className={inp} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Label Font Size
              </label>
              <input type="number" min="8" max="24" value={manualForm.fontSize}
                onChange={(e) => upd('fontSize', e.target.value)}
                className={inp} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Barcode Height (px)
              </label>
              <input type="number" min="20" max="120" value={manualForm.barcodeHeight}
                onChange={(e) => upd('barcodeHeight', e.target.value)}
                className={inp} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Bar Width
              </label>
              <input type="number" min="1" max="4" step="0.5" value={manualForm.barcodeWidth}
                onChange={(e) => upd('barcodeWidth', e.target.value)}
                className={inp} />
            </div>
          </div>

          {/* Preview */}
          {manualForm.barcode && (
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Preview (first label)</p>
              <div className="inline-flex flex-col items-center bg-white border border-gray-200 rounded-lg p-3 gap-1">
                <div className="flex gap-0.5 items-end h-10">
                  {Array.from({ length: 40 }, (_, i) => (
                    <div
                      key={i}
                      className="bg-gray-800"
                      style={{
                        width: `${parseInt(manualForm.barcodeWidth) || 1}px`,
                        height: `${(Math.random() * 0.4 + 0.6) * (parseInt(manualForm.barcodeHeight) || 40)}px`,
                      }}
                    />
                  ))}
                </div>
                <span style={{ fontSize: `${parseInt(manualForm.fontSize) || 12}px` }} className="font-semibold text-gray-800">
                  {manualForm.label || manualForm.barcode}
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-2">Actual barcodes are generated with JsBarcode (Code128) in the print window.</p>
            </div>
          )}

          <button
            onClick={generateManualPrint}
            disabled={generating || !manualForm.barcode}
            className="flex items-center gap-2 px-8 py-3 bg-maroon-950 text-white font-bold rounded-xl hover:bg-maroon-900 disabled:opacity-50 transition shadow-sm"
          >
            {generating ? <LoadingSpinner size="sm" /> : <FiPrinter />}
            PRINT {manualForm.count || 10} Barcode{parseInt(manualForm.count) !== 1 ? 's' : ''}
          </button>
        </div>
      )}

      {/* Bulk mode */}
      {mode === MODES.bulk && (
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-800 flex items-center gap-2">
              <FiBarChart2 className="text-amber-500" /> Generate Barcodes from Products
            </h2>
            <div className="flex items-center gap-2">
              <button onClick={fetchProducts} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition">
                <FiRefreshCw className={loadingProducts ? 'animate-spin' : ''} />
              </button>
              <button onClick={() => { setMode(null); setSelectedProducts([]); }}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition"
              >
                <FiX />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 px-3 py-2 bg-amber-50 rounded-lg text-sm text-amber-700">
            <FiPackage className="flex-shrink-0" />
            <span>
              {selectedProducts.length > 0
                ? `${selectedProducts.length} product${selectedProducts.length !== 1 ? 's' : ''} selected`
                : 'Select products below to generate barcodes using their SKU'}
            </span>
            {selectedProducts.length > 0 && (
              <button onClick={() => setSelectedProducts([])} className="ml-auto text-amber-500 hover:text-amber-700 flex-shrink-0">
                <FiX className="text-xs" />
              </button>
            )}
          </div>

          {loadingProducts ? (
            <div className="flex justify-center py-8"><LoadingSpinner /></div>
          ) : (
            <div className="border border-gray-100 rounded-xl overflow-hidden max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0">
                  <tr>
                    <th className="px-4 py-2.5 text-left w-10">
                      <input type="checkbox"
                        checked={selectedProducts.length === products.length && products.length > 0}
                        onChange={(e) => setSelectedProducts(e.target.checked ? [...products] : [])}
                        className="rounded text-amber-500"
                      />
                    </th>
                    <th className="px-4 py-2.5 text-left">Product</th>
                    <th className="px-4 py-2.5 text-left">SKU (Barcode)</th>
                    <th className="px-4 py-2.5 text-left hidden sm:table-cell">Category</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {products.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No products found</td></tr>
                  ) : products.map((p) => {
                    const pid = p.id || p._id;
                    const isSelected = selectedProducts.some((s) => (s.id || s._id) === pid);
                    return (
                      <tr key={pid}
                        onClick={() => toggleProduct(p)}
                        className={`cursor-pointer transition ${isSelected ? 'bg-amber-50' : 'hover:bg-gray-50'}`}
                      >
                        <td className="px-4 py-2.5">
                          <input type="checkbox" checked={isSelected} onChange={() => toggleProduct(p)}
                            onClick={(e) => e.stopPropagation()}
                            className="rounded text-amber-500" />
                        </td>
                        <td className="px-4 py-2.5 font-medium text-gray-800">{p.name}</td>
                        <td className="px-4 py-2.5 font-mono text-gray-500 text-xs">{p.sku || p.id || p._id}</td>
                        <td className="px-4 py-2.5 capitalize text-gray-500 text-xs hidden sm:table-cell">
                          {p.category?.replace(/-/g, ' ')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <button
            onClick={generateBulkPrint}
            disabled={generating || selectedProducts.length === 0}
            className="flex items-center gap-2 px-8 py-3 bg-maroon-950 text-white font-bold rounded-xl hover:bg-maroon-900 disabled:opacity-50 transition shadow-sm"
          >
            {generating ? <LoadingSpinner size="sm" /> : <FiPrinter />}
            GENERATE BARCODES ({selectedProducts.length})
          </button>
        </div>
      )}
    </div>
  );
}
