'use client';

/* ─────────────────────────────────────────────
   A Marketing-tab card that shows only its name until it is opened.

   Closed: the name, a short status ("3 of 4 visible", "On") and a chevron.
   Click / Enter / Space opens the features. The body is mounted the first
   time it opens and then kept (hidden when closed), so a draft, a preview or
   a save in flight survives closing the section — and a panel that loads its
   own data (the category showcase) does not fetch until it is wanted.

   The wrapped panels draw their own card and heading; the body flattens that
   card and keeps the heading for screen readers only, so the name is shown
   once, in the header.
   ───────────────────────────────────────────── */
import { useId, useState } from 'react';
import { FiChevronDown } from 'react-icons/fi';

/**
 * @param {object} props
 * @param {string} props.title        the section's name (always visible)
 * @param {string} [props.status]     short text next to the name, e.g. "On" or "3 of 4 visible"
 * @param {boolean} [props.dirty]     unsaved changes in this section → a dot with a screen-reader label
 * @param {boolean} [props.defaultOpen=false]
 * @param {boolean} [props.flatten=true]  flatten the wrapped panel's own card (and hide its h2 visually)
 * @param {import('react').ReactNode} props.children
 */
export default function CollapsibleSection({ title, status = '', dirty = false, defaultOpen = false, flatten = true, children }) {
  const uid = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [mounted, setMounted] = useState(defaultOpen);
  const toggle = () => { setMounted(true); setOpen((o) => !o); };
  const headerId = `${uid}-header`;
  const bodyId = `${uid}-body`;

  return (
    <section className="rounded-xl border border-gray-100 bg-white shadow-sm">
      <h2 className="m-0">
        <button
          type="button"
          id={headerId}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={toggle}
          className="flex min-h-14 w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 sm:px-5"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate font-bold text-gray-800">{title}</span>
            {status && <span className="block truncate text-xs font-normal text-gray-500">{status}</span>}
          </span>
          {dirty && (
            <span className="inline-flex flex-shrink-0 items-center gap-1 text-xs font-semibold text-amber-700">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-500" />
              <span className="sr-only">Unsaved changes</span>
            </span>
          )}
          <FiChevronDown
            aria-hidden="true"
            className={`flex-shrink-0 text-lg text-gray-400 transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </h2>
      {mounted && (
        <div
          id={bodyId}
          role="region"
          aria-labelledby={headerId}
          hidden={!open}
          className={flatten
            ? 'border-t border-gray-100 px-4 pb-4 pt-4 sm:px-5 [&>*]:!m-0 [&>*]:!rounded-none [&>*]:!border-0 [&>*]:!bg-transparent [&>*]:!p-0 [&>*]:!shadow-none [&_h2]:sr-only'
            : 'border-t border-gray-100 px-4 pb-4 pt-4 sm:px-5'}
        >
          {children}
        </div>
      )}
    </section>
  );
}
