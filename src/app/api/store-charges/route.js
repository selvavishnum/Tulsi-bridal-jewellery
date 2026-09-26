import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { getStoreCharges } from '@/lib/storeChargesServer';

/* GET /api/store-charges — public: the shipping and COD charges the
   checkout shows. Never cached, so a change applies to open checkouts on
   their next refresh (the server recalculates every order regardless). */
export async function GET() {
  try {
    const { updatedAt: _u, ...charges } = await getStoreCharges(getDB());
    const res = NextResponse.json({ success: true, data: charges });
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (e) {
    console.error('[store-charges]', e.message);
    return NextResponse.json({ success: false, message: 'Could not load charges' }, { status: 500 });
  }
}
