/* Devices, regions, pages, try-on and browsers for the range. */
import { FiSmartphone, FiMapPin, FiFileText, FiCamera, FiGlobe } from 'react-icons/fi';
import { Card, BreakdownList } from './ui';
import { fmtNum, fmtPct, n0, deviceLabel, osLabel, browserLabel } from './format';

const PAGE_NAMES = { '/': 'Home', '/product/[id]': 'Product pages', '/shop/[category]': 'Category pages', '(other)': 'Other pages' };

const toRows = (rows, labelFor = (r) => r.label) =>
  (Array.isArray(rows) ? rows : []).map((r) => ({
    key: r.key,
    label: labelFor(r),
    share: n0(r.share),
    countText: fmtNum(r.count),
    shareText: fmtPct(r.share),
  }));

function SubHead({ children }) {
  return <h3 className="text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-2.5">{children}</h3>;
}

export default function Breakdowns({ report }) {
  const r = report || {};
  const tryon = r.tryon || {};
  const sub = r.label ? `Sessions · ${r.label}` : 'Sessions';
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Card title="Devices" subtitle={sub} icon={FiSmartphone}>
        <BreakdownList rows={toRows(r.devices, (x) => deviceLabel(x.key))} color="bg-sky-400" />
        {r.os?.length > 0 && (
          <div className="mt-5">
            <SubHead>Operating system</SubHead>
            <BreakdownList rows={toRows(r.os, (x) => osLabel(x.key))} color="bg-sky-400/60" />
          </div>
        )}
      </Card>

      <Card title="Top states / regions" subtitle={sub} icon={FiMapPin}>
        <BreakdownList rows={toRows(r.regions)} color="bg-amber-400" empty="No location data yet" />
      </Card>

      <Card title="Top pages" subtitle={r.label ? `Pageviews · ${r.label}` : 'Pageviews'} icon={FiFileText}>
        <BreakdownList rows={toRows(r.pages, (x) => PAGE_NAMES[x.label] || x.label)} color="bg-teal-400" empty="No pageviews yet" />
      </Card>

      <Card title="Virtual try-on" subtitle={`${fmtNum(tryon.opens)} try-ons opened`} icon={FiCamera}>
        <SubHead>Mode</SubHead>
        <BreakdownList rows={toRows(tryon.modes)} color="bg-fuchsia-400" empty="No try-ons yet" />
        <div className="mt-5">
          <SubHead>Skin tone chosen</SubHead>
          <BreakdownList rows={toRows(tryon.tones)} color="bg-fuchsia-400/60" empty="No skin tones chosen yet" />
        </div>
      </Card>

      <Card title="Browsers" subtitle={sub} icon={FiGlobe}>
        <BreakdownList rows={toRows(r.browsers, (x) => browserLabel(x.key))} color="bg-indigo-400" />
      </Card>
    </div>
  );
}
