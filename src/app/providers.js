'use client';

import { SessionProvider } from 'next-auth/react';
import { CartProvider } from '@/context/CartContext';
import { WishlistProvider } from '@/context/WishlistContext';
import { Toaster } from 'react-hot-toast';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import { TrackingProvider } from '@/components/TrackingProvider';
import { TopProgressBar } from '@/components/ui/TopProgressBar';

export function Providers({ children }) {
  return (
    <SessionProvider refetchOnWindowFocus={false} refetchInterval={0}>
      <CartProvider>
        <WishlistProvider>
          <TrackingProvider>
            <TopProgressBar />
            <div className="flex flex-col min-h-screen">
              <Navbar />
              <main className="flex-1">{children}</main>
              <Footer />
            </div>
            <Toaster
              position="top-right"
              toastOptions={{
                duration: 3000,
                style: { borderRadius: '8px', fontSize: '14px' },
                success: { style: { background: '#f0fdf4', color: '#166534' } },
                error: { style: { background: '#fef2f2', color: '#991b1b' } },
              }}
            />
          </TrackingProvider>
        </WishlistProvider>
      </CartProvider>
    </SessionProvider>
  );
}
