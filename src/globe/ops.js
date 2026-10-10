// Ops: the "spy satellite" pack for the globe, all in the browser with no key.
//   Sensors   one post-process pass: night vision, thermal (white hot, black hot, ironbow), CRT, noir. Off = no cost.
//   HUD       compass tape, reticle, the ground under the reticle (lat/lon, MGRS), altitude, heading, ground sample
//             distance, UTC, and a lock line for the object being followed
//   Detect    boxes and IDs on what is in view: satellites, aircraft, quakes. A cheap scan 4x a second picks the nearest
//             few dozen; only those are projected every frame
//   Cockpit   ride the followed satellite or aircraft: looking along its path, drag to look around, scroll to zoom
// Keys: 1-7 sensors, H HUD, D detection, C cockpit (V talks: voice.js). Esc leaves the cockpit first.
import { C, $, PHONE, toast, store, fmt } from './env.js';
import { viewer, scene, camera, ctrl, camHeight, orbitLines } from './viewer.js';
import { state, hooks } from './state.js';
import { Follow } from './follow.js';
import { Sats, SatModels } from './satellites.js';
import { Air, AirModels, airShown } from './aircraft.js';
import { Quakes } from './quakes.js';
import { L } from './layers.js';
import { LookUp } from './lookup.js';
import { toMgrs } from '../core/mgrs.js';
import { SENSORS } from '../core/voicecmd.js';

const SENSOR_INFO = {
  normal: ['EO', 'Normal colour'], nvg: ['NVG', 'Night vision'], flir: ['WHT', 'Thermal, white hot'], flirbh: ['BHT', 'Thermal, black hot'],
  iron: ['IRN', 'Thermal, ironbow'], crt: ['CRT', 'Old monitor'], noir: ['NOIR', 'Noir'],
};
// overlay colour per sensor (the detection boxes and HUD follow the look)
const HUD_COLOR = { normal: '#7dffa6', nvg: '#c4ffbe', flir: '#ffffff', flirbh: '#ffe36e', iron: '#ffffff', crt: '#7dffa6', noir: '#ffffff' };
const KIND_COLOR = { sat: '#d9ccff', station: '#7dffa6', air: '#5fd3ff', mil: '#ffb44d', emg: '#ff4d5e', quake: '#ff7b4f' };

