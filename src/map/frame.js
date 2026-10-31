// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Pure helpers for the 2D map's frame budget: Web Mercator placement for the glyph canvas, colour and text-width caches,
// which feeds may start this tick, and how often a moving map may redraw. No DOM and no Leaflet, so Node tests them
// (test/mapframe.test.mjs); engine.js, util.js and detail.js use them.

const MAX_LAT = 85.0511287798, D2R = Math.PI / 180;
/** World pixel position of lat/lon at `scale` (= 256 * 2^zoom), the projection Leaflet's EPSG:3857 uses, into out {x, y}. */
export function mercator(lat, lon, scale, out) {
  const s = Math.sin(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * D2R);
  out.x = scale * (0.5 + lon / 360);
  out.y = scale * (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI));
  return out;
}
/** A placer for one frame: place(lat, lon) fills pts[0..n) with the container points of every world copy of lat/lon that
 *  lies on screen (with `margin` px of slack) and returns n (0 when it is off screen). originX/Y: the world pixel at the
 *  container's top-left corner; w, h: the container size. At most pts.length copies (a wide screen at zoom 2 shows three). */
export function createPlacer(pts = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]) {
  const p = { x: 0, y: 0 }; let scale = 256, ox = 0, oy = 0, w = 0, h = 0, m = 30;
  function place(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 0;
    mercator(lat, lon, scale, p);
    const y = p.y - oy; if (y < -m || y > h + m) return 0;   // off the top or bottom: no copy can show
    const x0 = p.x - ox; let n = 0;
    for (let k = Math.ceil((-m - x0) / scale), k1 = Math.floor((w + m - x0) / scale); k <= k1 && n < pts.length; k++) { const q = pts[n++]; q.x = x0 + k * scale; q.y = y; }
    return n;
  }
  place.pts = pts;
  place.frame = (sc, originX, originY, width, height, margin = 30) => { scale = sc; ox = originX; oy = originY; w = width; h = height; m = margin; };
  return place;
}

/** rgba() text for a #rgb / #rrggbb colour at alpha a, cached: the canvas asks for the same few thousands of times a frame. */
const rgbaCache = new Map();
export function hexA(hex, a) {
  const key = hex + '|' + a; let v = rgbaCache.get(key); if (v) return v;
  const h = String(hex).replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  v = `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  if (rgbaCache.size > 4096) rgbaCache.clear(); rgbaCache.set(key, v); return v;
}

/** Text widths through measure(text), remembered (labels repeat every frame; measureText is not free). */
export function createWidths(measure, max = 4000) {
  const m = new Map();
  const width = t => { let v = m.get(t); if (v === undefined) { if (m.size >= max) m.clear(); v = measure(t); m.set(t, v); } return v; };
  width.clear = () => m.clear(); width.size = () => m.size;
  return width;
}

/** Which feeds start now, oldest due first and at most `max` (the rest wait for the next tick, so a boot or a return to
 *  the tab is spread over a few seconds rather than a burst). A hidden page runs only the feeds keep(f) names (alerts),
 *  at a third of their cadence; the others rest until the page shows again. */
export function dueFeeds(list, now, { hidden = false, keep = () => false, max = Infinity } = {}) {
  const due = [];
  for (const f of list) {
    if (!f.layer.on || f.running) continue;
    if (hidden && !keep(f)) continue;
    const slack = hidden ? 2 * (f.status === 'error' ? f.retry : f.interval) * 1000 : 0;
    if (now >= f.nextAt + slack) due.push(f);
  }
  due.sort((a, b) => a.nextAt - b.nextAt);
  return due.length > max ? due.slice(0, max) : due;
}

/** Milliseconds between canvas redraws while the map moves: every frame when a draw is cheap, then fewer as the last
 *  draw's cost grows, so a dense view stays smooth to drag instead of redrawing itself into a stutter. */
export function moveRedrawGap(lastDrawMs) {
  if (!(lastDrawMs > 0) || lastDrawMs <= 4) return 0;
  return Math.min(250, Math.round(lastDrawMs * 6));
}
