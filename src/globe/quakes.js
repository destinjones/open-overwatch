// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Earthquakes: USGS M2.5+ in the last 24 h (the feed sends CORS headers, so no relay; parsed by core/quakes.js, like the 2D map's).
// With the clock in the past (time travel), the 24 h before the time shown from the USGS catalogue instead (FDSN event API,
// one UTC day per request, kept for the session; core/history.js), each quake appearing as the clock passes it.
import { C, getJSON, toast } from './env.js';
import { qkPts } from './viewer.js';
import { L, setCount } from './layers.js';
import { hooks, state } from './state.js';
import { Time } from './time.js';
import { parseUsgs, usgsUrl, usgsDataAt, stampQuake } from '../core/quakes.js';
import { stamp, rep } from '../core/liveprov.js';
import { isPast, quakeDays, quakeInWindow, fdsnDayUrl } from '../core/history.js';

const COLOR = C.Color.fromCssColorString('#ff7b4f');
const days = new Map();   // UTC day start -> Promise<quakes> (the catalogue doesn't change for past days)
function day(d) {
  if (!days.has(d)) {
    if (days.size > 14) days.delete(days.keys().next().value);
    days.set(d, getJSON(fdsnDayUrl(d), { timeout: 45000 }).then(doc => parseUsgs(doc), e => { days.delete(d); throw e; }));
  }
  return days.get(d);
}
export const Quakes = {
  list: [], live: [], past: false, pastKey: '', all: [], warned: false,
  async load() {
    const doc = await getJSON(usgsUrl('2.5_day')), dataAt = usgsDataAt(doc);
    this.live = parseUsgs(doc).map(q => stampQuake(q, { dataAt }));   // provenance: USGS at the summary's time (no second catalogue on the globe)
    if (!this.past) this.draw(this.live);
  },
  draw(list) {
    if (state.selected && state.selected.kind === 'quake' && !list.some(q => q.id === state.selected.id)) hooks.closeCard?.();   // a quake from another time
    qkPts.removeAll(); this.all = list; this.list = list;
    for (const q of list) {
      q.kind = 'quake'; q.mag = q.mag ?? 0;
      if (!q.prov) stamp(q, 'history', [rep('usgs', { name: 'USGS catalogue (FDSN)', dataAt: q.updated ?? q.time })]);   // time travel: a catalogue record
      q.pt = qkPts.add({ position: C.Cartesian3.fromDegrees(q.lon, q.lat, 0), pixelSize: 4 + q.mag * 2.2, color: COLOR.withAlpha(0.75), outlineColor: COLOR, outlineWidth: 1, id: q, show: L.quakes.on, disableDepthTestDistance: 0 });
    }
    setCount('quakes', list.length); hooks.updateStats();
  },
  /** Follow the clock: the live feed now, the catalogue in the past (called on every clock change and every second). */
  async sync() {
    const ms = Time.nowMs();
    if (!isPast(ms)) {
      if (this.past) { this.past = false; this.pastKey = ''; this.draw(this.live); hooks.historyChanged?.(); }
      return;
    }
    if (!this.past) { this.past = true; this.draw([]); }
    if (!L.quakes.on) return;   // no catalogue requests for a layer that is off
    const want = quakeDays(ms), key = want.join(',');
    if (key !== this.pastKey) {
      this.pastKey = key; this.loading = true; hooks.historyChanged?.();
      try {
        const lists = await Promise.all(want.map(day));
        if (this.pastKey !== key || !this.past) return;   // the clock moved on meanwhile
        const seen = new Set(); this.draw(lists.flat().filter(q => !seen.has(q.id) && seen.add(q.id)));
      } catch (e) {
        console.warn('quake catalogue', e); this.pastKey = '';
        if (!this.warned) { this.warned = true; toast('The USGS earthquake catalogue could not be reached; retrying', 3500); }
        return;
      } finally { this.loading = false; }
    }
    // the 24 h before the time shown: points come and go as the clock moves
    let n = 0; const shown = [];
    for (const q of this.all) { const on = quakeInWindow(q, ms); if (q.pt.show !== (on && L.quakes.on)) q.pt.show = on && L.quakes.on; if (on) { n++; shown.push(q); } }
    if (n !== this.list.length) { this.list = shown; setCount('quakes', n); hooks.updateStats(); hooks.historyChanged?.(); }
  },
};
