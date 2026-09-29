/* Vendor account states — one rule everywhere a vendor's standing matters.
     active    — selling; products visible and orderable
     suspended — shop stops selling their products (hidden); the vendor can
                 still sign in to finish existing orders and see earnings
     blocked   — suspended + dashboard login turned off
   Pure module — no '@/…' imports. */
export const VENDOR_STATUSES = Object.freeze(['active', 'suspended', 'blocked']);

export const vendorStatusOf = (v) => (VENDOR_STATUSES.includes(v?.status) ? v.status : 'active');

/** Can customers buy this vendor's products / message them? */
export const vendorCanSell = (v) => !!v && vendorStatusOf(v) === 'active';
