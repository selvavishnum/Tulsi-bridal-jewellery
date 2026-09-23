import { NextResponse } from 'next/server';
import { getDB, FieldValue } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';
import { isBotRequest } from '@/lib/isBotRequest';

const MAX_DWELL_SECONDS = 4 * 60 * 60; // a real product-page view is never hours long — clamp obviously-bad client values instead of storing them as-is
const MAX_INTERACTION_COUNT = 1000; // guards against a runaway/malicious client inflating counters

function clampInt(value, min, max) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export async function POST(request) {
  try {
    if (isBotRequest(request)) return NextResponse.json({ success: false });

    const session = await getEffectiveSession();
    if (!session?.user?.id) return NextResponse.json({ success: false });

    const {
      productId, id,
      dwellSeconds, scrollDepthPercentage, carouselClicks, zoomInteractions,
    } = await request.json();

    const resolvedId = productId || id;
    if (typeof resolvedId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(resolvedId)) return NextResponse.json({ success: false });

    const db = getDB();
    const now = new Date().toISOString();

    /* Name, image, price and category come from the product itself — never
       from the request — because staff see them on the customer's profile. */
    const prodSnap = await db.collection('products').doc(resolvedId).get();
    if (!prodSnap.exists) return NextResponse.json({ success: false });
    const p = prodSnap.data();
    const category = typeof p.category === 'string' && /^[a-z0-9-]{1,40}$/.test(p.category) ? p.category : null;

    const lastSeenProduct = {
      id: resolvedId,
      name: p.name || null,
      slug: p.slug || null,
      image: p.images?.[0] || null,
      price: Number(p.discountPrice) || Number(p.price) || null,
      category,
      viewedAt: now,
      dwellSeconds: clampInt(dwellSeconds, 0, MAX_DWELL_SECONDS),
      scrollDepthPercentage: clampInt(scrollDepthPercentage, 0, 100),
      carouselClicks: clampInt(carouselClicks, 0, MAX_INTERACTION_COUNT),
      zoomInteractions: clampInt(zoomInteractions, 0, MAX_INTERACTION_COUNT),
    };

    const ref = db.collection('users').doc(session.user.id);
    const updateData = { lastSeenProduct };

    // Same aggregate the pageview route feeds — /product/[id] URLs don't
    // encode a category the way /shop/[category] does, so this is the only
    // place a product-detail view can contribute to categoryInterests.
    if (category) {
      updateData[`categoryInterests.${category}`] = FieldValue.increment(1);
    }

    await ref.update(updateData);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false });
  }
}
