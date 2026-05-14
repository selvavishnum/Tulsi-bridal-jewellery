'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

export function TopProgressBar() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const prevPath = useRef(pathname);
  const tickRef = useRef(null);
  const hideRef = useRef(null);

  function startBar() {
    clearInterval(tickRef.current);
    clearTimeout(hideRef.current);
    setVisible(true);
    setProgress(12);
    tickRef.current = setInterval(() => {
      setProgress((p) => {
        if (p >= 82) { clearInterval(tickRef.current); return 82; }
        return p + Math.random() * 10;
      });
    }, 220);
  }

  function completeBar() {
    clearInterval(tickRef.current);
    setProgress(100);
    hideRef.current = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 380);
  }

  // Detect link clicks to start bar immediately
  useEffect(() => {
    function onClick(e) {
      const anchor = e.target.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto') || href.startsWith('tel')) return;
      startBar();
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // Complete bar when navigation finishes
  useEffect(() => {
    if (prevPath.current !== pathname) {
      completeBar();
      prevPath.current = pathname;
    }
  }, [pathname]);

  useEffect(() => () => { clearInterval(tickRef.current); clearTimeout(hideRef.current); }, []);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: `${progress}%`,
        height: '3px',
        zIndex: 99999,
        borderRadius: '0 3px 3px 0',
        boxShadow: '0 0 12px rgba(217,119,6,0.6)',
        background: 'linear-gradient(90deg, #92400e, #b45309, #d97706, #f59e0b, #fbbf24, #d97706)',
        backgroundSize: '200% 100%',
        animation: 'nprogress-shimmer 1.2s linear infinite',
        transition: 'width 0.25s ease',
      }}
    />
  );
}
