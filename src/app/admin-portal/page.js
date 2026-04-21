'use client';

import { useState } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { FiLock, FiMail, FiEye, FiEyeOff, FiShield } from 'react-icons/fi';
import { FcGoogle } from 'react-icons/fc';
import { GiQueenCrown } from 'react-icons/gi';
import toast from 'react-hot-toast';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

const GOOGLE_CONFIGURED = !!process.env.NEXT_PUBLIC_GOOGLE_ENABLED;

export default function AdminPortalPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState('otp');
  const [loading, setLoading] = useState(null);
  const [showPass, setShowPass] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpStep, setOtpStep] = useState('email');

  // Redirect once session resolves
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }
  if (status === 'authenticated') {
    if (session.user.role === 'admin') {
      router.replace('/admin');
      return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><LoadingSpinner size="lg" /></div>;
    } else {
      return (
        <div className="min-h-screen bg-gray-950 flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-400 text-lg font-semibold mb-2">⛔ Access Denied</p>
            <p className="text-gray-400 text-sm">{session.user.email} is not an admin account.</p>
            <button onClick={() => router.push('/')} className="mt-4 text-gold-400 text-sm underline">Go to Home</button>
          </div>
        </div>
      );
    }
  }

  async function handleGoogle() {
    setLoading('google');
    await signIn('google', { callbackUrl: '/admin-portal' });
  }

  async function handlePassword(e) {
    e.preventDefault();
    setLoading('pw');
    try {
      const r = await signIn('credentials', { email, password, redirect: false });
      if (r?.error) toast.error('Wrong email or password');
      else toast.success('Checking access…');
    } finally { setLoading(null); }
  }

  async function sendOTP(e) {
    e.preventDefault();
    setLoading('send');
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.success) { toast.success('OTP sent to your email!'); setOtpStep('verify'); }
      else toast.error(data.message || 'Failed to send OTP');
    } catch { toast.error('Network error'); }
    finally { setLoading(null); }
  }

  async function verifyOTP(e) {
    e.preventDefault();
    setLoading('verify');
    try {
      const r = await signIn('otp', { email, otp, redirect: false });
      if (r?.error) toast.error('Invalid or expired OTP');
      else toast.success('Checking admin access…');
    } finally { setLoading(null); }
  }

  const tabs = [
    { id: 'otp', label: 'Email OTP' },
    { id: 'password', label: 'Password' },
    ...(GOOGLE_CONFIGURED ? [{ id: 'google', label: 'Google' }] : []),
  ];

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-maroon-950 border border-gold-800/30 mb-4">
            <GiQueenCrown className="text-gold-400 text-3xl" />
          </div>
          <h1 className="font-serif text-2xl font-bold text-white">Admin Portal</h1>
          <div className="flex items-center justify-center gap-1.5 mt-1">
            <FiShield className="text-gold-500 text-xs" />
            <p className="text-gold-500 text-xs tracking-widest uppercase">Tulsi Bridal Jewellery</p>
          </div>
        </div>

        <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 shadow-2xl">

          {/* Tabs */}
          <div className="flex rounded-lg bg-gray-800 p-0.5 mb-5">
            {tabs.map((t) => (
              <button key={t.id} type="button" onClick={() => { setTab(t.id); setOtpStep('email'); setOtp(''); }}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition ${tab === t.id ? 'bg-maroon-900 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* OTP tab */}
          {tab === 'otp' && otpStep === 'email' && (
            <form onSubmit={sendOTP} className="space-y-3">
              <div className="relative">
                <FiMail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm" />
                <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="Your admin email"
                  className="w-full pl-9 pr-4 py-2.5 bg-gray-800 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-gold-600" />
              </div>
              <button type="submit" disabled={loading === 'send'}
                className="w-full py-2.5 bg-maroon-800 hover:bg-maroon-700 text-white font-bold rounded-xl text-sm disabled:opacity-60 transition flex items-center justify-center gap-2">
                {loading === 'send' ? <LoadingSpinner size="sm" /> : <FiMail className="text-sm" />} Send OTP Code
              </button>
            </form>
          )}

          {tab === 'otp' && otpStep === 'verify' && (
            <form onSubmit={verifyOTP} className="space-y-3">
              <p className="text-xs text-gray-400 text-center">Code sent to <span className="text-white font-semibold">{email}</span></p>
              <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000" maxLength={6}
                className="w-full text-center text-3xl tracking-[0.6em] py-3 bg-gray-800 border-2 border-gold-700 rounded-xl text-white font-mono outline-none focus:ring-2 focus:ring-gold-500" />
              <button type="submit" disabled={loading === 'verify' || otp.length < 6}
                className="w-full py-2.5 bg-maroon-800 hover:bg-maroon-700 text-white font-bold rounded-xl text-sm disabled:opacity-60 transition flex items-center justify-center gap-2">
                {loading === 'verify' ? <LoadingSpinner size="sm" /> : <FiShield className="text-sm" />} Verify & Enter
              </button>
              <button type="button" onClick={() => { setOtpStep('email'); setOtp(''); }} className="w-full text-xs text-gray-500 hover:text-gray-300 pt-1">
                ← Use different email
              </button>
            </form>
          )}

          {/* Password tab */}
          {tab === 'password' && (
            <form onSubmit={handlePassword} className="space-y-3">
              <div className="relative">
                <FiMail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm" />
                <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="Admin email"
                  className="w-full pl-9 pr-4 py-2.5 bg-gray-800 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-gold-600" />
              </div>
              <div className="relative">
                <FiLock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm" />
                <input required type={showPass ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="w-full pl-9 pr-10 py-2.5 bg-gray-800 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-gold-600" />
                <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                  {showPass ? <FiEyeOff /> : <FiEye />}
                </button>
              </div>
              <button type="submit" disabled={loading === 'pw'}
                className="w-full py-2.5 bg-maroon-800 hover:bg-maroon-700 text-white font-bold rounded-xl text-sm disabled:opacity-60 transition flex items-center justify-center gap-2">
                {loading === 'pw' ? <LoadingSpinner size="sm" /> : <FiLock className="text-sm" />} Sign In
              </button>
            </form>
          )}

          {/* Google tab */}
          {tab === 'google' && (
            <div className="space-y-3">
              <button onClick={handleGoogle} disabled={loading === 'google'}
                className="w-full flex items-center justify-center gap-3 py-2.5 bg-white text-gray-800 font-semibold rounded-xl text-sm hover:bg-gray-100 disabled:opacity-60 transition">
                {loading === 'google' ? <LoadingSpinner size="sm" /> : <FcGoogle className="text-xl" />}
                Sign in with Google
              </button>
              <p className="text-center text-xs text-gray-500">Only emails listed in ADMIN_EMAILS will gain access</p>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-700 mt-5">Authorised administrators only</p>
      </div>
    </div>
  );
}
