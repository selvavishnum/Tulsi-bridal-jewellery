/* ─────────────────────────────────────────────
   Customer ↔ seller chat and vendor password change, against the real
   handlers (session, Firestore and email are fakes).
   ───────────────────────────────────────────── */
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { fakeFirestore } from './helpers/fakeFirestore.mjs';
import { maskContacts, cleanMessage } from '../src/lib/chat.js';

process.env.ADMIN_EMAILS = 'owner@tulsi.test';
delete process.env.NEXT_PUBLIC_ADMIN_BYPASS;

const src = (p) => pathToFileURL(path.resolve('src', p)).href;
let db;
let session = null;
const mails = [];
const asCustomer = (id, name = 'Priya') => { session = { user: { id, name, email: `${id}@shop.test`, role: 'customer' } }; };
const asVendor = (email) => { session = { user: { id: `uid-${email}`, email, role: 'vendor' } }; };

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
mock.module(src('lib/email.js'), {
  namedExports: {
    esc: (v) => String(v ?? ''),
    sendChatNotification: async (a) => { mails.push(['chat', a]); return true; },
    sendVendorPasswordChanged: async (a) => { mails.push(['password', a]); return true; },
  },
});

const route = (p) => import(src(`app/api/${p}/route.js`));
const [inbox, thread, vInbox, vThread, password] = await Promise.all([
  route('messages'), route('messages/[id]'), route('vendor/messages'), route('vendor/messages/[id]'), route('vendor/password'),
]);