// ------------------------------------------------------------------------------------------------ sensors
const FS = `
uniform sampler2D colorTexture;
uniform float mode;
uniform float time;
in vec2 v_textureCoordinates;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 ironbow(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 a = mix(vec3(0.0, 0.0, 0.03), vec3(0.18, 0.0, 0.45), smoothstep(0.0, 0.2, t));
  a = mix(a, vec3(0.62, 0.0, 0.55), smoothstep(0.2, 0.42, t));
  a = mix(a, vec3(0.93, 0.25, 0.08), smoothstep(0.42, 0.62, t));
  a = mix(a, vec3(1.0, 0.62, 0.0), smoothstep(0.62, 0.8, t));
  a = mix(a, vec3(1.0, 0.95, 0.55), smoothstep(0.8, 0.94, t));
  return mix(a, vec3(1.0), smoothstep(0.94, 1.0, t));
}
float lumAt(vec2 uv) { return luma(texture(colorTexture, uv).rgb); }
float sobel(vec2 uv, vec2 px) {
  float tl = lumAt(uv + px * vec2(-1.0, 1.0)), t = lumAt(uv + px * vec2(0.0, 1.0)), tr = lumAt(uv + px * vec2(1.0, 1.0));
  float l = lumAt(uv + px * vec2(-1.0, 0.0)), r = lumAt(uv + px * vec2(1.0, 0.0));
  float bl = lumAt(uv + px * vec2(-1.0, -1.0)), b = lumAt(uv + px * vec2(0.0, -1.0)), br = lumAt(uv + px * vec2(1.0, -1.0));
  float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl), gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
  return length(vec2(gx, gy));
}
void main() {
  vec2 uv = v_textureCoordinates, res = czm_viewport.zw, px = 1.0 / res;
  float m = mode;
  if (m > 4.5 && m < 5.5) {   // CRT: a curved glass face
    vec2 c = uv - 0.5; uv = 0.5 + c * (1.0 + 0.18 * dot(c, c));
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { out_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  }
  vec3 col = texture(colorTexture, uv).rgb;
  float l = luma(col);
  float grain = hash(floor(uv * res) + floor(time * 24.0) * vec2(7.13, 3.71)) - 0.5;
  float vig = 1.0 - smoothstep(0.45, 1.05, length((uv - 0.5) * vec2(res.x / res.y, 1.0)));
  vec3 o = col;
  if (m < 1.5) {            // night vision: amplified light on a green phosphor, noisy, a faint raster
    float g = pow(1.0 - exp(-l * 4.0), 0.9) + 0.03 + grain * 0.15;   // a soft knee: city lights glow, they don't flood
    g *= 0.93 + 0.07 * sin(uv.y * res.y * 1.4);
    o = vec3(0.30, 1.0, 0.42) * g * (0.5 + 0.5 * vig) + vec3(0.0, 0.025, 0.0);
  } else if (m < 4.5) {     // thermal: brightness as heat, edges sharpened like a real imager
    float t = smoothstep(0.02, 1.0, (1.0 - exp(-l * 2.6)) * 0.85 + sobel(uv, px) * 0.45) + grain * 0.05;
    o = m < 2.5 ? vec3(t) : m < 3.5 ? vec3(1.0 - t) : ironbow(t);
    o *= 0.72 + 0.28 * vig;
  } else if (m < 5.5) {     // CRT: colour fringes, scanlines, an RGB shadow mask, flicker
    float ca = 0.0012 + 0.004 * dot(uv - 0.5, uv - 0.5);
    vec3 c3 = vec3(texture(colorTexture, uv + vec2(ca, 0.0)).r, col.g, texture(colorTexture, uv - vec2(ca, 0.0)).b);
    float scan = 0.74 + 0.26 * sin(uv.y * res.y * 3.14159);
    float k = mod(floor(uv.x * res.x), 3.0);
    vec3 mask = k < 0.5 ? vec3(1.0, 0.8, 0.8) : k < 1.5 ? vec3(0.8, 1.0, 0.8) : vec3(0.8, 0.8, 1.0);
    o = c3 * scan * mask * (0.97 + 0.03 * sin(time * 60.0)) * 1.3 * (0.3 + 0.7 * vig) + grain * 0.03;
  } else {                  // noir: hard black and white with film grain
    o = vec3(smoothstep(0.04, 0.95, 1.0 - exp(-l * 3.2)) + grain * 0.09) * (0.38 + 0.62 * vig);
  }
  out_FragColor = vec4(clamp(o, 0.0, 1.0), 1.0);
}`;

const t0 = performance.now();
const stage = new C.PostProcessStage({ name: 'oo_sensor', fragmentShader: FS, uniforms: { mode: () => SENSORS.indexOf(Ops.sensor), time: () => (performance.now() - t0) / 1000 } });
stage.enabled = false;
scene.postProcessStages.add(stage);

// ------------------------------------------------------------------------------------------------ overlays (DOM)
const el = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.innerHTML = html; return e; };
const hud = el('div', { id: 'opsHud', 'aria-hidden': 'true' }, `
  <div class="oh-frame"></div>
  <div class="oh-tape"><div class="oh-strip"></div><b class="oh-hdg">000</b></div>
  <svg class="oh-ret" viewBox="-60 -60 120 120"><circle r="34"/><path d="M-56 0H-20M20 0H56M0 -56V-20M0 20V56M-3 0H3M0 -3V3"/><path class="oh-tick" d="M-34 -6V6M34 -6V6M-6 -34H6M-6 34H6"/></svg>
  <div class="oh-lock"></div>
  <div class="oh-tl"></div><div class="oh-bl"></div>`);
const canvas = el('canvas', { id: 'opsDet', 'aria-hidden': 'true' });
const rail = el('div', { id: 'opsRail', class: 'glass', role: 'toolbar', 'aria-label': 'Sensors and tactical overlays' },
  `<button class="ops-t" id="opsToggle" aria-expanded="false" title="Sensors, tactical HUD, detection, cockpit and voice">OPS</button><div class="ops-body">` +
  SENSORS.map((s, i) => `<button data-s="${s}" title="${SENSOR_INFO[s][1]} (${i + 1})">${SENSOR_INFO[s][0]}</button>`).join('') +
  `<i class="ops-sep"></i><button data-o="hud" title="Tactical HUD (H)">HUD</button><button data-o="detect" title="Boxes and IDs on everything in view (D)">DET</button>` +
  `<button data-o="cockpit" title="Ride the satellite or plane you follow (C)">CKPT</button>` +
  `<button data-o="voice" id="opsMic" title="Talk to it (V)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button></div>`);
