'use client';
/* Customer ↔ seller chat inbox, used by both sides:
   customers at /account/messages (apiBase /api/messages) and vendors at
   /vendor/messages (apiBase /api/vendor/messages). Polls while open. */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { FiArrowLeft, FiSend, FiMessageCircle, FiShield } from 'react-icons/fi';
import { MAX_MESSAGE } from '@/lib/chat';

const LIST_POLL_MS = 30_000;
const THREAD_POLL_MS = 8_000;

const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString('en-IN', today ? { hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

export default function ChatInbox({ apiBase, side, initialId = null, emptyHint }) {
  const [list, setList] = useState(null);
  const [activeId, setActiveId] = useState(initialId);
  const [thread, setThread] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  const loadList = useCallback(async () => {
    try {
      const d = await fetch(apiBase).then((r) => r.json());
      if (d.success) setList(d.data);
      else setList((l) => l || []);
    } catch { setList((l) => l || []); }
  }, [apiBase]);

  const loadThread = useCallback(async (id) => {
    try {
      const d = await fetch(`${apiBase}/${encodeURIComponent(id)}`).then((r) => r.json());
      if (!d.success) { toast.error(d.message || 'Could not open the chat'); setActiveId(null); return; }
      setThread((t) => (t && t.conversation.id === id && t.messages.length === d.data.messages.length ? t : d.data));
      setList((l) => (l ? l.map((c) => (c.id === id ? { ...c, unread: 0 } : c)) : l));
    } catch { /* next poll retries */ }
  }, [apiBase]);

  useEffect(() => {
    loadList();
    const t = setInterval(loadList, LIST_POLL_MS);
    return () => clearInterval(t);
  }, [loadList]);

  useEffect(() => {
    if (!activeId) return undefined;
    loadThread(activeId);
    const t = setInterval(() => { if (document.visibilityState === 'visible') loadThread(activeId); }, THREAD_POLL_MS);
    return () => clearInterval(t);
  }, [activeId, loadThread]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [thread?.messages.length]);

  function open(id) {
    setThread(null);
    setActiveId(id);
  }

  async function send(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body || !activeId) return;
    setSending(true);
    try {
      const res = await fetch(`${apiBase}/${encodeURIComponent(activeId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: body }),
      });
      const d = await res.json().catch(() => ({}));
      if (!d.success) { toast.error(d.message || 'Message not sent'); return; }
      if (d.data?.masked) toast('Phone numbers, emails and links are hidden — keep chats and payments on Tulsi.', { icon: '🔒' });
      setText('');
      await loadThread(activeId);
      loadList();
    } catch {
      toast.error('Message not sent — check your connection.');
    } finally {
      setSending(false);
    }
  }

  const active = thread?.conversation;

  return (
    <div className="grid md:grid-cols-[18rem_1fr] bg-white rounded-2xl border border-stone-200 overflow-hidden h-[calc(100dvh-12rem)] min-h-[28rem]">
      {/* Conversation list */}
      <div className={`border-r border-stone-100 overflow-y-auto ${activeId ? 'hidden md:block' : ''}`}>
        {list === null ? (
          <p className="p-6 text-sm text-stone-400">Loading…</p>
        ) : list.length === 0 ? (
          <div className="p-6 text-center text-sm text-stone-500">
            <FiMessageCircle className="mx-auto mb-2 text-2xl text-stone-300" aria-hidden />
            {emptyHint}
          </div>
        ) : (
          <ul>
            {list.map((c) => (
              <li key={c.id}>
                <button onClick={() => open(c.id)} aria-current={c.id === activeId ? 'true' : undefined}
                  className={`w-full text-left px-4 py-3 flex gap-3 items-start border-b border-stone-50 hover:bg-stone-50 ${c.id === activeId ? 'bg-stone-50' : ''}`}>
                  {c.product?.image
                    ? <img src={c.product.image} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                    : <span className="w-10 h-10 rounded-lg bg-stone-100 flex-shrink-0" />}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${c.unread ? 'font-bold text-stone-900' : 'font-semibold text-stone-700'}`}>{c.with}</span>
                      <span className="text-[11px] text-stone-400 flex-shrink-0">{when(c.updatedAt)}</span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate text-xs ${c.unread ? 'text-stone-800' : 'text-stone-500'}`}>
                        {c.lastMessage ? `${c.lastMessage.from === side ? 'You: ' : ''}${c.lastMessage.text}` : ''}
                      </span>
                      {c.unread > 0 && <span className="min-w-[1.25rem] h-5 px-1.5 rounded-full bg-wine-700 text-white text-[11px] font-bold flex items-center justify-center">{c.unread}</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Thread */}
      <div className={`flex flex-col min-h-0 ${activeId ? '' : 'hidden md:flex'}`}>
        {!activeId ? (
          <div className="flex-1 flex items-center justify-center text-sm text-stone-400 p-6">Choose a conversation</div>
        ) : (
          <>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-100">
              <button onClick={() => { setActiveId(null); setThread(null); }} className="md:hidden p-1.5 -ml-1.5 rounded-lg hover:bg-stone-100" aria-label="Back to conversations"><FiArrowLeft /></button>
              <div className="min-w-0">
                <p className="font-semibold text-stone-800 truncate">{active?.with || '…'}</p>
                {active?.product && (
                  side === 'customer'
                    ? <Link href={`/product/${active.product.id}`} className="block text-xs text-wine-700 truncate hover:underline">{active.product.name}</Link>
                    : <p className="text-xs text-stone-500 truncate">{active.product.name}</p>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-stone-50/60" aria-live="polite">
              {!thread ? <p className="text-sm text-stone-400">Loading…</p> : thread.messages.map((m) => (
                <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${m.mine ? 'bg-wine-700 text-white rounded-br-md' : 'bg-white text-stone-800 rounded-bl-md border border-stone-100'}`}>
                    {m.product && (
                      <p className={`text-[11px] mb-1 ${m.mine ? 'text-white/70' : 'text-stone-400'}`}>
                        About: {m.product.name}{m.orderNumber ? ` · Order #${m.orderNumber}` : ''}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                    <p className={`text-[10px] mt-1 text-right ${m.mine ? 'text-white/60' : 'text-stone-400'}`}>{when(m.at)}</p>
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>

            <form onSubmit={send} className="border-t border-stone-100 p-3 flex items-end gap-2">
              <label htmlFor="chat-text" className="sr-only">Message</label>
              <textarea id="chat-text" rows={1} value={text} maxLength={MAX_MESSAGE} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); send(e); } }}
                placeholder="Type a message…" className="flex-1 resize-none max-h-32 px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm outline-none focus:border-wine-700 focus:ring-2 focus:ring-wine-700/15" />
              <button disabled={sending || !text.trim()} className="h-10 w-10 flex items-center justify-center rounded-xl bg-wine-700 text-white disabled:opacity-40" aria-label="Send">
                <FiSend />
              </button>
            </form>
            <p className="px-4 pb-3 text-[11px] text-stone-400 flex items-center gap-1"><FiShield aria-hidden /> Keep payments on Tulsi — phone numbers and links are hidden for your safety.</p>
          </>
        )}
      </div>
    </div>
  );
}
