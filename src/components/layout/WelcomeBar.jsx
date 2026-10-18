'use client';

/* ─────────────────────────────────────────────
   Welcome-offer strip — the top line of the storefront header.

   "✨ {message} · Use code [TULSI10] · {free-delivery line}" from the
   public site settings (settings/site.announcement) and the store's real
   shipping rule (never a hard-coded "free shipping" claim). Tapping the
   code remembers it for checkout (cart, checkout and the Buy Now drawer
   apply it; the server decides whether it's valid) and copies it.

   Dismissed (per message+code), switched off, or empty: the strip shows
   its usual tagline + delivery line + phone instead. Always one line at a
   fixed height, so swapping tagline → offer after hydration changes text
   only — never the header's height.

   Never advertises a code that doesn't work: the server render and first
   paint show the tagline, and the offer appears only once GET
   /api/announcement says it is switched on AND its code is a live coupon
   (checked on the server). So a switched-off or changed offer never
   flashes, and a code that doesn't exist (or expired) is never shown.
   ───────────────────────────────────────────── */
import { useEffect, useState, useSyncExternalStore } from 'react';
import toast from 'react-hot-toast';
import { FiPhone, FiX } from 'react-icons/fi';
import { freeShippingLine } from '@/lib/storeCharges';
import { normalizeAnnouncement, DISMISS_KEY, dismissToken, setPendingCoupon } from '@/lib/welcomeOffer';

export const DEFAULT_SITE_PHONE = '+91 76958 68787';
const TAGLINE = '✦ Handcrafted Bridal Jewellery — Made with Love ✦';

/* Shared with the admin preview (AnnouncementSettingsPanel). */
export const BAR_BG = 'bg-velvet-950 bg-gradient-to-r from-velvet-950 via-wine-950 to-velvet-950';
export const CODE_CHIP = 'inline-flex flex-shrink-0 items-center h-6 px-2 rounded border border-dashed border-velvet-950/30 bg-gold-gradient text-velvet-950 text-[11px] font-bold tracking-[0.14em] leading-none shadow-gold';

/* Phones get a short form: the message itself when it fits, else its
   offer ("10% OFF first order", "Up to ₹500 OFF"), else the part after a
   "Headline:" prefix. Whatever is left still truncates with an ellipsis. */
const SHORT_FITS = 26;
export function shortOffer(message) {
  const m = String(message || '').replace(/\s+/g, ' ').trim();
  if (m.length <= SHORT_FITS) return m;
  const off = m.match(/(up\s?to\s+)?(\d{1,3}\s?%|(?:₹|rs\.?)\s?\d[\d,]*)\s*off\b/i);
  if (off) {
    const amount = off[2].replace(/\s+/g, '').replace(/^rs\.?/i, '₹');
    const first = /\bfirst\s+(?:\w+\s+){0,2}order\b/i.test(m) ? ' first order' : '';
    return `${off[1] ? 'Up to ' : ''}${amount} OFF${first}`;
  }
  const colon = m.indexOf(':');
  return (colon > 0 && m.slice(colon + 1).trim()) || m;
}

/* Last phone number this browser saw, so a returning visitor gets it at
   once; the fresh copy from the Navbar's settings fetch always wins and
   replaces it. (The offer itself is never taken from here — only from a
   fresh /api/announcement.) Read with useSyncExternalStore: hydration uses
   the server value (null) and swaps after — no mismatch. */
const CACHE_KEY = 'tj-welcome-bar';
const CHANGE_EVENT = 'tj-welcome-bar-change';

