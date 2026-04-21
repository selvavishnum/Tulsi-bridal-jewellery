'use client';

import { Suspense, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { GiQueenCrown } from 'react-icons/gi';
import { FiEye, FiEyeOff, FiMail, FiLock, FiUser } from 'react-icons/fi';
import { FcGoogle } from 'react-icons/fc';
import toast from 'react-hot-toast';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

const GOOGLE_CONFIGURED = !!process.env.NEXT_PUBLIC_GOOGLE_ENABLED;

/* ── Google Sign-in Button ── */
function GoogleBtn({ callbackUrl }) {
  const [loading, setLoading] = useState(false);
  async function go() {
    setLoading(true);
    await signIn('google', { callbackUrl });
  }
  return (
    <button type="button" onClick={go} disabled={loading}
      className="w-full flex items-center justify-center gap-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 transition">
      {loading ? <LoadingSpinner size="sm" /> : <FcGoogle className="text-xl" />}
      Continue with Google (Gmail)
    </button>
  );
}

/* ── Email + Password ── */
function PasswordForm({ callbackUrl }) {
  const router = useRouter();
  const [mode, setMode] = useState('login');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const upd = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'login') {
        const r = await signIn('credentials', { email: form.email, password: form.password, redirect: false });
        if (r?.error) toast.error('Wrong email or password');
        else { toast.success('Welcome back!'); router.push(callbackUrl); }
      } else {
        const res = await fetch('/api/auth/register', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        const data = await res.json();
        if (data.success) { toast.success('Account created! Please log in.'); setMode('login'); }
        else toast.error(data.message);
      }
    } finally { setLoading(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {mode === 'register' && (
        <div className="relative">
          <FiUser className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
          <input required value={form.name} onChange={(e) => upd('name', e.target.value)}
            placeholder="Full Name" className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-400" />
        </div>
      )}
      <div className="relative">
        <FiMail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
        <input required type="email" value={form.email} onChange={(e) => upd('email', e.target.value)}
          placeholder="Email address" className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-400" />
      </div>
      <div className="relative">
        <FiLock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
        <input required type={showPass ? 'text' : 'password'} value={form.password} onChange={(e) => upd('password', e.target.value)}
          placeholder="Password" className="w-full pl-9 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-400" />
        <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
          {showPass ? <FiEyeOff /> : <FiEye />}
        </button>
      </div>
      <button type="submit" disabled={loading}
        className="w-full py-3 bg-maroon-950 text-white font-bold rounded-xl hover:bg-maroon-900 disabled:opacity-60 transition flex items-center justify-center gap-2">
        {loading && <LoadingSpinner size="sm" />}
        {mode === 'login' ? 'Sign In' : 'Create Account'}
      </button>
      <p className="text-center text-sm text-gray-500">
        {mode === 'login' ? "No account? " : 'Have account? '}
        <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')} className="text-gold-600 font-semibold">
          {mode === 'login' ? 'Register free' : 'Sign In'}
        </button>
      </p>
    </form>
  );
}

/* ── Email OTP ── */
function OTPForm({ callbackUrl }) {
  const router = useRouter();
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);

  async function sendOTP(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.success) { toast.success('OTP sent! Check your email.'); setStep('verify'); }
      else toast.error(data.message || 'Failed to send OTP');
    } catch { toast.error('Network error'); }
    finally { setLoading(false); }
  }

  async function verifyOTP(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await signIn('otp', { email, otp, redirect: false });
      if (r?.error) toast.error('Invalid or expired OTP. Try again.');
      else { toast.success('Signed in!'); router.push(callbackUrl); }
    } finally { setLoading(false); }
  }

  if (step === 'verify') return (
    <form onSubmit={verifyOTP} className="space-y-4">
      <p className="text-sm text-center text-gray-600">6-digit code sent to <strong>{email}</strong></p>
      <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
        placeholder="000000" maxLength={6}
        className="w-full text-center text-3xl tracking-[0.6em] py-3 border-2 border-gold-300 rounded-xl font-mono outline-none focus:ring-2 focus:ring-gold-400" />
      <button type="submit" disabled={loading || otp.length < 6}
        className="w-full py-3 bg-maroon-950 text-white font-bold rounded-xl hover:bg-maroon-900 disabled:opacity-60 transition flex items-center justify-center gap-2">
        {loading && <LoadingSpinner size="sm" />} Verify & Sign In
      </button>
      <button type="button" onClick={() => { setStep('email'); setOtp(''); }} className="w-full text-sm text-gray-400 hover:text-gray-600">
        ← Try different email
      </button>
    </form>
  );

  return (
    <form onSubmit={sendOTP} className="space-y-3">
      <div className="relative">
        <FiMail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
        <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com" className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-400" />
      </div>
      <button type="submit" disabled={loading}
        className="w-full py-3 bg-maroon-950 text-white font-bold rounded-xl hover:bg-maroon-900 disabled:opacity-60 transition flex items-center justify-center gap-2">
        {loading ? <LoadingSpinner size="sm" /> : <FiMail />} Send OTP Code
      </button>
      <p className="text-xs text-center text-gray-400">We'll send a 6-digit code to your email</p>
    </form>
  );
}

/* ── Main ── */
function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const [tab, setTab] = useState('password');

  const tabs = [
    ...(GOOGLE_CONFIGURED ? [{ id: 'google', label: '🔵 Google' }] : []),
    { id: 'otp', label: '📧 Email OTP' },
    { id: 'password', label: '🔑 Password' },
  ];

  return (
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-7">
      <div className="text-center mb-6">
        <GiQueenCrown className="text-gold-500 text-4xl mx-auto mb-2" />
        <h1 className="font-serif text-2xl font-bold text-maroon-950">Tulsi Bridal</h1>
        <p className="text-gray-400 text-xs mt-0.5">Sign in to your account</p>
      </div>

      {/* Tabs */}
      <div className="flex rounded-xl bg-gray-100 p-0.5 mb-5 gap-0.5">
        {tabs.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition ${tab === t.id ? 'bg-white text-maroon-950 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'google' && <GoogleBtn callbackUrl={callbackUrl} />}
      {tab === 'otp' && <OTPForm callbackUrl={callbackUrl} />}
      {tab === 'password' && <PasswordForm callbackUrl={callbackUrl} />}

      <div className="text-center mt-5">
        <Link href="/" className="text-xs text-gray-400 hover:text-gray-600">← Back to Home</Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-maroon-950 to-maroon-800 flex items-center justify-center py-12 px-4">
      <Suspense fallback={<div className="text-white"><LoadingSpinner size="lg" /></div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
