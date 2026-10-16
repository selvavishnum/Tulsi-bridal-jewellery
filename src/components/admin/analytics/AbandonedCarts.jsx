/* Today's abandoned carts (idle 30+ min, no order), highest value first. */
import { FiShoppingCart } from 'react-icons/fi';
import { Card, Empty, Pill } from './ui';
import { fmtNum, fmtINR, timeAgo, channelColor, place, n0 } from './format';

function Who({ c }) {
  return c.registered ? (
    <span className="flex items-center gap-2 min-w-0">
      <span className="text-slate-100 text-sm font-medium truncate">{c.name || 'Customer'}</span>
      <Pill className="bg-amber-500/15 text-amber-300 ring-amber-400/30">Customer</Pill>
    </span>
  ) : (
    <Pill className="bg-white/[0.04] text-slate-300 ring-white/10">Guest</Pill>
  );
}

function Channel({ c }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-slate-300 text-sm min-w-0">
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: channelColor(c.channel) }} aria-hidden="true" />
      <span className="truncate">{c.channelLabel || 'Direct'}</span>
    </span>
  );
}

const items = (c) => `${fmtNum(c.cartItems)} ${n0(c.cartItems) === 1 ? 'item' : 'items'}`;
const TH = 'font-medium text-[11px] uppercase tracking-wider text-slate-500 px-3 py-2 whitespace-nowrap';

export default function AbandonedCarts({ live }) {
  const carts = live?.carts || {};
  const rows = Array.isArray(carts.recent) ? carts.recent : [];
  const ref = live?.generatedAt;

  return (
    <Card
      title="Abandoned carts today"
      subtitle="Idle for 30+ minutes without an order · highest value first"
      icon={FiShoppingCart}
      action={rows.length > 0 && <span className="text-xs text-slate-400 tabular-nums">{fmtNum(carts.abandoned)} {n0(carts.abandoned) === 1 ? 'cart' : 'carts'} · {fmtINR(carts.abandonedValue)}</span>}
    >
      {rows.length === 0 ? (
        <Empty>No abandoned carts today</Empty>
      ) : (
        <>
          <ul className="sm:hidden divide-y divide-white/[0.05]">
            {rows.map((c, i) => (
              <li key={c.sid || i} className="py-3 space-y-1.5">
                <div className="flex items-start justify-between gap-3">
                  <Who c={c} />
                  <span className="text-slate-100 text-sm font-semibold tabular-nums whitespace-nowrap">{fmtINR(c.cartValue)}</span>
                </div>
                <p className="text-slate-400 text-xs">{items(c)} · {place(c)}</p>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <Channel c={c} />
                  <span className="text-slate-500 whitespace-nowrap">{timeAgo(c.lastSeenAt, ref)}</span>
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden sm:block overflow-x-auto -mx-5 px-5">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-white/[0.06]">
                <tr>
                  <th scope="col" className={`${TH} text-left`}>Who</th>
                  <th scope="col" className={`${TH} text-left`}>City</th>
                  <th scope="col" className={`${TH} text-right`}>Items</th>
                  <th scope="col" className={`${TH} text-right`}>Value</th>
                  <th scope="col" className={`${TH} text-left`}>Last seen</th>
                  <th scope="col" className={`${TH} text-left`}>Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {rows.map((c, i) => (
                  <tr key={c.sid || i} className="hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5 max-w-[220px]"><Who c={c} /></td>
                    <td className="px-3 py-2.5 text-slate-300 max-w-[200px]"><span className="block truncate" title={place(c)}>{place(c)}</span></td>
                    <td className="px-3 py-2.5 text-right text-slate-300 tabular-nums">{fmtNum(c.cartItems)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-100 font-semibold tabular-nums whitespace-nowrap">{fmtINR(c.cartValue)}</td>
                    <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">{timeAgo(c.lastSeenAt, ref)}</td>
                    <td className="px-3 py-2.5 max-w-[160px]"><Channel c={c} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
