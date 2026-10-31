// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Satellites: TLEs from the shared source (src/core/tle.js), SGP4 for every dot in a worker, and Blender-built glTF
// models with exact per-frame SGP4 for the nearest ones.
import { C, toast, bigStore, getText, ON_SITE, NO_ENV_MAP, PHONE } from './env.js';
import { viewer, camera, satPts, orbitLines, camHeight } from './viewer.js';
import { L, LAYERS, setCount } from './layers.js';
import { state, hooks } from './state.js';
import { Follow, MODEL_FIX, SOLAR_AXIS } from './follow.js';
import { sunDirection } from './earth.js';
import { createTleSource, parseTle, tleEpochJd, stampTle } from '../core/tle.js';
import { fetchAsset } from '../core/assets.js';
import { chooseElements, nearestSnapshot, parseHistoryIndex, archiveMap, historyFileUrl, TLE_HISTORY, DAY_MS } from '../core/history.js';
import { Time } from './time.js';
import { eciVelToEcf } from '../core/ecfvel.js';
import { noradKeys } from '../core/viewlink.js';
import { sliced } from '../core/slices.js';

const satellite = window.satellite;
const tles = createTleSource({ fetchText: (url, o) => getText(url, o), cache: bigStore, onSite: ON_SITE });

// The worker propagates every satellite once a second (position and velocity, Earth-fixed km and km/s; one SGP4 run each,
// core/ecfvel.js turns the velocity); the page extrapolates. satellite.js is the site's own copy (src/vendor/, the same
// bytes the pages pin by hash): importScripts has no integrity check, and a blob worker needs the URL whole.
const SAT_LIB = new URL('../vendor/satellite.min.js', import.meta.url).href;
const WORKER_SRC = `
importScripts(${JSON.stringify(SAT_LIB)});
${eciVelToEcf}
let recs = [];
onmessage = e => {
  const m = e.data;
  if (m.type === 'load') { recs = m.tles.map(t => { try { return t ? satellite.twoline2satrec(t[0], t[1]) : null; } catch (err) { return null; } }); return; }   // null: no elements for the time shown (hidden)
  if (m.type === 'tick') {
    const t0 = new Date(m.t), g0 = satellite.gstime(t0), v = {};
    const out = new Float32Array(recs.length * 6), w0 = performance.now();
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i]; let ok = false;
      if (r) {
        const a = satellite.propagate(r, t0);
        if (a.position && a.velocity && !isNaN(a.position.x)) {
          const p = satellite.eciToEcf(a.position, g0); eciVelToEcf(p, a.velocity, g0, v);
          // the velocity half a second on (plus 0.5 s of central gravity): the page draws straight along it, and over the
          // 1 s between ticks that chord is ~1 m off the orbit where v(t) itself is ~4 m off. Gravity is along r, so the
          // orbit normal r x v the page turns about past 3 s is unchanged
          const r2 = p.x * p.x + p.y * p.y + p.z * p.z, gk = 0.5 * 398600.4418 / (r2 * Math.sqrt(r2));
          v.x -= gk * p.x; v.y -= gk * p.y; v.z -= gk * p.z;
          const k = i * 6; out[k] = p.x; out[k + 1] = p.y; out[k + 2] = p.z; out[k + 3] = v.x; out[k + 4] = v.y; out[k + 5] = v.z; ok = true;
        }
      }
      if (!ok) out[i * 6] = NaN;
    }
    postMessage({ t: m.t, buf: out, ms: performance.now() - w0 }, [out.buffer]);
  }
};`;

