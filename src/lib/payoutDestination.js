/* Vendor payout destination (bank account or UPI) — validation shared by
   the Super Admin vendor screen and the vendor's own change request.
   Pure module, no '@/…' imports. */
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI = /^[\w.-]{2,256}@[a-zA-Z]{2,64}$/;
const ACCOUNT = /^\d{9,18}$/;

/* Validates and normalises the payout destination. Returns { payout } or { error }. */
export function parsePayout(input) {
  if (!input || !input.method) return { payout: null };
  if (input.method === 'upi') {
    const upiId = String(input.upiId || '').trim();
    if (!UPI.test(upiId)) return { error: 'Enter a valid UPI ID (e.g. name@okaxis).' };
    return { payout: { method: 'upi', upiId } };
  }
  if (input.method === 'bank') {
    const accountName = String(input.accountName || '').trim();
    const accountNumber = String(input.accountNumber || '').replace(/\s/g, '');
    const ifsc = String(input.ifsc || '').trim().toUpperCase();
    if (!accountName) return { error: 'Enter the account holder name.' };
    if (!ACCOUNT.test(accountNumber)) return { error: 'Account number must be 9–18 digits.' };
    if (!IFSC.test(ifsc)) return { error: 'Enter a valid IFSC (e.g. HDFC0001234).' };
    return { payout: { method: 'bank', accountName, accountNumber, ifsc } };
  }
  return { error: 'Payout method must be bank or UPI.' };
}
