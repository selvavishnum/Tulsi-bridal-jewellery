'use client';

/* The store's WhatsApp number (digits, with 91), from the site settings
   the rest of the site uses: the cached copy (src/lib/clientCache) when
   there is one, else /api/admin/settings (then cached). Until that
   resolves — or if it fails — the built-in store number is used, so a
   WhatsApp link always works. */
import { useEffect, useState } from 'react';
import { cacheGet, cacheSet } from '@/lib/clientCache';
import { whatsappNumber } from '@/lib/whatsappOrder';

/* Same key and lifetime as the homepage's cached settings. */
const SETTINGS_TTL_MS = 60 * 60 * 1000;

let inflight = null;
function loadSiteSettings() {
  const cached = cacheGet('settings', SETTINGS_TTL_MS);
  if (cached) return Promise.resolve(cached);
  inflight ||= fetch('/api/admin/settings')
    .then((r) => r.json())
    .then((d) => {
      if (!d?.success || !d.data) return null;
      cacheSet('settings', d.data, SETTINGS_TTL_MS);
      return d.data;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

export default function useStoreWhatsApp() {
  const [raw, setRaw] = useState('');
  useEffect(() => {
    let alive = true;
    loadSiteSettings()
      .then((s) => { if (alive && s) setRaw(String(s.whatsapp || s.phone || '')); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return whatsappNumber(raw);
}
