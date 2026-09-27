import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';
import { adminEmails } from '@/lib/requireRole';
import { decryptField } from '@/lib/fieldCrypto';
import { parsePayout } from '@/lib/payoutDestination';
import { createVendorAccount, tempPassword, ProvisionError } from '@/lib/vendorProvision';
import { syncVendorPickup } from '@/lib/pickupSync';
import { sendVendorWelcome, sendVendorApplicationRejected } from '@/lib/email';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://tulsijewels.in';

const fail = (message, status = 400) => NextResponse.json({ success: false, message }, { status });

/* Claim a PENDING application for one reviewer, so two clicks can't
   create two vendors. */
async function claim(db, ref, reviewer) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { error: fail('Application not found', 404) };
    const app = snap.data();
    if (app.status !== 'PENDING') return { error: fail(`This application is already ${String(app.status).toLowerCase()}.`, 409) };
    tx.update(ref, { status: 'PROCESSING', reviewed_by: reviewer });
    return { app };
  });
}

function whatsappLink(phone, text) {
  return `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`;
}

/* PATCH /api/admin/vendor-applications/:id  { action: 'approve' | 'reject', reason? } — Super Admin only. */
export async function PATCH(request, { params }) {
  try {
    const session = await requireAdmin();
    if (!session) return fail('Forbidden', 403);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reviewer = session.user.email || null;
    const db = getDB();
    const ref = db.collection('vendor_applications').doc(String(id));

    if (body.action === 'reject') {
      const reason = String(body.reason || '').trim().replace(/[<>]/g, '').slice(0, 500);
      if (!reason) return fail('Add a reason — the applicant sees it.');
      const claimed = await claim(db, ref, reviewer);
      if (claimed.error) return claimed.error;
      const now = new Date().toISOString();
      await ref.update({ status: 'REJECTED', rejection_reason: reason, reviewed_by: reviewer, reviewed_at: now });
      const emailed = await sendVendorApplicationRejected({ to: claimed.app.email, name: claimed.app.full_name, reason }).catch(() => false);
      return NextResponse.json({ success: true, data: { status: 'REJECTED', emailed } });
    }

    if (body.action !== 'approve') return fail('Action must be approve or reject.');
    const claimed = await claim(db, ref, reviewer);
    if (claimed.error) return claimed.error;
    const app = claimed.app;

    try {
      const b = app.bank_details || {};
      const { payout, error } = parsePayout({ method: 'bank', accountName: b.account_holder, accountNumber: decryptField(b.account_number_enc), ifsc: b.ifsc });
      if (error) throw new ProvisionError(`Bank details: ${error}`);

      const password = tempPassword();
      const { vendorId } = await createVendorAccount(db, {
        ownerEmails: adminEmails(),
        vendor: {
          name: app.business_name,
          contactName: app.full_name,
          phone: app.phone,
          contactEmail: app.email,
          instagramHandle: app.instagram_handle,
          taxType: app.tax_type,
          gstin: app.tax_type === 'GST' ? app.tax_id_number : '',
          enrolmentId: app.tax_type === 'ENROLMENT_ID' ? app.tax_id_number : '',
          pan: app.pan_number || '',
          pickupAddress: { line1: app.warehouse_address, line2: app.landmark || '', city: app.city, state: app.state, pincode: app.pincode },
          /* Ships from their own warehouse through Tulsi's Shiprocket. */
          selfFulfil: true,
          shiprocketPickupLocation: '',
          /* Lifetime free: no platform fee, no commission. */
          platformFeeBps: 0,
          defaultMarginPercent: 0,
          payout,
          ...(b.upi_id && { upiId: b.upi_id }),
          applicationId: app.id || ref.id,
          createdBy: reviewer,
        },
        login: { email: app.email, password, name: app.full_name, phone: app.phone },
      });

      const now = new Date().toISOString();
      await ref.update({ status: 'APPROVED', vendor_id: vendorId, reviewed_by: reviewer, reviewed_at: now });

      /* Register the warehouse with Shiprocket now; the vendor can retry from their profile. */
      const pickup = await syncVendorPickup(db, vendorId).catch((e) => ({ status: 'error', message: e.message }));
      const emailed = await sendVendorWelcome({ to: app.email, name: app.full_name, businessName: app.business_name, password }).catch(() => false);
      const message = `Hi ${app.full_name}! 🎉 Your seller application on Tulsi Jewels is approved.\n\nVendor login: ${SITE}/vendor/login\nEmail: ${app.email}\nTemporary password: ${password}\n\nPlease change it from Store Profile after you sign in, and don't share it with anyone.`;
      return NextResponse.json({
        success: true,
        data: { status: 'APPROVED', vendorId, email: app.email, tempPassword: password, whatsappUrl: whatsappLink(app.phone, message), emailed, pickup },
      });
    } catch (e) {
      /* Put it back so it can be approved again once fixed. */
      await ref.update({ status: 'PENDING', last_error: e.message }).catch(() => {});
      if (e instanceof ProvisionError) return fail(e.message);
      throw e;
    }
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
