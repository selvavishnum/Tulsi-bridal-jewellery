import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireVendor } from '@/lib/vendorAuth';
import { adminEmails } from '@/lib/requireRole';
import { hit, clientIp, LIMITS, tooManyRequests } from '@/lib/rateLimit';
import { sendVendorPasswordChanged } from '@/lib/email';

const fail = (message, status = 400) => NextResponse.json({ success: false, message }, { status });

/* PUT /api/vendor/password { currentPassword, newPassword } — the vendor
   changes their own login password; the Super Admin is alerted. */
export async function PUT(request) {
  try {
    const ctx = await requireVendor();
    if (ctx.error) return ctx.error;
    const body = await request.json().catch(() => ({}));
    const current = String(body.currentPassword || '');
    const next = String(body.newPassword || '');
    if (next.length < 8 || next.length > 128) return fail('New password must be 8–128 characters.');
    if (!/[A-Za-z]/.test(next) || !/\d/.test(next)) return fail('Use at least one letter and one number.');
    if (next === current) return fail('The new password must be different from the current one.');

    const email = String(ctx.session.user.email || '').toLowerCase();
    const limited = await hit(ctx.db, `vendorPassword:${email}`, LIMITS.vendorPassword);
    if (!limited.allowed) return tooManyRequests(limited.retryAfterSec, 'Too many attempts. Please wait 15 minutes.');

    const snap = await ctx.db.collection('staff').where('email', '==', email).limit(1).get();
    const doc = snap.docs[0];
    if (!doc || doc.data().vendorId !== ctx.vendorId) return fail('Login not found.', 404);
    if (!doc.data().password || !(await bcrypt.compare(current, doc.data().password))) return fail('Your current password is wrong.');

    const at = new Date().toISOString();
    await doc.ref.update({ password: await bcrypt.hash(next, 10), passwordChangedAt: at, updatedAt: at });

    const vendor = (await ctx.db.collection('vendors').doc(ctx.vendorId).get()).data() || {};
    await sendVendorPasswordChanged({
      vendorName: vendor.name || 'Vendor', email, at, ip: clientIp(request.headers), adminEmails: adminEmails(),
    }).catch(() => false);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