export const Sats = {
  list: [], byId: new Map(), state: null, worker: null, sources: {}, tickMs: 0,
  async load() {
    const seen = new Set(), elements = [], failed = [];
    // fetch the groups four at a time (one after another cost seconds of round trips on phones; more at once would be
    // rude to CelesTrak when a downloaded copy goes there directly), then take them in layer order
    const groups = LAYERS.filter(x => x.sat).flatMap(l => l.sat), got = new Map(), queue = [...groups];
    const worker = async () => { for (let g; (g = queue.shift());) got.set(g, await tles.load(g).then(r => ({ r }), e => ({ e }))); };
    await Promise.all([worker(), worker(), worker(), worker()]);
    // parsing ~12,000 element sets and making their dots in one go froze a phone for ~1.5 s right after the globe
    // appeared: yield to the browser between groups, and within one whenever a slice has run 8 ms (Starlink alone is
    // ~10,000 sets; a fixed count of dots per slice was 40 ms on a slow phone and 3 ms on a desktop)
    const breathe = () => new Promise(r => setTimeout(r, 0));
    for (const l of LAYERS.filter(x => x.sat)) {
      let n = 0;
      for (const g of l.sat) {
        await breathe();
        const { r: res, e } = got.get(g);
        if (e) { console.warn('satellites', g, e.message); failed.push(g); continue; }   // one group missing is no news
        this.sources[g] = { source: res.source, ageMs: res.ageMs };
        if (res.source === 'stale cache') console.warn(`${g}: using TLEs cached ${Math.round(res.ageMs / 3600e3)} h ago`);
        await sliced(parseTle(res.txt), t => {
          if (seen.has(t.id)) return; seen.add(t.id);
          const s = { kind: 'sat', ...t, layer: l.id, group: g, idx: elements.length };
          s.today = { id: t.id, l1: t.l1, l2: t.l2, group: g, jd: tleEpochJd(t.l1), source: res.source };   // the time-travel archive swaps l1/l2; these stay
          stampTle(s, t.l1, res.source);   // provenance: the element set's epoch, CelesTrak or a copy
          elements.push([t.l1, t.l2]); this.list.push(s); for (const k of noradKeys(t.id)) this.byId.set(k, s); n++;   // '00005' and '5' (links, SOCRATES)
        });
      }
      setCount(l.id, n);
    }
    if (!this.list.length && failed.length) toast('Satellites are unavailable right now; they are retried on the next visit', 5000);
    // one colour per layer and one set of distance scalars for all (each dot copies them): parsing the layer's colour
    // and making two scalars per dot was ~50,000 objects of garbage for nothing
    const SCALE = new C.NearFarScalar(5.0e5, 2.0, 1.5e8, 0.55), FUR = new C.NearFarScalar(4.0e7, 1.0, 1.6e8, 0.0), paint = {};
    for (const l of LAYERS) if (l.sat) paint[l.id] = C.Color.fromCssColorString(l.color).withAlpha(l.alpha ?? 1);
    await sliced(this.list, s => {
      s.pt = satPts.add({ position: C.Cartesian3.ZERO, pixelSize: L[s.layer].size, color: paint[s.layer], outlineWidth: 0, id: s, show: false, scaleByDistance: SCALE,
        // 10,000 Starlinks would cover the whole disc like fur from beyond the GEO belt (and are far too faint to see): fade them out
        translucencyByDistance: s.layer === 'starlink' ? FUR : undefined });
    });
    this.worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })));
    this.worker.onmessage = e => { this.state = { t: e.data.t, buf: e.data.buf }; this.tickMs = e.data.ms; };
    this.worker.postMessage({ type: 'load', tles: elements });
    // ask for positions at the clock's time: once a second live, more often when the clock runs fast
    const tick = () => { this.worker.postMessage({ type: 'tick', t: Time.nowMs() }); setTimeout(tick, Math.max(150, Math.min(1000, 20000 / Math.max(1, Math.abs(Time.rate))))); };
    tick();
    hooks.updateStats();
    this.travelKey = ''; this.travel();
  },
  // ---- time travel: the element sets current at the time shown (core/history.js chooses per satellite, from today's copy
  // and the site's daily archive); satellites with nothing within a week of it are hidden rather than drawn somewhere wrong
  history: null, travelKey: null, travelling: false,
  async travel() {
    if (this.travelKey === null || this.travelling) return;
    const ms = Time.nowMs(), near = Math.abs(ms - Date.now()) < DAY_MS / 2;
    const snap = near ? null : nearestSnapshot(await Archive.days(), ms);
    const key = near ? '' : `${snap ? snap.day : '-'}@${Math.round(ms / (6 * 3600e3))}`;   // the week rule moves with the clock: re-chosen every 6 h of clock time
    if (key === this.travelKey) return;
    this.travelling = true;
    try {
      const arch = snap ? await Archive.map(snap.day) : null;
      const r = near ? null : chooseElements(this.list.map(s => s.today), arch, ms, { covers: !!snap && Math.abs(snap.at - ms) < DAY_MS });
      const sets = this.list.map((s, i) => (r ? r.sets[i] : [s.today.l1, s.today.l2]));
      this.list.forEach((s, i) => {
        const set = sets[i]; s.gone = !set;
        if (set && set[0] !== s.l1) { s.l1 = set[0]; s.l2 = set[1]; s.rec = null; s._k = null; stampTle(s, s.l1, s.l1 === s.today.l1 ? s.today.source : 'archive'); }   // models, cards and orbit lines read l1/l2
        if (s.gone && s.ent) SatModels.drop(s);
      });
      this.worker.postMessage({ type: 'load', tles: sets });
      this.history = r && { day: snap ? snap.day : null, archived: r.archived, today: r.today, hidden: r.hidden };
      this.travelKey = key;
      hooks.updateStats(); hooks.historyChanged?.();
    } catch (e) { console.warn('satellite archive', e); } finally { this.travelling = false; }
  },
  scratch: new C.Cartesian3(), frameNo: 0,
  update(now) { // extrapolate from the last worker tick (ECF, km): straight along v for a few seconds, else round the orbit
    if (state.weather) return;   // weather mode hides every dot: no position work for ~19,000 of them
    const st = this.state; if (!st) return; const dt = (now - st.t) / 1000, b = st.buf, P = this.scratch, curve = Math.abs(dt) > 3;
    // Every moved dot costs Cesium a high/low precision split, and once more than a tenth of them move it re-uploads the
    // whole vertex buffer (~11,000 dots): on a phone that buffer was most of the frame (dragging the globe: 15 fps with the
    // dots, 97 without). A satellite moves ~125 m a frame, far under a pixel from orbit, so far out all of them move together
    // every few frames and the frames in between upload nothing. Time-lapse moves them every frame.
    const h = camHeight(), fast = !Time.live && Math.abs(Time.rate) > 60;
    const every = fast ? 1 : h > 2.0e7 ? (PHONE ? 8 : 4) : h > 1.5e6 ? (PHONE ? 4 : 2) : h > 1.5e5 && PHONE ? 2 : 1;
    if ((this.frameNo = (this.frameNo + 1) % 840) % every) return;
    const list = this.list;
    for (let n = 0; n < list.length; n++) {
      const s = list[n], i = s.idx * 6, x = b[i]; if (!(x === x) || x === undefined) { s.pt.show = false; continue; }   // not propagated yet (or failed): undefined must not slip through as NaN
      s.pt.show = L[s.layer].on && !s.ent && !s.docked; if (!s.pt.show) continue;   // hidden dots: no position work
      const y = b[i + 1], z = b[i + 2], vx = b[i + 3], vy = b[i + 4], vz = b[i + 5];
      if (!curve) { P.x = (x + vx * dt) * 1000; P.y = (y + vy * dt) * 1000; P.z = (z + vz * dt) * 1000; }
      else { // rotate about the orbit normal k = r x v at the mean angular rate |r x v| / r^2 (near-circular orbits)
        const nx = y * vz - z * vy, ny = z * vx - x * vz, nz = x * vy - y * vx, nl = Math.hypot(nx, ny, nz), a = nl / (x * x + y * y + z * z) * dt;
        const kx = nx / nl, ky = ny / nl, kz = nz / nl, c = Math.cos(a), sn = Math.sin(a);
        P.x = (x * c + (ky * z - kz * y) * sn) * 1000; P.y = (y * c + (kz * x - kx * z) * sn) * 1000; P.z = (z * c + (kx * y - ky * x) * sn) * 1000;
      }
      if (!(P.x === P.x && P.y === P.y && P.z === P.z)) { s.pt.show = false; continue; }   // one NaN dot makes the collection's bounds NaN: Cesium then fails every frame
      s.pt.position = P;
    }
  },
  info(s) {
    const rec = satellite.twoline2satrec(s.l1, s.l2), now = new Date(Time.nowMs()), pv = satellite.propagate(rec, now);
    const gd = satellite.eciToGeodetic(pv.position, satellite.gstime(now));
    const v = pv.velocity ? Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z) : null;
    return { alt: gd.height, lat: satellite.degreesLat(gd.latitude), lon: satellite.degreesLong(gd.longitude), speed: v * 3600, period: 2 * Math.PI / rec.no, incl: rec.inclo * 180 / Math.PI };
  },
  orbit(s) { // one inertial orbit, drawn in the current Earth-fixed frame so it passes through the satellite
    orbitLines.removeAll();
    const rec = satellite.twoline2satrec(s.l1, s.l2), now = new Date(Time.nowMs()), g = satellite.gstime(now), per = 2 * Math.PI / rec.no, pts = [];
    for (let k = 0; k <= 180; k++) {
      const pv = satellite.propagate(rec, new Date(now.getTime() + k / 180 * per * 60000)); if (!pv.position) continue;
      const f = satellite.eciToEcf(pv.position, g); pts.push(new C.Cartesian3(f.x * 1000, f.y * 1000, f.z * 1000));
    }
    orbitLines.add({ positions: pts, width: 1.6, material: C.Material.fromType('Color', { color: C.Color.fromCssColorString(L[s.layer].color).withAlpha(0.55) }) });
  },
};

