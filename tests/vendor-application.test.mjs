/* ─────────────────────────────────────────────
   Seller applications — schema, encryption, the public API and the
   Super Admin approve / reject flow, against the real handlers
   (Firestore, email, Cloudinary and Shiprocket are fakes).
   ───────────────────────────────────────────── */
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { fakeFirestore } from './helpers/fakeFirestore.mjs';
import { parseVendorApplication, gstinChecksumOk } from '../src/lib/vendorApplication.js';
import { encryptField, decryptField } from '../src/lib/fieldCrypto.js';

process.env.ADMIN_EMAILS = 'owner@tulsi.test';
process.env.VENDOR_DATA_KEY = 'a'.repeat(64);
delete process.env.NEXT_PUBLIC_ADMIN_BYPASS;
delete process.env.SHIPROCKET_EMAIL;

const src = (p) => pathToFileURL(path.resolve('src', p)).href;
let db;
let session = null;
const mails = [];

mock.module('next-auth', { defaultExport: { getServerSession: async () => session }, namedExports: { getServerSession: async () => session } });
mock.module(src('app/api/auth/[...nextauth]/route.js'), { namedExports: { authOptions: {} } });
mock.module(src('lib/firebase.js'), {
  namedExports: {
    getDB: () => db, getBucket: () => null,
    FieldValue: { increment: (n) => n, serverTimestamp: () => new Date().toISOString() },
    Timestamp: class {},
    docToObj: (d) => (d.exists ? { id: d.id, ...d.data() } : null),
    snapshotToArr: (snap) => snap.docs.map((d) => ({ id: d.id, _id: d.id, ...d.data() })),
    toPublicProduct: (p) => p, paginate: async () => ({}), newId: () => `id${Date.now()}`,
  },
});
const record = (kind) => async (arg) => { mails.push([kind, arg]); return true; };
mock.module(src('lib/email.js'), {
  namedExports: {
    esc: (v) => String(v ?? ''),
    sendVendorApplicationAlert: record('alert'),
    sendVendorWelcome: record('welcome'),
    sendVendorApplicationRejected: record('rejected'),
  },
});

const apply = await import(src('app/api/vendor-applications/route.js'));
const list = await import(src('app/api/admin/vendor-applications/route.js'));
const review = await import(src('app/api/admin/vendor-applications/[id]/route.js'));

const GSTIN = '27AAPFU0939F1ZV';
const valid = (over = {}) => ({
  fullName: 'Meena Raj', businessName: 'Meena Bridal', phone: '+91 98765 43210', email: 'Meena@Example.com', instagram: 'https://instagram.com/meena.bridal/',
  taxType: 'GST', gstin: GSTIN.toLowerCase(), gstCertificateUrl: 'https://res.cloudinary.com/demo/image/upload/v1/tulsi-bridal/vendor-applications/c.pdf',
  address: '12, Bazaar Street', landmark: '', city: 'Madurai', state: 'Tamil Nadu', pincode: '625001',
  accountHolder: 'Meena Raj', bankName: 'Indian Bank', accountNumber: '123456789012', confirmAccountNumber: '123456789012', ifsc: 'idib000m001', upiId: '',
  agree: true, website: '', ...over,
});

let ipSeq = 0;
async function call(mod, method, { body, params, ip } = {}) {
  const req = new Request('http://tulsi.test/api/x', {
    method, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip || `10.0.0.${++ipSeq}` },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const res = await mod[method](req, { params: Promise.resolve(params || {}) });
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  session = null;
  mails.length = 0;
  db = fakeFirestore({ staff: { s1: { email: 'taken@example.com', role: 'VENDOR', status: 'Active' } } });
});

/* ── Schema ── */

test('schema: normalises a valid application', () => {
  assert.ok(gstinChecksumOk(GSTIN));
  const { data } = parseVendorApplication(valid());
  assert.equal(data.phone, '9876543210');
  assert.equal(data.email, 'meena@example.com');
  assert.equal(data.instagram, 'meena.bridal');
  assert.equal(data.gstin, GSTIN);
  assert.equal(data.ifsc, 'IDIB000M001');
});

test('schema: every wrong field is reported at once', () => {
  const { errors } = parseVendorApplication(valid({
    phone: '12345', pincode: '0123', gstin: '27AAPFU0939F1ZX', confirmAccountNumber: '1', address: 'no number here', agree: false,
  }));
  for (const k of ['phone', 'pincode', 'gstin', 'confirmAccountNumber', 'address', 'agree']) assert.ok(errors[k], `${k} flagged`);
  assert.match(errors.gstin, /check digit/);
});

test('schema: Enrolment ID path needs a PAN; GST path needs the certificate', () => {
  const e1 = parseVendorApplication(valid({ taxType: 'ENROLMENT_ID', enrolmentId: '331234567890ABC', pan: 'bad' })).errors;
  assert.ok(e1.pan);
  assert.ok(!e1.enrolmentId);
  assert.ok(parseVendorApplication(valid({ gstCertificateUrl: 'https://evil.test/x.pdf' })).errors.gstCertificateUrl);
  assert.ok(parseVendorApplication(valid({ fullName: '<script>' })).errors.fullName, 'markup refused');
});

test('bank account numbers are encrypted, tamper-evident', () => {
  const enc = encryptField('123456789012');
  assert.notEqual(enc, encryptField('123456789012'), 'random IV');
  assert.ok(!enc.includes('123456789012'));
  assert.equal(decryptField(enc), '123456789012');
  const parts = enc.split(':');
  parts[3] = Buffer.from('999999999999').toString('base64');
  assert.throws(() => decryptField(parts.join(':')));
});

