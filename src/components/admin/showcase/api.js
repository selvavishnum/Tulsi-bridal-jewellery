/* Client calls to /api/admin/category-showcase (see the route for the
   contract). Both resolve to the normalized showcase or throw an Error
   whose message is safe to show in a toast. */
const ENDPOINT = '/api/admin/category-showcase';

async function readJson(res) {
  try { return await res.json(); } catch { return null; }
}

function failure(res, d, fallback) {
  if (res.status === 401 || res.status === 403) return new Error('Only the store owner can change the category showcase.');
  return new Error(d?.message || fallback);
}

export async function fetchShowcase(signal) {
  const res = await fetch(ENDPOINT, { cache: 'no-store', signal });
  const d = await readJson(res);
  if (!res.ok || !d?.success || !d.data) throw failure(res, d, 'Could not load the category showcase.');
  return d.data;
}

/** Sends only the fields being changed: { layout? , items?: [{ key, ... }], order? }. */
export async function patchShowcase(body) {
  let res;
  try {
    res = await fetch(ENDPOINT, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('Network error — not saved.');
  }
  const d = await readJson(res);
  if (!res.ok || !d?.success || !d.data) throw failure(res, d, 'Could not save. Please try again.');
  return d.data;
}
