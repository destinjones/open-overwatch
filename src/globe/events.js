// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Natural events from NASA EONET (CORS, keyless): wildfires, volcanic eruptions, floods, sea and lake ice, dust, drought...
// (storms are the cyclone layer's). Live: the events open in the last 20 days. With the clock in the past (time travel):
// the events going on at the time shown, open or since closed (core/history.js), each where it was then.
import { C, esc, getJSON } from './env.js';
import { scene } from './viewer.js';
import { L, setCount } from './layers.js';
import { hooks, state } from './state.js';
import { Time } from './time.js';
import { parseEonet, eonetUrl, EONET_COLOR } from '../core/eonet.js';
import { stamp, rep } from '../core/liveprov.js';
import { isPast, utcDay, eonetAtUrl, eventActiveAt, trackAt } from '../core/history.js';

const pts = scene.primitives.add(new C.PointPrimitiveCollection());
const pastDays = new Map();   // UTC day -> Promise<events around it>
const day = d => new Date(d).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

function card(e) {
  const col = EONET_COLOR[e.cat] || '#e3e3e3', links = [e.link ? { text: 'EONET event', url: e.link } : null, ...e.sources.map(s => ({ text: 'Source: ' + s.id, url: s.url }))].filter(l => l && /^https:\/\//.test(l.url));
  const row = (k, v) => v ? `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>` : '';
  return `<div class="k" style="--c:${col}">${esc(e.cats.join(', ') || 'Natural event')} · NASA EONET</div><h2>${esc(e.title)}</h2>
    <dl>${row('First seen', e.first ? day(e.first) : '')}${row('Last update', e.date ? day(e.date) : '')}${row('Closed', e.closed ? day(e.closed) : 'still open')}${row('Size', e.mag)}
    ${row('Position', `${Math.abs(e.lat).toFixed(2)}°${e.lat >= 0 ? 'N' : 'S'} ${Math.abs(e.lon).toFixed(2)}°${e.lon >= 0 ? 'E' : 'W'}`)}</dl>
    ${links.length ? `<div class="acts">${links.slice(0, 4).map(l => `<a class="chipbtn" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.text)}</a>`).join('')}</div>` : ''}
    <div class="note" style="margin-top:8px">${e.then ? 'Going on at the time shown (time travel). ' : ''}EONET lists events reported by NASA and partner agencies; it is not a complete record.</div>`;
}

export const Events = {
  list: [], live: null, past: false, pastDay: '', loading: null,
  load() {   // live: when the layer first goes on, then every 30 minutes while it is on (main.js)
    if (!this.loading) this.loading = getJSON(eonetUrl({ days: 20 }), { timeout: 30000 }).then(d => { this.live = parseEonet(d).filter(e => e.cat !== 'severeStorms'); if (!this.past) this.draw(this.live); })
      .catch(e => { console.warn('natural events', e); }).finally(() => { this.loading = null; });
    return this.loading;
  },
  draw(list) {
    const sel = state.selected && this.list.includes(state.selected) ? state.selected : null;
    pts.removeAll(); this.list = list;
    for (const e of list) {
      if (!e.prov) stamp(e, this.past ? 'history' : 'events', [rep('eonet', { dataAt: e.date })]);
      e.kind = 'event'; e.tip = () => `${e.title} · ${e.cats[0] || 'event'}`; e.cardHtml = () => card(e);
      const c = C.Color.fromCssColorString(EONET_COLOR[e.cat] || '#e3e3e3');
      e.pt = pts.add({ position: C.Cartesian3.fromDegrees(e.lon, e.lat, 0), pixelSize: 8, color: c.withAlpha(0.85), outlineColor: C.Color.BLACK.withAlpha(0.55), outlineWidth: 1.5, id: e, disableDepthTestDistance: 0 });
    }
    setCount('events', list.length); hooks.historyChanged?.();
    if (sel) { const same = list.find(e => e.id === sel.id); if (same) hooks.reselect?.(same); else hooks.closeCard?.(); }
  },
  async sync() {
    const ms = Time.nowMs();
    if (!isPast(ms)) { if (this.past) { this.past = false; this.pastDay = ''; this.draw(this.live || []); } return; }
    if (!this.past) { this.past = true; this.draw([]); }
    if (!L.events.on) return;
    const d = utcDay(ms);
    if (d === this.pastDay) return;
    this.pastDay = d;
    if (!pastDays.has(d)) {
      if (pastDays.size > 10) pastDays.delete(pastDays.keys().next().value);
      pastDays.set(d, getJSON(eonetAtUrl(Date.parse(d + 'T12:00:00Z'), { before: 30 }), { timeout: 30000 }).then(parseEonet).catch(e => { pastDays.delete(d); throw e; }));
    }
    try {
      const at = Date.parse(d + 'T23:59:59Z'), evs = await pastDays.get(d);
      if (this.pastDay !== d) return;
      this.draw(evs.filter(e => e.cat !== 'severeStorms' && eventActiveAt(e, at)).map(e => {   // where it was that day (moving ice drifts)
        const p = e.track.length > 1 ? trackAt(e.track, at, { holdMs: Infinity }) : null;
        return { ...e, ...(p ? { lat: p.lat, lon: p.lon } : {}), then: true };
      }));
    } catch (e) { console.warn('natural events (past)', e); this.pastDay = ''; }
  },
  apply() { pts.show = L.events.on && !state.lookup; if (L.events.on && !this.past && !this.live && !this.loading) this.load(); scene.requestRender(); },
};
