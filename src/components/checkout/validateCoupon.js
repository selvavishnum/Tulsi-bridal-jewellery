/* ─────────────────────────────────────────────
   One call to POST /api/coupons/validate, with the answer classified:

     { ok: true, code, coupon, discount, firstOrderOnly }
     { ok: false, code, refused, definite, status, message }

   `refused` = the server said no (400/404) — show its reason. `definite` =
   that no is about the code itself, so a remembered welcome code should be
   forgotten (see isDefiniteCouponRejection). Offline, rate-limited or a
   server error is neither — keep the code and try again later.

   No answer within COUPON_CHECK_TIMEOUT_MS counts as offline (plus
   `timedOut: true`): the code is kept but not applied, and whatever was
   waiting on the check ("Place order") is released.
   ───────────────────────────────────────────── */
import { isDefiniteCouponRejection } from './checkoutRules.js';
import { fetchJsonWithin } from './fetchWithin.js';

const OFFLINE = 'Couldn’t check the code — check your connection and try again.';
export const COUPON_CHECK_TIMEOUT_MS = 8000;

export async function validateCoupon(rawCode, orderAmount, { fetchImpl, timeoutMs = COUPON_CHECK_TIMEOUT_MS } = {}) {
  const code = String(rawCode || '').trim().toUpperCase();
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!code) return { ok: false, code, refused: false, definite: false, status: 0, message: 'Enter a coupon code' };
  if (!doFetch) return { ok: false, code, refused: false, definite: false, status: 0, message: OFFLINE };

  let res;
  let data;
  try {
    ({ res, data } = await fetchJsonWithin('/api/coupons/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, orderAmount }),
    }, { ms: timeoutMs, fetchImpl: doFetch }));
  } catch (e) {
    const offline = { ok: false, code, refused: false, definite: false, status: 0, message: OFFLINE };
    return e?.name === 'TimeoutError' ? { ...offline, timedOut: true } : offline;
  }

  if (data?.success && data.data?.coupon) {
    return {
      ok: true,
      code: data.data.coupon.code || code,
      coupon: data.data.coupon,
      discount: Number(data.data.discount) || 0,
      firstOrderOnly: data.data.firstOrderOnly === true || data.data.coupon.firstOrderOnly === true,
    };
  }
  const refused = res.status === 400 || res.status === 404;
  const message = data?.message || (refused ? 'This code can’t be used on this order.' : 'Couldn’t check the code right now. Please try again.');
  return {
    ok: false,
    code,
    /* The server refused it (show the reason), and whether that refusal is
       about the code itself (forget a remembered code). */
    refused,
    definite: isDefiniteCouponRejection(res.status, data?.message),
    status: res.status,
    message,
  };
}
