/* ─────────────────────────────────────────────
   Seller application — the one schema the form and the API share.

   Validates and normalises everything a prospective vendor submits:
   contact, tax identity (regular GST or composition / non-GST enrolment
   ID), pickup warehouse (checked the way Shiprocket will check it), and
   settlement bank details. Pure module (zod only) — runs in the browser
   for instant feedback and on the server as the authority.
   ───────────────────────────────────────────── */
import { z } from 'zod';

export const INDIAN_STATES = Object.freeze([
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
]);

/* GST = regular GST registration; ENROLMENT_ID = composition / non-GST
   supplier enrolled on the GST portal; NONE = just starting, no GST yet (PAN only). */
export const TAX_TYPES = Object.freeze(['GST', 'ENROLMENT_ID', 'NONE']);

/* GSTIN check digit (mod-36, as issued by the GST network). */
export function gstinChecksumOk(gstin) {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const v = chars.indexOf(gstin[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return chars[(36 - (sum % 36)) % 36] === gstin[14];
}

const upper = (v) => String(v ?? '').trim().toUpperCase();
/* Text field: missing counts as empty (so the "required" message shows,
   not a type error), trimmed, bounded, no markup characters. */
const text = (max, min = 0, minMessage = 'Required') => z.preprocess(
  (v) => (v === undefined || v === null ? '' : String(v)),
  z.string().trim().min(min, minMessage).max(max, `Up to ${max} characters`).refine((v) => !/[<>]/.test(v), 'Remove < and > characters'),
);
const digits = (v) => String(v ?? '').replace(/\D/g, '');

const phone = z.preprocess((v) => digits(v).replace(/^(91|0)(?=\d{10}$)/, ''),
  z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number'));

/* "@my_shop", "my_shop" or an instagram.com link → "my_shop". */
const instagram = z.preprocess((v) => {
  const s = String(v ?? '').trim();
  const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  return (m ? m[1] : s).replace(/^@/, '').replace(/\/$/, '');
}, z.string().regex(/^[A-Za-z0-9._]{1,30}$/, 'Enter your Instagram handle, e.g. @my_jewellery_shop'));

const base = z.object({
  /* A. Store & contact */
  fullName: text(80, 2, 'Enter your full legal name'),
  businessName: text(80, 2, 'Enter your business / brand name'),
  phone,
  email: z.preprocess((v) => String(v ?? '').trim().toLowerCase(), z.email('Enter a valid email address')),
  instagram,

  /* B. Tax identity */
  taxType: z.enum(TAX_TYPES, { message: 'Choose how you are registered' }),
  gstin: z.preprocess(upper, z.string()).optional(),
  gstCertificateUrl: z.string().trim().optional(),
  enrolmentId: z.preprocess(upper, z.string()).optional(),
  pan: z.preprocess(upper, z.string()).optional(),

  /* C. Pickup warehouse (Shiprocket) */
  address: text(200, 10, 'Enter the full address (at least 10 characters)')
    .refine((v) => /\d/.test(v), 'Include a door / shop / plot number — couriers need it'),
  landmark: text(120),
  city: text(60, 2, 'Enter the city'),
  state: z.enum(INDIAN_STATES, { message: 'Choose your state' }),
  pincode: z.preprocess(digits, z.string().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit pincode')),

  /* D. Bank & settlement */
  accountHolder: text(80, 2, 'Enter the account holder name'),
  bankName: text(80, 2, 'Enter the bank name'),
  accountNumber: z.preprocess(digits, z.string().regex(/^\d{9,18}$/, 'Account number must be 9–18 digits')),
  confirmAccountNumber: z.preprocess(digits, z.string()),
  ifsc: z.preprocess(upper, z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC, e.g. HDFC0001234')),
  upiId: text(260)
    .refine((v) => !v || /^[\w.-]{2,256}@[a-zA-Z]{2,64}$/.test(v), 'Enter a valid UPI ID, e.g. name@okaxis'),

  agree: z.literal(true, { message: 'Please accept the seller terms' }),
  /* Honeypot: people never see this field; bots fill it. */
  website: z.preprocess((v) => String(v ?? ''), z.string().max(0, 'Invalid submission')),
});

/* Checks that span fields. Run on the raw input (normalising what they
   read) so they report alongside field errors, not only after every
   other field is valid. */
function crossFieldIssues(raw) {
  const d = raw || {};
  const out = [];
  const gstin = upper(d.gstin);
  const acct = digits(d.accountNumber);
  if (acct && digits(d.confirmAccountNumber) !== acct) out.push(['confirmAccountNumber', 'Account numbers don’t match']);
  if (d.taxType === 'GST') {
    if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) out.push(['gstin', 'Enter your 15-character GSTIN']);
    else if (!gstinChecksumOk(gstin)) out.push(['gstin', 'This GSTIN’s check digit is wrong — please re-check it']);
    if (!/^https:\/\/res\.cloudinary\.com\//.test(String(d.gstCertificateUrl || ''))) out.push(['gstCertificateUrl', 'Upload your GST certificate']);
  } else if (d.taxType === 'ENROLMENT_ID') {
    /* GST enrolment ID for suppliers selling through e-commerce without
       GST registration. Allow 15 or 16 characters so a valid ID isn't
       refused over format; staff verify it on the GST portal. */
    if (!/^[A-Z0-9]{15,16}$/.test(upper(d.enrolmentId))) out.push(['enrolmentId', 'Enter your 16-character Enrolment ID']);
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(upper(d.pan))) out.push(['pan', 'Enter a valid PAN, e.g. ABCDE1234F']);
  } else if (d.taxType === 'NONE') {
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(upper(d.pan))) out.push(['pan', 'Enter a valid PAN, e.g. ABCDE1234F']);
  }
  return out;
}

export const vendorApplicationSchema = base.superRefine((d, ctx) => {
  for (const [path, message] of crossFieldIssues(d)) ctx.addIssue({ code: 'custom', path: [path], message });
});

/** Per-step field lists, so the form can validate one section at a time. */
export const STEP_FIELDS = Object.freeze([
  ['fullName', 'businessName', 'phone', 'email', 'instagram'],
  ['taxType', 'gstin', 'gstCertificateUrl', 'enrolmentId', 'pan'],
  ['address', 'landmark', 'city', 'state', 'pincode'],
  ['accountHolder', 'bankName', 'accountNumber', 'confirmAccountNumber', 'ifsc', 'upiId', 'agree'],
]);

/**
 * @returns {{ data: object } | { errors: Record<string, string> }}  first message per field
 */
export function parseVendorApplication(input) {
  const r = vendorApplicationSchema.safeParse(input || {});
  if (r.success) return { data: r.data };
  const errors = {};
  for (const i of r.error.issues) {
    const k = String(i.path[0] ?? 'form');
    if (!errors[k]) errors[k] = i.message;
  }
  for (const [k, message] of crossFieldIssues(input)) if (!errors[k]) errors[k] = message;
  return { errors };
}

/** Last 4 digits for display; the full number is stored encrypted. */
export const maskAccount = (acct) => (acct ? `••••${String(acct).slice(-4)}` : '');
