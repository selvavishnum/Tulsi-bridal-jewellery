/* Formatting + label helpers for the Visitor Analytics dashboard.
   Pure: no React, no app imports. Numbers in en-IN, times in IST. */

const NUM = new Intl.NumberFormat('en-IN');
const NUM1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const COMPACT = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const TIME = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
});
const DAY = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });

/** Any value → finite number (null, undefined, NaN → 0). */
export const n0 = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export const fmtNum = (v) => NUM.format(n0(v));
export const fmtDec = (v) => NUM1.format(n0(v));
export const fmtCompact = (v) => COMPACT.format(n0(v));
export const fmtPct = (v) => `${NUM1.format(n0(v))}%`;
export const fmtINR = (v) => INR.format(n0(v));

/** Share of a total as a 0–100 number; 0 when the total is 0. */
export const share = (part, total) => (n0(total) > 0 ? (n0(part) / n0(total)) * 100 : 0);

/** Clamp to a CSS width percentage, never NaN. */
export const widthPct = (v) => `${Math.min(100, Math.max(0, n0(v)))}%`;

const pad2 = (v) => String(v).padStart(2, '0');

/** Seconds → "m:ss" or "h:mm:ss". */
export function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(n0(seconds)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`;
}

/** Date | ISO string → "03:04:05 pm" in IST; '' when invalid. */
export function fmtTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? TIME.format(d) : '';
}

/** "2026-10-16" → "16 Oct" (the key is an IST calendar day). */
export function fmtDayKey(key) {
  const d = new Date(`${key}T12:00:00+05:30`);
  return Number.isFinite(d.getTime()) ? DAY.format(d) : String(key || '');
}

/** "x min ago" for `iso`, measured against the snapshot time `refIso`. */
export function timeAgo(iso, refIso) {
  const t = Date.parse(iso);
  const ref = Date.parse(refIso);
  if (!Number.isFinite(t) || !Number.isFinite(ref)) return '';
  const min = Math.max(0, Math.round((ref - t) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${min % 60} min ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/** Round a maximum up to a clean axis value (1, 2, 5 × 10ⁿ). */
export function niceMax(max) {
  const m = n0(max);
  if (m <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(m));
  const step = [1, 2, 5, 10].find((f) => f * mag >= m) || 10;
  return step * mag;
}

/* ── Labels ── */
export const CHANNEL_COLORS = Object.freeze({
  instagram: '#ec4899',
  whatsapp: '#22c55e',
  facebook: '#3b82f6',
  google_organic: '#f59e0b',
  google_ads: '#fde047',
  youtube: '#ef4444',
  direct: '#64748b',
  email: '#c084fc',
  referral: '#2dd4bf',
  other_search: '#84cc16',
  social_other: '#6366f1',
});
export const channelColor = (key) => CHANNEL_COLORS[key] || '#64748b';

/** Ink that stays legible on a channel fill (dark on light fills, white on dark). */
export function inkOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '#ffffff';
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  /* Whichever ink has the higher WCAG contrast (#0d1117 has L ≈ 0.0056). */
  return (L + 0.05) / 0.0556 > 1.05 / (L + 0.05) ? '#0d1117' : '#ffffff';
}

const DEVICE_LABELS = { mobile: 'Mobile', tablet: 'Tablet', desktop: 'Desktop' };
const OS_LABELS = { android: 'Android', ios: 'iOS', windows: 'Windows', macos: 'macOS', linux: 'Linux', chromeos: 'ChromeOS', other: 'Other' };
const BROWSER_LABELS = {
  instagram: 'Instagram app', facebook: 'Facebook app', whatsapp: 'WhatsApp app', samsung: 'Samsung Internet',
  edge: 'Edge', opera: 'Opera', firefox: 'Firefox', chrome: 'Chrome', safari: 'Safari', other: 'Other',
};
const titleCase = (k) => (k ? String(k)[0].toUpperCase() + String(k).slice(1) : '');
export const deviceLabel = (k) => DEVICE_LABELS[k] || titleCase(k) || 'Unknown';
export const osLabel = (k) => OS_LABELS[k] || titleCase(k) || '';
export const browserLabel = (k) => BROWSER_LABELS[k] || titleCase(k) || '';

/** Journey stage → pill label + semantic colour (full class strings for Tailwind). */
export const STAGES = Object.freeze({
  browsing: { label: 'Browsing', cls: 'bg-slate-500/15 text-slate-300 ring-slate-400/25' },
  product: { label: 'Viewing product', cls: 'bg-sky-500/15 text-sky-300 ring-sky-400/30' },
  tryon: { label: 'Trying on', cls: 'bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-400/30' },
  cart: { label: 'In cart', cls: 'bg-amber-500/15 text-amber-300 ring-amber-400/30' },
  checkout: { label: 'Checkout', cls: 'bg-orange-500/15 text-orange-300 ring-orange-400/30' },
  paid: { label: 'Paid', cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30' },
});
export const stageOf = (key) => STAGES[key] || STAGES.browsing;

/** Only same-site absolute paths become links. */
export const safePath = (p) => (typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') ? p : '');

function countryName(code) {
  if (!code) return '';
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code; } catch { return code; }
}

/** "Chennai, Tamil Nadu" (falls back to the country name / Unknown). */
export function place(row) {
  const parts = [row?.city, row?.region].filter(Boolean);
  if (parts.length) return parts.join(', ');
  return countryName(row?.country) || 'Unknown';
}