document.body.append(canvas, hud, rail);
const ctx = canvas.getContext('2d');

// compass tape: 4 px per degree, ticks every 5, labels every 15, from -360 to 720 so any heading has both sides filled
{
  const strip = hud.querySelector('.oh-strip'), NAMES = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }; let h = '';
  for (let d = -360; d <= 720; d += 5) {
    const n = ((d % 360) + 360) % 360, big = n % 15 === 0;
    h += `<i style="left:${(d + 360) * 4}px" class="${big ? 'b' : ''}">${big ? `<span>${NAMES[n] || String(n).padStart(3, '0')}</span>` : ''}</i>`;
  }
  strip.innerHTML = h;
}

// ------------------------------------------------------------------------------------------------ detection scan
const scratch = { d: new C.Cartesian3(), w: new C.Cartesian2() };
let picks = [];            // [{ o, kind, id, label, sub, pos: () => Cartesian3, seen }]
const firstSeen = new Map();
function kindOf(o) {
  if (o.kind === 'sat') return o.layer === 'stations' ? 'station' : 'sat';
  if (o.kind === 'air') return o.emerg ? 'emg' : o.mil ? 'mil' : 'air';
  return o.kind;
}
function describe(o) {
  if (o.kind === 'sat') return { id: 'SAT ' + o.id, sub: o.name.replace(/\s*\[.*?\]\s*/g, ' ').trim().slice(0, 22) };
  if (o.kind === 'air') return { id: (o.mil ? 'MIL ' : o.emerg ? 'EMG ' : 'AIR ') + String(o.hex || '').toUpperCase(), sub: `${(o.flight || '').trim() || '—'} ${o.ground ? 'GND' : 'FL' + String(Math.round((o.alt || 0) / 0.3048 / 100)).padStart(3, '0')}` };
  if (o.kind === 'quake') return { id: 'SEIS M' + o.mag.toFixed(1), sub: (o.place || '').replace(/^.*? of /, '').slice(0, 18) };
  return { id: '', sub: '' };
}
/** Everything that could be boxed, with where it is now. */
function* candidates() {
  for (const s of Sats.list) if (s.pt && L[s.layer].on && !s.docked) yield [s, () => s.pt.position];
  if (!state.weather) for (const a of Air.map.values()) if (a.pt && airShown(a)) yield [a, () => a.pt.position];
  if (L.quakes.on) for (const q of Quakes.list) if (q.pt) yield [q, () => q.pt.position];
}
/** One pass over every candidate: in front of the camera, inside the view cone, not behind the Earth. */
function scan(cap) {
  const cam = camera.positionWC, dir = camera.directionWC, fr = camera.frustum;
  const aspect = scene.canvas.clientWidth / Math.max(1, scene.canvas.clientHeight), half = (fr.fov || 1) / 2;
  const th = Math.tan(half), tv = aspect >= 1 ? th / aspect : th, thh = aspect >= 1 ? th : th * aspect;
  const cosLim = Math.cos(Math.atan(Math.hypot(thh, tv)) * 1.02);
  const occ = new C.EllipsoidalOccluder(C.Ellipsoid.WGS84, cam);
  const out = [], counts = { sat: 0, air: 0, mil: 0, quake: 0, all: 0 };
  for (const [o, pos] of candidates()) {
    const p = pos(); if (!p) continue;
    const d = C.Cartesian3.subtract(p, cam, scratch.d), dist = C.Cartesian3.magnitude(d); if (!(dist > 1)) continue;
    if (C.Cartesian3.dot(d, dir) / dist < cosLim) continue;
    if (!occ.isPointVisible(p)) continue;
    const k = kindOf(o); counts.all++; counts[k === 'station' ? 'sat' : k === 'emg' ? 'air' : k] = (counts[k === 'station' ? 'sat' : k === 'emg' ? 'air' : k] || 0) + 1;
    if (cap) out.push({ o, pos, kind: k, score: dist * (k === 'station' ? 0.25 : k === 'air' || k === 'mil' || k === 'emg' ? 0.5 : k === 'quake' ? 0.6 : o.layer === 'debris' ? 1.6 : 1) });
  }
  if (cap) { out.sort((a, b) => a.score - b.score); out.length = Math.min(out.length, cap); }
  return { list: out, counts };
}