/* ── Public API ── */

test('apply: stores a PENDING application with the account number encrypted and alerts the team', async () => {
  const r = await call(apply, 'POST', { body: valid() });
  assert.equal(r.status, 201);
  const [app] = [...db.store.get('vendor_applications').values()];
  assert.equal(app.status, 'PENDING');
  assert.equal(app.tax_type, 'GST');
  assert.equal(app.pan_number, 'AAPFU0939F', 'PAN taken from the GSTIN');
  assert.equal(app.bank_details.account_masked, '••••9012');
  assert.ok(!JSON.stringify(app).includes('123456789012'), 'no plain account number stored');
  assert.equal(decryptField(app.bank_details.account_number_enc), '123456789012');
  assert.equal(mails[0][0], 'alert');
});

test('apply: bad input → 400 with field errors; duplicates and existing logins → 409', async () => {
  const bad = await call(apply, 'POST', { body: valid({ phone: '1' }) });
  assert.equal(bad.status, 400);
  assert.ok(bad.json.errors.phone);
  assert.equal((await call(apply, 'POST', { body: valid() })).status, 201);
  assert.equal((await call(apply, 'POST', { body: valid({ email: 'other@example.com' }) })).status, 409, 'same phone');
  assert.equal((await call(apply, 'POST', { body: valid({ phone: '9123456780', email: 'taken@example.com' }) })).status, 409, 'already a login');
});

test('apply: certificate must be our upload; honeypot drops bots silently; rate limited per IP', async () => {
  const foreign = await call(apply, 'POST', { body: valid({ gstCertificateUrl: 'https://res.cloudinary.com/other/image/upload/x.pdf' }) });
  assert.equal(foreign.status, 400);
  const bot = await call(apply, 'POST', { body: valid({ website: 'http://spam' }) });
  assert.equal(bot.status, 201);
  assert.equal(db.store.get('vendor_applications')?.size || 0, 0, 'bot stored nothing');
  const codes = [];
  for (let i = 0; i < 4; i += 1) codes.push((await call(apply, 'POST', { body: valid({ phone: `98765432${10 + i}`, email: `s${i}@example.com` }), ip: '9.9.9.9' })).status);
  assert.deepEqual(codes, [201, 201, 201, 429]);
});

/* ── Super Admin review ── */

async function seedApplication() {
  await call(apply, 'POST', { body: valid() });
  return [...db.store.get('vendor_applications').keys()][0];
}

test('review: only the Super Admin may list or decide', async () => {
  const id = await seedApplication();
  assert.equal((await call(list, 'GET')).status, 403);
  session = { user: { email: 'taken@example.com' } };
  assert.equal((await call(list, 'GET')).status, 403, 'a vendor login');
  assert.equal((await call(review, 'PATCH', { body: { action: 'approve' }, params: { id } })).status, 403);
  session = { user: { email: 'owner@tulsi.test' } };
  const r = await call(list, 'GET');
  assert.equal(r.status, 200);
  assert.equal(r.json.data.length, 1);
  assert.equal(r.json.data[0].bank_details.account_number_enc, undefined, 'ciphertext never leaves the server');
});

test('approve: creates the vendor + VENDOR login with the bank payout, launch offer and a one-time password', async () => {
  const id = await seedApplication();
  session = { user: { email: 'owner@tulsi.test' } };
  const r = await call(review, 'PATCH', { body: { action: 'approve' }, params: { id } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const { vendorId, tempPassword, whatsappUrl } = r.json.data;
  const vendor = db.store.get('vendors').get(vendorId);
  assert.equal(vendor.name, 'Meena Bridal');
  assert.equal(vendor.gstin, GSTIN);
  assert.deepEqual(vendor.payout, { method: 'bank', accountName: 'Meena Raj', accountNumber: '123456789012', ifsc: 'IDIB000M001' });
  assert.equal(vendor.pickupAddress.pincode, '625001');
  assert.equal(vendor.platformFeeBps, 0);
  assert.ok(new Date(vendor.launchOfferUntil) > new Date(Date.now() + 80 * 86_400_000));
  const login = [...db.store.get('staff').values()].find((s) => s.vendorId === vendorId);
  assert.equal(login.role, 'VENDOR');
  assert.equal(login.email, 'meena@example.com');
  assert.ok(await bcrypt.compare(tempPassword, login.password));
  assert.match(whatsappUrl, /^https:\/\/wa\.me\/919876543210\?text=/);
  assert.equal(db.store.get('vendor_applications').get(id).status, 'APPROVED');
  assert.ok(mails.some(([k, a]) => k === 'welcome' && a.password === tempPassword));

  const again = await call(review, 'PATCH', { body: { action: 'approve' }, params: { id } });
  assert.equal(again.status, 409, 'no second vendor from a double click');
  assert.equal(db.store.get('vendors').size, 1);
});

test('reject: needs a reason, emails it, and lets the seller apply again', async () => {
  const id = await seedApplication();
  session = { user: { email: 'owner@tulsi.test' } };
  assert.equal((await call(review, 'PATCH', { body: { action: 'reject' }, params: { id } })).status, 400);
  const r = await call(review, 'PATCH', { body: { action: 'reject', reason: 'GSTIN cancelled' }, params: { id } });
  assert.equal(r.status, 200);
  assert.equal(db.store.get('vendor_applications').get(id).status, 'REJECTED');
  assert.ok(mails.some(([k, a]) => k === 'rejected' && a.reason === 'GSTIN cancelled'));
  session = null;
  assert.equal((await call(apply, 'POST', { body: valid() })).status, 201, 'reapply after rejection');
});
