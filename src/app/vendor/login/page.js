'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { signIn, signOut, useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FiMail, FiLock } from 'react-icons/fi';
import { FcGoogle } from 'react-icons/fc';
import toast from 'react-hot-toast';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { destinationAfterSignIn } from '@/lib/postLoginRedirect';

const input = 'w-full pl-10 pr-3 py-3 border border-stone-300 rounded-xl text-sm bg-white outline-none focus:border-wine-700 focus:ring-2 focus:ring-wine-700/15';

function VendorLogin() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get('callbackUrl');
  const [tab, setTab] = useState('password');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  const role = session?.user?.role;
  useEffect(() => {
    if (role === 'vendor') router.replace('/vendor/dashboard');
  }, [role, router]);

  async function finish(result) {
    if (result?.error) {
      toast.error(result.error === 'RateLimited' ? 'Too many attempts. Please wait a minute and try again.' : tab === 'otp' ? 'Wrong or expired code.' : 'Wrong email or password.');
      return;
    }
    const next = await destinationAfterSignIn(callbackUrl, '/account');
    if (!next.startsWith('/vendor/')) {
      toast.error('This account is not a vendor account. Ask Tulsi to set up your vendor login.');
    }
    window.location.replace(next);
  }

  async function onPassword(e) {
    e.preventDefault();
    setBusy(true);
    try { await finish(await signIn('credentials', { email, password, redirect: false })); } finally { setBusy(false); }
  }

  async function sendOtp(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/auth/send-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const d = await res.json();
      if (d.success) { setOtpSent(true); toast.success('Code sent — check your email.'); } else toast.error(d.message || 'Could not send the code.');
    } catch { toast.error('Network error. Try again.'); } finally { setBusy(false); }
  }

  async function onOtp(e) {
    e.preventDefault();
    setBusy(true);
    try { await finish(await signIn('otp', { email, otp, redirect: false })); } finally { setBusy(false); }
  }

  if (status === 'loading' || role === 'vendor') {
    return <div className="min-h-screen flex items-center justify-center bg-stone-50"><LoadingSpinner size="lg" /></div>;
  }

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <p className="font-serif text-2xl font-bold text-wine-700">Tulsi Vendor Portal</p>
          <p className="text-sm text-stone-500 mt-1">Manage your pieces, stock, orders and payouts</p>
        </div>

        {session && role !== 'vendor' && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            You&apos;re signed in as {session.user.email}, which isn&apos;t a vendor login.{' '}
            <button onClick={() => signOut({ redirect: false })} className="font-semibold underline">Sign out</button> to use a vendor account.
          </div>
        )}

        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
          <div className="flex border-b border-stone-200" role="tablist">
            {[['password', 'Password'], ['otp', 'Email code']].map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setOtpSent(false); setOtp(''); }}
                className={`flex-1 py-3 text-sm font-semibold ${tab === id ? 'text-wine-700 border-b-2 border-wine-700' : 'text-stone-500'}`}>
                {label}
              </button>
            ))}
          </div>

          <div className="p-5 space-y-4">
            <label className="block">
              <span className="block text-xs font-medium text-stone-600 mb-1">Vendor login email</span>
              <span className="relative block">
                <FiMail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="store@example.com" className={input} disabled={otpSent} />
              </span>
            </label>

            {tab === 'password' && (
              <form onSubmit={onPassword} className="space-y-4">
                <label className="block">
                  <span className="block text-xs font-medium text-stone-600 mb-1">Password</span>
                  <span className="relative block">
                    <FiLock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
                    <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
                  </span>
                </label>
                <button disabled={busy || !email} className="w-full py-3 rounded-xl bg-wine-700 hover:bg-wine-800 text-white font-semibold text-sm disabled:opacity-50 flex justify-center">
                  {busy ? <LoadingSpinner size="sm" /> : 'Sign in'}
                </button>
              </form>
            )}

            {tab === 'otp' && !otpSent && (
              <form onSubmit={sendOtp}>
                <button disabled={busy || !email} className="w-full py-3 rounded-xl bg-wine-700 hover:bg-wine-800 text-white font-semibold text-sm disabled:opacity-50 flex justify-center">
                  {busy ? <LoadingSpinner size="sm" /> : 'Email me a sign-in code'}
                </button>
              </form>
            )}
            {tab === 'otp' && otpSent && (
              <form onSubmit={onOtp} className="space-y-3">
                <input inputMode="numeric" autoFocus value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6-digit code" aria-label="6-digit code"
                  className="w-full text-center text-2xl tracking-[0.5em] py-3 border border-stone-300 rounded-xl font-mono outline-none focus:border-wine-700" />
                <button disabled={busy || otp.length < 6} className="w-full py-3 rounded-xl bg-wine-700 hover:bg-wine-800 text-white font-semibold text-sm disabled:opacity-50 flex justify-center">
                  {busy ? <LoadingSpinner size="sm" /> : 'Verify and sign in'}
                </button>
                <button type="button" onClick={() => { setOtpSent(false); setOtp(''); }} className="w-full text-xs text-stone-500">Use a different email</button>
              </form>
            )}

            <div className="flex items-center gap-3 text-xs text-stone-400"><span className="flex-1 h-px bg-stone-200" />or<span className="flex-1 h-px bg-stone-200" /></div>
            <button onClick={() => signIn('google', { callbackUrl: '/vendor/dashboard' })}
              className="w-full py-3 rounded-xl border border-stone-300 hover:bg-stone-50 text-sm font-semibold text-stone-700 flex items-center justify-center gap-2">
              <FcGoogle className="text-lg" /> Continue with Google
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-stone-500 mt-5">
          Want to sell with Tulsi? Call <a href="tel:+917695868787" className="text-wine-700 font-semibold">+91 76958 68787</a>
          <br /><Link href="/" className="text-stone-400 hover:text-stone-600 mt-2 inline-block">← Back to the shop</Link>
        </p>
      </div>
    </div>
  );
}

export default function VendorLoginPage() {
  return <Suspense fallback={null}><VendorLogin /></Suspense>;
}
