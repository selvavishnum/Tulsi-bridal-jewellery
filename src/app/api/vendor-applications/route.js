import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { parseVendorApplication, maskAccount } from '@/lib/vendorApplication';
import { encryptField } from '@/lib/fieldCrypto';
import { sendVendorApplicationAlert } from '@/lib/email';
import { hit, clientIp, LIMITS, tooManyRequests } from '@/lib/rateLimit';

const OPEN = ['PENDING', 'APPROVED'];

/* POST /api/vendor-applications — public "Become a seller" form. */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({ success: false, message: 'Invalid request' }, { status: 400 });
    /* Honeypot filled → a bot. Look successful, store nothing. */
    if (body.website) return NextResponse.json({ success: true }, { status: 201 });

    const parsed = parseVendorApplication(body);
    if (parsed.errors) {
      return NextResponse.json({ success: false, message: 'Please correct the highlighted fields.', errors: parsed.errors }, { status: 400 });
    }
    const d = parsed.data;
    /* Only our own uploads count as the GST certificate. */
    if (d.taxType === 'GST' && !d.gstCertificateUrl.includes('/tulsi-bridal/vendor-applications/')) {
      return NextResponse.json({ success: false, message: 'Please upload your GST certificate again.', errors: { gstCertificateUrl: 'Upload your GST certificate' } }, { status: 400 });
    }

    const db = getDB();
    const limited = await hit(db, `vendorApply:ip:${clientIp(request.headers)}`, LIMITS.vendorApply);
    if (!limited.allowed) return tooManyRequests(limited.retryAfterSec, 'Too many applications from this network. Please try again in an hour.');

    const col = db.collection('vendor_applications');
    const [byPhone, byEmail, login] = await Promise.all([
      col.where('phone', '==', d.phone).get(),
      col.where('email', '==', d.email).get(),
      db.collection('staff').where('email', '==', d.email).limit(1).get(),
    ]);
    if (!login.empty) {
      return NextResponse.json({ success: false, message: 'This email already has a Tulsi login. Sign in at the Vendor Portal, or use another email.' }, { status: 409 });
    }
    if ([...byPhone.docs, ...byEmail.docs].some((s) => OPEN.includes(s.data().status))) {
      return NextResponse.json({ success: false, message: 'We already have an application with this phone number or email. Our team will contact you soon.' }, { status: 409 });
    }

    const ref = col.doc();
    const app = {
      id: ref.id,
      full_name: d.fullName,
      business_name: d.businessName,
      phone: d.phone,
      email: d.email,
      instagram_handle: d.instagram,
      tax_type: d.taxType,
      tax_id_number: d.taxType === 'GST' ? d.gstin : d.enrolmentId,
      pan_number: d.taxType === 'GST' ? d.gstin.slice(2, 12) : d.pan,
      gst_certificate_url: d.taxType === 'GST' ? d.gstCertificateUrl : null,
      warehouse_address: d.address,
      landmark: d.landmark,
      city: d.city,
      state: d.state,
      pincode: d.pincode,
      /* Account number encrypted at rest; only the last 4 are readable. */
      bank_details: {
        account_holder: d.accountHolder,
        bank_name: d.bankName,
        account_number_enc: encryptField(d.accountNumber),
        account_masked: maskAccount(d.accountNumber),
        ifsc: d.ifsc,
        upi_id: d.upiId || null,
      },
      status: 'PENDING',
      created_at: new Date().toISOString(),
    };
    await ref.set(app);
    await sendVendorApplicationAlert(app).catch((e) => console.error('[vendor-applications] alert failed:', e.message));
    return NextResponse.json({ success: true, data: { id: ref.id } }, { status: 201 });
  } catch (e) {
    console.error('[vendor-applications]', e.message);
    return NextResponse.json({ success: false, message: 'Could not submit your application. Please try again.' }, { status: 500 });
  }
}