// ------------------------------------------------------------------------------------------------ the module
export const Ops = {
  sensor: 'normal', hud: false, detect: false, cockpit: false, counts: { all: 0 }, open: !PHONE,
  setSensor(s) {
    if (!SENSORS.includes(s)) return;
    this.sensor = s; stage.enabled = s !== 'normal';
    document.body.dataset.sensor = s; document.body.style.setProperty('--hud', HUD_COLOR[s]);
    this.sync();
  },
  setHud(on = !this.hud) { this.hud = !!on; document.body.classList.toggle('ops-hud', this.hud); this.sync(); if (this.hud) this.tickHud(); },
  setDetect(on = !this.detect) {
    this.detect = !!on; canvas.style.display = this.detect || this.hud ? 'block' : 'none';
    if (!this.detect) { picks = []; firstSeen.clear(); }
    this.sync(); if (this.detect) this.rescan();
  },
  /** How many of a kind ('sat', 'air', 'mil', 'quake', 'all') are in view right now (voice asks this). */
  countInView(kind = 'all') { return scan(0).counts[kind] || 0; },
  rescan() {
    if (!this.detect && !this.hud) return;
    const cap = this.detect ? (PHONE ? 22 : 46) : 0, { list, counts } = scan(cap); this.counts = counts;
    const now = performance.now();
    picks = list.map(x => { const id = x.o.kind + ':' + (x.o.id || x.o.hex || x.o.place); if (!firstSeen.has(id)) firstSeen.set(id, now); return { ...x, key: id, ...describe(x.o) }; });
    if (firstSeen.size > 4000) firstSeen.clear();
  },
  sync() {
    rail.querySelectorAll('[data-s]').forEach(b => b.classList.toggle('on', b.dataset.s === this.sensor));
    rail.querySelector('[data-o="hud"]').classList.toggle('on', this.hud);
    rail.querySelector('[data-o="detect"]').classList.toggle('on', this.detect);
    rail.querySelector('[data-o="cockpit"]').classList.toggle('on', this.cockpit);
    rail.classList.toggle('open', this.open); $('#opsToggle').setAttribute('aria-expanded', String(this.open));
    $('#opsToggle').textContent = this.open ? 'OPS' : `OPS · ${SENSOR_INFO[this.sensor][0]}`;
    canvas.style.display = this.detect || this.hud ? 'block' : 'none';
  },

  // ---- HUD text (8 times a second while on)
  tickHud() {
    if (!this.hud && !this.cockpit) return;
    const h = C.Math.toDegrees(camera.heading) || 0, pitch = C.Math.toDegrees(camera.pitch) || 0;
    hud.querySelector('.oh-strip').style.transform = `translateX(${-(h + 360) * 4}px)`;
    hud.querySelector('.oh-hdg').textContent = String(Math.round(h) % 360).padStart(3, '0');
    const W = scene.canvas.clientWidth, H = scene.canvas.clientHeight;
    const hit = camera.pickEllipsoid(new C.Cartesian2(W / 2, H / 2), C.Ellipsoid.WGS84);
    let lat, lon, gsd = null, where = 'RETICLE';
    if (hit) {
      const g = C.Cartographic.fromCartesian(hit); lat = C.Math.toDegrees(g.latitude); lon = C.Math.toDegrees(g.longitude);
      const fovy = camera.frustum.fovy || camera.frustum.fov || 1;
      gsd = C.Cartesian3.distance(camera.positionWC, hit) * 2 * Math.tan(fovy / 2) / Math.max(1, H);
    } else { const c = camera.positionCartographic; lat = C.Math.toDegrees(c.latitude); lon = C.Math.toDegrees(c.longitude); where = 'NADIR'; }
    const ll = (v, p, n) => Math.abs(v).toFixed(4) + '°' + (v >= 0 ? p : n);
    const alt = camHeight(), altTxt = alt > 1e5 ? fmt(alt / 1000) + ' km' : fmt(alt) + ' m';
    const gsdTxt = gsd == null ? '—' : gsd >= 1000 ? (gsd / 1000).toFixed(gsd > 1e4 ? 0 : 1) + ' km/px' : gsd.toFixed(gsd < 10 ? 1 : 0) + ' m/px';
    const mode = this.cockpit ? 'COCKPIT' : Follow.obj ? 'TRACK' : this.detect ? 'SCAN' : 'SEARCH', now = new Date();
    hud.querySelector('.oh-tl').innerHTML = `<b>OVERWATCH ◆ ${SENSOR_INFO[this.sensor][0]}</b><span>MODE ${mode}</span><span>${now.toISOString().slice(11, 19)}Z <em class="rec">● REC</em></span>`
      + `<span>DET ${fmt(this.counts.all || 0)}${this.detect ? ' · BOX ' + picks.length : ''}</span>`;
    hud.querySelector('.oh-bl').innerHTML = `<span>${where} ${ll(lat, 'N', 'S')} ${ll(lon, 'E', 'W')}</span><span>MGRS ${toMgrs(lat, lon) || 'polar (UPS)'}</span>`
      + `<span>ALT ${altTxt} · GSD ${gsdTxt}</span><span>HDG ${String(Math.round(h) % 360).padStart(3, '0')}° · PIT ${pitch.toFixed(0)}°</span>`;
    const o = Follow.obj, lock = hud.querySelector('.oh-lock');
    if (o) {
      const p = Follow.getPos && Follow.getPos(viewer.clock.currentTime);
      const rng = p ? C.Cartesian3.distance(camera.positionWC, p) : null;
      lock.textContent = `◇ LOCK ${o.kind === 'sat' ? o.name : (o.flight || o.hex || '').trim()}${rng != null && !this.cockpit ? ' · RNG ' + (rng > 1e4 ? fmt(rng / 1000) + ' km' : fmt(rng) + ' m') : ''}`;
      lock.style.display = 'block';
    } else lock.style.display = 'none';
  },

  // ---- detection boxes, every frame (only the chosen few are projected)
  draw() {
    const dpr = Math.min(2, devicePixelRatio || 1), W = scene.canvas.clientWidth, H = scene.canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    if (!this.detect && !(this.hud && Follow.obj)) return;
    const mono = HUD_COLOR[this.sensor], tinted = this.sensor !== 'normal' && this.sensor !== 'crt', now = performance.now();
    ctx.lineWidth = 1.25; ctx.font = '500 10.5px "IBM Plex Mono", ui-monospace, monospace'; ctx.textBaseline = 'top';
    let labels = 0;
    if (this.detect) for (const pk of picks) {
      const p = pk.pos(); if (!p || pk.o === Follow.obj) continue;
      const w = C.SceneTransforms.worldToWindowCoordinates(scene, p, scratch.w); if (!w || w.x < -20 || w.y < -20 || w.x > W + 20 || w.y > H + 20) continue;
      const age = Math.min(1, (now - (firstSeen.get(pk.key) || 0)) / 280), sz = (pk.kind === 'quake' ? 9 : pk.kind === 'sat' ? 7 : 9) * (1 + (1 - age) * 1.6);
      ctx.strokeStyle = ctx.fillStyle = tinted ? mono : KIND_COLOR[pk.kind] || mono; ctx.globalAlpha = 0.35 + 0.65 * age;
      bracket(w.x, w.y, sz);
      if (labels < (PHONE ? 8 : 18) && age >= 1) { labels++; ctx.globalAlpha = 0.9; ctx.fillText(pk.id, w.x + sz + 4, w.y - sz); ctx.globalAlpha = 0.6; ctx.fillText(pk.sub, w.x + sz + 4, w.y - sz + 12); }
    }
    ctx.globalAlpha = 1;
    // the followed object: a turning lock box
    const o = Follow.obj, p = o && Follow.getPos && Follow.getPos(viewer.clock.currentTime);
    if (p && !this.cockpit) {
      const w = C.SceneTransforms.worldToWindowCoordinates(scene, p, scratch.w);
      if (w) {
        ctx.strokeStyle = ctx.fillStyle = tinted ? mono : '#7dffa6'; ctx.lineWidth = 1.6;
        ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(now / 1400); bracket(0, 0, 22); ctx.restore();
        ctx.beginPath(); ctx.arc(w.x, w.y, 3, 0, Math.PI * 2); ctx.stroke();
      }
    }
  },

  // ---- cockpit
  look: { yaw: 0, pitch: 0, fov: null, drag: null },
  async setCockpit(on = !this.cockpit) {
    if (on && !Follow.obj) {
      const o = state.selected;
      if (o && o.kind === 'sat') { await SatModels.follow(o); await new Promise(r => setTimeout(r, 400)); }
      else if (o && o.kind === 'air') { AirModels.follow(o); await new Promise(r => setTimeout(r, 400)); }
      if (!Follow.obj) { toast('Pick a satellite or plane first (double-click to follow it), then Cockpit', 4200); return; }
    }
    if (on === this.cockpit) return;
    this.cockpit = !!on;
    const ent = Follow.ent;
    if (this.cockpit) {
      Follow.glide = null; if (ent) ent.show = false; orbitLines.show = false;   // its own orbit line would slice through the view
      const sat = Follow.obj.kind === 'sat', h = sat ? Math.max(200e3, C.Cartesian3.magnitude(Follow.getPos(viewer.clock.currentTime) || C.Cartesian3.ZERO) - 6371e3) : 0;
      const dip = sat ? C.Math.toDegrees(Math.acos(6371e3 / (6371e3 + h))) : 0;
      this.look = { yaw: 0, pitch: sat ? -dip * 0.82 : -6, fov: camera.frustum.fov, drag: null };
      camera.frustum.fov = C.Math.toRadians(sat ? 70 : 62); ctrl.enableInputs = false;
      document.body.classList.add('ops-cockpit');
      toast(`Cockpit: riding ${Follow.obj.name || Follow.obj.flight || Follow.obj.hex} · drag to look around, scroll to zoom, Esc to leave`, 4500);
    } else {
      if (ent) ent.show = true; orbitLines.show = true; if (this.look.fov) camera.frustum.fov = this.look.fov; ctrl.enableInputs = true;
      document.body.classList.remove('ops-cockpit');
      if (Follow.obj && Follow.home) Follow.glide = { from: new C.Cartesian3(-40, -40, 15), to: Follow.home, t0: performance.now(), dur: 1600 };
    }
    this.sync();
  },
  ride(time) {
    if (!this.cockpit) return;
    if (!Follow.obj) { this.setCockpit(false); return; }
    const p = Follow.getPos(time), p2 = Follow.getPos(C.JulianDate.addSeconds(time, 1, new C.JulianDate())); if (!p || !p2) return;
    const up = C.Cartesian3.normalize(p, new C.Cartesian3()), v = C.Cartesian3.subtract(p2, p, new C.Cartesian3());
    const fwd = C.Cartesian3.normalize(C.Cartesian3.subtract(v, C.Cartesian3.multiplyByScalar(up, C.Cartesian3.dot(v, up), new C.Cartesian3()), new C.Cartesian3()), new C.Cartesian3());
    if (!Number.isFinite(fwd.x)) return;
    const right = C.Cartesian3.cross(fwd, up, new C.Cartesian3());
    const y = C.Math.toRadians(this.look.yaw), pt = C.Math.toRadians(this.look.pitch);
    const flat = C.Cartesian3.add(C.Cartesian3.multiplyByScalar(fwd, Math.cos(y), new C.Cartesian3()), C.Cartesian3.multiplyByScalar(right, Math.sin(y), new C.Cartesian3()), new C.Cartesian3());
    const dir = C.Cartesian3.normalize(C.Cartesian3.add(C.Cartesian3.multiplyByScalar(flat, Math.cos(pt), new C.Cartesian3()), C.Cartesian3.multiplyByScalar(up, Math.sin(pt), new C.Cartesian3()), new C.Cartesian3()), new C.Cartesian3());
    const side = C.Cartesian3.normalize(C.Cartesian3.cross(dir, up, new C.Cartesian3()), new C.Cartesian3()), camUp = C.Cartesian3.cross(side, dir, new C.Cartesian3());
    const eye = C.Cartesian3.add(p, C.Cartesian3.multiplyByScalar(up, Follow.obj.kind === 'air' ? 4 : 0, new C.Cartesian3()), new C.Cartesian3());
    camera.lookAtTransform(C.Matrix4.IDENTITY);
    camera.setView({ destination: eye, orientation: { direction: dir, up: camUp } });
  },
};

