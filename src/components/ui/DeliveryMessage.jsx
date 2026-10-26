/* The "Free Delivery across India" message, drawn the way the owner chose it
   (Admin → Settings → Marketing → Delivery message): the icon and the words,
   in the chosen model (plain, pill, outline, solid, underline), font and colours.

   One component for the storefront AND the admin's live preview, so what the
   owner sees there is what a customer gets. No hooks and no 'use client': it
   renders on the server and in the browser alike, and with the default
   configuration it is today's markup on every surface, byte for byte: the
   strip's clause and the hero badge are bare words (the strip's second state
   not even wrapped), and the product page's cell is `<svg/> <span>words</span>`
   like the other cells of its list.

   Props
     text       the words (from deliveryMessageFor — '' draws nothing). Always rendered as text, never as markup.
     config     settings.deliveryMessage, any shape (normalized here; undefined = the defaults)
     surface    'bar'     the announcement strip's clause (its words, then the icon)
                'tagline' the same clause in the strip's second state (no icon; runs on in the tagline's line)
                'badge'   a hero trust badge (draw it as the list item: as="li")
                'product' a cell of the product page's trust list (it is the whole grid cell: a row with its own icon)
     as         'span' | 'div' | 'li' | 'p' — the element (default: div for 'product', span otherwise)
     className  layout classes of the caller, put in front of ours (the strip: "hidden min-[820px]:block")

   Heights: on 'bar', 'tagline' and 'badge' every model is at most 24px (h-6), inside the strip's fixed 32px row
   and the badge's fixed 24px row. The one exception is a text longer than WRAP_AFTER characters on 'badge', which
   wraps rather than being cut off on a phone. */
import { FiTruck } from 'react-icons/fi';
import { resolveMessageStyle, WRAP_AFTER } from './deliveryMessageStyle';

const TAGS = { span: 'span', div: 'div', li: 'li', p: 'p' };
const DEFAULT_TAG = { bar: 'span', tagline: 'span', badge: 'span', product: 'div' };
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/**
 * @param {{ text?: string, config?: unknown, surface?: 'bar'|'tagline'|'badge'|'product', as?: 'span'|'div'|'li'|'p', className?: string }} props
 */
export default function DeliveryMessage({ text, config, surface = 'bar', as, className = '' }) {
  const words = typeof text === 'string' ? text.trim() : '';
  if (!words) return null;

  const s = resolveMessageStyle(config, surface, { long: words.length > WRAP_AFTER });
  /* An unknown surface is drawn as a product-page cell (as resolveMessageStyle does). */
  const kind = typeof surface === 'string' && has(DEFAULT_TAG, surface) ? surface : 'product';
  const Tag = typeof as === 'string' && has(TAGS, as) ? TAGS[as] : DEFAULT_TAG[kind];
  const classes = [typeof className === 'string' ? className : '', s.wrapperClass].filter(Boolean).join(' ');

  /* The product page's own truck is a bare line icon, as its list's other cells have (the emoji ones are decoration, hidden). */
  let icon = null;
  if (s.iconKind === 'line') icon = <FiTruck className={s.iconClass} />;
  else if (s.iconKind === 'emoji') icon = <span aria-hidden="true" className={s.iconClass || undefined}>{s.icon}</span>;

  const isProduct = kind === 'product';
  const wrapperStyle = Object.keys(s.wrapperStyle).length ? s.wrapperStyle : undefined;
  /* Bare words, unless the look needs an element for them: the underline accent, or (the product list) its `<span>`. */
  const label = s.textClass || isProduct ? <span className={s.textClass || undefined}>{words}</span> : words;

  /* Nothing to put on the words (no classes, no inline style, no icon) and no element asked for: they are just words,
     so they sit in the caller's line as they always did (the strip's second state). */
  if (!classes && !wrapperStyle && !icon && typeof as !== 'string' && typeof label === 'string') return label;

  return (
    <Tag className={classes || undefined} style={wrapperStyle}>
      {s.iconAfter ? <>{label}{icon && ' '}{icon}</> : <>{icon}{isProduct && icon && ' '}{label}</>}
    </Tag>
  );
}
