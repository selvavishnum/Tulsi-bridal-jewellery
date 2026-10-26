import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getDB, docToObj } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';
import { isUsableImageUrl } from '@/lib/avatar';
import { normalizeDeliveryMessage } from '@/lib/deliveryMessage';

export async function GET() {
  try {
    // Public — anyone can read site settings (phone, address, email shown on website)
    const db = getDB();
    const doc = await db.collection('settings').doc('site').get();
    /* No caching — this doc now also gates live behavior (payment methods,
       loyalty/referral toggles), so an admin flipping a switch must take
       effect immediately, not up to an hour later from a stale edge cache. */
    const res = NextResponse.json({ success: true, data: doc.exists ? docToObj(doc) : {} });
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (e) { return NextResponse.json({ success: false, message: e.message }, { status: 500 }); }
}

/* The homepage is pre-rendered with the hero slides in its HTML (src/app/page.js,
   rebuilt every 5 minutes at most). Drop that copy now, so the next visitor
   sees this save and not the previous one.
   It must never fail the save — the settings are already stored, and the page
   catches up on its own within 5 minutes anyway: revalidatePath throws when
   there is no Next request to attach to (unit tests, scripts), which is not
   an error worth a 500. */
function refreshHomepage() {
  try {
    revalidatePath('/');
  } catch (e) {
    if (process.env.NODE_ENV === 'production') console.warn('[settings] homepage refresh failed:', e.message);
  }
}

export async function POST(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const db = getDB();
    const body = await request.json();
    /* This document is publicly readable (GET above), so it must never
       hold credentials — those live in environment variables. */
    const secretish = Object.keys(body || {}).filter((k) => /secret|password|token|api_?key|private/i.test(k));
    if (secretish.length) {
      return NextResponse.json({ success: false, message: `Don't store credentials in site settings (${secretish.join(', ')}). Use environment variables.` }, { status: 400 });
    }
    /* The homepage category showcase has its own endpoint (instant toggles,
       per-field changes): a full-page Save, sent with whatever this page
       loaded earlier, must never overwrite it. */
    const { categoryShowcase: _showcase, ...rest } = body || {};
    /* Testimonial photos: only a usable https link is stored (a half-typed
       or non-https link used to break the avatar on the homepage). */
    if (Array.isArray(rest.testimonials)) {
      rest.testimonials = rest.testimonials.slice(0, 50).map((t) => (
        t && typeof t === 'object' ? { ...t, photo: isUsableImageUrl(t.photo) ? t.photo : '' } : t
      ));
    }
    /* The delivery message ("Free Delivery across India"…) is shown on the storefront, so only its
       known, validated fields are ever stored — whatever the form (or a hand-made request) sent:
       text without markup, choices from the allow-lists, colours as #rrggbb. Anything that isn't an
       object is stored as the defaults. */
    if (Object.prototype.hasOwnProperty.call(rest, 'deliveryMessage')) rest.deliveryMessage = normalizeDeliveryMessage(rest.deliveryMessage);
    await db.collection('settings').doc('site').set({ ...rest, updatedAt: new Date().toISOString() }, { merge: true });
    refreshHomepage();
    return NextResponse.json({ success: true, message: 'Settings saved' });
  } catch (e) { return NextResponse.json({ success: false, message: e.message }, { status: 500 }); }
}
