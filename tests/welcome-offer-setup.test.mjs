/* ─────────────────────────────────────────────
   scripts/setup-welcome-offer.mjs — the owner's one-time setup of the
   welcome offer (coupon TULSI100 + settings/site.announcement). Its logic
   lives in scripts/lib/welcome-offer-setup.mjs and takes the Firestore db
   as an argument, so it runs here against the in-memory fake:

     - the coupon is exactly what the admin form would store: fixed ₹100,
       first order only, switched on, no expiry, no overall cap;
     - a dry run writes nothing; --apply writes; running it again changes
       nothing (idempotent);
     - an existing coupon is corrected without losing its usage history, and
       other site settings are left alone;
     - the result is what the storefront needs: GET /api/announcement says
       the offer is active, and the coupon check gives ₹100 off.

   Run: npm test
   ───────────────────────────────────────────── */
import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeFirestore } from './helpers/fakeFirestore.mjs';
import { couponDiscountFor, couponStateRefusal } from '../src/lib/coupons.js';
import { DEFAULT_ANNOUNCEMENT } from '../src/lib/welcomeOffer.js';
import {
  WELCOME_CODE, WELCOME_AMOUNT, buildWelcomeCoupon, buildAnnouncement, describeCoupon, diffFields, planCoupon, planAnnouncement, bridalMentions, runSetup,
} from '../scripts/lib/welcome-offer-setup.mjs';

const src = (p) => pathToFileURL(path.resolve('src', p)).href;
let db;
mock.module(src('lib/firebase.js'), { namedExports: { getDB: () => db } });
mock.module('next-auth', { defaultExport: { getServerSession: async () => null }, namedExports: { getServerSession: async () => null } });
mock.module(src('app/api/auth/[...nextauth]/route.js'), { namedExports: { authOptions: {} } });
const announcement = await import(src('app/api/announcement/route.js'));
const validate = await import(src('app/api/coupons/validate/route.js'));

const NOW = '2026-11-01T10:00:00.000Z';
const quiet = () => { const lines = []; return { lines, log: (...a) => lines.push(a.join(' ')) }; };
const couponDocs = () => [...db.store.get('coupons').entries()].map(([id, d]) => ({ id, ...d }));
const siteDoc = () => db.store.get('settings').get('site');
const snapshot = () => JSON.stringify([...db.store].map(([col, docs]) => [col, [...docs]]));

describe('the welcome coupon', () => {
  test('is flat ₹100 off the first order: on, no expiry, no overall cap — the shape the admin form stores', () => {
    assert.deepEqual(buildWelcomeCoupon(), {
      code: 'TULSI100',
      description: 'Welcome offer: flat ₹100 off your first order',
      type: 'fixed',
      value: 100,
      maxUses: 0, // blank limit = unlimited overall (each customer can use a code once)
      minOrderAmount: 0,
      maxDiscount: null,
      startsAt: null,
      expiresAt: null,
      isActive: true,
      firstOrderOnly: true,
    });
  });

  test('the offer text, the code and the coupon agree', () => {
    const c = buildWelcomeCoupon();
    assert.equal(WELCOME_CODE, DEFAULT_ANNOUNCEMENT.code);
    assert.equal(c.code, WELCOME_CODE);
    assert.deepEqual(buildAnnouncement(), { enabled: true, message: DEFAULT_ANNOUNCEMENT.message, code: 'TULSI100' });
    assert.match(DEFAULT_ANNOUNCEMENT.message, new RegExp(`₹${WELCOME_AMOUNT} OFF on your first order`));
    assert.equal(c.value, WELCOME_AMOUNT);
    assert.equal(couponDiscountFor(c, 1599), 100);
    assert.equal(couponDiscountFor(c, 60), 60, 'never more than the order');
    assert.equal(couponStateRefusal(c), null, 'live from the first second');
  });
});

