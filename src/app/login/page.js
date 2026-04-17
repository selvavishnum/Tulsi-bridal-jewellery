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

/* ── Google Sign-in Button ── */
function GoogleBtn({ loading, setLoading, callbackUrl }) {
  async function handleGoogle() {
    setLoading('google');
    try {
      await signIn('google', { callbackUrl });
    } catch {
      toast.error('Google sign-in failed');
      setLoading(null);
    }
  }
  return (
    <button
      type="button"
      onClick={handleGoogle}
      disabled={!!loading}
      className="w-full flex items-center justify-center gap-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 transition"
    >
      {loading === 'google' ? <LoadingSpinner size="sm" /> : <FcGoogle className="text-xl" />}
      Continue with Google
    </button>
  );
}

/* ── Email + Password Form ── */
function PasswordForm({ mode, setMode, callbackUrl }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const update = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await signIn('credentials', { email: form.email, password: form.password, redirect: false });
      if (result?.error) toast.error('Invalid email or password');
      else { toast.success('Welcome back!'); router.push(callbackUrl); }
    } finally { setLoading(false); }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) { toast.success('Account created! Please log in.'); setMode('login'); }
      else toast.error(data.message);
    } finally { setLoading(false); }
  }

  return (
    <form onSubmit={mode === 'login' ? handleLogin : handleRegister} className="space-y-3">
      {mode === 'register' && (
        <div className="relative">
          <FiUser className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
          <input required value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Full Name" className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-400" />
        </div>
      )}
      <div className="relative">
        <FiMail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
        <input required type="email" value={form.email} onChange={(e) => update('email', e.target.value)} placeholder="Email address" className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-400" />
      </div>
      <div className="relative">
        <FiLock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
        <input required type={showPassword ? 'text' : 'password'} value={form.password} onChange={(e) => update('password', e.target.value)} placeholder="Password" className="w-full pl-9 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-400" />
        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
          {showPassword ? <FiEyeOff /> : <FiEye />}
        </button>
      </div>
      <button type="submit" disabled={loading} className="w-full py-3 bg-maroon-950 text-white font-bold rounded-xl hover:bg-maroon-900 disabled:opacity-60 transition flex items-center justify-center gap-2">
        {loading ? <LoadingSpinner size="sm" /> : null}
        {mode === 'login' ? 'Sign In' : 'Create Account'}
      </button>
      <p className="text-center text-sm text-gray-500">
        {mode === 'login' ? "No account? " : 'Have account? '}
        <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')} className="text-gold-600 font-semibold">{mode === 'login' ? 'Register' : 'Sign In'}</button>
      </p>
    </form>
  );
}

/* ── Email OTP Form ── */
function OTPForm({ callbackUrl }) {
  const router = useRouter();
  const [step, setStep] = useState('email'); // 'email' | 'verify'
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
      if (data.success) {
        toast.success('OTP sent! Check your email (or Vercel logs for testing)');
        setStep('verify');
      } else toast.error(data.message);
    } finally { setLoading(false); }
  }

  async function verifyOTP(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await signIn('otp', { email, otp, redirect: false });
      if (result?.error) toast.error('Invalid or expired OTP');
      else { toast.success('Signed in!'); router.push(callbackUrl); }
    } finally { setLoading(false); }
  }

  if (step === 'verify') {
    return (
      <form onSubmit={verifyOTP} className="space-y-3">
        <p className="text-sm text-gray-600 text-center">Enter the 6-digit code sent to <strong>{email}</strong></p>
        <input
          value={otp} onChange={(e) => setOtp(e.target.value)}
          placeholder="000000" maxLength={6}
          className="w-full text-center text-2xl tracking-[0.5em] py-3 border-2 border-gold-300 rounded-xl outline-none focus:ring-2 focus:ring-gold-400 font-mono"
        />
        <button type="submit" disabled={loading || otp.length < 6} className="w-full py-3 bg-maroon-950 text-white font-bold rounded-xl hover:bg-maroon-900 disabled:opacity-60 transition flex items-center justify-center gap-2">
          {loading ? <LoadingSpinner size="sm" /> : null} Verify OTP
        </button>
        <button type="button" onClick={() => { setStep('email'); setOtp(''); }} className="w-full text-sm text-gray-500 hover:text-gray-700">← Change email</button>
      </form>
    );
  }

  return (
    <form onSubmit={sendOTP} className="space-y-3">
      <div className="relative">
        <FiMail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
        <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-400" />
      </div>
      <button type="submit" disabled={loading} className="w-full py-3 bg-maroon-950 text-white font-bold rounded-xl hover:bg-maroon-900 disabled:opacity-60 transition flex items-center justify-center gap-2">
        {loading ? <LoadingSpinner size="sm" /> : <FiMail />} Send OTP Code
      </button>
    </form>
  );
}

/* ── Main Login Form ── */
function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const [tab, setTab] = useState('google'); // 'google' | 'password' | 'otp'
  const [mode, setMode] = useState('login');
  const [loading, setLoading] = useState(null);

  return (
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
      {/* Header */}
      <div className="text-center mb-6">
        <GiQueenCrown className="text-gold-500 text-4xl mx-auto mb-2" />
        <h1 className="font-serif text-2xl font-bold text-maroon-950">
          {tab === 'google' || tab === 'otp' ? 'Sign In' : mode === 'login' ? 'Welcome Back' : 'Create Account'}
        </h1>
        <p className="text-gray-400 text-xs mt-1">Tulsi Bridal Jewellery</p>
      </div>

      {/* Tabs */}
      <div className="flex rounded-xl bg-gray-100 p-1 mb-5 gap-1">
        {[
          { id: 'google', label: 'Google' },
          { id: 'otp', label: 'Email OTP' },
          { id: 'password', label: 'Password' },
        ].map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition ${tab === t.id ? 'bg-white text-maroon-950 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'google' && (
        <div className="space-y-4">
          <GoogleBtn loading={loading} setLoading={setLoading} callbackUrl={callbackUrl} />
          <p className="text-xs text-center text-gray-400">Use your Gmail account to sign in instantly</p>
        </div>
      )}
      {tab === 'otp' && <OTPForm callbackUrl={callbackUrl} />}
      {tab === 'password' && <PasswordForm mode={mode} setMode={setMode} callbackUrl={callbackUrl} />}

      <div className="text-center mt-5">
        <Link href="/" className="text-xs text-gray-400 hover:text-gray-600">← Back to Home</Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-maroon-950 to-maroon-800 flex items-center justify-center py-12 px-4">
      <Suspense fallback={<LoadingSpinner size="lg" />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