async function call(mod, method, { body, params } = {}) {
  const req = new Request('http://tulsi.test/api/x', {
    method, headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const res = await mod[method](req, { params: Promise.resolve(params || {}) });
  return { status: res.status, json: await res.json() };
}

let hash;
beforeEach(async () => {
  session = null;
  mails.length = 0;
  hash ||= await bcrypt.hash('OldPass123', 4);
  db = fakeFirestore({
    staff: {
      vA: { email: 'a@vendor.test', role: 'VENDOR', vendorId: 'vA', status: 'Active', password: hash },
      vB: { email: 'b@vendor.test', role: 'VENDOR', vendorId: 'vB', status: 'Active', password: hash },
    },
    vendors: {
      vA: { name: 'Meena Bridal', status: 'active', contactEmail: 'meena@vendor.test' },
      vB: { name: 'Other Seller', status: 'active' },
      vS: { name: 'Paused', status: 'suspended' },
    },
    products: {
      pA: { name: 'Temple Necklace', vendorId: 'vA', images: ['https://res.cloudinary.com/x/a.jpg'] },
      pS: { name: 'Paused piece', vendorId: 'vS' },
      pT: { name: 'Tulsi own', vendorId: 'tulsi' },
    },
    orders: { o1: { orderNumber: 'TBJ9', userId: 'c1' } },
  });
});

/* ── Rules ── */

test('contact details are masked so deals stay on the platform', () => {
  assert.equal(maskContacts('call me 98765 43210 or +91-9876543210'), 'call me [contact hidden] or [contact hidden]');
  assert.equal(maskContacts('mail x.y@gmail.com, wa.me/919876543210'), 'mail [contact hidden], [contact hidden]');
  assert.equal(maskContacts('Price ₹12,500 for 2 sets, 22 inch'), 'Price ₹12,500 for 2 sets, 22 inch', 'prices untouched');
  assert.equal(cleanMessage('   ').error, 'Type a message.');
  assert.ok(cleanMessage('x'.repeat(1001)).error);
});

/* ── Chat flow ── */

test('customer asks about a product → vendor sees it, replies → customer sees the reply; unread counts move', async () => {
  asCustomer('c1');
  const start = await call(inbox, 'POST', { body: { productId: 'pA', text: 'Is this available? 9876543210', orderNumber: 'TBJ9' } });
  assert.equal(start.status, 201, JSON.stringify(start.json));
  assert.equal(start.json.data.masked, true);
  const cid = start.json.data.conversationId;
  assert.equal(mails[0][1].to, 'meena@vendor.test', 'vendor emailed');

  await call(thread, 'POST', { body: { text: 'Also in red?' }, params: { id: cid } });
  assert.equal(mails.length, 1, 'one email per unread burst');

  asVendor('a@vendor.test');
  const list = await call(vInbox, 'GET');
  assert.equal(list.json.data[0].with, 'Priya');
  assert.equal(list.json.data[0].unread, 2);
  const t = await call(vThread, 'GET', { params: { id: cid } });
  assert.equal(t.json.data.messages.length, 2);
  assert.equal(t.json.data.messages[0].text, 'Is this available? [contact hidden]');
  assert.equal(t.json.data.messages[0].orderNumber, 'TBJ9', 'own order attached');
  assert.equal(JSON.stringify(t.json.data).includes('c1@shop.test'), false, 'vendor never sees the customer email');
  assert.equal((await call(vInbox, 'GET')).json.data[0].unread, 0, 'read once opened');

  await call(vThread, 'POST', { body: { text: 'Yes, red is in stock!' }, params: { id: cid } });
  assert.equal(mails.at(-1)[1].to, 'c1@shop.test', 'customer emailed');

  asCustomer('c1');
  const mine = await call(inbox, 'GET');
  assert.equal(mine.json.data[0].with, 'Meena Bridal');
  assert.equal(mine.json.data[0].unread, 1);
  const ct = await call(thread, 'GET', { params: { id: cid } });
  assert.deepEqual(ct.json.data.messages.map((m) => m.mine), [true, true, false]);
});

test('isolation: other customers and other vendors can’t read or post in a conversation', async () => {
  asCustomer('c1');
  const cid = (await call(inbox, 'POST', { body: { productId: 'pA', text: 'hi' } })).json.data.conversationId;
  asCustomer('c2');
  assert.equal((await call(thread, 'GET', { params: { id: cid } })).status, 404);
  assert.equal((await call(thread, 'POST', { body: { text: 'x' }, params: { id: cid } })).status, 404);
  asVendor('b@vendor.test');
  assert.equal((await call(vThread, 'GET', { params: { id: cid } })).status, 404);
  assert.equal((await call(vInbox, 'GET')).json.data.length, 0);
  asVendor('a@vendor.test');
  assert.equal((await call(inbox, 'GET')).status, 403, 'vendors can’t use the customer inbox');
  session = null;
  assert.equal((await call(inbox, 'POST', { body: { productId: 'pA', text: 'hi' } })).status, 401);
});

test('no chat for Tulsi’s own pieces or paused sellers; foreign order numbers are dropped', async () => {
  asCustomer('c2');
  assert.equal((await call(inbox, 'POST', { body: { productId: 'pT', text: 'hi' } })).status, 400);
  assert.equal((await call(inbox, 'POST', { body: { productId: 'pS', text: 'hi' } })).status, 409);
  const r = await call(inbox, 'POST', { body: { productId: 'pA', text: 'hi', orderNumber: 'TBJ9' } });
  const [msg] = [...db.store.get('chat_messages').values()];
  assert.equal(r.status, 201);
  assert.equal(msg.orderNumber, undefined, 'TBJ9 is c1’s order, not c2’s');
});

/* ── Vendor password ── */

test('vendor changes own password: needs the current one, alerts the Super Admin', async () => {
  asVendor('a@vendor.test');
  assert.equal((await call(password, 'PUT', { body: { currentPassword: 'wrong', newPassword: 'NewPass456' } })).status, 400);
  assert.equal((await call(password, 'PUT', { body: { currentPassword: 'OldPass123', newPassword: 'short' } })).status, 400);
  const ok = await call(password, 'PUT', { body: { currentPassword: 'OldPass123', newPassword: 'NewPass456' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const staff = db.store.get('staff');
  assert.ok(await bcrypt.compare('NewPass456', staff.get('vA').password));
  assert.ok(await bcrypt.compare('OldPass123', staff.get('vB').password), 'other vendor untouched');
  const [, alert] = mails.find(([k]) => k === 'password');
  assert.deepEqual(alert.adminEmails, ['owner@tulsi.test']);
  assert.equal(alert.vendorName, 'Meena Bridal');
  session = null;
  assert.equal((await call(password, 'PUT', { body: { currentPassword: 'NewPass456', newPassword: 'Another789' } })).status, 401);
});
