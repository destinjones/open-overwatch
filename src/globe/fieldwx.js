// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Airport weather from the reports pilots read: the latest METAR and TAF for a field, decoded into plain words on its
// card (core/metar.js), and the airport dots in view coloured by flight category (green VFR, blue MVFR, red IFR,
// magenta LIFR). The reports come from the Aviation Weather Center's data API (aviationweather.gov, US NOAA/NWS), which
// sends no CORS headers: browsers refuse it on the website, so this works in the download version, whose local helper
// (serve.js / serve.py) relays it. The website keeps the model weather (Open-Meteo, labelled estimated) on the cards.
// AWC asks for no more than 100 requests a minute; this makes a few: one per ~60 fields in view every 10 minutes, and
// one METAR + one TAF per card opened (cached 10 minutes).
import { C, getJSON, RELAY } from './env.js';
import { camera, camHeight } from './viewer.js';
import { L } from './layers.js';
import { readAwcMetars, readAwcTafs, metarUrl, tafUrl, idBatches, CAT_COLOR } from '../core/metar.js';

const FRESH_MS = 10 * 60e3, MISSING_MS = 30 * 60e3, VIEW_KM = 2.5e6, MAX_VIEW = 180;
const COLORS = Object.fromEntries(Object.entries(CAT_COLOR).map(([k, v]) => [k, C.Color.fromCssColorString(v)]));

export const FieldWx = {
  available: !!RELAY,           // the download version
  airports: null,               // the airport list (airports.js sets it)
  metars: new Map(),            // icao -> { t (fetched), r (parsed METAR) | null }
  tafs: new Map(),              // icao -> { t, taf | null }
  busy: false, backoff: 0, coloured: new Set(),
  fresh(m, icao) { const c = m.get(icao); return c && Date.now() - c.t < (c.r === null || c.taf === null ? MISSING_MS : FRESH_MS); },
  async fetchMetars(ids) {
    const want = ids.filter(id => !this.fresh(this.metars, id));
    for (const batch of idBatches(want, 60)) {
      const got = readAwcMetars(await getJSON(metarUrl(batch), { relay: true, timeout: 15000 })), now = Date.now();
      for (const id of batch) this.metars.set(id, { t: now, r: got.get(id) || null });
    }
  },
  /** The latest METAR for a field, parsed (or null when it has none or the reports can't be read here). */
  async metar(icao) {
    if (!this.available || !icao) return null;
    if (!this.fresh(this.metars, icao)) await this.fetchMetars([icao]);
    this.paint(icao);
    return this.metars.get(icao)?.r || null;
  },
  /** The latest TAF for a field, parsed, or null (only fields with a forecast office's TAF have one). */
  async taf(icao) {
    if (!this.available || !icao) return null;
    if (!this.fresh(this.tafs, icao)) {
      const got = readAwcTafs(await getJSON(tafUrl([icao]), { relay: true, timeout: 15000 }));
      this.tafs.set(icao, { t: Date.now(), taf: got.get(icao) || null });
    }
    return this.tafs.get(icao)?.taf || null;
  },
  /** The flight category a field's METAR gives, if we have it. */
  cat(icao) { return this.metars.get(icao)?.r?.category || null; },
  /** Colour one airport's dot by its category (or back to the default). */
  paint(icao) {
    const a = this.airports && this.airports.get(icao); if (!a || !a.pt) return;
    const cat = this.cat(icao), base = a.baseColor || a.pt.color;
    if (!a.baseColor) a.baseColor = C.Color.clone(a.pt.color);
    a.pt.color = cat ? COLORS[cat].withAlpha(0.95) : base;
    a.pt.pixelSize = cat ? (a.size === 2 ? 7 : 5) : (a.size === 2 ? 6 : 4);
    if (cat) this.coloured.add(icao); else this.coloured.delete(icao);
  },
  /** Fetch and colour the fields in view (when the airports layer is on and the camera is low enough to see dots). */
  async view() {
    if (!this.available || !this.airports || !L.airports.on || this.busy || Date.now() < this.backoff || document.hidden || camHeight() > VIEW_KM) return;
    const r = camera.computeViewRectangle(); if (!r) return;
    const D = 180 / Math.PI, list = this.airports.inBox(r.south * D, r.west * D, r.north * D, r.east * D, MAX_VIEW);
    const ids = list.map(a => a.icao).filter(id => /^[A-Z]{4}$/.test(id));
    if (!ids.some(id => !this.fresh(this.metars, id))) return;
    this.busy = true;
    try { await this.fetchMetars(ids); for (const id of ids) this.paint(id); }
    catch (e) { this.backoff = Date.now() + 120e3; console.warn('metars', e.message || e); }
    finally { this.busy = false; }
  },
};
setInterval(() => FieldWx.view(), 8000);
