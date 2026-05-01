'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { FiCheckCircle, FiCalendar, FiPackage } from 'react-icons/fi';

function RentalSuccessContent() {
  const searchParams = useSearchParams();
  const rentalNumber = searchParams.get('rentalNumber');
  const email = searchParams.get('email');

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
      <div className="bg-white rounded-2xl shadow-sm p-8 max-w-md w-full text-center">
        <div className="w-20 h-20 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-5">
          <FiCheckCircle className="text-5xl text-green-500" />
        </div>
        <h1 className="font-serif text-2xl font-bold text-gray-800 mb-2">Rental Booked!</h1>
        <p className="text-gray-500 text-sm mb-5">
          Your rental booking is confirmed. We will contact you to arrange delivery/pickup details.
          {email && <> Confirmation sent to <span className="font-medium text-gray-700">{email}</span>.</>}
        </p>
        {rentalNumber && (
          <div className="bg-gold-50 border border-gold-100 rounded-xl px-5 py-4 mb-6">
            <p className="text-xs text-gray-500 mb-1">Your Rental Booking Number</p>
            <p className="font-mono text-xl font-bold text-maroon-950">#{rentalNumber}</p>
            <p className="text-xs text-gray-400 mt-1">Save this for reference</p>
          </div>
        )}
        <div className="space-y-3">
          <Link href="/rentals" className="flex items-center justify-center gap-2 w-full py-3 bg-maroon-950 text-white font-semibold rounded-xl hover:bg-maroon-900 transition">
            <FiCalendar /> Browse More Rentals
          </Link>
          <Link href="/account" className="block w-full py-3 border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition text-sm">
            My Account
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function RentalSuccessPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>}>
      <RentalSuccessContent />
    </Suspense>
  );
}
