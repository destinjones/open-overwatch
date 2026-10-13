// Comets as bodies you can find, follow and click: the famous ones, the ones near the Sun right now, and any other
// comet picked in the search. Each has a glowing coma and two tails from src/core/comets.js: a straight blue ion tail
// along the solar wind and a curved, yellow-white dust tail of grains shed over the past weeks. Both switch on inside
// ~5 AU and grow toward the Sun. (All 1,800 comets on closed orbits also fly as points with the asteroids:
// smallbodies.js.) Open-orbit comets (parabolic, hyperbolic, interstellar) are drawn as an arc around perihelion.
import * as THREE from 'three';
import { KM_AU } from '../core/units.js';
import { orbitPath } from '../core/kepler.js';
import { cometFromRow, cometNames, cometPosition, cometVelocity, cometClass, cometPeriodYears, activity, ionTail, dustTail, dustDays, cometsNearNow, conicArc, perihelionPassages, COMET_FACTS } from '../core/comets.js';
import { distance, period } from '../core/format.js';
import { formatUtc } from '../core/time.js';
import { relativeTime } from '../core/craft.js';
import { LOGDEPTH_V, LOGDEPTH_F, glowTexture } from './util.js';
import { addBody, removeBody, byKey, bodies, layerOn, onLayers } from './world.js';

// designations (not names: dozens of comets are called "NEOWISE" or "ATLAS" after the surveys that found them)
const FAMOUS = ['1P/', '2P/', '12P/', '13P/', '29P/', '55P/', '67P/', '109P/', 'C/1995 O1', 'C/2020 F3', 'C/2023 A3', 'C/2025 N1', 'C/2025 A6'];
const N_DUST = 28, N_ION = 10;

const RIBBON_V = LOGDEPTH_V + `attribute float a; varying float vA;
  void main() { vA = a; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }`;
const RIBBON_F = LOGDEPTH_F + `uniform vec3 uCol; uniform float uOp; varying float vA;
  void main() {
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(uCol * vA * uOp, 1.0);
    #include <colorspace_fragment>
  }`;

/** A camera-facing strip through a polyline, three vertices across (edge, centre, edge) so the edges fade out:
 *  width(k) is the half-width at point k, alpha(k) the brightness along its centre line. */
function ribbon(n, color) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 9), 3));
  g.setAttribute('a', new THREE.BufferAttribute(new Float32Array(n * 3), 1));
  const idx = [];
  for (let k = 0; k < n - 1; k++) for (let j = 0; j < 2; j++) { const a = k * 3 + j, b = a + 3; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: { uCol: { value: new THREE.Color(color) }, uOp: { value: 1 } }, vertexShader: RIBBON_V, fragmentShader: RIBBON_F,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  m.frustumCulled = false; m.visible = false;
  const t = new THREE.Vector3(), side = new THREE.Vector3(), toCam = new THREE.Vector3(), p = new THREE.Vector3();
  m.userData.set = (pts, width, alpha, cam) => {
    const P = g.attributes.position, A = g.attributes.a;
    for (let k = 0; k < n; k++) {
      p.set(pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2]);
      const j0 = Math.max(0, k - 1), j1 = Math.min(n - 1, k + 1);
      t.set(pts[j1 * 3] - pts[j0 * 3], pts[j1 * 3 + 1] - pts[j0 * 3 + 1], pts[j1 * 3 + 2] - pts[j0 * 3 + 2]);
      toCam.copy(cam).sub(p); side.crossVectors(t, toCam); const l = side.length(); if (l > 0) side.multiplyScalar(width(k) / l);
      P.setXYZ(k * 3, p.x + side.x, p.y + side.y, p.z + side.z); P.setXYZ(k * 3 + 1, p.x, p.y, p.z); P.setXYZ(k * 3 + 2, p.x - side.x, p.y - side.y, p.z - side.z);
      A.setX(k * 3, 0); A.setX(k * 3 + 1, alpha(k)); A.setX(k * 3 + 2, 0);
    }
    P.needsUpdate = A.needsUpdate = true;
  };
  return m;
}

