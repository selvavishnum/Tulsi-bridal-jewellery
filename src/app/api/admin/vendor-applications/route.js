import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';

/* What staff see: everything but the encrypted account number. */
function toAdminApplication(a) {
  const { account_number_enc: _enc, ...bank } = a.bank_details || {};
  return { ...a, bank_details: bank };
}

/* GET /api/admin/vendor-applications?status=PENDING — Super Admin only. */
export async function GET(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const status = new URL(request.url).searchParams.get('status');
    let q = getDB().collection('vendor_applications');
    if (['PENDING', 'APPROVED', 'REJECTED'].includes(status)) q = q.where('status', '==', status);
    const snap = await q.get();
    /* Sorted here, not in the query — no composite index needed. */
    const data = snap.docs.map((d) => toAdminApplication({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