// ------------------------------------------------------------------------------------------------ wiring
function bracket(x, y, s) {
  const k = s * 0.55; ctx.beginPath();
  ctx.moveTo(x - s, y - s + k); ctx.lineTo(x - s, y - s); ctx.lineTo(x - s + k, y - s);
  ctx.moveTo(x + s - k, y - s); ctx.lineTo(x + s, y - s); ctx.lineTo(x + s, y - s + k);
  ctx.moveTo(x + s, y + s - k); ctx.lineTo(x + s, y + s); ctx.lineTo(x + s - k, y + s);
  ctx.moveTo(x - s + k, y + s); ctx.lineTo(x - s, y + s); ctx.lineTo(x - s, y + s - k);
  ctx.stroke();
}
scene.preUpdate.addEventListener((sc, time) => Ops.ride(time));   // after Follow.track (registered first, in main.js)
let drawn = false;   // the overlay is cleared once when everything is switched off, then left alone
scene.postRender.addEventListener(() => { const on = Ops.detect || Ops.hud; if (on || drawn) { Ops.draw(); drawn = on; } });
setInterval(() => Ops.rescan(), 250);
setInterval(() => Ops.tickHud(), 125);

rail.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'opsToggle') { Ops.open = !Ops.open; if (PHONE) store.set('opsOpen', Ops.open); Ops.sync(); return; }
  if (b.dataset.s) Ops.setSensor(b.dataset.s);
  else if (b.dataset.o === 'hud') Ops.setHud();
  else if (b.dataset.o === 'detect') Ops.setDetect();
  else if (b.dataset.o === 'cockpit') Ops.setCockpit();
  else if (b.dataset.o === 'voice') Ops.onVoice?.();
});
rail.addEventListener('pointerdown', e => e.stopPropagation());
if (PHONE) Ops.open = store.get('opsOpen', false);