function readKey(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeKey(key, value) {
  try { window.localStorage.setItem(key, value); return true; } catch { return false; }
}
function subscribe(onChange) {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}
const serverNull = () => null;
const readCache = () => readKey(CACHE_KEY);
const readDismissed = () => readKey(DISMISS_KEY);

function parseCache(raw) {
  try {
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}

const Dot = ({ className = '' }) => (
  <span aria-hidden="true" className={`flex-shrink-0 text-gold-400/70 ${className}`}>·</span>
);

/**
 * @param {{ settings: object|null, charges: object }} props
 *   settings — the public site settings (null until the Navbar's fetch lands)
 *   charges  — shipping settings from useCart()
 */
export default function WelcomeBar({ settings, charges }) {
  const cached = parseCache(useSyncExternalStore(subscribe, readCache, serverNull));
  const storedDismissal = useSyncExternalStore(subscribe, readDismissed, serverNull);
  /* Dismissed in this page view — also covers a browser that can't store it. */
  const [dismissedNow, setDismissedNow] = useState(null);
  /* The offer as the server vouches for it — null until known (tagline). */
  const [offer, setOffer] = useState(null);

  useEffect(() => {
    let live = true;
    fetch('/api/announcement')
      .then((r) => r.json())
      .then((d) => { if (live && d?.success === true) setOffer(d); })
      .catch(() => { /* offline: keep the tagline */ });
    return () => { live = false; };
  }, []);

  const source = settings || cached || {};
  /* Exactly what the server vouched for (never a default code). */
  const a = offer
    ? normalizeAnnouncement({ announcement: { enabled: offer.enabled === true, message: String(offer.message ?? ''), code: String(offer.code ?? '') } })
    : null;
  const phone = (typeof source.phone === 'string' && source.phone.trim()) || DEFAULT_SITE_PHONE;
  const tel = `tel:${phone.replace(/[^\d+]/g, '')}`;
  const shippingLine = freeShippingLine(charges);

  /* Remember the fresh phone number, for the next page load. */
  useEffect(() => {
    if (!settings) return;
    writeKey(CACHE_KEY, JSON.stringify({ phone: settings.phone || null }));
  }, [settings]);

  const token = a ? dismissToken(a) : null;
  const showOffer = !!a && offer.active === true && a.enabled && !!(a.message || a.code)
    && dismissedNow !== token && storedDismissal !== token;

  const applyCode = () => {
    const saved = setPendingCoupon(a.code);
    try { navigator.clipboard?.writeText(a.code)?.catch(() => {}); } catch { /* no clipboard (http, old browser) */ }
    /* Lets an already-open cart or checkout pick the code up without a reload. */
    try { window.dispatchEvent(new CustomEvent('tj:pending-coupon', { detail: { code: a.code } })); } catch { /* old browser */ }
    /* At the bottom: a toast at the top would sit right over this strip
       (and its ✕) on phones. */
    if (saved) toast.success(`${a.code} will be applied at checkout`, { id: 'welcome-code', position: 'bottom-center' });
    else toast(`Use code ${a.code} at checkout`, { id: 'welcome-code', icon: '✨', position: 'bottom-center' });
  };

  const dismiss = () => {
    setDismissedNow(token);
    if (writeKey(DISMISS_KEY, token)) window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  return (
    <div className={`relative h-8 overflow-hidden ${BAR_BG}`}>
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold-500/40 to-transparent" />
      <div className="section-container h-full flex items-center gap-2">
        {showOffer ? (
          <>
            <p className="flex-1 min-w-0 flex items-center justify-center gap-1.5 sm:gap-2 whitespace-nowrap text-xs tracking-wide text-gold-200">
              <span aria-hidden="true" className="flex-shrink-0">✨</span>
              {a.message && (
                <>
                  <span className="min-w-0 truncate font-medium text-gold-100 sm:hidden">{shortOffer(a.message)}</span>
                  <span className="min-w-0 truncate font-medium text-gold-100 hidden sm:block">{a.message}</span>
                </>
              )}
              {a.code && (
                <>
                  {a.message && <Dot />}
                  <span className="flex-shrink-0 text-gold-200/80 max-[359px]:hidden">
                    <span className="sm:hidden">Code</span>
                    <span className="hidden sm:inline">Use code</span>
                  </span>
                  <button
                    type="button"
                    onClick={applyCode}
                    aria-label={`Apply code ${a.code} at checkout`}
                    title="Tap to apply at checkout"
                    className={`${CODE_CHIP} transition hover:brightness-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-200 focus-visible:ring-offset-1 focus-visible:ring-offset-velvet-950`}
                  >
                    {a.code}
                  </button>
                </>
              )}
              <Dot className="hidden md:block" />
              <span className="hidden md:block flex-shrink-0 text-gold-200/80">{shippingLine}</span>
            </p>
            <a href={tel} className="hidden lg:inline-flex flex-shrink-0 items-center gap-1 text-xs font-medium tracking-wide text-gold-200/90 hover:text-gold-100 transition-colors">
              <FiPhone aria-hidden="true" className="text-[10px]" /> {phone}
            </a>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss offer"
              className="flex-shrink-0 -mr-2 w-8 h-8 inline-flex items-center justify-center rounded-full text-gold-200/70 hover:text-gold-100 hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300/60"
            >
              <FiX aria-hidden="true" className="text-sm" />
            </button>
          </>
        ) : (
          <>
            <p className="hidden sm:block flex-shrink-0 whitespace-nowrap text-xs tracking-wider text-gold-300/80">{TAGLINE}</p>
            <p className="flex-1 min-w-0 truncate whitespace-nowrap text-center sm:text-right text-xs tracking-wide text-gold-300/70">
              {shippingLine} &nbsp;·&nbsp;
              <a href={tel} className="inline-flex items-center gap-1 font-medium hover:text-gold-300 transition-colors text-gold-300/90">
                <FiPhone aria-hidden="true" className="text-[10px]" /> {phone}
              </a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
