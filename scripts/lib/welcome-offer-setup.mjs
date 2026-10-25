/* ─────────────────────────────────────────────
   Welcome-offer setup — the logic behind scripts/setup-welcome-offer.mjs.

   Two things on the live store have to agree before the top strip shows
   "Use Code: TULSI100":
     1. a coupon TULSI100 — flat ₹100 off, first order only, switched on, no
        expiry, no overall cap (every coupon is already once per customer:
        checkout records who used it), and
     2. settings/site.announcement = { enabled, message, code: 'TULSI100' }
        — saved settings override the built-in default
        (DEFAULT_ANNOUNCEMENT in src/lib/welcomeOffer.js), so a store that
        has ever saved the announcement keeps showing the old offer.

   Everything here is pure or takes the Firestore Admin db as an argument
   (like src/lib/coupons.js), so it runs against the test fake as well as
   the real thing. Safe to run again: it only reports "up to date" once
   both already match, and it never touches a coupon's usage bookkeeping
   (usedCount, usedBy, createdAt) or any other site setting.
   ───────────────────────────────────────────── */
import { parseCouponInput, checkCouponValue, couponStateRefusal } from '../../src/lib/coupons.js';
import { DEFAULT_ANNOUNCEMENT } from '../../src/lib/welcomeOffer.js';

export const WELCOME_CODE = DEFAULT_ANNOUNCEMENT.code;
export const WELCOME_AMOUNT = 100;

/** The coupon exactly as the admin form + POST /api/coupons would store it (before usage bookkeeping). */
export function buildWelcomeCoupon() {
  const parsed = parseCouponInput({
    code: WELCOME_CODE,
    description: `Welcome offer: flat ₹${WELCOME_AMOUNT} off your first order`,
    type: 'fixed',
    value: WELCOME_AMOUNT,
    minOrderAmount: 0, // the discount never exceeds the order (couponDiscountFor)
    maxDiscount: '',   // no cap
    usageLimit: '',    // blank = unlimited overall; each customer can still use it once
    validFrom: '',     // straight away
    validUntil: '',    // never expires
    isActive: true,
    firstOrderOnly: true,
  });
  if (parsed.error) throw new Error(`Welcome coupon is not valid: ${parsed.error}`);
  const bad = checkCouponValue(parsed.data);
  if (bad) throw new Error(`Welcome coupon is not valid: ${bad}`);
  return parsed.data;
}

/** What the strip is saved as. */
export function buildAnnouncement() {
  return { enabled: true, message: DEFAULT_ANNOUNCEMENT.message, code: WELCOME_CODE };
}

const same = (a, b) => (a ?? null) === (b ?? null);

/** The fields of `wanted` that `current` does not already have: [{ field, from, to }]. */
export function diffFields(current, wanted) {
  const have = current || {};
  return Object.entries(wanted)
    .filter(([field, to]) => !same(have[field], to))
    .map(([field, to]) => ({ field, from: have[field] ?? null, to }));
}

/**
 * What to do about the coupon, given the stored documents with this code.
 * @param {{ id: string, data: object }[]} found
 * @returns {{ action: 'create', data: object }
 *         | { action: 'update', id: string, changes: object[], patch: object, result: object }
 *         | { action: 'none', id: string, result: object }
 *         | { action: 'conflict', ids: string[] }}
 */
export function planCoupon(found, wanted, now) {
  if (found.length > 1) return { action: 'conflict', ids: found.map((d) => d.id) };
  if (found.length === 0) return { action: 'create', data: { ...wanted, usedCount: 0, usedBy: [], createdAt: now } };
  const [{ id, data }] = found;
  const changes = diffFields(data, wanted);
  if (!changes.length) return { action: 'none', id, result: data };
  const patch = { ...Object.fromEntries(changes.map((c) => [c.field, c.to])), updatedAt: now };
  return { action: 'update', id, changes, patch, result: { ...data, ...patch } };
}

/** What to do about settings/site.announcement. */
export function planAnnouncement(site, wanted, now) {
  const current = site && typeof site.announcement === 'object' && site.announcement ? site.announcement : {};
  const changes = diffFields(current, wanted);
  if (!changes.length) return { action: 'none' };
  return { action: 'update', changes, patch: { announcement: wanted, updatedAt: now } };
}

/** Stored settings that still say "Bridal" — reported, never changed. */
export function bridalMentions(site, { skip = ['announcement'], limit = 20 } = {}) {
  const out = [];
  const walk = (value, path, depth) => {
    if (out.length >= limit || depth > 4) return;
    if (typeof value === 'string') { if (/bridal/i.test(value)) out.push({ path, text: value }); return; }
    if (Array.isArray(value)) { value.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1)); return; }
    if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) if (!(depth === 0 && skip.includes(k))) walk(v, path ? `${path}.${k}` : k, depth + 1);
  };
  walk(site || {}, '', 0);
  return out;
}

