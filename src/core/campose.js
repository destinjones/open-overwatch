// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Where a public traffic camera looks, as a best guess, and the geometry of what it sees. Pure (Node tests it).
// Feeds publish a camera's position, rarely its aim. The guess, best first:
//   1. a pose someone calibrated (the globe saves them; data/camera_poses.json can ship them)
//   2. a direction the feed gives (Caltrans "West", a TfL view "South (Earls Court Road)", "Zoom north - …")
//   3. the road it stands on (OpenStreetMap), facing along it: the text hint picks which way, else the feed's preset does
//   4. defaults for a pole-mounted traffic camera
// Angles in degrees: heading clockwise from north, pitch up from level (negative = down). Distances in metres.
// Local frame: east-north-up (ENU) metres around the camera's foot.

const D = Math.PI / 180;
export const PRESETS = Object.freeze({   // typical mounts per network
  tfl: { height: 7, pitch: -12, fov: 60 }, nyc: { height: 7, pitch: -14, fov: 60 },
  caltrans: { height: 11, pitch: -9, fov: 50 }, finland: { height: 6, pitch: -13, fov: 62 }, default: { height: 8, pitch: -12, fov: 58 },
});

/** @type {[RegExp, number][]} */
const BOUND = [[/\b(north[\s-]?bound|n\/b|nb)\b/, 0], [/\b(south[\s-]?bound|s\/b|sb)\b/, 180], [/\b(east[\s-]?bound|e\/b|eb)\b/, 90], [/\b(west[\s-]?bound|w\/b|wb)\b/, 270]];
const COMPASS = { northeast: 45, northwest: 315, southeast: 135, southwest: 225, north: 0, south: 180, east: 90, west: 270 };
const WORD = '(north[\\s-]?east|north[\\s-]?west|south[\\s-]?east|south[\\s-]?west|northeast|northwest|southeast|southwest|north|south|east|west)';
// a compass word that names the view: after "zoom / looking / facing / towards", or standing alone before a dash, a
// bracket, "zoom" or the end ("South (Earls Court Road)", "EAST ZOOM - …"). Not one that starts a road name
// ("South Circular", "West End Lane", "West St @ 86 St").
const LEADS = new RegExp(`\\b(?:zoom(?:ed)?|looking|facing|view(?:ing)?|towards?|twds|direction|camera)\\s+${WORD}\\b`);
const ALONE = new RegExp(`\\b${WORD}\\b(?=\\s*(?:$|[-–—(/,:]|zoom|view))`);

/** A compass bearing from a feed's words, or null. */
export function bearingFromText(text) {
  const s = String(text || '').toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  for (const [re, b] of BOUND) if (re.test(s)) return b;
  const m = s.match(LEADS) || s.match(ALONE);
  return m ? COMPASS[m[1].replace(/[\s-]/g, '')] ?? null : null;
}

/** Smallest angle between two bearings (0-180). */
export const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/** A road-aligned heading: of the roads near the camera (bearings of their nearest segments, closest road first), the
 *  direction along a road nearest the hint (each road can be faced either way). Without a hint: along the closest road,
 *  `flip` turning it round (a feed's second preset). Returns null if there are no roads. */
export function alongRoad(roads, hint = null, flip = false) {
  if (!roads || !roads.length) return null;
  if (hint == null) return ((roads[0] + (flip ? 180 : 0)) % 360 + 360) % 360;
  let best = null, bd = Infinity;
  for (const r of roads) for (const b of [r, (r + 180) % 360]) { const d = angleDiff(b, hint); if (d < bd) { bd = d; best = b; } }
  return bd <= 50 ? best : hint;   // a road far off the hint is probably the cross street: trust the words
}

/** The pose guess for a camera { net, view, name, direction, preset, presetDir, calibrated } and nearby road bearings. */
export function estimatePose(cam, roads = []) {
  const base = PRESETS[cam.net] || PRESETS.default;
  if (cam.calibrated) return { ...base, ...cam.calibrated, source: 'calibrated' };
  const hint = bearingFromText(cam.direction) ?? bearingFromText(cam.view) ?? bearingFromText(cam.name);
  const road = alongRoad(roads, hint, cam.presetDir === 'decreasing');
  const surface = /tienpinta|road surface|surface/i.test(cam.view || '');   // Finnish weather cameras' road-surface preset looks down
  const heading = road ?? hint ?? 0;
  return { ...base, heading, pitch: surface ? -55 : base.pitch, source: road != null && hint != null ? 'words + road' : road != null ? 'road' : hint != null ? 'words' : 'default' };
}

/** Unit view direction in ENU for a heading and pitch. */
export function enuDir(heading, pitch) {
  const h = heading * D, p = pitch * D;
  return [Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p)];
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };

/** The camera's axes in ENU: forward, right, up (all unit). */
export function axes(pose) {
  const f = enuDir(pose.heading, pose.pitch), r = norm([Math.cos(pose.heading * D), -Math.sin(pose.heading * D), 0]);
  return { f, r, u: cross(r, f) };
}

/** Unit rays through the image corners, bottom-left, bottom-right, top-right, top-left (ENU). fov is horizontal. */
export function cornerRays(pose, aspect = 16 / 9) {
  const { f, r, u } = axes(pose), th = Math.tan(pose.fov * D / 2), tv = th / aspect;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => norm([0, 1, 2].map(i => f[i] + x * th * r[i] + y * tv * u[i])));
}

/** The patch of flat ground the camera sees, as ENU [east, north] corners (bottom-left, bottom-right, top-right, top-left),
 *  each at most `maxDist` away horizontally. Rays that miss the ground (above the horizon) are cut at maxDist.
 *  Returns null when even the bottom of the picture is above the horizon. */
export function footprint(pose, aspect = 16 / 9, maxDist = 500) {
  const h = pose.height, rays = cornerRays(pose, aspect);
  if (rays[0][2] >= 0 && rays[1][2] >= 0) return null;
  return rays.map(d => {
    const flat = Math.hypot(d[0], d[1]) || 1e-9;
    const t = d[2] < -1e-6 ? Math.min(h / -d[2], maxDist / flat) : maxDist / flat;   // to the ground, or cut off
    return [d[0] * t, d[1] * t];
  });
}

/** Bearings of the nearest segment of each road (Overpass `out geom` ways), closest road first. */
export function roadBearings(ways, lat, lon, within = 60) {
  const kx = 111320 * Math.cos(lat * D), ky = 110540, out = [];
  for (const w of ways || []) {
    const g = w.geometry || []; let best = null;
    for (let i = 1; i < g.length; i++) {
      const ax = (g[i - 1].lon - lon) * kx, ay = (g[i - 1].lat - lat) * ky, bx = (g[i].lon - lon) * kx, by = (g[i].lat - lat) * ky;
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-9, t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (!best || d < best.d) best = { d, b: ((Math.atan2(dx, dy) / D) + 360) % 360 };
    }
    if (best && best.d <= within) out.push(best);
  }
  return out.sort((a, b) => a.d - b.d).map(x => x.b);
}
