'use client';

import { Suspense } from 'react';
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { GiQueenCrown } from 'react-icons/gi';
import { FiEye, FiEyeOff } from 'react-icons/fi';
import toast from 'react-hot-toast';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const [mode, setMode] = useState('login');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });

  function updateForm(key, value) { setForm((prev) => ({ ...prev, [key]: value })); }

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await signIn('credentials', { email: form.email, password: form.password, redirect: false });
      if (result?.error) { toast.error('Invalid email or password'); }
      else { toast.success('Welcome back!'); router.push(callbackUrl); }
    } finally { setLoading(false); }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Account created! Please log in.');
        setMode('login');
        setForm({ ...form, name: '' });
      } else { toast.error(data.message); }
    } finally { setLoading(false); }
  }

  return (
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
      <div className="text-center mb-8">
        <GiQueenCrown className="text-gold-600 text-4xl mx-auto mb-2" />
        <h1 className="font-serif text-2xl font-bold text-maroon-950">
          {mode === 'login' ? 'Welcome Back' : 'Create Account'}
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          {mode === 'login' ? 'Sign in to your account' : 'Join the Tulsi family'}
        </p>
      </div>

      <form onSubmit={mode === 'login' ? handleLogin : handleRegister} className="space-y-4">
        {mode === 'register' && (
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Full Name *</label>
            <input required value={form.name} onChange={(e) => updateForm('name', e.target.value)} placeholder="Your full name" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-500" />
          </div>
        )}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Email *</label>
          <input required type="email" value={form.email} onChange={(e) => updateForm('email', e.target.value)} placeholder="your@email.com" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-500" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Password *</label>
          <div className="relative">
            <input required type={showPassword ? 'text' : 'password'} value={form.password} onChange={(e) => updateForm('password', e.target.value)} placeholder="••••••••" className="w-full px-4 py-2.5 pr-10 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-500" />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              {showPassword ? <FiEyeOff /> : <FiEye />}
            </button>
          </div>
        </div>
        <button type="submit" disabled={loading} className="w-full py-3 bg-maroon-950 text-white font-bold rounded-xl hover:bg-maroon-900 disabled:opacity-60 transition flex items-center justify-center gap-2">
          {loading ? <><LoadingSpinner size="sm" /> {mode === 'login' ? 'Signing in...' : 'Creating account...'}</> : mode === 'login' ? 'Sign In' : 'Create Account'}
        </button>
      </form>

      <p className="text-center text-sm text-gray-500 mt-6">
        {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
        <button onClick={() => setMode(mode === 'login' ? 'register' : 'login')} className="text-gold-600 font-semibold hover:text-gold-700">
          {mode === 'login' ? 'Create one' : 'Sign in'}
        </button>
      </p>

      <div className="text-center mt-4">
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
