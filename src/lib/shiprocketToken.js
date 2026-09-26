/* ─────────────────────────────────────────────
   Shiprocket bearer-token manager.

   Shiprocket tokens are valid for 10 days. We refresh a day early (9 days)
   and also on any 401, so an expired or revoked token costs one retry,
   not a failed dispatch. The token is cached in memory and in a store
   (Firestore `integrations/shiprocket` in production) so every serverless
   instance reuses one login instead of each cold start logging in again.
   Concurrent callers share one in-flight login.

   Pure module: the store and fetch are injected, so it's unit-testable.
   ───────────────────────────────────────────── */
export const TOKEN_TTL_MS = 9 * 24 * 60 * 60 * 1000;

/**
 * @param {object} deps
 *   login(): Promise<string>            performs /auth/login, returns the token
 *   store: { read(): Promise<{token, expiresAt}|null>, write(v): Promise<void> }
 *   now(): number
 */
export function createTokenManager({ login, store, now = () => Date.now() }) {
  let cached = null; // { token, expiresAt }
  let inflight = null;

  const fresh = (t) => t && t.token && t.expiresAt - now() > 60_000; // 1 min safety margin

  async function refresh() {
    if (!inflight) {
      inflight = (async () => {
        const token = await login();
        const value = { token, expiresAt: now() + TOKEN_TTL_MS };
        cached = value;
        await store?.write(value).catch(() => {}); // a failed cache write never fails the call
        return token;
      })().finally(() => { inflight = null; });
    }
    return inflight;
  }

  return {
    async get() {
      if (fresh(cached)) return cached.token;
      const stored = await store?.read().catch(() => null);
      if (fresh(stored)) { cached = stored; return stored.token; }
      return refresh();
    },
    /** After a 401: forget the token and log in again. */
    async renew() {
      cached = null;
      return refresh();
    },
  };
}
