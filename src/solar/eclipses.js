// Eclipses and lunar occultations, 2026-2030, seen from space. The events come from src/core/syzygy.js over JPL Horizons'
// Sun and Moon (data/solar/ephem.json, loaded on first use); while it is loaded the Moon is drawn at Horizons' position
// (the view's own formula is ~0.3 deg off, which would put the shadow beside it).
// - Shadows on the globes: Earth's and the Moon's shaders darken by how much of the Sun the other one hides (planets.js
//   globeMaterial "occluder"), so the Moon's shadow is a dark spot moving over Earth and the Moon turns red in Earth's
//   umbra (sunlight bent through Earth's atmosphere).
// - Near an event: the shadow cones (umbra and penumbra), the shadow's cross-section where the Moon crosses it, the
//   Sun-Earth-Moon line, and for an occultation the Moon's "shadow" toward the star (a cylinder) and the line to the star.
// - Every event is a body you can search ("eclipse 2027", "Regulus") with a card whose timeline (the contacts) sets the
//   clock; the list (left panel) jumps to any of them.
import * as THREE from 'three';
import { KM_AU, radecToEcl, eqToEcl, eclToEq } from '../core/units.js';
import { fetchAsset } from '../core/assets.js';
import { formatUtc } from '../core/time.js';
import { esc } from '../core/format.js';
import { relativeTime } from '../core/craft.js';
import { R_SUN, R_MOON, cones, outline } from '../core/eclipse.js';
import { createEphemeris, findEclipses, findOccultations, eventTitle, earthShadow, R_EARTH, DANJON, OCCULT_STARS, planetGeocentric } from '../core/syzygy.js';
import { addBody, byKey, layerOn, onLayers } from './world.js';

const UMBRA = 0xff6a3d, PENUMBRA = 0x9fb4c8, MOONSHADOW = 0x6fb7ff, OCC = 0xfff1a8;
const WINDOW = { solar: 0.18, lunar: 0.3, occultation: 0.12 };   // days either side of greatest when the diagram shows

/** "12°N 45°E" */
export const latLon = p => `${Math.abs(Math.round(p.lat))}°${p.lat >= 0 ? 'N' : 'S'} ${Math.abs(Math.round(p.lon))}°${p.lon >= 0 ? 'E' : 'W'}`;
const hhmm = jd => formatUtc(jd).slice(0, 16).replace('T', ' ');
const dur = m => m == null ? null : m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')} min` : `${Math.round(m)} min`;

/** Words for one event: { title, when, detail, where, key, contacts: [[jd, text]] } (shared by the card and the list). */
export function describe(e) {
  const title = eventTitle(e), date = formatUtc(e.jd).slice(0, 10);
  if (e.type === 'lunar') {
    const C = e.contacts, tl = [['P1', 'Moon enters the penumbra'], ['U1', 'Partial phase begins'], ['U2', 'Totality begins'], ['U3', 'Totality ends'], ['U4', 'Partial phase ends'], ['P4', 'Moon leaves the penumbra']]
      .filter(([k]) => C[k] != null).map(([k, t]) => [C[k], t]);
    tl.splice(tl.findIndex(x => x[0] > e.jd) < 0 ? tl.length : tl.findIndex(x => x[0] > e.jd), 0, [e.jd, 'Greatest eclipse']);
    const mag = e.kind === 'penumbral' ? `penumbral magnitude ${e.penumbral.toFixed(3)}` : `umbral magnitude ${e.umbral.toFixed(3)}`;
    return { key: `eclipse:lunar-${date}`, title, date, detail: mag + (e.durations.total ? ` · totality ${dur(e.durations.total)}` : e.durations.partial ? ` · partial phase ${dur(e.durations.partial)}` : ''),
      where: `the night side of Earth, centred on ${latLon(e.sub)} (the Moon overhead there)`, contacts: tl };
  }
  if (e.type === 'solar') {
    const tl = [[e.contacts.P1, 'The Moon\'s shadow first touches Earth'], [e.jd, 'Greatest eclipse'], [e.contacts.P4, 'The shadow leaves Earth']];
    const detail = e.central ? `${e.kind === 'annular' ? 'ring of fire' : e.kind === 'hybrid' ? 'total along part of the path, annular elsewhere' : 'totality'} on a path ${Math.round(e.width_km)} km wide · magnitude ${e.magnitude.toFixed(3)}`
      : `magnitude ${e.magnitude.toFixed(3)} at best`;
    return { key: `eclipse:solar-${date}`, title, date, detail, where: (e.central ? 'greatest at ' : 'deepest near ') + latLon(e.at), contacts: tl };
  }
  const how = e.central ? 'covered centrally' : 'a graze near the Moon\'s edge';
  return { key: `occult:${e.target}-${date}`, title, date, detail: `${how} · Moon ${Math.round(e.elongation)}° from the Sun`,
    where: `${e.central ? 'best ' : 'only '}around ${latLon(e.at)}, ${e.dark ? 'at night' : e.sunAlt > 0 ? 'in daylight' : 'in twilight'}`, contacts: [[e.jd, 'Closest to the line (mid-occultation)']] };
}

