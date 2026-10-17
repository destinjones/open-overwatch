// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Re-entries on the 2D map, as on the globe's "Falling soon": objects predicted to come down in the next 30 days, worked out
// here from CelesTrak element sets (core/decay.js). A dot where each is at its likeliest time, its likeliest orbit as a line
// (±45 min), and a card with the window in plain words, why it is that wide and the provenance block (the detail panel adds it). The groups are read
// through the shared TLE source (the site's copy first on the website) whatever satellite groups the Satellites layer shows.
import { esc, fmt } from './util.js';
import { vecRenderer } from './mapview.js';
import { Layers, Points, feed } from './engine.js';
import { Detail } from './detail.js';
import { lineLayer } from './feeds.js';
import { Sats } from './satellites.js';
import { fallingSoon, corridor, windowWords, whereWords, uncertaintyWords, spanText, status, WINDOW_FRACTION } from '../core/decay.js';
import { num } from '../core/format.js';

const GROUPS = ['stations', 'active', 'cosmos-2251-debris', 'iridium-33-debris', 'fengyun-1c-debris'];
const RED = '#ff5a4f', NEAR_MS = 45 * 60e3, KEEP_MS = 2 * 3600e3;
const texts = new Map();   // group -> { t, txt }: kept 2 h here too, so a full browser storage never means downloading again
const WINDOWS = `windows usually ±${Math.round(WINDOW_FRACTION * 100)}% of the time left, wider when the two drag estimates disagree`;   // as the cards say (core/decay.js)

export const lyReentry = Layers.add({ id: 'reentry', group: 'Space', name: 'Re-entries (next 30 days)', desc: `Predicted here from CelesTrak element sets: n-dot and drag through a solar-scaled atmosphere · ${WINDOWS} · the line is each object's likeliest orbit`, color: RED, shape: 'round', default: false, points: 'reentry' });
export const gReentry = lineLayer(lyReentry); Points.define('reentry', 'reentry');

const when = (p, now) => { const d = (p.reentryMs - now) / 864e5; return status(p, now) === 'window' ? 'window open now' : 'in ' + spanText(d); };
Detail.renderers.reentry = p => {
  const now = Date.now(), c = p.corridor;
  return `<div class="det">${Detail.head(RED, `Re-entry · ${when(p, now)}`, p.name, esc(`NORAD ${p.id}${p.group ? ' · ' + p.group : ''}`))}
<p style="font-size:13px;line-height:1.45">Coming down ${esc(whereWords(p, c))}.</p>
${Detail.kv([['Likeliest', new Date(p.reentryMs).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'], ['Window', `±${Math.round(p.fraction * 100)}% · ${spanText((p.windowMs[1] - p.windowMs[0]) / 864e5)}`],
    ['Orbit now', `${Math.round(p.perigeeKm)} × ${Math.round(p.apogeeKm)} km · ${p.incl.toFixed(1)}°`], ['Drag', `${p.ballistic.toFixed(4)} m²/kg (${p.method})`]])}
<p style="font-size:12px;color:var(--ink-dim);line-height:1.45">Why so wide: ${esc(uncertaintyWords(p))}${p.working ? ' A satellite in service: if it still has fuel, its operator can keep it up or bring it down on purpose.' : ''} Solar flux assumed F10.7 ${p.solar.f107} sfu.</p>
<div class="actions"><button class="btn small" data-do="fly" data-lat="${num(p.at.lat)}" data-lon="${num(p.at.lon)}" data-z="3">Center</button></div></div>`;
};

async function groupText(g) {
  const k = texts.get(g);
  if (k && Date.now() - k.t < KEEP_MS) return k;
  const txt = await Sats.loadGroup(g), v = { t: Date.now(), txt, source: Sats.srcOf?.[g] };
  texts.set(g, v); return v;
}

feed(lyReentry, { interval: 1800, fetch: async () => {
  const sats = [], failed = [];
  for (const g of GROUPS) {
    try { const { txt, source } = await groupText(g); for (const t of Sats.parse(txt, g)) sats.push({ id: String(t.id), name: t.name, l1: t.l1, l2: t.l2, group: g, source }); }
    catch (e) { failed.push(g); }
  }
  if (!sats.length) throw new Error('No satellite element sets could be loaded' + (failed.length ? ' (' + failed.join(', ') + ')' : ''));
  const now = Date.now(), list = fallingSoon(sats, { now });
  gReentry.clearLayers(); const items = [];
  for (const p of list) {
    p.corridor = corridor(p);
    const pts = (p.corridor?.segments || []).flat();
    if (!pts.length) continue;
    p.at = pts.reduce((a, b) => (Math.abs(b.t - p.reentryMs) < Math.abs(a.t - p.reentryMs) ? b : a));
    for (const seg of p.corridor.segments) {
      const near = seg.filter(q => Math.abs(q.t - p.reentryMs) <= NEAR_MS);
      if (near.length > 1) L.polyline(near.map(q => [q.lat, q.lon]), { color: RED, weight: 1.4, opacity: .55, interactive: false, renderer: vecRenderer }).addTo(gReentry);
    }
    items.push({ lat: p.at.lat, lon: p.at.lon, r: 4, color: RED, fillAlpha: .9, stroke: true, kind: 'reentry', obj: p, tip: `${p.name} · ${when(p, now)} · ${windowWords(p)}` });
  }
  Points.set('reentry', items); lyReentry.feed.count = items.length;
  lyReentry.desc = `${items.length} objects predicted to re-enter in the next 30 days (of ${fmt.n(sats.length)} in the loaded groups) · ${WINDOWS} · the line is each one's likeliest orbit`;
} });
