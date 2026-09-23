/* Escapes text for an HTML template string (print popups, emails).
   Needed wherever markup is built by hand instead of by React: shopper
   and vendor text (names, addresses, product names, SKUs) must never be
   able to become tags or attributes in a staff member's browser. */
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"'`]/g, (c) => MAP[c]);
}
