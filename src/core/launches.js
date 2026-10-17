// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Rocket launches from The Space Devs' Launch Library 2 (the site build keeps a trimmed copy in data/launches.json; a page
// without it asks the API directly). One mapping for both, so the build only trims and never reshapes. DOM-free.

const https = u => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null);
const num = v => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

/** One LL2 launch (any response mode) -> { id, name, mission, type, desc, orbit, rocket, provider, net, windowStart, windowEnd,
 *  precision, status, statusName, pad, place, country, lat, lon, prob, live, webcasts: [{ url, title }] } or null without a pad. */
export function fromLL2(r) {
  if (!r || !r.pad) return null;
  const lat = num(r.pad.latitude), lon = num(r.pad.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const m = r.mission || {}, cfg = (r.rocket && r.rocket.configuration) || {}, t = s => (s ? Date.parse(s) : NaN);
  const vids = (r.vid_urls || []).slice().sort((a, b) => (b.priority || 0) - (a.priority || 0))
    .map(v => ({ url: https(v.url), title: String(v.title || v.publisher || 'Webcast').slice(0, 120) })).filter(v => v.url).slice(0, 3);
  return {
    id: String(r.id || ''), name: String(r.name || ''), mission: String(m.name || r.name || '').slice(0, 140), type: String(m.type || ''),
    desc: String(m.description || '').replace(/\s+/g, ' ').trim().slice(0, 600), orbit: (m.orbit && (m.orbit.name || m.orbit.abbrev)) || '',
    rocket: String(cfg.full_name || cfg.name || (r.name || '').split('|')[0]).trim(), provider: String((r.launch_service_provider && r.launch_service_provider.name) || ''),
    net: t(r.net), windowStart: t(r.window_start), windowEnd: t(r.window_end), updated: Number.isFinite(t(r.last_updated)) ? t(r.last_updated) : null,
    precision: (r.net_precision && (r.net_precision.abbrev || r.net_precision.name)) || '', status: (r.status && r.status.abbrev) || '', statusName: (r.status && r.status.name) || '',
    pad: String(r.pad.name || ''), place: String((r.pad.location && r.pad.location.name) || ''), country: (r.pad.country && r.pad.country.alpha_2_code) || '',
    lat, lon, prob: Number.isFinite(num(r.probability)) ? num(r.probability) : null, live: !!r.webcast_live, webcasts: vids,
  };
}

/** How sure the time is, in words (LL2's precision codes). */
export function when(l, fmt = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC') {
  const p = String(l.precision).toUpperCase();
  if (!Number.isFinite(l.net)) return 'Date not set';
  if (['SEC', 'MIN', 'HR', 'SECOND', 'MINUTE', 'HOUR'].includes(p) || !p) return fmt(l.net);
  const d = new Date(l.net);
  if (p === 'DAY') return d.toISOString().slice(0, 10) + ' (time not set)';
  if (p === 'M' || p === 'MONTH') return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) + ' (no date yet)';
  if (/^Q[1-4]$/.test(p) || /^H[12]$/.test(p)) return `${p} ${d.getUTCFullYear()} (no date yet)`;
  return d.getUTCFullYear() + ' (no date yet)';
}

/** "T-2 d 04:10:22", "T-00:04:59", or "T+00:01:12" (counting up after lift-off). */
export function countdown(net, now) {
  if (!Number.isFinite(net)) return '';
  const s = Math.round((net - now) / 1000), a = Math.abs(s), d = Math.floor(a / 86400), h = Math.floor(a / 3600) % 24, m = Math.floor(a / 60) % 60, x = a % 60;
  const hms = [h, m, x].map(v => String(v).padStart(2, '0')).join(':');
  return `T${s >= 0 ? '-' : '+'}${d ? d + ' d ' : ''}${hms}`;
}

/** LL2's precision (its abbrev, or its name: 'DAY' / 'Day', 'Q4' / 'Quarter 4', 'M' / 'Month') as one upper-case code:
 *  SEC MIN HR AM PM DAY WK M Q1-Q4 H1 H2 Y FY DEC, or '' when not given. */
export function precisionCode(p) {
  const s = String(p || '').trim().toUpperCase();
  const q = /^(?:QUARTER|Q) ?([1-4])$/.exec(s), h = /^(?:HALF|H) ?([12])$/.exec(s);
  if (q) return 'Q' + q[1];
  if (h) return 'H' + h[1];
  return { SECOND: 'SEC', MINUTE: 'MIN', HOUR: 'HR', D: 'DAY', W: 'WK', WEEK: 'WK', MONTH: 'M', YEAR: 'Y', 'FISCAL YEAR': 'FY', DECADE: 'DEC', MORNING: 'AM', AFTERNOON: 'PM' }[s] || s;
}

/** The end (ms, UTC) of the period a not-yet-precise launch time names: the end of its UTC day (DAY, AM, PM), a week on
 *  (WK), or the end of its month, quarter, half, year or decade. LL2 dates such a launch inside that period (a "NET
 *  October" launch at 31 October 00:00Z), so it is still due until the period is over. null for a time to the hour or
 *  better, an unknown code or no time. */
export function periodEnd(net, precision) {
  if (!Number.isFinite(net)) return null;
  const d = new Date(net), y = d.getUTCFullYear(), m = d.getUTCMonth(), day = Date.UTC(y, m, d.getUTCDate() + 1);
  const c = precisionCode(precision);
  if (c === 'DAY' || c === 'AM' || c === 'PM') return day;
  if (c === 'WK') return day + 6 * 864e5;
  if (c === 'M') return Date.UTC(y, m + 1, 1);
  if (/^Q[1-4]$/.test(c)) return Date.UTC(y, Math.floor(m / 3) * 3 + 3, 1);
  if (/^H[12]$/.test(c)) return Date.UTC(y, m < 6 ? 6 : 12, 1);
  if (c === 'Y' || c === 'FY') return Date.UTC(y + 1, 0, 1);
  if (c === 'DEC') return Date.UTC(Math.floor(y / 10) * 10 + 10, 0, 1);
  return null;
}

/** Until when (ms) a launch belongs on an "upcoming" list: `grace` after its time, or to the end of the period an
 *  imprecise time names (periodEnd), whichever is later. */
export const listedUntil = (net, precision, grace) => Math.max(net + grace, periodEnd(net, precision) ?? -Infinity);

/** Upcoming first; a launch stays listed for 2 hours after its time, to the end of the day, month or quarter an
 *  imprecise time names (periodEnd), or while marked in flight. */
export function upcoming(list, now) {
  return list.filter(l => l && (l.status === 'In Flight' || !Number.isFinite(l.net) || listedUntil(l.net, l.precision, 2 * 3600e3) > now)).sort((a, b) => (a.net || Infinity) - (b.net || Infinity));
}
