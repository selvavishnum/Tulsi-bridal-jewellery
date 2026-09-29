import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { requireRole, CAN } from '@/lib/requireRole';
import { validateVendorPricing } from '@/lib/settlement';

const fail = (message, status = 400) => NextResponse.json({ success: false, message }, { status });

/* POST /api/admin/products/:id/review { decision: 'approve' | 'reject', reason? }
   One-tap review of a vendor-submitted product.
     approve → published (visible in the shop), margin as set (₹0 = free)
     reject  → stays hidden; the vendor sees the reason and can fix and
               resubmit, which puts it back in review. */
export async function POST(request, { params }) {
  try {
    const auth = await requireRole(CAN.manageCatalog);
    if (auth.error) return auth.error;
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const db = getDB();
    const ref = db.collection('products').doc(String(id));
    const snap = await ref.get();
    if (!snap.exists) return fail('Product not found', 404);
    const p = snap.data();
    if (p.reviewStatus !== 'pending') return fail('This product isn’t waiting for review.', 409);

    const now = new Date().toISOString();
    const reviewer = auth.session?.user?.email || null;

    if (body.decision === 'approve') {
      const problem = validateVendorPricing(p);
      if (problem) return fail(`${problem} Open Edit to fix it, then publish.`);
      await ref.update({
        isActive: true, showMe: true,
        reviewStatus: 'approved', reviewNote: null, reviewedBy: reviewer, reviewedAt: now, updatedAt: now,
        /* Missing margin = free for the seller. */
        ...((p.supplyCost === undefined || p.supplyCost === null || p.supplyCost === '') && { supplyCost: 0, marginMode: p.marginMode || 'fixed' }),
      });
      return NextResponse.json({ success: true, data: { reviewStatus: 'approved' } });
    }

    if (body.decision === 'reject') {
      const reason = String(body.reason || '').trim().replace(/[<>]/g, '').slice(0, 300);
      if (!reason) return fail('Add a reason — the seller sees it.');
      await ref.update({
        isActive: false, showMe: false,
        reviewStatus: 'rejected', reviewNote: reason, reviewedBy: reviewer, reviewedAt: now, updatedAt: now,
      });
      return NextResponse.json({ success: true, data: { reviewStatus: 'rejected' } });
    }

    return fail('Decision must be approve or reject.');
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
