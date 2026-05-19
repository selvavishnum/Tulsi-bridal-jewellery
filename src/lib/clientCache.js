const P = 'tulsi:';

export function cacheGet(key, ttlMs) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(P + key);
    if (!raw) return null;
    const { v, exp } = JSON.parse(raw);
    if (Date.now() > exp) { localStorage.removeItem(P + key); return null; }
    return v;
  } catch { return null; }
}

export function cacheSet(key, value, ttlMs) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(P + key, JSON.stringify({ v: value, exp: Date.now() + ttlMs }));
  } catch {}
}
