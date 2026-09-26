import { NextResponse } from 'next/server';
import { requireVendor, requireActiveVendor } from '@/lib/vendorAuth';
import { parseVendorProfile } from '@/lib/vendorCatalog';
import { maskPayoutDestination } from '@/lib/vendorLedger';
import { syncVendorPickup, pickupSyncView } from '@/lib/pickupSync';
import { vendorHasPickup } from '@/lib/shipmentPlan';

/* The vendor's own store profile, as they may see it: no fee rate, no
   internal notes, and bank details masked to the last four digits. */
function toVendorProfile(v, loginEmail) {
  return {
    name: v.name || '',
    contactName: v.contactName || '',
    phone: v.phone || '',
    contactEmail: v.contactEmail || '',
    gstin: v.gstin || '',
    pickupAddress: v.pickupAddress || { line1: '', line2: '', city: '', state: '', pincode: '' },
    status: v.status || 'active',
    selfFulfil: v.selfFulfil === true,
    shiprocketReady: vendorHasPickup(v),
    pickupSync: pickupSyncView(v),
    loginEmail,
    payoutDestination: maskPayoutDestination(v.payout),
    pendingPayout: v.pendingPayout
      ? { destination: maskPayoutDestination(v.pendingPayout), requestedAt: v.pendingPayout.requestedAt || null }
      : null,
  };
}

export async function GET() {
  try {
    const ctx = await requireVendor();
    if (ctx.error) return ctx.error;
    const snap = await ctx.db.collection('vendors').doc(ctx.vendorId).get();
    if (!snap.exists) return NextResponse.json({ success: false, message: 'Vendor not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: toVendorProfile(snap.data(), ctx.session.user.email) });
  } catch (e) {
    console.error('[vendor/profile GET]', e.message);
    return NextResponse.json({ success: false, message: 'Could not load your profile' }, { status: 500 });
  }
}

/* PUT — store name, contact details, GSTIN and pickup address. The fee
   rate, status and payout destination are not editable here. */
export async function PUT(request) {
  try {
    const ctx = await requireActiveVendor();
    if (ctx.error) return ctx.error;
    const parsed = parseVendorProfile(await request.json().catch(() => null));
    if (parsed.error) return NextResponse.json({ success: false, message: parsed.error }, { status: parsed.status });
    const ref = ctx.db.collection('vendors').doc(ctx.vendorId);
    await ref.update({ ...parsed.data, updatedAt: new Date().toISOString() });
    /* Warehouse or pickup contact changed → register it with Shiprocket
       (VENDOR_<id>). The profile is saved either way; the sync result is
       reported so the vendor can fix what Shiprocket rejected. */
    const touchesPickup = ['pickupAddress', 'phone', 'contactName', 'name'].some((k) => k in parsed.data);
    const pickupSync = touchesPickup ? await syncVendorPickup(ctx.db, ctx.vendorId).catch((e) => ({ status: 'error', message: e.message })) : null;
    const snap = await ref.get();
    return NextResponse.json({ success: true, data: toVendorProfile(snap.data(), ctx.session.user.email), ...(pickupSync && { pickupSync }) });
  } catch (e) {
    console.error('[vendor/profile PUT]', e.message);
    return NextResponse.json({ success: false, message: 'Could not save your profile' }, { status: 500 });
  }
}
