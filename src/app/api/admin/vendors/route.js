import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDB } from '@/lib/firebase';
import { requireOwner } from '@/lib/adminCollection';
import { requireRole, ROLES, CAN } from '@/lib/requireRole';
import { summarizeLedger, PLATFORM_VENDOR_ID } from '@/lib/settlement';
import { parsePayout } from '@/lib/payoutDestination';

function adminEmails() {
  return (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/* Default margin % for this vendor's new self-listed products; 0 = none
   (Tulsi sets each product's margin at review). */
function parseMarginPercent(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n >= 100) return null;
  return Math.round(n * 100) / 100;
}

function parseFeeBps(percent) {
  const n = Number(percent);
  if (!Number.isFinite(n) || n < 0 || n > 50) return null;
  return Math.round(n * 100);
}

/* GET /api/admin/vendors — every vendor with its wallet, catalogue size and
   login, plus platform-wide totals of what the platform has retained. */
export async function GET() {
  try {
    const auth = await requireRole(CAN.manageCatalog);
    if (auth.error) return auth.error;
    const db = getDB();
    /* Business Managers pick a seller on the product form, so they get the
       vendor names — and nothing else: no bank/UPI details, ledgers, fees
       or totals. Everything below is SUPER_ADMIN only (needed to make the
       transfers). */
    if (auth.tier !== ROLES.SUPER_ADMIN) {
      const snap = await db.collection('vendors').get();
      const vendors = snap.docs
        .filter((d) => d.id !== PLATFORM_VENDOR_ID)
        .map((d) => ({ id: d.id, name: d.data().name, status: d.data().status || 'active', defaultMarginPercent: Number(d.data().defaultMarginPercent) || 0 }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      return NextResponse.json({ success: true, data: { vendors, totals: null } });
    }

    const [vendorsSnap, ledgerSnap, productsSnap, staffSnap] = await Promise.all([
      db.collection('vendors').get(),
      db.collection('vendorLedger').get(),
      db.collection('products').select('vendorId', 'reviewStatus', 'isActive').get(),
      db.collection('staff').get(),
    ]);

    const entriesByVendor = new Map();
    for (const d of ledgerSnap.docs) {
      const e = d.data();
      if (!entriesByVendor.has(e.vendorId)) entriesByVendor.set(e.vendorId, []);
      entriesByVendor.get(e.vendorId).push(e);
    }
    const productCount = new Map();
    const inReviewCount = new Map();
    for (const d of productsSnap.docs) {
      const p = d.data();
      const v = p.vendorId;
      if (v) productCount.set(v, (productCount.get(v) || 0) + 1);
      if (v && p.reviewStatus === 'pending' && p.isActive === false) inReviewCount.set(v, (inReviewCount.get(v) || 0) + 1);
    }
    const loginByVendor = new Map();
    for (const d of staffSnap.docs) {
      const s = d.data();
      if (s.vendorId && s.vendorId !== PLATFORM_VENDOR_ID && !loginByVendor.has(s.vendorId)) {
        loginByVendor.set(s.vendorId, { staffId: d.id, email: s.email, status: s.status });
      }
    }

    const totals = { grossPaise: 0, supplyCostPaise: 0, shippingPaise: 0, platformFeePaise: 0, paidOutPaise: 0, availablePaise: 0, pendingPaise: 0 };
    const vendors = vendorsSnap.docs
      .filter((d) => d.id !== PLATFORM_VENDOR_ID)
      .map((d) => {
        const v = d.data();
        const summary = summarizeLedger(entriesByVendor.get(d.id) || []);
        for (const k of Object.keys(totals)) totals[k] += summary[k];
        return {
          id: d.id,
          name: v.name,
          contactName: v.contactName || '',
          phone: v.phone || '',
          status: v.status || 'active',
          platformFeePercent: (Number(v.platformFeeBps) || 0) / 100,
          defaultMarginPercent: Number(v.defaultMarginPercent) || 0,
          selfFulfil: v.selfFulfil === true,
          shiprocketPickupLocation: v.shiprocketPickupLocation || '',
          shiprocketPickup: v.shiprocketPickup ? { status: v.shiprocketPickup.status || null, nickname: v.shiprocketPickup.nickname || null, lastError: v.shiprocketPickup.lastError || null } : null,
          payout: v.payout || null,
          /* A bank/UPI change the vendor asked for — not used for payouts
             until a Super Admin approves it below. */
          pendingPayout: v.pendingPayout || null,
          contactEmail: v.contactEmail || '',
          gstin: v.gstin || '',
          pickupAddress: v.pickupAddress || null,
          login: loginByVendor.get(d.id) || null,
          productCount: productCount.get(d.id) || 0,
          inReviewCount: inReviewCount.get(d.id) || 0,
          summary,
          createdAt: v.createdAt,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ success: true, data: { vendors, totals } });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

/* POST /api/admin/vendors — create a vendor and its dashboard login (owner only). */
export async function POST(request) {
  try {
    const session = await requireOwner();
    if (!session) return NextResponse.json({ success: false, message: 'Only the store owner can add vendors.' }, { status: 403 });

    const body = await request.json();
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!name) return NextResponse.json({ success: false, message: 'Vendor name is required.' }, { status: 400 });
    if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ success: false, message: 'Enter a valid login email.' }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ success: false, message: 'Password must be at least 8 characters.' }, { status: 400 });
    const feeBps = parseFeeBps(body.platformFeePercent ?? 0);
    if (feeBps === null) return NextResponse.json({ success: false, message: 'Platform fee must be between 0% and 50%.' }, { status: 400 });
    const { payout, error } = parsePayout(body.payout);
    if (error) return NextResponse.json({ success: false, message: error }, { status: 400 });
    const defaultMarginPercent = parseMarginPercent(body.defaultMarginPercent);
    if (defaultMarginPercent === null) return NextResponse.json({ success: false, message: 'Default margin must be from 0% to under 100%.' }, { status: 400 });

    if (adminEmails().includes(email)) {
      return NextResponse.json({ success: false, message: 'That email belongs to a store owner.' }, { status: 400 });
    }
    const db = getDB();
    const [staffDup, userDup] = await Promise.all([
      db.collection('staff').where('email', '==', email).limit(1).get(),
      db.collection('users').where('email', '==', email).limit(1).get(),
    ]);
    if (!staffDup.empty) return NextResponse.json({ success: false, message: 'That email is already used by a staff or vendor login.' }, { status: 400 });
    /* A customer account with the same email signs in through the users
       collection first, which would shadow this login's password. */
    if (!userDup.empty) return NextResponse.json({ success: false, message: 'That email already has a customer account — use a different email for the vendor login.' }, { status: 400 });

    const now = new Date().toISOString();
    const vendorRef = db.collection('vendors').doc();
    const staffRef = db.collection('staff').doc();
    const batch = db.batch();
    batch.set(vendorRef, {
      name,
      contactName: String(body.contactName || '').trim(),
      phone: String(body.phone || '').trim(),
      status: 'active',
      platformFeeBps: feeBps,
      defaultMarginPercent,
      selfFulfil: body.selfFulfil === true,
      shiprocketPickupLocation: String(body.shiprocketPickupLocation || '').trim().replace(/[<>]/g, '').slice(0, 60),
      payout,
      createdAt: now,
      updatedAt: now,
      createdBy: session.user.email || null,
    });
    batch.set(staffRef, {
      name: String(body.contactName || name).trim(),
      email,
      password: await bcrypt.hash(password, 10),
      role: 'VENDOR',
      vendorId: vendorRef.id,
      phone: String(body.phone || '').trim(),
      status: 'Active',
      createdAt: now,
      updatedAt: now,
    });
    await batch.commit();
    return NextResponse.json({ success: true, data: { id: vendorRef.id } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

/* PUT /api/admin/vendors?id=… — update details, fee, payout destination,
   selling status, or the login (owner only). A fee change applies to new
   orders only; placed orders keep the rate snapshotted at checkout. */
export async function PUT(request) {
  try {
    const session = await requireOwner();
    if (!session) return NextResponse.json({ success: false, message: 'Only the store owner can change vendors.' }, { status: 403 });
    const id = new URL(request.url).searchParams.get('id');
    if (!id || id === PLATFORM_VENDOR_ID) return NextResponse.json({ success: false, message: 'Vendor id required' }, { status: 400 });

    const body = await request.json();
    if (body.newPassword && String(body.newPassword).length < 8) {
      return NextResponse.json({ success: false, message: 'Password must be at least 8 characters.' }, { status: 400 });
    }
    const db = getDB();
    const ref = db.collection('vendors').doc(id);
    if (!(await ref.get()).exists) return NextResponse.json({ success: false, message: 'Vendor not found' }, { status: 404 });

    const update = { updatedAt: new Date().toISOString() };
    if (body.name !== undefined) {
      if (!String(body.name).trim()) return NextResponse.json({ success: false, message: 'Vendor name is required.' }, { status: 400 });
      update.name = String(body.name).trim();
    }
    if (body.contactName !== undefined) update.contactName = String(body.contactName).trim();
    if (body.phone !== undefined) update.phone = String(body.phone).trim();
    if (body.status !== undefined) {
      if (!['active', 'suspended'].includes(body.status)) return NextResponse.json({ success: false, message: 'Status must be active or suspended.' }, { status: 400 });
      update.status = body.status;
    }
    if (body.platformFeePercent !== undefined) {
      const bps = parseFeeBps(body.platformFeePercent);
      if (bps === null) return NextResponse.json({ success: false, message: 'Platform fee must be between 0% and 50%.' }, { status: 400 });
      update.platformFeeBps = bps;
    }
    /* "Vendor ships their own orders": on orders made up only of this
       vendor's pieces, the vendor gets the delivery address and packs,
       ships and updates them from the Vendor Portal. */
    if (body.selfFulfil !== undefined) update.selfFulfil = body.selfFulfil === true;
    if (body.shiprocketPickupLocation !== undefined) {
      const loc = String(body.shiprocketPickupLocation || '').trim();
      if (loc.length > 60 || /[<>]/.test(loc)) return NextResponse.json({ success: false, message: 'Pickup nickname must be up to 60 characters.' }, { status: 400 });
      update.shiprocketPickupLocation = loc;
    }
    if (body.defaultMarginPercent !== undefined) {
      const pct = parseMarginPercent(body.defaultMarginPercent);
      if (pct === null) return NextResponse.json({ success: false, message: 'Default margin must be from 0% to under 100%.' }, { status: 400 });
      update.defaultMarginPercent = pct;
    }
    if (body.payout !== undefined) {
      const { payout, error } = parsePayout(body.payout);
      if (error) return NextResponse.json({ success: false, message: error }, { status: 400 });
      update.payout = payout;
      update.payoutUpdatedAt = update.updatedAt;
      update.payoutUpdatedBy = session.user.email || null;
    }
    if (body.pendingPayoutDecision !== undefined) {
      const current = (await ref.get()).data();
      if (!current.pendingPayout) return NextResponse.json({ success: false, message: 'There is no pending payout change.' }, { status: 400 });
      if (!['approve', 'reject'].includes(body.pendingPayoutDecision)) {
        return NextResponse.json({ success: false, message: 'Decision must be approve or reject.' }, { status: 400 });
      }
      if (body.pendingPayoutDecision === 'approve') {
        const { payout, error } = parsePayout(current.pendingPayout);
        if (error) return NextResponse.json({ success: false, message: error }, { status: 400 });
        update.payout = payout;
        update.payoutUpdatedAt = update.updatedAt;
        update.payoutUpdatedBy = session.user.email || null;
      }
      update.pendingPayout = null;
      update.pendingPayoutReviewedAt = update.updatedAt;
      update.pendingPayoutReviewedBy = session.user.email || null;
    }
    await ref.update(update);

    if (body.loginActive !== undefined || body.newPassword) {
      const logins = await db.collection('staff').where('vendorId', '==', id).get();
      const patch = { updatedAt: update.updatedAt };
      if (body.loginActive !== undefined) patch.status = body.loginActive ? 'Active' : 'Inactive';
      if (body.newPassword) {
        patch.password = await bcrypt.hash(String(body.newPassword), 10);
      }
      await Promise.all(logins.docs.map((d) => d.ref.update(patch)));
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