export function createEclipses({ scene, nav, clock, story }) {
  let eph = null, loading = null, events = [], ready = false;
  const geo = new THREE.Group(); geo.visible = false; scene.add(geo);   // everything rides at Earth's centre
  const mat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const lmat = (color, opacity) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  // an open frustum along +y from y = 0 to 1 (unit radii); setFrustum() gives each end its radius, place() its pose
  const frustum = m => {
    const g = new THREE.CylinderGeometry(1, 1, 1, 64, 1, true); g.translate(0, 0.5, 0);
    const P = g.attributes.position, ang = new Float32Array(P.count); for (let k = 0; k < P.count; k++) ang[k] = Math.atan2(P.getZ(k), P.getX(k));
    const o = new THREE.Mesh(g, m); o.frustumCulled = false; o.userData.ang = ang; geo.add(o); return o;
  };
  const earthUmbra = frustum(mat(UMBRA, 0.10)), earthPen = frustum(mat(PENUMBRA, 0.045));
  const moonUmbra = frustum(mat(MOONSHADOW, 0.16)), moonPen = frustum(mat(PENUMBRA, 0.05));
  const occTube = frustum(mat(OCC, 0.08));
  const ring = color => { const g = new THREE.BufferGeometry(), n = 96, p = new Float32Array(n * 3); for (let k = 0; k < n; k++) { p[k * 3] = Math.cos(k / n * 2 * Math.PI); p[k * 3 + 2] = Math.sin(k / n * 2 * Math.PI); } g.setAttribute('position', new THREE.BufferAttribute(p, 3)); const o = new THREE.LineLoop(g, lmat(color, 0.7)); o.frustumCulled = false; geo.add(o); return o; };
  const ringU = ring(UMBRA), ringP = ring(PENUMBRA);
  const line = color => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)); const o = new THREE.Line(g, lmat(color, 0.35)); o.frustumCulled = false; scene.add(o); o.visible = false; return o; };
  const sunLine = line(0xffe2a8), targetLine = line(OCC);
  // the Moon's shadow outlines on the ground (umbra, penumbra), in the Earth-centred group
  const spot = (color, n) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); const o = new THREE.LineLoop(g, lmat(color, 0.9)); o.frustumCulled = false; geo.add(o); return o; };
  const spotU = spot(MOONSHADOW, 64), spotP = spot(PENUMBRA, 96);

  function load() {
    if (!loading) loading = fetchAsset('data/solar/ephem.json', 'json').then(d => {
      eph = createEphemeris(d);
      // the Moon at Horizons' place while we have it (the shadows depend on it)
      const moon = byKey.moon, km = {};
      if (moon) moon.geoSource = (jd, out) => { if (!eph.has(jd)) return null; eph.moon(jd, km); return out.set(km.x * KM_AU, km.y * KM_AU, km.z * KM_AU); };
      const t0 = performance.now();
      events = [...findEclipses(eph), ...findOccultations(eph).map(o => ({ type: 'occultation', ...o }))].sort((a, b) => a.jd - b.jd);
      for (const e of events) { e.words = describe(e); register(e); }
      ready = true; api.computeMs = Math.round(performance.now() - t0);
      return events;
    }).catch(e => { loading = null; throw e; });
    return loading;
  }

  function register(e) {
    const w = e.words, at = e.type === 'solar' ? 'earth' : 'moon';
    const b = addBody({ key: w.key, name: `${w.title}, ${w.date}`, kind: e.type === 'occultation' ? 'lunar occultation' : e.type + ' eclipse', color: e.type === 'solar' ? '#6fb7ff' : e.type === 'lunar' ? '#ff8a5c' : '#fff1a8',
      radius: 0, pos: new THREE.Vector3(), small: true, layer: 'eclipses', event: e, weight: 35, launched: true,
      aliases: ['eclipse', e.type === 'occultation' ? 'occultation' : e.type + ' eclipse', w.date.slice(0, 4), w.date, e.name].filter(Boolean),
      fact: e.type === 'solar' ? 'The Moon passes between the Sun and Earth and its shadow sweeps across the ground. Watch the dark spot cross the globe, and the shadow cones in space.'
        : e.type === 'lunar' ? 'Earth passes between the Sun and the Moon. Inside Earth\'s umbra the Moon turns red: the only sunlight reaching it is bent through our atmosphere, every sunrise and sunset on Earth at once.'
          : `The Moon passes in front of ${e.name}. Wherever the Moon's "shadow" from ${e.kind === 'star' ? 'the star' : 'the planet'} (the yellow tube) crosses Earth, people see it disappear behind the Moon's edge and reappear up to an hour later.`,
      update() { const p = byKey[at]?.pos; if (p) b.pos.copy(p); },
      info() {
        const jd = clock.jd, rows = [['When', hhmm(e.jd) + ' UTC · ' + relativeTime(e.jd - jd)], ['What', w.detail], ['Seen from', w.where]];
        if (e.type === 'lunar') rows.push(['Gamma', e.gamma.toFixed(4) + ' (Moon\'s closest pass from the shadow\'s axis, Earth radii)']);
        if (e.type === 'solar') rows.push(['Gamma', e.gamma.toFixed(4) + ' (the shadow axis from Earth\'s centre, Earth radii)']);
        if (e.type === 'occultation') rows.push(['Pass', (e.impact).toFixed(3) + ' Earth radii from the line to ' + e.name + (e.kind === 'planet' ? ' (planet place to ~1 arcminute)' : '')]);
        rows.push(['Source', 'Sun and Moon: JPL Horizons (2026-2030); geometry: Open Overwatch']);
        return rows;
      },
      timeline: () => w.contacts,
      onFocus(on) { if (on && Math.abs(clock.jd - e.jd) > 2) jumpClock(e); } });
    e.body = b;
  }

  function jumpClock(e) { story?.stopTour?.(); clock.setJd(e.jd); clock.setRate(0); }
  /** Set the clock to the event's greatest moment (paused) and fly to a view of it from the side. */
  function jump(e, { watch = false } = {}) {
    jumpClock(e);
    // watch: from just before it starts, at 10 minutes a second (an occultation: 2 minutes a second)
    if (watch) { const first = e.type === 'occultation' ? e.jd - 1 / 24 : e.contacts.P1; clock.setJd(first - 10 / 1440); clock.setRate((e.type === 'occultation' ? 120 : 600) / 86400); }
    for (const b of [byKey.earth, byKey.moon]) b?.update?.(clock.jd);
    e.body.update(clock.jd);
    // where to look from (unit vector, focus -> camera): a solar eclipse from the sunward side, a little off the shadow
    // axis, so the dark spot sits on the lit globe; a lunar eclipse from Earth's side of the Moon, so its Earth-facing
    // (sunlit, now shadowed) face shows inside the shadow's rings; an occultation from the side, Earth and Moon both in view
    const s = eph.sun(e.jd), su = new THREE.Vector3(s.x, s.y, s.z).normalize(), up = new THREE.Vector3(0, 0, 1);
    const side = new THREE.Vector3().crossVectors(su, up).normalize();
    const dir = e.type === 'occultation' ? side.clone().multiplyScalar(-1).addScaledVector(up, 0.3).normalize()
      : su.clone().multiplyScalar(e.type === 'solar' ? 1 : 1).addScaledVector(side, 0.45).addScaledVector(up, 0.25).normalize();
    const d = e.type === 'solar' ? 0.00032 : e.type === 'lunar' ? 0.00026 : 0.0042;   // 48,000 km; 39,000 km; 630,000 km
    nav.focusOn(e.body, d, 2.4, true, dir);
  }

  /** The next events after jd (and the latest one before it), for the list. */
  function around(jd, n = 30) { const i = events.findIndex(e => e.jd > jd - 0.5); return i < 0 ? events.slice(-3) : events.slice(Math.max(0, i - 1), i - 1 + n); }

  // ---- per frame: which event is near, then the cones, rings and lines for it
  const ZERO = new THREE.Vector3(), E = new THREE.Vector3(), mk = {}, sk = {}, q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), w2 = new THREE.Vector3(), vw = new THREE.Vector3();
  /** Pose a frustum: its y = 0 end at origin, pointing along dir, len long; radii at the two ends (AU). */
  function place(o, origin, dir, len, r0, r1) {
    o.position.copy(origin); o.quaternion.setFromUnitVectors(Y, dir); o.scale.set(1, len, 1); o.visible = true;
    const P = o.geometry.attributes.position, ang = o.userData.ang;
    for (let k = 0; k < P.count; k++) { const r = P.getY(k) > 0.5 ? r1 : r0; P.setX(k, Math.cos(ang[k]) * r); P.setZ(k, Math.sin(ang[k]) * r); }
    P.needsUpdate = true;
  }
  function nearest(jd) { let best = null; for (const e of events) { const dt = Math.abs(e.jd - jd); if (dt < WINDOW[e.type] && (!best || dt < Math.abs(best.jd - jd))) best = e; } return best; }
  onLayers(() => { if (!layerOn('eclipses')) { geo.visible = sunLine.visible = targetLine.visible = false; } });

  function occluders(camera) {   // shader shadows: each globe learns where the other one is, in view space
    const earth = byKey.earth, moon = byKey.moon; if (!earth?.mesh || !moon?.mesh) return;
    const on = layerOn('eclipses') && !!eph;
    for (const [b, o, r] of [[earth, moon, R_MOON], [moon, earth, R_EARTH * DANJON]]) {
      const u = b.mesh.material.uniforms; if (!u.hasOcc) continue;
      u.hasOcc.value = on ? 1 : 0; if (!on) continue;
      u.occ.value.copy(o.pos).applyMatrix4(camera.matrixWorldInverse); u.occR.value = r * KM_AU; u.sunR.value = R_SUN * KM_AU;
      u.red.value = b === moon ? 1 : 0;
    }
  }

  const api = {
    load, jump, around, describe, get events() { return events; }, get ready() { return ready; }, get eph() { return eph; }, computeMs: 0,
    frame({ camera, jd }) {
      occluders(camera);
      const e = ready && layerOn('eclipses') ? nearest(jd) : null, near = e && camera.position.distanceTo(byKey.earth.pos) < 0.08;
      geo.visible = !!near; sunLine.visible = targetLine.visible = false;
      if (!near) return;
      for (const o of geo.children) o.visible = false;
      E.copy(byKey.earth.pos); geo.position.copy(E);
      eph.moon(jd, mk); eph.sun(jd, sk);
      const fade = 1 - Math.abs(e.jd - jd) / WINDOW[e.type];
      const sunDir = v.set(sk.x, sk.y, sk.z).normalize(), anti = w2.copy(sunDir).negate(), dS = Math.hypot(sk.x, sk.y, sk.z), moonG = vw.set(mk.x, mk.y, mk.z).multiplyScalar(KM_AU);
      // the Sun-Earth-Moon line, from the Sun through Earth to past the Moon
      const P = sunLine.geometry.attributes.position, far = E.clone().addScaledVector(anti, Math.max(moonG.length() * 1.25, 0.003));
      P.setXYZ(0, E.x + sunDir.x * dS * KM_AU, E.y + sunDir.y * dS * KM_AU, E.z + sunDir.z * dS * KM_AU); P.setXYZ(1, far.x, far.y, far.z); P.needsUpdate = true;
      sunLine.visible = true; sunLine.material.opacity = 0.35 * fade;
      if (e.type === 'lunar' || e.type === 'occultation') {
        // Earth's umbra (a cone to its tip ~1.4 million km out) and penumbra (widening), Danjon-enlarged
        const Re = R_EARTH * DANJON, tu = (R_SUN - R_EARTH) / dS, tp = (R_SUN + R_EARTH) / dS, Lu = Re / tu, x = Math.abs(moonG.dot(anti)) / KM_AU;
        if (e.type === 'lunar') {
          place(earthUmbra, ZERO, anti, Lu * KM_AU, Re * KM_AU, 0);
          place(earthPen, ZERO, anti, x * 1.6 * KM_AU, Re * KM_AU, (Re + x * 1.6 * tp) * KM_AU);
          const s = earthShadow(sk, mk), rU = Math.tan(s.rhoU) * x, rP = Math.tan(s.rhoP) * x, c = anti.clone().multiplyScalar(x * KM_AU);
          for (const [o, r] of [[ringU, rU], [ringP, rP]]) { o.position.copy(c); o.quaternion.setFromUnitVectors(Y, anti); o.scale.setScalar(r * KM_AU); o.visible = true; o.material.opacity = 0.75 * fade; }
          earthUmbra.material.opacity = 0.10 * fade; earthPen.material.opacity = 0.045 * fade;
        }
      }
      if (e.type === 'solar') {
        const c = cones(sk, mk), ax = new THREE.Vector3(c.axis.x, c.axis.y, c.axis.z), m0 = moonG.clone(), toEarth = Math.max(0, -moonG.dot(ax) / KM_AU) + R_EARTH * 1.2;
        const uLen = Math.min(c.umbraLen, toEarth);
        place(moonUmbra, m0, ax, uLen * KM_AU, R_MOON * KM_AU, Math.max(0, (c.umbraLen - uLen) * c.tu) * KM_AU);
        place(moonPen, m0, ax, toEarth * KM_AU, c.penumbraR0 * KM_AU, (c.penumbraR0 + toEarth * c.tp) * KM_AU);
        moonUmbra.material.opacity = 0.18 * fade; moonPen.material.opacity = 0.05 * fade;
        // the outlines on the ground: computed in J2000 equatorial axes (the ellipsoid's pole), drawn in ecliptic ones
        const sq = eclToEq(sk.x, sk.y, sk.z), mq = eclToEq(mk.x, mk.y, mk.z);
        for (const [o, which, n] of [[spotU, 'umbra', 64], [spotP, 'penumbra', 96]]) {
          const pts = outline(sq, mq, which, n), A = o.geometry.attributes.position;
          if (pts.length < n * 0.5) { o.visible = false; continue; }
          for (let k = 0; k < n; k++) { const p = pts[Math.min(k, pts.length - 1)], g = eqToEcl(p.x * 1.003, p.y * 1.003, p.z * 1.003); A.setXYZ(k, g.x * KM_AU, g.y * KM_AU, g.z * KM_AU); }
          A.needsUpdate = true; o.visible = true; o.material.opacity = 0.9 * fade;
        }
      }
      if (e.type === 'occultation') {
        // the Moon's "shadow" cast by the star: a tube of the Moon's radius along the starlight, past Earth
        const t = e.kind === 'star' ? radecToEcl(OCCULT_STARS.find(s => s.key === e.target).ra, OCCULT_STARS.find(s => s.key === e.target).dec) : planetGeocentric(e.target, jd);
        const u = new THREE.Vector3(t.x, t.y, t.z).normalize(), back = u.clone().negate(), along = moonG.dot(u) / KM_AU;
        place(occTube, moonG, back, (along + R_EARTH * 3) * KM_AU, R_MOON * KM_AU, R_MOON * KM_AU); occTube.material.opacity = 0.10 * fade;
        const T = targetLine.geometry.attributes.position, L = Math.max(moonG.length() * 4, 0.01);
        T.setXYZ(0, E.x + moonG.x, E.y + moonG.y, E.z + moonG.z); T.setXYZ(1, E.x + moonG.x + u.x * L, E.y + moonG.y + u.y * L, E.z + moonG.z + u.z * L); T.needsUpdate = true;
        targetLine.visible = true; targetLine.material.opacity = 0.5 * fade;
      }
    },
  };
  return api;
}
