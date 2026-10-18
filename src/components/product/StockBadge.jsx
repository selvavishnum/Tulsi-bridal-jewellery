import { stockStatus } from './stockStatus';

const TONES = {
  out: { chip: 'bg-red-50 text-red-700 ring-red-100', dot: 'bg-red-500' },
  low: { chip: 'bg-amber-50 text-amber-800 ring-amber-200', dot: 'bg-amber-500' },
  in:  { chip: 'bg-green-50 text-green-700 ring-green-100', dot: 'bg-green-500' },
};

/* The product's real stock, as a small chip (see stockStatus.js). */
export default function StockBadge({ stock }) {
  const { tone, label } = stockStatus(stock);
  const t = TONES[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ring-1 ${t.chip}`}>
      <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${t.dot}`} />
      {label}
    </span>
  );
}
