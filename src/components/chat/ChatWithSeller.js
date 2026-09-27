'use client';
/* "Chat with seller" on a vendor's product page: a short message sheet
   that starts (or continues) the conversation, then opens the inbox. */
import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { FiMessageCircle, FiX, FiSend } from 'react-icons/fi';
import { MAX_MESSAGE } from '@/lib/chat';

export default function ChatWithSeller({ product }) {
  const { data: session } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const id = product.id || product._id;

  function start() {
    if (!session) { router.push(`/login?callbackUrl=${encodeURIComponent(`/product/${id}`)}`); return; }
    if (session.user?.role && session.user.role !== 'customer') { toast.error('Chat is for customer accounts.'); return; }
    setText(`Hi! Is "${product.name}" available? `);
    setOpen(true);
  }

  async function send(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: id, text }),
      });
      const d = await res.json().catch(() => ({}));
      if (!d.success) { toast.error(d.message || 'Message not sent'); return; }
      toast.success('Sent — the seller will reply here');
      router.push(`/account/messages?c=${encodeURIComponent(d.data.conversationId)}`);
    } catch {
      toast.error('Message not sent — check your connection.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={start}
        className="w-full mb-4 py-3 rounded-xl border-2 border-wine-700 text-wine-700 hover:bg-wine-700/5 font-bold text-sm flex items-center justify-center gap-2 transition">
        <FiMessageCircle /> Chat with seller
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <form onSubmit={send} role="dialog" aria-modal="true" aria-labelledby="chat-seller-title"
            className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 id="chat-seller-title" className="font-semibold text-stone-800">Ask the seller</h2>
              <button type="button" onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-stone-100" aria-label="Close"><FiX /></button>
            </div>
            <p className="text-xs text-stone-500 truncate">About: {product.name}</p>
            <label htmlFor="seller-msg" className="sr-only">Message</label>
            <textarea id="seller-msg" rows={4} autoFocus value={text} maxLength={MAX_MESSAGE} onChange={(e) => setText(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm outline-none focus:border-wine-700 focus:ring-2 focus:ring-wine-700/15" />
            <p className="text-[11px] text-stone-400">Keep payments on Tulsi — phone numbers and links are hidden for your safety.</p>
            <button disabled={busy || !text.trim()} className="w-full py-3 rounded-xl bg-wine-700 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
              <FiSend /> {busy ? 'Sending…' : 'Send message'}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
