'use client';

import { useState, useEffect } from 'react';
import { FiMail, FiPhone, FiTrash2, FiSearch, FiX, FiInbox, FiCheckCircle } from 'react-icons/fi';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

export default function AdminMessagesPage() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter]     = useState('all'); // all | unread | read
  const [search, setSearch]     = useState('');

  async function fetchMessages() {
    try {
      const res = await fetch('/api/contact');
      const data = await res.json();
      if (data.success) setMessages(data.data);
    } finally { setLoading(false); }
  }

  useEffect(() => { fetchMessages(); }, []);

  async function markRead(msg, read) {
    await fetch(`/api/contact/${msg.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read }),
    });
    setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, read } : m));
    if (selected?.id === msg.id) setSelected({ ...msg, read });
  }

  async function deleteMessage(id) {
    if (!confirm('Delete this message?')) return;
    await fetch(`/api/contact/${id}`, { method: 'DELETE' });
    toast.success('Message deleted');
    setMessages((prev) => prev.filter((m) => m.id !== id));
    if (selected?.id === id) setSelected(null);
  }

  function openMessage(msg) {
    setSelected(msg);
    if (!msg.read) markRead(msg, true);
  }

  const filtered = messages.filter((m) => {
    if (filter === 'unread' && m.read) return false;
    if (filter === 'read' && !m.read) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return m.name?.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q) || m.subject?.toLowerCase().includes(q) || m.message?.toLowerCase().includes(q);
    }
    return true;
  });

  const unreadCount = messages.filter((m) => !m.read).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Customer Messages</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {unreadCount > 0 ? <span className="text-maroon-700 font-semibold">{unreadCount} unread</span> : 'All messages read'} · {messages.length} total
          </p>
        </div>
      </div>

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, subject…"
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400 bg-white"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <FiX className="text-sm" />
            </button>
          )}
        </div>
        <div className="flex gap-1.5">
          {[['all', 'All'], ['unread', 'Unread'], ['read', 'Read']].map(([val, lbl]) => (
            <button
              key={val}
              onClick={() => setFilter(val)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition ${filter === val ? 'bg-maroon-950 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              {lbl}{val === 'unread' && unreadCount > 0 && <span className="ml-1.5 bg-red-500 text-white text-xs rounded-full px-1.5">{unreadCount}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        {/* Message list */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-300">
              <FiInbox className="text-5xl mb-3" />
              <p className="text-sm font-medium">No messages</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {filtered.map((m) => (
                <button
                  key={m.id}
                  onClick={() => openMessage(m)}
                  className={`w-full text-left px-4 py-3.5 hover:bg-gray-50 transition ${selected?.id === m.id ? 'bg-gold-50/60 border-l-4 border-maroon-950' : 'border-l-4 border-transparent'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {!m.read && <span className="w-2 h-2 rounded-full bg-maroon-700 flex-shrink-0 mt-1" />}
                      <div className="min-w-0">
                        <p className={`text-sm truncate ${!m.read ? 'font-bold text-gray-800' : 'font-medium text-gray-700'}`}>{m.name}</p>
                        <p className="text-xs text-gray-400 truncate">{m.subject || m.email}</p>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 flex-shrink-0">
                      {m.createdAt ? format(new Date(m.createdAt), 'dd MMM') : '—'}
                    </p>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 line-clamp-1 pl-4">{m.message}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Message detail */}
        <div className="lg:col-span-3">
          {selected ? (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              {/* Detail header */}
              <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-bold text-gray-800">{selected.name}</h2>
                  <p className="text-xs text-gray-400 mt-0.5">{selected.createdAt ? format(new Date(selected.createdAt), 'dd MMM yyyy, hh:mm a') : '—'}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => markRead(selected, !selected.read)}
                    className="text-xs text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-2.5 py-1.5 rounded-lg transition flex items-center gap-1"
                  >
                    <FiCheckCircle className="text-xs" /> {selected.read ? 'Mark Unread' : 'Mark Read'}
                  </button>
                  <button
                    onClick={() => deleteMessage(selected.id)}
                    className="text-xs text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition flex items-center gap-1"
                  >
                    <FiTrash2 className="text-xs" /> Delete
                  </button>
                </div>
              </div>

              {/* Contact info */}
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex flex-wrap gap-4">
                <a href={`mailto:${selected.email}`} className="flex items-center gap-1.5 text-sm text-maroon-700 hover:underline">
                  <FiMail className="text-xs" /> {selected.email}
                </a>
                {selected.phone && (
                  <a href={`tel:${selected.phone}`} className="flex items-center gap-1.5 text-sm text-maroon-700 hover:underline">
                    <FiPhone className="text-xs" /> {selected.phone}
                  </a>
                )}
              </div>

              {/* Subject */}
              {selected.subject && (
                <div className="px-5 pt-4">
                  <p className="text-xs text-gray-400 uppercase tracking-wider font-bold mb-1">Subject</p>
                  <p className="text-sm font-semibold text-gray-800">{selected.subject}</p>
                </div>
              )}

              {/* Message body */}
              <div className="px-5 py-4">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-bold mb-2">Message</p>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{selected.message}</p>
              </div>

              {/* Quick reply */}
              <div className="px-5 py-4 border-t border-gray-100 bg-gold-50/40">
                <a
                  href={`mailto:${selected.email}?subject=Re: ${encodeURIComponent(selected.subject || 'Your enquiry - Tulsi Bridal Jewellery')}`}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-maroon-950 text-white text-sm font-semibold rounded-xl hover:bg-maroon-900 transition"
                >
                  <FiMail /> Reply via Email
                </a>
                {selected.phone && (
                  <a
                    href={`https://wa.me/91${selected.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi ${selected.name}! Thank you for contacting Tulsi Bridal Jewellery.`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 inline-flex items-center gap-2 px-4 py-2 bg-green-500 text-white text-sm font-semibold rounded-xl hover:bg-green-400 transition"
                  >
                    <FiPhone /> WhatsApp
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm flex flex-col items-center justify-center py-20 text-gray-300">
              <FiMail className="text-6xl mb-4" />
              <p className="text-sm font-medium">Select a message to read</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