describe('planning', () => {
  const wanted = buildWelcomeCoupon();

  test('diffFields lists only what differs; missing and null count as the same', () => {
    assert.deepEqual(diffFields({ a: 1, b: null }, { a: 1, b: null, c: null }), []);
    assert.deepEqual(diffFields({ a: 1 }, { a: 2, d: 'x' }), [{ field: 'a', from: 1, to: 2 }, { field: 'd', from: null, to: 'x' }]);
  });

  test('no coupon yet → create it, with fresh usage bookkeeping', () => {
    const p = planCoupon([], wanted, NOW);
    assert.equal(p.action, 'create');
    assert.deepEqual(p.data, { ...wanted, usedCount: 0, usedBy: [], createdAt: NOW });
  });

  test('already right → nothing; one field off → update just that (plus updatedAt), never the usage history', () => {
    const stored = { ...wanted, usedCount: 7, usedBy: ['u:1'], createdAt: '2026-01-01T00:00:00.000Z' };
    assert.equal(planCoupon([{ id: 'c1', data: stored }], wanted, NOW).action, 'none');
    const p = planCoupon([{ id: 'c1', data: { ...stored, isActive: false } }], wanted, NOW);
    assert.equal(p.action, 'update');
    assert.deepEqual(p.patch, { isActive: true, updatedAt: NOW });
    assert.equal(p.result.usedCount, 7);
  });

  test('two coupons with the code → refuse to guess which one', () => {
    assert.deepEqual(planCoupon([{ id: 'a', data: {} }, { id: 'b', data: {} }], wanted, NOW), { action: 'conflict', ids: ['a', 'b'] });
  });

  test('announcement: missing, old default or switched off → save; exactly right → nothing', () => {
    const want = buildAnnouncement();
    assert.equal(planAnnouncement({}, want, NOW).action, 'update');
    assert.equal(planAnnouncement(null, want, NOW).action, 'update');
    assert.deepEqual(planAnnouncement({ announcement: { enabled: true, message: 'Welcome Offer: Flat 10% OFF on your first jewellery order', code: 'TULSI10' } }, want, NOW).changes.map((c) => c.field), ['message', 'code']);
    assert.deepEqual(planAnnouncement({ announcement: { ...want, enabled: false } }, want, NOW).changes.map((c) => c.field), ['enabled']);
    assert.equal(planAnnouncement({ announcement: { ...want } }, want, NOW).action, 'none');
  });

  test('bridalMentions finds old-brand text in the stored settings, but not the announcement being replaced', () => {
    const site = { businessName: 'Tulsi Bridal Jewellery', phone: '+91 1', tagline: 'Exquisite bridal jewellery', announcement: { message: 'Bridal sale' }, nested: { list: ['fine', 'Bridal sets'] } };
    assert.deepEqual(bridalMentions(site).map((m) => m.path), ['businessName', 'tagline', 'nested.list[1]']);
    assert.deepEqual(bridalMentions({ businessName: 'Tulsi Fashion Jewellery' }), []);
  });
});

