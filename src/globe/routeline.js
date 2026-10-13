// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The route on the globe for the plane you have open or follow, when its route on file fits where it is (acinfo.js):
// a dashed great circle from the plane to its destination (holding its height, then down to the field over the last
// 200 km), and a fainter one back to where it took off. Drawn only for a route that fits: a wrong route is worse than
// none. Redrawn every 2 s as the plane moves.
import { C } from './env.js';
import { scene } from './viewer.js';
import { state } from './state.js';
import { Follow } from './follow.js';
import { Air, displayAt, airShown } from './aircraft.js';
import { AcInfo } from './acinfo.js';
import { Trails } from './trails.js';
import { greatCircle } from '../core/phase.js';
import { gcKm } from '../core/actype.js';

const lines = scene.primitives.add(new C.PolylineCollection());
const AHEAD = C.Material.fromType('PolylineDash', { color: C.Color.fromCssColorString('#e6edf3').withAlpha(0.85), gapColor: C.Color.TRANSPARENT, dashLength: 18 });
const BEHIND = C.Material.fromType('PolylineDash', { color: C.Color.fromCssColorString('#8b9bab').withAlpha(0.45), gapColor: C.Color.TRANSPARENT, dashLength: 10 });
const DESCENT_KM = 200;

/** Positions along the great circle from a to b: height h0 held, then eased to h1 over the last 200 km. */
function arc(a, b, h0, h1) {
  const km = gcKm(a.lat, a.lon, b.lat, b.lon), n = Math.max(8, Math.min(128, Math.round(km / 40)));
  return greatCircle(a.lat, a.lon, b.lat, b.lon, n).map(([lat, lon], i) => {
    const w = Math.max(0, Math.min(1, 1 - km * (1 - i / n) / DESCENT_KM));
    return C.Cartesian3.fromDegrees(lon, lat, h0 + (h1 - h0) * w * w * (3 - 2 * w));
  });
}

export const RouteLine = {
  for: null,
  watched() {
    const o = Follow.obj && Follow.obj.kind === 'air' ? Follow.obj : state.selected && state.selected.kind === 'air' ? state.selected : null;
    return o && Air.map.get(o.hex) === o && airShown(o) ? o : null;
  },
  draw() {
    const o = this.watched(), rt = o && o.info && o.info.route, fit = rt && rt.origin && rt.destination ? AcInfo.fit(o) : null;
    lines.removeAll(); this.for = null;
    if (!fit || !fit.fits || o.ground) return;
    const p = displayAt(o, Date.now()), here = { lat: p.lat, lon: p.lon }, h = p.altE ?? p.alt ?? 0;
    const dest = rt.destination, orig = rt.origin, ft = 0.3048;
    if (fit.leftKm > 5) lines.add({ positions: arc(here, dest, h, (dest.elevFt || 0) * ft + 30), width: 2.5, material: AHEAD, arcType: C.ArcType.NONE });
    const t = Trails.get(o), start = t && t.pts.length ? t.pts[0] : here;
    if (fit.flownKm > 5 && gcKm(orig.lat, orig.lon, start.lat, start.lon) > 5)
      lines.add({ positions: arc(start, orig, start.h ?? start.alt ?? h, (orig.elevFt || 0) * ft + 30), width: 1.5, material: BEHIND, arcType: C.ArcType.NONE });   // the climb-out, drawn backwards
    this.for = o;
  },
};
setInterval(() => RouteLine.draw(), 2000);
