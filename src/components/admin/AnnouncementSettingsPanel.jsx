'use client';

/* ─────────────────────────────────────────────
   Admin card for the storefront's welcome-offer strip
   (settings/site.announcement → src/components/layout/WelcomeBar.jsx).

   Controlled: `value` is settings.announcement (may be missing — the
   defaults then apply), `onChange(next)` gets the whole new
   { enabled, message, code } object. Saved with the settings page.
   Optional `phone` (settings.phone) is only used in the preview.
   ───────────────────────────────────────────── */
import Link from 'next/link';
import { FiPhone, FiX } from 'react-icons/fi';
import { useCart } from '@/context/CartContext';
import { freeShippingLine } from '@/lib/storeCharges';
import { DEFAULT_ANNOUNCEMENT, normalizeAnnouncement } from '@/lib/welcomeOffer';
import { BAR_BG, CODE_CHIP, DEFAULT_SITE_PHONE, shortOffer } from '@/components/layout/WelcomeBar';

const MAX_MESSAGE = 140;
const CODE_RE = /^[A-Z0-9_-]{3,30}$/;
const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400';

/* A static copy of the strip at a forced width (the real one switches on
   the viewport, which in the admin is always wide). */
function PreviewStrip({ a, shippingLine, phone, mobile }) {
  return (
    <div className={`relative h-8 overflow-hidden rounded-md ${BAR_BG}`}>
      <div className="h-full px-3 flex items-center gap-2">
        {a.enabled ? (
          <>
            <p className="flex-1 min-w-0 flex items-center justify-center gap-1.5 whitespace-nowrap text-xs tracking-wide text-gold-200">
              <span aria-hidden="true" className="flex-shrink-0">✨</span>
              <span className="min-w-0 truncate font-medium text-gold-100">{mobile ? shortOffer(a.message) : a.message}</span>
              {a.code && (
                <>
                  <span aria-hidden="true" className="flex-shrink-0 text-gold-400/70">·</span>
                  <span className="flex-shrink-0 text-gold-200/80">{mobile ? 'Code' : 'Use code'}</span>
                  <span className={CODE_CHIP}>{a.code}</span>
                </>
              )}
              {!mobile && (
                <>
                  <span aria-hidden="true" className="flex-shrink-0 text-gold-400/70">·</span>
                  <span className="flex-shrink-0 text-gold-200/80">{shippingLine}</span>
                </>
              )}
            </p>
            <FiX aria-hidden="true" className="flex-shrink-0 text-sm text-gold-200/70" />
          </>
        ) : (
          <p className="flex-1 min-w-0 truncate whitespace-nowrap text-center text-xs tracking-wide text-gold-300/70">
            {!mobile && <span className="text-gold-300/80">✦ Handcrafted Bridal Jewellery — Made with Love ✦ &nbsp;&nbsp;</span>}
            {shippingLine} &nbsp;·&nbsp; <FiPhone aria-hidden="true" className="inline text-[10px]" /> {phone}
          </p>
        )}
      </div>
    </div>
  );
}

export default function AnnouncementSettingsPanel({ value, onChange, phone }) {
  const { charges } = useCart();
  const v = { ...DEFAULT_ANNOUNCEMENT, ...(value && typeof value === 'object' ? value : {}) };
  const set = (patch) => onChange({ enabled: v.enabled !== false, message: v.message ?? '', code: v.code ?? '', ...patch });

  const message = String(v.message ?? '');
  const code = String(v.code ?? '');
  const codeError = code && !CODE_RE.test(code) ? 'Use 3–30 letters, numbers, - or _ — an invalid code is not shown.' : '';
  /* What the storefront will actually show (same rules as the strip). */
  const shown = normalizeAnnouncement({ announcement: { enabled: v.enabled !== false, message, code } });
  const shippingLine = freeShippingLine(charges);
  const previewPhone = (typeof phone === 'string' && phone.trim()) || DEFAULT_SITE_PHONE;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="font-bold text-gray-800 mb-1">Welcome Offer Bar</h2>
          <p className="text-xs text-gray-400">The gold strip at the very top of every storefront page. Tapping the code saves it for checkout.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={shown.enabled}
          aria-label="Show the welcome offer bar"
          onClick={() => set({ enabled: !shown.enabled })}
          className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${shown.enabled ? 'bg-amber-500' : 'bg-gray-300'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${shown.enabled ? 'translate-x-6' : 'translate-x-0'}`} />
        </button>
      </div>

      <div className={`space-y-4 ${shown.enabled ? '' : 'opacity-60'}`}>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="announce-message" className="text-xs font-medium text-gray-600">Message</label>
            <span className={`text-xs tabular-nums ${message.length >= MAX_MESSAGE ? 'text-amber-600 font-semibold' : 'text-gray-400'}`}>{message.length}/{MAX_MESSAGE}</span>
          </div>
          <input
            id="announce-message"
            type="text"
            value={message}
            maxLength={MAX_MESSAGE}
            onChange={(e) => set({ message: e.target.value.replace(/[<>]/g, '').slice(0, MAX_MESSAGE) })}
            placeholder={DEFAULT_ANNOUNCEMENT.message}
            className={inputCls}
          />
          {!message.trim() && (
            <p className="text-xs text-amber-700 mt-1">Empty — the default message will be shown. Switch the bar off to hide it.</p>
          )}
        </div>

        <div>
          <label htmlFor="announce-code" className="text-xs font-medium text-gray-600 mb-1 block">Coupon code</label>
          <input
            id="announce-code"
            type="text"
            value={code}
            maxLength={30}
            onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/\s+/g, '') })}
            placeholder={DEFAULT_ANNOUNCEMENT.code}
            aria-invalid={!!codeError}
            aria-describedby="announce-code-hint"
            className={`${inputCls} font-mono uppercase ${codeError ? 'border-red-300' : ''}`}
          />
          {codeError ? (
            <p id="announce-code-hint" className="text-xs text-red-600 mt-1">{codeError}</p>
          ) : (
            <p id="announce-code-hint" className="text-xs text-gray-400 mt-1">Leave empty to show the message without a code.</p>
          )}
        </div>

        <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-800 leading-relaxed">
          Create this code in{' '}
          <Link href="/admin/coupons" target="_blank" rel="noopener" className="font-semibold underline underline-offset-2 hover:text-amber-900">Coupons</Link>
          {' '}and tick <span className="font-semibold">First order only</span> — checkout checks it there, not here. The delivery line comes from your Shipping &amp; Payment Charges.
        </div>
      </div>

      <div className="mt-5 space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Preview</p>
        <div>
          <p className="text-[11px] text-gray-400 mb-1">Computer &amp; tablet</p>
          <PreviewStrip a={shown} shippingLine={shippingLine} phone={previewPhone} />
        </div>
        <div>
          <p className="text-[11px] text-gray-400 mb-1">Phone</p>
          <div className="max-w-[360px]"><PreviewStrip a={shown} shippingLine={shippingLine} phone={previewPhone} mobile /></div>
        </div>
      </div>
    </div>
  );
}
