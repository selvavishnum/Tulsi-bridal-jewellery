'use client';

import { useState } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { FiLock, FiMail, FiShield, FiAlertCircle, FiArrowRight } from 'react-icons/fi';
import { GiQueenCrown } from 'react-icons/gi';
import toast from 'react-hot-toast';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

/* ── tiny reusable input ── */
function AdminInput({ icon: Icon, ...props }) {
  return (
    <div className="relative">
      <Icon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none" />
      <input
        {...props}
        className="w-full pl-10 pr-4 py-3 bg-slate-800/60 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 outline-none focus:border-amber-500/70 focus:ring-2 focus:ring-amber-500/20 transition"
      />
    </div>
  );
}

/* ── OTP digit display ── */
function OTPInput({ value, onChange }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      placeholder="0 0 0 0 0 0"
      maxLength={6}
      autoFocus
      className="w-full text-center text-4xl tracking-[0.8em] py-4 bg-slate-800/60 border-2 border-amber-500/50 rounded-xl text-amber-300 font-mono outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 transition placeholder-slate-700"
    />
  );
}

export default function AdminPortalPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [tab, setTab] = useState('otp');
  const [loading, setLoading] = useState(null);
  const [showPass, setShowPass] = useState(false);

  // OTP flow
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [otpStep, setOtpStep] = useState('email'); // 'email' | 'verify'

  // Password flow
  const [pwEmail, setPwEmail] = useState('');
  const [password, setPassword] = useState('');

  // Already logged-in admin — go straight to dashboard
  if (status === 'authenticated' && session?.user?.role === 'admin') {
    router.replace('/admin');
    return (
      <Screen>
        <div className="flex flex-col items-center gap-3">
          <LoadingSpinner size="lg" />
          <p className="text-slate-400 text-sm">Opening admin panel…</p>
        </div>
      </Screen>
    );
  }

  if (status === 'loading') {
    return (
      <Screen>
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-slate-800 border border-amber-800/30 flex items-center justify-center">
            <GiQueenCrown className="text-amber-400 text-3xl" />
          </div>
          <LoadingSpinner size="lg" />
          <p className="text-slate-400 text-sm">Checking session…</p>
        </div>
      </Screen>
    );
  }

  // Logged in but not admin — show clear error with sign-out option
  if (status === 'authenticated' && session?.user?.role !== 'admin') {
    return (
      <Screen>
        <div className="w-full max-w-sm text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto">
            <FiAlertCircle className="text-red-400 text-3xl" />
          </div>
          <h2 className="text-white text-xl font-bold">Access Denied</h2>
          <p className="text-slate-400 text-sm">
            <span className="text-white font-medium">{session.user.email}</span> is not listed as an admin.
          </p>
          <p className="text-slate-500 text-xs leading-relaxed">
            Make sure <code className="bg-slate-800 px-1 rounded text-amber-400">ADMIN_EMAILS</code> is set in Vercel with your email address.
          </p>
          <div className="flex gap-3 justify-center pt-2">
            <button
              onClick={() => router.push('/')}
              className="px-4 py-2 text-sm text-slate-400 hover:text-white border border-slate-700 rounded-lg transition"
            >
              Go to Shop
            </button>
            <button
              onClick={() => signOut({ callbackUrl: '/admin-portal' })}
              className="px-4 py-2 text-sm text-amber-400 hover:text-amber-300 border border-amber-700/40 rounded-lg transition"
            >
              Sign Out &amp; Retry
            </button>
          </div>
        </div>
      </Screen>
    );
  }

  /* ── OTP send ── */
  async function sendOTP(e) {
    e.preventDefault();
    setLoading('send');
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('OTP sent — check your email or Vercel logs.');
        setOtpStep('verify');
      } else {
        toast.error(data.message || 'Failed to send OTP');
      }
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setLoading(null);
    }
  }

  /* ── OTP verify ── */
  async function verifyOTP(e) {
    e.preventDefault();
    setLoading('verify');
    try {
      const r = await signIn('otp', { email, otp, redirect: false });
      if (r?.error) {
        toast.error('Invalid or expired OTP. Try again.');
        setOtp('');
      } else {
        // signIn() with redirect:false awaits until the session cookie is fully written.
        // Hard-navigate so /admin loads fresh with the correct session — no useSession timing issues.
        window.location.replace('/admin');
      }
    } finally {
      setLoading(null);
    }
  }

  /* ── Password login ── */
  async function handlePassword(e) {
    e.preventDefault();
    setLoading('pw');
    try {
      const r = await signIn('credentials', { email: pwEmail, password, redirect: false });
      if (r?.error) {
        toast.error('Wrong email or password.');
      } else {
        window.location.replace('/admin');
      }
    } finally {
      setLoading(null);
    }
  }

  return (
    <Screen>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-900/60 to-slate-900 border border-amber-700/30 mb-4 shadow-lg shadow-amber-900/20">
            <GiQueenCrown className="text-amber-400 text-3xl" />
          </div>
          <h1 className="font-serif text-2xl font-bold text-white tracking-tight">Admin Portal</h1>
          <div className="flex items-center justify-center gap-1.5 mt-1">
            <FiShield className="text-amber-500 text-xs" />
            <span className="text-amber-500 text-xs tracking-widest uppercase font-medium">Tulsi Bridal Jewellery</span>
          </div>
        </div>

        {/* Card */}
        <div className="bg-slate-900 border border-white/[0.08] rounded-2xl overflow-hidden shadow-2xl shadow-black/60">

          {/* Tab strip */}
          <div className="flex border-b border-white/[0.06]">
            {[{ id: 'otp', label: 'Email OTP' }, { id: 'password', label: 'Password' }].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { setTab(t.id); setOtpStep('email'); setOtp(''); }}
                className={`flex-1 py-3.5 text-xs font-semibold tracking-wide transition ${
                  tab === t.id
                    ? 'text-amber-400 border-b-2 border-amber-400 bg-amber-400/5'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-6">

            {/* ── OTP: Enter email ── */}
            {tab === 'otp' && otpStep === 'email' && (
              <form onSubmit={sendOTP} className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5 font-medium">Admin Email Address</label>
                  <AdminInput
                    icon={FiMail}
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading === 'send'}
                  className="w-full py-3 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white font-bold rounded-xl text-sm disabled:opacity-50 transition flex items-center justify-center gap-2 shadow-lg shadow-amber-900/30"
                >
                  {loading === 'send' ? <LoadingSpinner size="sm" /> : <FiMail className="text-sm" />}
                  Send OTP Code
                </button>
                <p className="text-center text-xs text-slate-600">A 6-digit one-time code will be sent to your email</p>
              </form>
            )}

            {/* ── OTP: Enter code ── */}
            {tab === 'otp' && otpStep === 'verify' && loading === 'verify' && (
              <div className="text-center py-8 space-y-3">
                <LoadingSpinner size="lg" />
                <p className="text-slate-400 text-sm">Verifying OTP…</p>
              </div>
            )}
            {tab === 'otp' && otpStep === 'verify' && loading !== 'verify' && (
              <form onSubmit={verifyOTP} className="space-y-4">
                <div className="text-center space-y-1">
                  <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-full px-3 py-1">
                    <FiMail className="text-amber-400 text-xs" />
                    <span className="text-amber-300 text-xs font-medium">{email}</span>
                  </div>
                  <p className="text-slate-400 text-sm pt-1">Enter the 6-digit code from your email</p>
                </div>
                <OTPInput value={otp} onChange={setOtp} />
                <button
                  type="submit"
                  disabled={loading === 'verify' || otp.length < 6}
                  className="w-full py-3 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white font-bold rounded-xl text-sm disabled:opacity-50 transition flex items-center justify-center gap-2 shadow-lg shadow-amber-900/30"
                >
                  {loading === 'verify' ? <LoadingSpinner size="sm" /> : <FiShield className="text-sm" />}
                  Verify & Enter Admin
                </button>
                <button
                  type="button"
                  onClick={() => { setOtpStep('email'); setOtp(''); }}
                  className="w-full text-xs text-slate-600 hover:text-slate-400 py-1 transition"
                >
                  ← Use a different email
                </button>
              </form>
            )}

            {/* ── Password tab ── */}
            {tab === 'password' && (
              <form onSubmit={handlePassword} className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5 font-medium">Admin Email</label>
                  <AdminInput
                    icon={FiMail}
                    required
                    type="email"
                    value={pwEmail}
                    onChange={(e) => setPwEmail(e.target.value)}
                    placeholder="admin@example.com"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5 font-medium">Password</label>
                  <div className="relative">
                    <FiLock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none" />
                    <input
                      required
                      type={showPass ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-14 py-3 bg-slate-800/60 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 outline-none focus:border-amber-500/70 focus:ring-2 focus:ring-amber-500/20 transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs transition px-1"
                    >
                      {showPass ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading === 'pw'}
                  className="w-full py-3 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white font-bold rounded-xl text-sm disabled:opacity-50 transition flex items-center justify-center gap-2 shadow-lg shadow-amber-900/30"
                >
                  {loading === 'pw' ? <LoadingSpinner size="sm" /> : <FiArrowRight className="text-sm" />}
                  Sign In to Admin
                </button>
              </form>
            )}

          </div>
        </div>

        <p className="text-center text-xs text-slate-700 mt-6 flex items-center justify-center gap-1.5">
          <FiShield className="text-xs" /> Authorised administrators only
        </p>
      </div>
    </Screen>
  );
}

function Screen({ children }) {
  return (
    <div className="min-h-screen bg-[#070b11] flex items-center justify-center px-4 py-12 relative overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[300px] bg-amber-600/[0.04] rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-red-950/20 rounded-full blur-3xl pointer-events-none" />
      <div className="relative z-10 w-full flex items-center justify-center">
        {children}
      </div>
    </div>
  );
}
