'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import ChatInbox from '@/components/chat/ChatInbox';

function Inbox() {
  const params = useSearchParams();
  return (
    <ChatInbox apiBase="/api/vendor/messages" side="vendor" initialId={params.get('c')}
      emptyHint="No customer messages yet. Shoppers can chat with you from any of your product pages." />
  );
}

export default function VendorMessagesPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-stone-800">Messages</h1>
        <p className="text-sm text-stone-500">Answer customer questions about your pieces. You&apos;re emailed when a new message arrives.</p>
      </div>
      <Suspense fallback={null}><Inbox /></Suspense>
    </div>
  );
}