// the site build's archive: data/tle/history/index.json and one file per day (the published site's copy when this one has none)
const Archive = {
  index: null, maps: new Map(),
  days() { return this.index || (this.index = fetchAsset(TLE_HISTORY + 'index.json', 'json').then(parseHistoryIndex, () => [])); },
  map(day) {
    if (!this.maps.has(day)) {
      if (this.maps.size > 3) this.maps.delete(this.maps.keys().next().value);   // ~4,000 sets each: keep a few days
      this.maps.set(day, fetchAsset(historyFileUrl(day), 'text').then(t => archiveMap(parseTle(t)), () => null));
    }
    return this.maps.get(day);
  },
};

// ambient fill for satellite models in Earth's shadow (otherwise they render black)
export const SHADOW_FILL = new C.CustomShader({ fragmentShaderText: 'void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) { material.emissive += material.diffuse * 0.42; }' });

// SatModels.state's temporaries (it runs per modelled satellite per frame; nothing it returns points into these)
const SCRATCH = { Z: new C.Cartesian3(), V: new C.Cartesian3(), X: new C.Cartesian3(), Y: new C.Cartesian3(), T: new C.Cartesian3(), R: new C.Matrix3() };

/* Satellites near the camera swap their point for a glTF model at real size, flying nose-first (+X along velocity, +Z
   to zenith), with solar arrays (nodes solar_*) turned toward the real sun about the model's Y axis. Modelled
   satellites get exact SGP4 every frame (the worker's 1 s linear extrapolation is ~1 m off, more past a missed tick, visible up close). */
