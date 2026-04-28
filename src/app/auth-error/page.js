'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import { GiQueenCrown } from 'react-icons/gi';
import { FiAlertCircle } from 'react-icons/fi';

const ERROR_MESSAGES = {
  Configuration: 'Server configuration error. Please contact support.',
  AccessDenied: 'Access denied. Your account does not have permission.',
  Verification: 'The sign-in link has expired. Please try again.',
  OAuthSignin: 'Could not start Google sign-in. Check your internet.',
  OAuthCallback: 'Google sign-in failed. Please try again.',
  OAuthCreateAccount: 'Could not create account. Try a different sign-in method.',
  Default: 'Something went wrong. Please try again.',
};

function getReadableError(code) {
  if (!code) return ERROR_MESSAGES.Default;
  // Firebase NOT_FOUND error
  if (code.includes('NOT_FOUND') || code.includes('5 ')) {
    return '⚠️ Firebase database not connected yet. Please check your Vercel environment variables (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) and make sure the Firestore database is created in Firebase Console.';
  }
  return ERROR_MESSAGES[code] || `Sign-in error (${code}). Please try again.`;
}

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error') || '';
  const message = getReadableError(error);

  return (
    <div className="min-h-screen bg-gradient-to-br from-maroon-950 to-maroon-800 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-7 text-center">
        <GiQueenCrown className="text-gold-500 text-4xl mx-auto mb-3" />
        <div className="flex items-center justify-center gap-2 text-red-600 mb-3">
          <FiAlertCircle className="text-xl" />
          <h1 className="font-bold text-lg">Sign-in Error</h1>
        </div>
        <p className="text-gray-600 text-sm leading-relaxed mb-6">{message}</p>
        <div className="flex flex-col gap-2">
          <Link href="/login" className="w-full py-2.5 bg-maroon-950 text-white font-bold rounded-xl text-sm hover:bg-maroon-900 transition text-center">
            Try Again
          </Link>
          <Link href="/" className="text-sm text-gray-400 hover:text-gray-600">← Back to Home</Link>
        </div>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={null}>
      <AuthErrorContent />
    </Suspense>
  );
}