describe('running it', () => {
  beforeEach(() => {
    db = fakeFirestore({ coupons: {}, settings: { site: { phone: '+91 76958 68787', businessName: 'Tulsi Bridal Jewellery', announcement: { enabled: true, message: 'Welcome Offer: Flat 10% OFF on your first jewellery order', code: 'TULSI10' } } } });
  });

  test('a dry run says what it would do and writes nothing', async () => {
    const before = snapshot();
    const { lines, log } = quiet();
    const r = await runSetup(db, { apply: false, now: NOW, log });
    assert.equal(snapshot(), before);
    assert.equal(r.ok, true);
    const text = lines.join('\n');
    assert.match(text, /→ CREATE a new coupon/);
    assert.match(text, /code: "TULSI100"/);
    assert.match(text, /type: "fixed"/);
    assert.match(text, /value: 100/);
    assert.match(text, /firstOrderOnly: true/);
    assert.match(text, /expiresAt: null/);
    assert.match(text, /message: "Welcome Offer: Flat 10% OFF on your first jewellery order" → "Welcome Offer: Flat ₹100 OFF on your first order"/);
    assert.match(text, /code: "TULSI10" → "TULSI100"/);
    assert.match(text, /businessName = "Tulsi Bridal Jewellery"/, 'the old brand name still stored is reported, not changed');
    assert.match(text, /DRY RUN — nothing was written\. Run again with --apply/);
  });

  test('--apply creates the coupon and saves the strip, keeping the other site settings', async () => {
    const { log } = quiet();
    const r = await runSetup(db, { apply: true, now: NOW, log });
    assert.equal(r.live, true);
    const [c] = couponDocs();
    assert.equal(couponDocs().length, 1);
    assert.deepEqual({ ...c, id: undefined }, { id: undefined, ...buildWelcomeCoupon(), usedCount: 0, usedBy: [], createdAt: NOW });
    assert.deepEqual(siteDoc().announcement, buildAnnouncement());
    assert.equal(siteDoc().phone, '+91 76958 68787');
    assert.equal(siteDoc().businessName, 'Tulsi Bridal Jewellery', 'never rewritten by the script');
    assert.equal(siteDoc().updatedAt, NOW);
  });

  test('running it again changes nothing', async () => {
    const { log } = quiet();
    await runSetup(db, { apply: true, now: NOW, log });
    const after = snapshot();
    const second = quiet();
    const r = await runSetup(db, { apply: true, now: '2026-12-01T00:00:00.000Z', log: second.log });
    assert.equal(snapshot(), after, 'not even updatedAt moves');
    assert.equal(r.coupon.action, 'none');
    assert.equal(r.announcement.action, 'none');
    assert.match(second.lines.join('\n'), /already as wanted/);
    assert.match(second.lines.join('\n'), /Nothing to write\./);
  });

  test('an existing TULSI100 saved the old way is corrected; its uses and history stay', async () => {
    db.store.get('coupons').set('old', {
      code: 'TULSI100', type: 'percentage', value: 10, maxUses: 100, minOrderAmount: 500, maxDiscount: 50,
      startsAt: null, expiresAt: '2020-01-01T00:00:00.000Z', isActive: false, firstOrderOnly: false,
      usedCount: 7, usedBy: ['u:1', 'u:2'], createdAt: '2025-05-05T00:00:00.000Z',
    });
    const { lines, log } = quiet();
    const r = await runSetup(db, { apply: true, now: NOW, log });
    assert.equal(r.coupon.action, 'update');
    assert.equal(couponDocs().length, 1, 'updated in place, not duplicated');
    assert.deepEqual(db.store.get('coupons').get('old'), {
      ...buildWelcomeCoupon(), usedCount: 7, usedBy: ['u:1', 'u:2'], createdAt: '2025-05-05T00:00:00.000Z', updatedAt: NOW,
    });
    assert.match(lines.join('\n'), /expiresAt: "2020-01-01T00:00:00\.000Z" → null/);
    assert.match(lines.join('\n'), /isActive: false → true/);
    assert.equal(r.live, true);
  });

  test('an earlier welcome code that is still live is reported, never touched; one already switched off is not', async () => {
    db.store.get('coupons').set('old', { code: 'TULSI10', type: 'percentage', value: 10, isActive: true, firstOrderOnly: true, maxUses: 0 });
    db.store.get('coupons').set('off', { code: 'OLDWELCOME', type: 'fixed', value: 50, isActive: false, firstOrderOnly: true });
    db.store.get('coupons').set('fest', { code: 'FEST5', type: 'percentage', value: 5, isActive: true });
    const { lines, log } = quiet();
    await runSetup(db, { apply: true, now: NOW, log });
    const text = lines.join('\n');
    assert.match(text, /other first-order-only coupons that are still live/);
    assert.match(text, /TULSI10 — 10% off/);
    assert.doesNotMatch(text, /OLDWELCOME|FEST5/);
    assert.equal(db.store.get('coupons').get('old').isActive, true, 'left alone');
    assert.equal(describeCoupon({ code: 'X', type: 'fixed', value: 250 }), 'X — ₹250 off');
  });

  test('two coupons already use the code → stops, writes nothing, reports failure', async () => {
    db.store.get('coupons').set('a', { code: 'TULSI100', type: 'fixed', value: 1 });
    db.store.get('coupons').set('b', { code: 'TULSI100', type: 'fixed', value: 2 });
    const before = snapshot();
    const { lines, log } = quiet();
    const r = await runSetup(db, { apply: true, now: NOW, log });
    assert.equal(r.ok, false);
    assert.equal(snapshot(), before);
    assert.match(lines.join('\n'), /2 coupons already use this code \(a, b\)/);
  });

  test('a store with no settings document at all gets one with just the offer', async () => {
    db = fakeFirestore({});
    const { log } = quiet();
    await runSetup(db, { apply: true, now: NOW, log });
    assert.deepEqual(siteDoc(), { announcement: buildAnnouncement(), updatedAt: NOW });
  });
});

describe('what the storefront then sees', () => {
  test('GET /api/announcement is active with the new offer, and the coupon check gives ₹100 off the first order', async () => {
    db = fakeFirestore({ settings: { site: { announcement: { enabled: true, message: 'Old offer', code: 'TULSI10' } } } });
    await runSetup(db, { apply: true, now: new Date().toISOString(), log: () => {} });

    const a = await (await announcement.GET()).json();
    assert.deepEqual(a, { success: true, enabled: true, message: 'Welcome Offer: Flat ₹100 OFF on your first order', code: 'TULSI100', active: true });

    const res = await validate.POST(new Request('http://tulsi.test/api/coupons/validate', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.1.2.3' }, body: JSON.stringify({ code: 'tulsi100', orderAmount: 1599 }),
    }));
    const v = await res.json();
    assert.equal(res.status, 200);
    assert.equal(v.data.discount, 100);
    assert.equal(v.data.firstOrderOnly, true);
    assert.equal(v.data.coupon.code, 'TULSI100');
  });
});
