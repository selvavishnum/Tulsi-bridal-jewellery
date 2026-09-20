/** IST calendar date key (YYYY-MM-DD) — the business operates in India, so
 * "today" should mean the same thing here as it does to the admin. */
export function istDateKey(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Last N IST date keys, oldest first. */
export function lastNDateKeys(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(istDateKey(new Date(Date.now() - i * 86400000)));
  }
  return out;
}
