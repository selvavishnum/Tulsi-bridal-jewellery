'use client';

/* ─────────────────────────────────────────────
   The shipping-address and payment-method fields of checkout, driven by
   useCheckoutFlow — the same markup on the /checkout page and in the Buy
   Now drawer. Each component takes the hook's return value as `flow`.
   ───────────────────────────────────────────── */
import { useId } from 'react';
import { formatPrice } from '@/lib/utils';
import { COD_MAX_ORDER_VALUE, normalizeMobileInput } from './checkoutRules';

/* 16px text on phones: iOS zooms the page into any smaller input on focus. */
const INPUT = 'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-base md:text-sm outline-none focus:ring-2 focus:ring-gold-500';
const LABEL = 'text-xs text-gray-500 mb-1 block';

/** Saved address cards (signed-in customers) + the address form. */
export function AddressFields({ flow }) {
  const uid = useId();
  const id = (k) => `${uid}-${k}`;
  const { form, updateForm, savedAddresses, addrChoice, chooseAddress, handlePincodeChange, pincodeLoading } = flow;

  return (
    <>
      {/* Saved address cards */}
      {savedAddresses.length > 0 && (
        <div className="mb-5 space-y-2">
          <p className="text-xs text-gray-500 mb-2">Saved addresses</p>
          {savedAddresses.map((a, i) => (
            <label
              key={a.id || i}
              className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition ${addrChoice === `saved-${i}` ? 'border-gold-600 bg-gold-50' : 'border-gray-200 hover:border-gray-300'}`}
            >
              <input
                type="radio"
                name="addrChoice"
                value={`saved-${i}`}
                checked={addrChoice === `saved-${i}`}
                onChange={() => chooseAddress(`saved-${i}`)}
                className="accent-gold-600 mt-1 flex-shrink-0"
              />
              <div className="text-sm min-w-0">
                <p className="font-semibold text-gray-800">{a.fullName}</p>
                <p className="text-gray-600 text-xs mt-0.5">{a.street}, {a.city}, {a.state} — {a.pincode}</p>
                {a.phone && <p className="text-gray-400 text-xs">{a.phone}</p>}
              </div>
            </label>
          ))}
          <label
            className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition ${addrChoice === 'new' ? 'border-gold-600 bg-gold-50' : 'border-gray-200 hover:border-gray-300'}`}
          >
            <input
              type="radio"
              name="addrChoice"
              value="new"
              checked={addrChoice === 'new'}
              onChange={() => chooseAddress('new')}
              className="accent-gold-600 flex-shrink-0"
            />
            <span className="text-sm font-semibold text-gray-700">+ Use a different address</span>
          </label>
        </div>
      )}

      {/* Address form */}
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 md:col-span-1">
          <label htmlFor={id('name')} className={LABEL}>Full Name *</label>
          <input id={id('name')} required autoComplete="name" value={form.fullName} onChange={(e) => updateForm('fullName', e.target.value)} className={INPUT} />
        </div>
        <div className="col-span-2 md:col-span-1">
          <label htmlFor={id('phone')} className={LABEL}>Phone *</label>
          <input
            id={id('phone')}
            required
            type="tel"
            autoComplete="tel-national"
            value={form.phone}
            onChange={(e) => updateForm('phone', normalizeMobileInput(e.target.value))}
            /* Room for an autofilled "+91 98765 43210"; the value itself
               never holds more than 10 digits. */
            maxLength={16}
            inputMode="numeric"
            pattern="[6-9][0-9]{9}"
            title="10-digit mobile number"
            className={INPUT}
          />
        </div>
        <div className="col-span-2">
          <label htmlFor={id('email')} className={LABEL}>Email *</label>
          <input id={id('email')} required type="email" autoComplete="email" value={form.email} onChange={(e) => updateForm('email', e.target.value)} className={INPUT} />
        </div>
        <div className="col-span-2">
          <label htmlFor={id('street')} className={LABEL}>Street Address *</label>
          <input id={id('street')} required autoComplete="street-address" value={form.street} onChange={(e) => updateForm('street', e.target.value)} className={INPUT} />
        </div>
        <div className="col-span-2 md:col-span-1">
          <label htmlFor={id('pincode')} className={LABEL}>Pincode *</label>
          <div className="relative">
            <input
              id={id('pincode')}
              required
              autoComplete="postal-code"
              value={form.pincode}
              onChange={(e) => handlePincodeChange(e.target.value)}
              maxLength={6}
              inputMode="numeric"
              className={INPUT}
            />
            {pincodeLoading && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">Loading…</span>
            )}
          </div>
        </div>
        <div className="col-span-2 md:col-span-1">
          <label htmlFor={id('city')} className={LABEL}>City *</label>
          <input id={id('city')} required autoComplete="address-level2" value={form.city} onChange={(e) => updateForm('city', e.target.value)} className={INPUT} />
        </div>
        <div>
          <label htmlFor={id('state')} className={LABEL}>State *</label>
          <input id={id('state')} required autoComplete="address-level1" value={form.state} onChange={(e) => updateForm('state', e.target.value)} className={INPUT} />
        </div>
      </div>
    </>
  );
}

/** Pay online (Razorpay) / Cash on Delivery, with why COD is unavailable. */
export function PaymentMethodFields({ flow }) {
  const { paymentMethod, setPaymentMethod, onlinePaymentEnabled, codBlocked, codBlockedByValue, codAvailable, codFeeIfSelected, charges } = flow;

  return (
    <div className="space-y-3">
      <label className={`flex items-center gap-3 p-3 rounded-xl border-2 transition ${!onlinePaymentEnabled ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed' : paymentMethod === 'razorpay' ? 'border-gold-600 bg-gold-50 cursor-pointer' : 'border-gray-200 hover:border-gray-300 cursor-pointer'}`}>
        <input
          type="radio" name="payment" value="razorpay" checked={paymentMethod === 'razorpay'} disabled={!onlinePaymentEnabled}
          onChange={() => setPaymentMethod('razorpay')} className="accent-gold-600"
        />
        <div>
          <p className="font-semibold text-sm text-gray-800">Pay Online (Razorpay)</p>
          {onlinePaymentEnabled ? (
            <p className="text-xs text-gray-500">Cards, UPI, Net Banking, Wallets</p>
          ) : (
            <p className="text-xs text-amber-600 font-medium">Coming Soon</p>
          )}
        </div>
      </label>

      <label className={`flex items-center gap-3 p-3 rounded-xl border-2 transition ${codBlocked ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed' : paymentMethod === 'cod' ? 'border-gold-600 bg-gold-50 cursor-pointer' : 'border-gray-200 hover:border-gray-300 cursor-pointer'}`}>
        <input
          type="radio" name="payment" value="cod" checked={paymentMethod === 'cod'} disabled={codBlocked}
          onChange={() => setPaymentMethod('cod')} className="accent-gold-600"
        />
        <div>
          <p className="font-semibold text-sm text-gray-800">Cash on Delivery</p>
          {codBlockedByValue ? (
            <p className="text-xs text-red-500">Not available above {formatPrice(COD_MAX_ORDER_VALUE)}</p>
          ) : !codAvailable ? (
            <p className="text-xs text-red-500">Not available for this pincode</p>
          ) : codFeeIfSelected > 0 ? (
            <p className="text-xs text-gray-500">Pay when you receive · +{formatPrice(codFeeIfSelected)} COD fee{charges.cod_fee_waive_above ? ` (none on orders of ${formatPrice(charges.cod_fee_waive_above)}+)` : ''}</p>
          ) : (
            <p className="text-xs text-gray-500">Pay when you receive</p>
          )}
        </div>
      </label>
    </div>
  );
}
