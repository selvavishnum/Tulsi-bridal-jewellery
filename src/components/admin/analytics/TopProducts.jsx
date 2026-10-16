/* Most-viewed jewellery in the range, with try-on and add-to-cart counts. */
import { FiEye, FiImage } from 'react-icons/fi';
import { cldThumb } from '@/lib/cloudinaryImage';
import { Card, Empty, FOCUS } from './ui';
import { fmtNum, fmtPct, fmtINR, n0 } from './format';

function Thumb({ src, alt }) {
  if (!src) {
    return (
      <div className="w-12 h-12 rounded-lg bg-white/[0.04] flex items-center justify-center flex-shrink-0">
        <FiImage className="text-slate-600" aria-hidden="true" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 48px Cloudinary thumb, already sized by cldThumb
    <img src={cldThumb(src, 96)} alt={alt} width={48} height={48} loading="lazy" decoding="async"
      className="w-12 h-12 rounded-lg object-cover bg-white/[0.04] flex-shrink-0" />
  );
}

function Stat({ label, value }) {
  return (
    <div className="min-w-0 sm:text-right">
      <dt className="text-slate-500 text-[10px] uppercase tracking-wider sm:sr-only">{label}</dt>
      <dd className="text-slate-200 text-sm tabular-nums">{value}</dd>
    </div>
  );
}

const COLS = 'sm:grid-cols-[48px_minmax(0,1fr)_repeat(4,4.5rem)]';

export default function TopProducts({ products, label }) {
  const rows = Array.isArray(products) ? products : [];
  return (
    <Card title="Most-viewed jewellery" subtitle={`Product views & try-ons · ${label || ''}`} icon={FiEye}>
      {rows.length === 0 ? (
        <Empty>No product views in this range yet</Empty>
      ) : (
        <>
          <div className={`hidden sm:grid ${COLS} gap-x-3 px-2 pb-2 border-b border-white/[0.06] text-[11px] uppercase tracking-wider text-slate-500`} aria-hidden="true">
            <span className="col-span-2">Product</span>
            <span className="text-right">Views</span>
            <span className="text-right">Try-ons</span>
            <span className="text-right">Carts</span>
            <span className="text-right">Try-on %</span>
          </div>
          <ol className="divide-y divide-white/[0.04]">
            {rows.map((p, i) => {
              const removed = p.name === 'Removed product' && !p.image && !n0(p.price);
              return (
                <li key={p.id || i} className={`grid grid-cols-[48px_minmax(0,1fr)] ${COLS} gap-x-3 gap-y-2 items-center px-2 py-2.5`}>
                  <Thumb src={p.image} alt={p.name || ''} />
                  <div className="min-w-0">
                    {removed ? (
                      <p className="text-slate-500 text-sm italic truncate">{p.name}</p>
                    ) : (
                      <a href={`/product/${encodeURIComponent(p.id)}`} target="_blank" rel="noopener noreferrer"
                        className={`block text-slate-100 hover:text-amber-300 text-sm font-medium truncate rounded ${FOCUS}`} title={p.name}>
                        {p.name}<span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    )}
                    <p className="text-amber-300/90 text-xs tabular-nums mt-0.5">
                      {n0(p.price) > 0 ? fmtINR(p.price) : '—'}
                      {p.category && <span className="text-slate-500 capitalize"> · {p.category}</span>}
                    </p>
                  </div>
                  <dl className="col-span-2 sm:col-span-4 grid grid-cols-4 gap-x-3">
                    <Stat label="Views" value={fmtNum(p.views)} />
                    <Stat label="Try-ons" value={fmtNum(p.tryons)} />
                    <Stat label="Carts" value={fmtNum(p.addToCarts)} />
                    <Stat label="Try-on %" value={fmtPct(p.tryonRate)} />
                  </dl>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </Card>
  );
}