addEventListener('keydown', e => {
  if (e.key === 'Escape' && Ops.cockpit) { e.stopImmediatePropagation(); Ops.setCockpit(false); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || LookUp.active || /input|textarea|select/i.test(e.target.tagName)) return;
  const k = e.key.toLowerCase(), n = '1234567'.indexOf(e.key);
  if (n >= 0) Ops.setSensor(SENSORS[n]);
  else if (k === 'h') Ops.setHud();
  else if (k === 'd') Ops.setDetect();
  else if (k === 'c') Ops.setCockpit();
  else if (k === 'v') Ops.onVoice?.();
  else if (Ops.cockpit && /^arrow/.test(k)) { e.preventDefault(); const L2 = Ops.look; if (k === 'arrowleft') L2.yaw -= 5; if (k === 'arrowright') L2.yaw += 5; if (k === 'arrowup') L2.pitch = Math.min(60, L2.pitch + 4); if (k === 'arrowdown') L2.pitch = Math.max(-89, L2.pitch - 4); }
}, true);

// cockpit free-look: drag turns the head, the wheel (or a pinch's wheel events) zooms the lens
scene.canvas.addEventListener('pointerdown', e => { if (Ops.cockpit) { Ops.look.drag = { x: e.clientX, y: e.clientY, yaw: Ops.look.yaw, pitch: Ops.look.pitch }; scene.canvas.setPointerCapture?.(e.pointerId); } });
scene.canvas.addEventListener('pointermove', e => {
  const d = Ops.look.drag; if (!Ops.cockpit || !d) return;
  const k = C.Math.toDegrees(camera.frustum.fov) / Math.max(300, scene.canvas.clientWidth);
  Ops.look.yaw = d.yaw - (e.clientX - d.x) * k; Ops.look.pitch = Math.max(-89, Math.min(60, d.pitch + (e.clientY - d.y) * k));
});
addEventListener('pointerup', () => { Ops.look.drag = null; });
scene.canvas.addEventListener('wheel', e => {
  if (!Ops.cockpit) return; e.preventDefault();
  camera.frustum.fov = C.Math.clamp(camera.frustum.fov * (e.deltaY > 0 ? 1.08 : 0.93), C.Math.toRadians(8), C.Math.toRadians(100));
}, { passive: false });

hooks.opsState = () => ({ sensor: Ops.sensor, hud: Ops.hud, detect: Ops.detect });
hooks.applyOps = o => { Ops.setSensor(o.sensor); Ops.setHud(o.hud); Ops.setDetect(o.detect); };
Ops.sync();