/** One line about a coupon, e.g. `TULSI10 — 10% off`. */
export function describeCoupon(c) {
  const off = c.type === 'percentage' ? `${c.value}%` : `₹${c.value}`;
  return `${c.code} — ${off} off`;
}

const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v ?? null));

function describeChanges(changes, log) {
  for (const c of changes) log(`      ${c.field}: ${show(c.from)} → ${show(c.to)}`);
}

/**
 * Plan (and, with `apply`, perform) the setup against a Firestore Admin db.
 * @returns {Promise<{ ok: boolean, coupon: object, announcement: object, live: boolean }>}
 */
export async function runSetup(firestore, { apply = false, now = new Date().toISOString(), log = console.log } = {}) {
  const wantedCoupon = buildWelcomeCoupon();
  const wantedAnnouncement = buildAnnouncement();

  const couponSnap = await firestore.collection('coupons').where('code', '==', WELCOME_CODE).limit(2).get();
  const found = couponSnap.docs.map((d) => ({ id: d.id, data: d.data() }));
  const siteRef = firestore.collection('settings').doc('site');
  const siteSnap = await siteRef.get();
  const site = siteSnap.exists ? siteSnap.data() : {};

  const coupon = planCoupon(found, wantedCoupon, now);
  const announcement = planAnnouncement(site, wantedAnnouncement, now);

  log(`Coupon ${WELCOME_CODE}  (coupons collection)`);
  if (coupon.action === 'conflict') {
    log(`   ✗ ${coupon.ids.length} coupons already use this code (${coupon.ids.join(', ')}). Delete the extras in Admin → Coupons, then run this again. Nothing was changed.`);
    return { ok: false, coupon, announcement, live: false };
  }
  if (coupon.action === 'create') {
    log('   → CREATE a new coupon:');
    for (const [field, to] of Object.entries(coupon.data)) log(`      ${field}: ${show(to)}`);
  } else if (coupon.action === 'update') {
    log(`   → UPDATE coupon ${coupon.id} (usage counts and history are kept):`);
    describeChanges(coupon.changes, log);
  } else {
    log(`   ✓ coupon ${coupon.id} is already as wanted — nothing to do.`);
  }

  log('Announcement  (settings/site → announcement)');
  if (announcement.action === 'update') {
    log('   → SAVE the welcome offer strip (other site settings are left alone):');
    describeChanges(announcement.changes, log);
  } else {
    log('   ✓ already as wanted — nothing to do.');
  }

  const resultingCoupon = coupon.action === 'create' ? coupon.data : coupon.result;
  const refusal = couponStateRefusal(resultingCoupon);
  const live = refusal === null;
  log(live
    ? `Result: ${WELCOME_CODE} is live — the strip shows the offer (within about a minute: /api/announcement is cached for 60 s).`
    : `Result: ${WELCOME_CODE} would NOT be live (${refusal}) — the strip would keep its tagline.`);

  /* An earlier welcome code (e.g. TULSI10) keeps working until it is switched
     off — shoppers who saved it still get it at checkout. Reported, not touched. */
  const firstOrder = await firestore.collection('coupons').where('firstOrderOnly', '==', true).limit(20).get();
  const others = firstOrder.docs.map((d) => d.data()).filter((c) => c.code !== WELCOME_CODE && couponStateRefusal(c) === null);
  if (others.length) {
    log('Not changed — other first-order-only coupons that are still live (switch them off in Admin → Coupons if the old offer should end):');
    for (const c of others) log(`   ${describeCoupon(c)}`);
  }

  const mentions = bridalMentions(site);
  if (mentions.length) {
    log('Not changed — stored site settings that still say "Bridal" (edit them in Admin → Settings; until then the footer and the store data for search engines ignore the saved name, tagline and description):');
    for (const m of mentions) log(`   ${m.path} = ${show(m.text.length > 90 ? `${m.text.slice(0, 87)}...` : m.text)}`);
  }

  if (!apply) {
    log(coupon.action === 'none' && announcement.action === 'none' ? 'DRY RUN — nothing needed.' : 'DRY RUN — nothing was written. Run again with --apply to do the above.');
    return { ok: true, coupon, announcement, live };
  }

  if (coupon.action === 'create') await firestore.collection('coupons').doc().set(coupon.data);
  else if (coupon.action === 'update') await firestore.collection('coupons').doc(coupon.id).update(coupon.patch);
  if (announcement.action === 'update') await siteRef.set(announcement.patch, { merge: true });
  log(coupon.action === 'none' && announcement.action === 'none' ? 'Nothing to write.' : 'APPLIED.');
  return { ok: true, coupon, announcement, live };
}
