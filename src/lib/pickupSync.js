/* ─────────────────────────────────────────────
   Keeps a vendor's warehouse registered as a pickup location on Tulsi's
   Shiprocket account.

   Runs when the vendor saves their pickup address (and on "Retry"). The
   address is checked first (instant, specific errors), then sent to
   Shiprocket as `VENDOR_<id>`. Shiprocket can't edit a pickup address, so
   a changed address is registered under the next version
   (`VENDOR_<id>_2`, …) and replaces the old nickname only once
   Shiprocket accepts it — a failed re-sync never breaks the working one.
   ───────────────────────────────────────────── */
import crypto from 'crypto';
import { addPickupLocation, isConfigured, ShiprocketError } from '@/lib/shiprocket';
import { pickupNickname, pickupAddressProblem } from '@/lib/shipmentPlan';

const hashOf = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

/**
 * @returns {{ status: 'active'|'needs_verification'|'incomplete'|'error'|'skipped'|'unchanged', message?: string, nickname?: string }}
 */
export async function syncVendorPickup(db, vendorId, { force = false } = {}) {
  const ref = db.collection('vendors').doc(vendorId);
  const vendor = (await ref.get()).data() || {};
  const a = vendor.pickupAddress || {};
  const contact = { name: vendor.contactName || vendor.name || '', phone: vendor.phone || '' };
  const now = new Date().toISOString();
  const prev = vendor.shiprocketPickup || {};

  const problem = pickupAddressProblem({ ...a, ...contact });
  if (problem) {
    await ref.update({ shiprocketPickup: { ...prev, lastError: problem, lastErrorAt: now, ...(!prev.nickname && { status: 'incomplete' }) } });
    return { status: 'incomplete', message: problem };
  }
  if (!isConfigured()) return { status: 'skipped', message: 'Shiprocket isn’t set up yet — Tulsi will register your pickup address.' };

  const addressHash = hashOf({ a, contact });
  if (!force && prev.addressHash === addressHash && prev.nickname && prev.status !== 'error') {
    return { status: 'unchanged', nickname: prev.nickname };
  }

  let email = vendor.contactEmail;
  if (!email) {
    const login = await db.collection('staff').where('vendorId', '==', vendorId).limit(1).get();
    email = login.empty ? process.env.SMTP_USER || '' : login.docs[0].data().email;
  }
  const version = prev.nickname && prev.addressHash !== addressHash ? (prev.version || 1) + 1 : (prev.version || 1);
  const nickname = pickupNickname(vendorId, version);

  try {
    let result;
    try {
      result = await addPickupLocation({
        nickname, name: contact.name, email, phone: contact.phone,
        address: a.line1, address2: a.line2 || '', city: a.city, state: a.state, pincode: a.pincode,
      });
    } catch (e) {
      /* A retry after Shiprocket already saved it: that nickname is ours. */
      if (e instanceof ShiprocketError && /already exist/i.test(e.message)) result = { nickname, pickupId: null, phoneVerified: null };
      else throw e;
    }
    const status = result.phoneVerified === false ? 'needs_verification' : 'active';
    await ref.update({
      shiprocketPickupLocation: result.nickname,
      shiprocketPickup: {
        nickname: result.nickname, pickupId: result.pickupId, status, version, addressHash,
        pincode: a.pincode, syncedAt: now, lastError: null, lastErrorAt: null,
      },
    });
    return {
      status,
      nickname: result.nickname,
      message: status === 'needs_verification'
        ? 'Registered with Shiprocket — Tulsi must verify the pickup phone number in Shiprocket before the first booking.'
        : 'Pickup address registered with Shiprocket.',
    };
  } catch (e) {
    const message = e instanceof ShiprocketError ? e.message : `Shiprocket: ${e.message}`;
    /* Keep the working nickname (if any); record why the new one failed. */
    await ref.update({ shiprocketPickup: { ...prev, lastError: message, lastErrorAt: now, ...(!prev.nickname && { status: 'error' }) } });
    return { status: 'error', message };
  }
}

/* What the vendor portal shows about it. */
export function pickupSyncView(vendor) {
  const p = vendor?.shiprocketPickup || {};
  return {
    status: p.status || (vendor?.shiprocketPickupLocation ? 'active' : 'not_registered'),
    nickname: p.nickname || vendor?.shiprocketPickupLocation || null,
    syncedAt: p.syncedAt || null,
    lastError: p.lastError || null,
  };
}
