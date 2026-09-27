'use client';
import { Suspense, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { FiArrowLeft } from 'react-icons/fi';
import ChatInbox from '@/components/chat/ChatInbox';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

function Inbox() {
  const { status } = useSession();
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login?callbackUrl=/account/messages');
  }, [status, router]);

  if (status !== 'authenticated') return <div className="py-20 flex justify-center"><LoadingSpinner size="lg" /></div>;
  return (
    <ChatInbox apiBase="/api/messages" side="customer" initialId={params.get('c')}
      emptyHint={<>No messages yet. Open a piece and tap <strong>Chat with seller</strong> to ask about it.</>} />
  );
}

export default function CustomerMessagesPage() {
  return (
    <main className="max-w-5xl mx-auto px-4 py-6">
      <Link href="/account" className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-wine-700 mb-3"><FiArrowLeft /> My account</Link>
      <h1 className="font-serif text-2xl font-bold text-stone-800 mb-4">Messages</h1>
      <Suspense fallback={null}><Inbox /></Suspense>
    </main>
  );
}