const COMA = glowTexture([[0, 'rgba(235,250,255,1)'], [0.12, 'rgba(190,230,255,.65)'], [0.4, 'rgba(120,190,255,.14)'], [1, 'rgba(90,160,255,0)']]);

export function createComets({ scene, focus: focusOf = () => null }) {
  const list = [], v = new THREE.Vector3(), vel = {}, pos = {};
  let rows = [];

  function cometBody(row, { transient = false } = {}) {
    const key = 'comet:' + row[0]; if (byKey[key]) return byKey[key];
    if (transient) for (const old of list.filter(b => b.transient)) drop(old);
    const c = cometFromRow(row), names = cometNames(row[0]), group = new THREE.Group(); scene.add(group);
    const coma = new THREE.Sprite(new THREE.SpriteMaterial({ map: COMA, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    coma.visible = false; scene.add(coma);
    const dust = ribbon(N_DUST, 0xfff0d2), ion = ribbon(N_ION, 0x6fb7ff); scene.add(dust, ion);
    let orbit;
    if (c.e < 1) { const a = c.q / (1 - c.e); orbit = new THREE.LineLoop(lineGeo(orbitPath({ a, e: c.e, i: c.i, node: c.node, peri: c.peri }, 1440)), orbitMat()); }
    else orbit = new THREE.Line(lineGeo(conicArc(c, c.tp - 20 * 365.25, c.tp + 20 * 365.25, 600)), orbitMat());
    orbit.userData.opacity = 0.3; orbit.visible = layerOn('comets'); scene.add(orbit);
    const P = cometPeriodYears(c), fact = COMET_FACTS[names.designation] || null;
    const b = addBody({ key, name: names.display, kind: 'comet', color: '#bfe3ff', radius: 5 * KM_AU, pos: new THREE.Vector3(), group, c, coma, dust, ion, orbit, small: true, layer: 'comets', transient,
      aliases: names.aliases, weight: FAMOUS.some(f => row[0].startsWith(f)) ? 60 : 20, fact,
      posAt: (jd, out) => cometPosition(c, jd, out),
      // perihelion passages around now (two-body: within days to months for a century or two either side)
      timeline: () => { const jd = b.jd ?? c.tp, span = Math.min(250, Math.max(10, P * 2.5)) * 365.25, t = perihelionPassages(c, jd - span, jd + span);
        const keep = t.length > 9 ? t.filter(x => Math.abs(x - jd) <= [...t].map(y => Math.abs(y - jd)).sort((a, z) => a - z)[8]) : t;
        return keep.map(x => [x, c.e >= 1 ? 'Perihelion: its one pass by the Sun' : 'Perihelion (two-body estimate)']); },
      update(jd) { cometPosition(c, jd, b.pos); group.position.copy(b.pos); b.jd = jd; },
      info() {
        const jd = b.jd, r = b.pos.length(), dE = b.pos.distanceTo(byKey.earth.pos), out = [['Type', cometClass(c)], ['Designation', names.designation === names.display ? row[0] : names.designation],
          ['From the Sun', distance(r)], ['From Earth', distance(dE)]];
        const vv = cometVelocity(c, jd, vel); out.push(['Speed (Sun)', (Math.hypot(vv.x, vv.y, vv.z) * 1731.456837).toFixed(1) + ' km/s']);
        // perihelion passages: the last and the next (open orbits have only one)
        let tp = c.tp; if (Number.isFinite(P)) { const Pd = P * 365.25; tp = c.tp + Math.round((jd - c.tp) / Pd) * Pd; if (tp < jd - Pd / 2) tp += Pd; }
        out.push(['Perihelion', `${formatUtc(tp).slice(0, 10)} · ${relativeTime(tp - jd)} · ${c.q.toFixed(3)} AU from the Sun`]);
        if (Number.isFinite(P)) out.push(['Orbit', period(P * 365.25) + ' · out to ' + (c.q * (1 + c.e) / (1 - c.e)).toFixed(1) + ' AU']);
        else out.push(['Orbit', c.e > 1.2 ? 'hyperbolic: passing through once, from another star' : 'open: leaving the Solar System']);
        out.push(['Tails', activity(r) > 0.02 ? 'active (drawn to direction; lengths illustrative)' : 'none this far from the Sun']);
        return out;
      } });
    list.push(b); return b;
  }
  function drop(b) {
    removeBody(b); list.splice(list.indexOf(b), 1);
    for (const o of [b.group, b.coma, b.dust, b.ion, b.orbit]) { scene.remove(o); o.geometry?.dispose?.(); }
  }
  const lineGeo = pts => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pts, 3)); return g; };
  const orbitMat = () => new THREE.LineBasicMaterial({ color: '#7fb6d9', transparent: true, opacity: 0.3, depthWrite: false });

  /** rows: small_bodies.json comets. Famous comets and the best placed ones near the Sun at jd become bodies. */
  function init(r, jd, earth) {
    rows = r;
    for (const row of rows) if (FAMOUS.some(f => row[0].startsWith(f))) cometBody(row);
    for (const n of cometsNearNow(rows, jd, earth, { maxR: 2.5, limit: 8 })) cometBody(n.row);
    for (const b of list) b.update(jd);
  }

  onLayers(() => { for (const b of list) b.orbit.visible = b.group.visible = layerOn('comets'); });

  const cam = new THREE.Vector3(), dir = new THREE.Vector3();
  return {
    init, cometBody, list,
    get rows() { return rows; },
    frame({ camera, camSun, fade, jd }) {
      const on = layerOn('comets'), far = 1 - fade(2000, 3e4, camSun); cam.copy(camera.position);
      const pxAngle = 2 * Math.tan(camera.fov * Math.PI / 360) / innerHeight;   // radians per CSS pixel
      for (const b of list) {
        b.orbit.material.opacity = b.orbit.userData.opacity * far;
        const r = b.pos.length(), act = activity(r), camD = cam.distanceTo(b.pos), show = on && act > 0.005 && camSun < 400 && jd != null;
        // we have no brightness (absolute magnitude) for most comets: the famous ones are drawn bright, others faint
        const glow = b === focusOf() ? 0.8 : b.weight >= 60 ? 0.6 : 0.25;
        b.coma.visible = b.dust.visible = b.ion.visible = show; if (!show) continue;
        // coma: real size ~10^5 km scaled by activity, but never under ~5 px, so a comet reads as a fuzzy star
        const s = Math.max(4e5 * KM_AU * act, camD * pxAngle * 5); b.coma.position.copy(b.pos); b.coma.scale.setScalar(s * 2); b.coma.material.opacity = 0.35 + 0.65 * act;
        // ion tail: straight, narrow, fading to its tip
        const ion = ionTail(cometPosition(b.c, jd, pos), cometVelocity(b.c, jd, vel)), L = Math.max(ion.length, s * 6);
        dir.set(ion.dir.x, ion.dir.y, ion.dir.z);
        const ip = new Float32Array(N_ION * 3);
        for (let k = 0; k < N_ION; k++) { const f = k / (N_ION - 1); ip[k * 3] = b.pos.x + dir.x * L * f; ip[k * 3 + 1] = b.pos.y + dir.y * L * f; ip[k * 3 + 2] = b.pos.z + dir.z * L * f; }
        b.ion.userData.set(ip, k => (0.15 + 0.85 * k / (N_ION - 1)) * L * 0.025 + s * 0.15, k => (1 - k / (N_ION - 1)) ** 1.5 * 0.8, cam);
        b.ion.material.uniforms.uOp.value = act * glow;
        // dust tail: the syndyne, widening with age
        const dp = dustTail(b.c, jd, { days: dustDays(r), n: N_DUST });
        const tipD = Math.hypot(dp[(N_DUST - 1) * 3] - b.pos.x, dp[(N_DUST - 1) * 3 + 1] - b.pos.y, dp[(N_DUST - 1) * 3 + 2] - b.pos.z);
        b.dust.userData.set(dp, k => s * 0.25 + tipD * 0.08 * (k / (N_DUST - 1)), k => (1 - k / (N_DUST - 1)) ** 1.5 * 0.45, cam);
        b.dust.material.uniforms.uOp.value = act * glow;
      }
    },
  };
}