export const SatModels = {
  dir: 'brand/models/', max: 40, range: 4.0e6, pool: new Map(), nodes: {}, stations: null,
  // follow-camera scale (m): the camera starts at (-r, -r, 0.55r) east/north/up of the satellite, r = the model's size
  view: { iss: 110, css: 56, hubble: 19, soyuz: 11, starlink: 10.5, gnss: 13, geo: 30, weather: 10.5, smallsat: 8.5, rocketbody: 11, axes: 12 },
  classify(s) {
    const n = s.name.toUpperCase();
    if (n === 'ISS (ZARYA)') return 'iss';
    if (n === 'CSS (TIANHE)') return 'css';
    if (/^(ISS|CSS) \(/.test(n)) return null;              // other station modules share the station's orbit and position
    if (n === 'HST') return 'hubble';
    if (/SOYUZ|PROGRESS|SHENZHOU|TIANZHOU|DRAGON|CYGNUS|STARLINER|HTV/.test(n)) return 'soyuz';
    if (/STARLINK/.test(n)) return 'starlink';
    if (/\bDEB\b/.test(n)) return null;                  // debris fragments stay dots
    if (/ R\/B|R\/B$/.test(n)) return 'rocketbody';
    if (s.layer === 'gnss') return 'gnss';
    if (s.layer === 'geo') return 'geo';
    if (s.layer === 'weather') return 'weather';
    return 'smallsat';
  },
  async solarNodes(type) { // node names straight from the GLB's JSON chunk; null = file missing (don't refetch)
    if (type in this.nodes) return this.nodes[type];
    try {
      const buf = await (await fetch(this.dir + type + '.glb')).arrayBuffer(), dv = new DataView(buf);
      const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, dv.getUint32(12, true))));
      this.nodes[type] = (json.nodes || []).map(n => n.name).filter(n => /^solar_/.test(n || ''));
    } catch (e) { console.warn('model', type, e); this.nodes[type] = null; }
    return this.nodes[type];
  },
  sunEcf: new C.Cartesian3(1, 0, 0),
  updateSun(time) { sunDirection(time, this.sunEcf); },
  state(s, time = viewer.clock.currentTime) { // exact position, attitude and array angle at the clock time (cached per instant)
    const key = time.dayNumber * 86400 + time.secondsOfDay;
    if (s._k === key && s._st) return s._st;
    s.rec = s.rec || satellite.twoline2satrec(s.l1, s.l2);
    const st = s._st || (s._st = { pos: new C.Cartesian3(), quat: new C.Quaternion(), solar: new C.Quaternion(), ok: false });
    s._k = key;
    if (s.gone) { st.ok = false; return st; }   // no element set near the time shown
    const d0 = C.JulianDate.toDate(time), a = satellite.propagate(s.rec, d0);   // one SGP4 run: position and velocity
    if (!a.position || !a.velocity || Number.isNaN(a.position.x)) { st.ok = false; return st; }
    const g = satellite.gstime(d0), p = satellite.eciToEcf(a.position, g), { Z, V, X, Y, T, R } = SCRATCH;
    C.Cartesian3.fromElements(p.x * 1000, p.y * 1000, p.z * 1000, st.pos);
    C.Cartesian3.normalize(st.pos, Z);
    eciVelToEcf(p, a.velocity, g, V);   // Earth-fixed velocity (km/s; only its direction is used)
    C.Cartesian3.normalize(C.Cartesian3.subtract(V, C.Cartesian3.multiplyByScalar(Z, C.Cartesian3.dot(V, Z), T), X), X);
    C.Cartesian3.cross(Z, X, Y);
    R[0] = X.x; R[1] = X.y; R[2] = X.z; R[3] = Y.x; R[4] = Y.y; R[5] = Y.z; R[6] = Z.x; R[7] = Z.y; R[8] = Z.z;   // columns = body axes in Earth-fixed coordinates
    C.Quaternion.multiply(C.Quaternion.fromRotationMatrix(R, st.quat), MODEL_FIX, st.quat);
    // arrays: rotate about body +Y so their +Z normal points at the sun: theta = atan2(sun.x, sun.z) in body axes
    C.Quaternion.fromAxisAngle(SOLAR_AXIS, Math.atan2(C.Cartesian3.dot(this.sunEcf, X), C.Cartesian3.dot(this.sunEcf, Z)), st.solar);
    const sd = C.Cartesian3.dot(st.pos, this.sunEcf);    // in Earth's shadow: behind the Earth and inside its cylinder
    st.shadow = sd < 0 && C.Cartesian3.magnitude(C.Cartesian3.subtract(st.pos, C.Cartesian3.multiplyByScalar(this.sunEcf, sd, T), T)) < 6371000;
    st.ok = true; return st;
  },
  async ensure(s) {
    if (s.ent) return s.ent;
    if (!s.pt) return null;                              // still loading (the list fills before the dots exist)
    const type = s.model === undefined ? (s.model = this.classify(s)) : s.model;
    if (!type) return null;
    const solar = await this.solarNodes(type);
    if (solar === null || s.ent) return s.ent || null;   // model file missing (or added while awaiting)
    const nodeTransformations = {};
    for (const n of solar) nodeTransformations[n] = new C.NodeTransformationProperty({ rotation: new C.CallbackProperty(t => this.state(s, t).solar, false) });
    s.ent = viewer.entities.add({
      position: new C.CallbackProperty(t => { const st = this.state(s, t); return st.ok ? st.pos : undefined; }, false),
      orientation: new C.CallbackProperty(t => this.state(s, t).quat, false),
      model: { uri: this.dir + type + '.glb', environmentMapOptions: NO_ENV_MAP, minimumPixelSize: 34, maximumScale: 4.0e4, nodeTransformations, runAnimations: false,
        customShader: new C.CallbackProperty(t => this.state(s, t).shadow ? SHADOW_FILL : undefined, false) },
    });
    s.ent.sat = s; s.pt.show = false; this.pool.set(s.id, s);
    return s.ent;
  },
  drop(s) {
    if (!s.ent || !s.pt || s === this.followed || s === state.selected) return;
    viewer.entities.remove(s.ent); s.ent = null; this.pool.delete(s.id);
    s.pt.show = L[s.layer].on && !s.docked;
  },
  refresh() { // which satellites get a model: the nearest within range, plus the selected and followed ones
    if (state.lookup) { for (const s of [...this.pool.values()]) this.drop(s); return; }   // from the ground, a model is a giant streak
    const st = Sats.state; if (!st) return;
    const cam = camera.positionWC, b = st.buf, dt = (Date.now() - st.t) / 1000, near = [];
    for (const s of Sats.list) {
      if (!L[s.layer].on || s.model === null) continue;
      const i = s.idx * 6; if (Number.isNaN(b[i])) continue;
      const dx = (b[i] + b[i + 3] * dt) * 1000 - cam.x, dy = (b[i + 1] + b[i + 4] * dt) * 1000 - cam.y, dz = (b[i + 2] + b[i + 5] * dt) * 1000 - cam.z;
      const d2 = dx * dx + dy * dy + dz * dz; if (d2 < this.range * this.range) near.push([d2, s]);
    }
    near.sort((p, q) => p[0] - q[0]);
    // docked vehicles and station modules have their own TLEs at the station's position: no model, no dot. Checked over
    // the whole catalogue (not just near the camera), so Follow/selection can never pick a docked one.
    // Docking changes on a scale of days: rechecked every 10 s, not every refresh (the full pass, stations x 18,000
    // objects, was the globe's second-biggest main-thread cost on a phone), with no allocation in the inner loop.
    if (!this.dockedAt || Date.now() - this.dockedAt > 10e3) {
      this.dockedAt = Date.now();
      this.stations = this.stations || Sats.list.filter(x => ['iss', 'css'].includes(this.classify(x)));
      const docked = new Set();
      for (const st2 of this.stations) {
        const j = st2.idx * 6; if (Number.isNaN(b[j])) continue;
        const px = b[j] + b[j + 3] * dt, py = b[j + 1] + b[j + 4] * dt, pz = b[j + 2] + b[j + 5] * dt;
        for (const s of Sats.list) {
          if (s === st2) continue; const i = s.idx * 6, x = b[i]; if (Number.isNaN(x)) continue;
          const dx = x + b[i + 3] * dt - px; if (dx > 5 || dx < -5) continue;
          const dy = b[i + 1] + b[i + 4] * dt - py, dz = b[i + 2] + b[i + 5] * dt - pz; if (dx * dx + dy * dy + dz * dz < 25) docked.add(s);
        }
      }
      for (const s of Sats.list) {
        const was = s.docked; s.docked = docked.has(s);
        if (was !== s.docked && s.pt) s.pt.show = L[s.layer].on && !s.ent && !s.docked;
        if (s.docked && s.ent && s !== this.followed) this.drop(s);
      }
    }
    const want = new Set(near.filter(x => !x[1].docked).slice(0, this.max).map(x => x[1]));
    if (this.followed) want.add(this.followed);
    const sel = state.selected; if (sel && sel.kind === 'sat' && !sel.docked) want.add(sel);
    for (const s of [...this.pool.values()]) if (!want.has(s)) this.drop(s);
    for (const s of want) if (!s.ent && L[s.layer].on) this.ensure(s);
  },
  get followed() { return Follow.obj && Follow.obj.kind === 'sat' ? Follow.obj : null; },
  async follow(s) {
    if (s.docked) { // follow the station it is docked to
      const st = Sats.list.find(x => ['iss', 'css'].includes(x.model ?? this.classify(x)) && x.ent) || Sats.list.find(x => x.name === 'ISS (ZARYA)');
      if (st) { toast(`${s.name} is docked to ${st.name} · following the station`); s = st; }
    }
    const ent = await this.ensure(s);
    if (!ent) { toast('No 3D model for this object'); return; }
    if (!this.state(s).ok) { toast('No position for this object right now'); return; }
    Follow.start(s, t => { const st = this.state(s, t); return st.ok ? st.pos : null; }, this.view[s.model] || 40, ent, 34);
  },
};
