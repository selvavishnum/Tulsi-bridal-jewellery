'use client';

import { useState, useEffect } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { FiLock, FiMail, FiEye, FiEyeOff, FiShield } from 'react-icons/fi';
import { FcGoogle } from 'react-icons/fc';
import { GiQueenCrown } from 'react-icons/gi';
import toast from 'react-hot-toast';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

export default function AdminPortalPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState('google');
  const [loading, setLoading] = useState(null);
  const [showPass, setShowPass] = useState(false);
  const [form, setForm] = useState({ email: '', password: '' });
  const [otpStep, setOtpStep] = useState('email');
  const [otp, setOtp] = useState('');

  useEffect(() => {
    if (status === 'authenticated') {
      if (session.user.role === 'admin') {
        router.push('/admin');
      } else {
        toast.error('Access denied — admin accounts only');
        router.push('/');
      }
    }
  }, [status, session, router]);

  async function handleGoogle() {
    setLoading('google');
    try {
      await signIn('google', { callbackUrl: '/admin' });
    } catch {
      toast.error('Google sign-in failed');
      setLoading(null);
    }
  }

  async function handlePassword(e) {
    e.preventDefault();
    setLoading('password');
    try {
      const result = await signIn('credentials', { email: form.email, password: form.password, redirect: false });
      if (result?.error) {
        toast.error('Invalid email or password');
      } else {
        // Session will trigger useEffect above
        toast.success('Verifying admin access…');
      }
    } finally { setLoading(null); }
  }

  async function sendOTP(e) {
    e.preventDefault();
    setLoading('otp-send');
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email }),
      });
      const data = await res.json();
      if (data.success) { toast.success('OTP sent to your email'); setOtpStep('verify'); }
      else toast.error(data.message);
    } finally { setLoading(null); }
  }

  async function verifyOTP(e) {
    e.preventDefault();
    setLoading('otp-verify');
    try {
      const result = await signIn('otp', { email: form.email, otp, redirect: false });
      if (result?.error) toast.error('Invalid or expired OTP');
      else toast.success('Verifying admin access…');
    } finally { setLoading(null); }
  }

  if (status === 'loading') return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-maroon-950 border border-gold-800/40 mb-4 shadow-2xl">
            <GiQueenCrown className="text-gold-400 text-3xl" />
          </div>
          <h1 className="font-serif text-2xl font-bold text-white">Admin Portal</h1>
          <div className="flex items-center justify-center gap-1.5 mt-1">
            <FiShield className="text-gold-500 text-xs" />
            <p className="text-gold-500 text-xs tracking-widest uppercase">Tulsi Bridal Jewellery</p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 shadow-2xl">

          {/* Tabs */}
          <div className="flex rounded-lg bg-gray-800 p-0.5 mb-5">
            {[
              { id: 'google', label: 'Google' },
              { id: 'otp', label: 'OTP' },
              { id: 'password', label: 'Password' },
            ].map((t) => (
              <button key={t.id} type="button" onClick={() => { setTab(t.id); setOtpStep('email'); }}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition ${tab === t.id ? 'bg-maroon-900 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Google */}
          {tab === 'google' && (
            <div className="space-y-3">
              <button onClick={handleGoogle} disabled={!!loading}
                className="w-full flex items-center justify-center gap-3 py-2.5 bg-white text-gray-800 font-semibold rounded-xl text-sm hover:bg-gray-100 disabled:opacity-60 transition">
                {loading === 'google' ? <LoadingSpinner size="sm" /> : <FcGoogle className="text-xl" />}
                Sign in with Google
              </button>
              <p className="text-center text-xs text-gray-500">Only authorised admin email addresses will gain access</p>
            </div>
          )}

          {/* OTP */}
          {tab === 'otp' && (
            <>
              {otpStep === 'email' ? (
                <form onSubmit={sendOTP} className="space-y-3">
                  <div className="relative">
                    <FiMail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm" />
                    <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="admin@email.com"
                      className="w-full pl-9 pr-4 py-2.5 bg-gray-800 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-gold-600" />
                  </div>
                  <button type="submit" disabled={!!loading}
                    className="w-full py-2.5 bg-maroon-800 hover:bg-maroon-700 text-white font-semibold rounded-xl text-sm disabled:opacity-60 transition flex items-center justify-center gap-2">
                    {loading === 'otp-send' ? <LoadingSpinner size="sm" /> : <FiMail />} Send OTP
                  </button>
                </form>
              ) : (
                <form onSubmit={verifyOTP} className="space-y-3">
                  <p className="text-xs text-gray-400 text-center">Code sent to <span className="text-white">{form.email}</span></p>
                  <input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="000000" maxLength={6}
                    className="w-full text-center text-2xl tracking-[0.5em] py-3 bg-gray-800 border-2 border-gold-700 rounded-xl text-white font-mono outline-none focus:ring-2 focus:ring-gold-500" />
                  <button type="submit" disabled={!!loading || otp.length < 6}
                    className="w-full py-2.5 bg-maroon-800 hover:bg-maroon-700 text-white font-semibold rounded-xl text-sm disabled:opacity-60 transition flex items-center justify-center gap-2">
                    {loading === 'otp-verify' ? <LoadingSpinner size="sm" /> : <FiShield />} Verify & Login
                  </button>
                  <button type="button" onClick={() => { setOtpStep('email'); setOtp(''); }} className="w-full text-xs text-gray-500 hover:text-gray-300">← Back</button>
                </form>
              )}
            </>
          )}

          {/* Password */}
          {tab === 'password' && (
            <form onSubmit={handlePassword} className="space-y-3">
              <div className="relative">
                <FiMail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm" />
                <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="Admin email"
                  className="w-full pl-9 pr-4 py-2.5 bg-gray-800 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-gold-600" />
              </div>
              <div className="relative">
                <FiLock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm" />
                <input required type={showPass ? 'text' : 'password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Password"
                  className="w-full pl-9 pr-10 py-2.5 bg-gray-800 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-gold-600" />
                <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
                  {showPass ? <FiEyeOff /> : <FiEye />}
                </button>
              </div>
              <button type="submit" disabled={!!loading}
                className="w-full py-2.5 bg-maroon-800 hover:bg-maroon-700 text-white font-semibold rounded-xl text-sm disabled:opacity-60 transition flex items-center justify-center gap-2">
                {loading === 'password' ? <LoadingSpinner size="sm" /> : <FiLock />} Sign In
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-gray-600 mt-5">
          This page is for authorised administrators only
        </p>
      </div>
    </div>
  );
}
