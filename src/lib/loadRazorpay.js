/** Loads the Razorpay Checkout script on demand and resolves once
 * window.Razorpay is actually usable — a plain <script async> tag races
 * with "Place Order" being clicked before it finishes loading. */
export function loadRazorpayScript() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Payment gateway is unavailable.'));
      return;
    }
    if (window.Razorpay) {
      resolve();
      return;
    }

    const existing = document.querySelector('script[data-razorpay-checkout]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error(
        'Could not load the payment gateway. Check your internet connection and try again.'
      )));
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.dataset.razorpayCheckout = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(
      'Could not load the payment gateway. If you are using an ad-blocker or a VPN, please disable it and try again.'
    ));
    document.body.appendChild(script);
  });
}
