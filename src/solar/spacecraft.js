// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Deep-space missions from JPL Horizons trajectories (data/solar/spacecraft.json, fixed time steps; maths in
// src/core/craft.js). Each craft draws the path it has flown (bright) and the path still planned (faint), and the
// focused craft marks its mission events along the track. Cards carry the mission, the signal time to Earth, the next
// event with a countdown, and a timeline whose entries jump the clock there. A craft in orbit around a planet (Juno, Mars
// Orbiter Mission, BepiColombo at Mercury) or the Moon (Chandrayaan) rides its two-body orbit around the body on screen
// (core/craft.js track.local), and that orbit is drawn there.
import * as THREE from 'three';
import { KM_AU, AU_KM } from '../core/units.js';
import { fetchAsset } from '../core/assets.js';
import { distance, lightTime } from '../core/format.js';
import { formatUtc } from '../core/time.js';
import { trackPosition, trackSpeed, missionPhase, eventsAround, relativeTime, escaping, lagrangeL1L2, inLocal, localOrbit, localPosition, periapses, statusAt, endedJd, trailRanges } from '../core/craft.js';
import { planetPosition, PHYSICAL } from '../core/planets.js';
import { orbitPath } from '../core/kepler.js';
import { STAR_TEXTURE } from './util.js';
import { addBody, byKey, layer, layerOn, onLayers } from './world.js';

const FLOWN = 0xffb44d, AHEAD = 0xffd9a3, LP = {};
/** Where the view draws a planet or the Moon (the centre of a planet- or Moon-centred track). */
const centerAt = (key, jd, out) => key === 'moon' ? byKey.moon?.posAt(jd, out) ?? null : planetPosition(key, jd, out);
const AROUND = { moon: 'the Moon', mercury: 'Mercury', mars: 'Mars', jupiter: 'Jupiter' };

export function createSpacecraft({ scene }) {
  const craft = [];
  // event markers of the focused craft: one small Points object, refilled when the focus changes
  const markGeo = new THREE.BufferGeometry(); markGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 64), 3));
  const marks = new THREE.Points(markGeo, new THREE.PointsMaterial({ color: 0xfff1d6, size: 7, sizeAttenuation: false, map: STAR_TEXTURE, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  marks.frustumCulled = false; marks.visible = false; scene.add(marks);
  let marked = null;

  function markEvents(c) {
    marked = c; if (!c) { marks.visible = false; return; }
    const a = markGeo.attributes.position, p = {}; let n = 0;
    for (const e of c.s.events) if (n < 64 && trackPosition(c.s, e[0], p)) { a.setXYZ(n++, p.x, p.y, p.z); }
    a.needsUpdate = true; markGeo.setDrawRange(0, n); marks.visible = n > 0;
  }

  async function load() {
    for (const s of await fetchAsset('data/solar/spacecraft.json', 'json')) {
      if (s.xyz.length < 6) continue;
      // two geometries over one position buffer: each keeps its own draw range (flown so far / still to come)
      const attr = new THREE.BufferAttribute(new Float32Array(s.xyz), 3), g = new THREE.BufferGeometry(), g2 = new THREE.BufferGeometry();
      g.setAttribute('position', attr); g2.setAttribute('position', attr);
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: FLOWN, transparent: true, opacity: 0.55, depthWrite: false }));
      const ahead = new THREE.Line(g2, new THREE.LineBasicMaterial({ color: AHEAD, transparent: true, opacity: 0.16, depthWrite: false }));
      line.frustumCulled = ahead.frustumCulled = false;   // the bounding sphere of a whole track is huge anyway
      line.visible = ahead.visible = layerOn('craft'); scene.add(line, ahead);
      const group = new THREE.Group(); scene.add(group);
      const leaving = escaping(s), ended = endedJd(s);
      const short = s.alias && s.alias[0] && s.name.length > 18 ? s.alias[0] : null;
      // the osculating orbit around the planet, redrawn when the element set in force changes
      let localLine = null, localKey = null;
      if (s.local) {
        localLine = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: FLOWN, transparent: true, opacity: 0.5, depthWrite: false }));
        localLine.frustumCulled = false; localLine.visible = false; scene.add(localLine);
      }
      const pjs = periapses(s), Rp = s.local ? PHYSICAL[s.local.center].radiusKm : 0;
      const c = addBody({ key: 'craft:' + s.name, name: short || s.name, fullName: s.name, kind: 'spacecraft', color: '#ffb44d', radius: 0.01 * KM_AU, pos: new THREE.Vector3(), group, line, ahead, s, vel: 0,
        fact: s.desc, layer: 'craft', small: true, aliases: [s.name, ...(s.alias || []), s.agency].filter(Boolean), weight: 50,
        posAt: (jd, out) => trackPosition(s, jd, out, centerAt) || out.copy(c.pos),   // the light-delay ghost
        update(jd) {
          const p = trackPosition(s, jd, c.pos, centerAt); c.launched = !!p && jd >= s.launch_jd; group.visible = c.launched && layerOn('craft');
          if (localLine) {
            const on = inLocal(s, jd) && layerOn('craft');
            localLine.visible = on;
            if (on) {
              const o = localOrbit(s, jd), key = o.tp + ':' + o.q;
              if (key !== localKey) { localKey = key; localLine.geometry.dispose(); localLine.geometry = new THREE.BufferGeometry(); localLine.geometry.setAttribute('position', new THREE.BufferAttribute(orbitPath({ a: o.q / (1 - o.e), e: o.e, i: o.i, node: o.node, peri: o.peri }, 720), 3)); }
              centerAt(s.local.center, jd, localLine.position);
            }
          }
          if (p) c.vel = trackSpeed(s, jd, centerAt) ?? c.vel;   // on the orbit it rides around a planet or the Moon
          // the path flown so far (unfocused: the last year, or the whole way out for craft leaving the Sun) and the path
          // still planned (unfocused: the next half year); a mission that has ended keeps its dot but not its lines, and
          // one past its published track (no dot) draws none either (core/craft.js trailRanges)
          const r = trailRanges(s, jd, c === marked, leaving, ended);
          c.over = r.over;
          line.geometry.setDrawRange(r.flown[0], r.flown[1]);
          ahead.geometry.setDrawRange(r.ahead[0], r.ahead[1]);
          c.jd = jd;
        },
        info() {
          const jd = c.jd, phase = missionPhase(s, jd), rows = [['Mission', s.agency], ['Status', phase === 'flying' ? statusAt(s, jd) : phase === 'coasting' ? 'Coasting outward (past the published track)' : phase === 'before launch' ? 'Not launched yet' : 'No published position after ' + formatUtc(s.end_jd).slice(0, 10)]];
          rows.push(['Launched', formatUtc(s.launch_jd).slice(0, 10) + ' · ' + relativeTime(s.launch_jd - jd)]);
          if (c.launched) {
            const dE = c.pos.distanceTo(byKey.earth.pos);
            rows.push(['From the Sun', distance(c.pos.length())], ['From Earth', distance(dE)], ['Signal to Earth', lightTime(dE) + ' each way'], ['Speed (Sun)', c.vel.toFixed(1) + ' km/s']);
          }
          if (s.local && inLocal(s, jd) && c.launched) {   // height over the body it circles (equatorial radius)
            const l = localPosition(s, jd, LP);
            rows.push([`Above ${AROUND[s.local.center] || s.local.center}`, Math.round(Math.hypot(l.x, l.y, l.z) * AU_KM - Rp).toLocaleString('en-US') + ' km']);
          }
          if (pjs.length && inLocal(s, jd)) {   // perijoves: the passes over the cloud tops
            let i = pjs.findIndex(t => t > jd); if (i < 0) i = pjs.length;
            const alt = k => Math.round(s.local.pj[k].el[Math.floor(s.local.pj[k].el.length / 2)][0] - Rp).toLocaleString('en-US');
            if (i > 0) rows.push(['Last perijove', `PJ${i} · ${relativeTime(pjs[i - 1] - jd)} · ${alt(i - 1)} km above the cloud tops`]);
            if (i < pjs.length) rows.push(['Next perijove', `PJ${i + 1} · ${relativeTime(pjs[i] - jd)} · ${formatUtc(pjs[i]).slice(0, 16)} UTC`]);
          }
          const { last, next } = eventsAround(s, jd);
          if (last && last[1] !== 'Launch') rows.push(['Last', last[1] + ' · ' + relativeTime(last[0] - jd)]);
          if (next) rows.push(['Next', next[1] + ' · ' + relativeTime(next[0] - jd)]);
          if (!leaving && phase === 'flying' && s.end_jd < 2464290) rows.push(['Track ends', formatUtc(s.end_jd).slice(0, 10)]);
          return rows;
        },
        // the mission's events, and for an orbiter the perijoves nearest the clock (all 109 would bury the rest)
        timeline: () => { if (!pjs.length) return s.events; const jd = c.jd ?? s.t0_jd;
          const near = pjs.map((t, i) => [t, `Perijove ${i + 1}: ${s.name} skims ${s.local.center[0].toUpperCase() + s.local.center.slice(1)}`]).filter(e => Math.abs(e[0] - jd) < 120);
          return [...s.events, ...near].sort((a, b) => a[0] - b[0]); },
        onFocus(on) { markEvents(on ? c : null); },
      });
      craft.push(c);
    }
    layer('craft').n = craft.length;
  }
  // Sun-Earth L1 and L2, where JWST, Gaia, SOHO and others work: points that ride along with Earth
  const LPOINTS = [['L1', 'Sun-Earth L1', 'Between the Sun and Earth, 1.5 million km out: SOHO, DSCOVR and Aditya-L1 watch the Sun from here without Earth ever getting in the way.'],
    ['L2', 'Sun-Earth L2', 'Beyond Earth, 1.5 million km out, with the Sun, Earth and Moon all on one side: JWST, Gaia and Euclid observe from orbits around this point.']];
  for (const [id, name, fact] of LPOINTS) {
    const p = addBody({ key: 'lagrange:' + id, name, kind: 'Lagrange point', color: '#ffd9a3', radius: 0, pos: new THREE.Vector3(), fact, layer: 'craft', aliases: [id], weight: 20,
      update() { const E = byKey.earth; if (E) p.pos.copy(lagrangeL1L2(E.pos)[id]); },
      info: () => [['From Earth', distance(p.pos.distanceTo(byKey.earth.pos))], ['From the Sun', distance(p.pos.length())]] });
  }
  onLayers(() => { for (const c of craft) c.line.visible = layerOn('craft'); if (!layerOn('craft')) marks.visible = false; else if (marked) markEvents(marked); });
  return {
    load, craft, centerAt,
    frame({ camSun, fade }) {
      const o = 1 - fade(2000, 3e4, camSun), on = layerOn('craft');
      for (const c of craft) {
        const f = c === marked; c.line.material.opacity = (f ? 0.8 : 0.4) * o; c.ahead.material.opacity = (f ? 0.32 : 0.12) * o;
        c.ahead.visible = on && o > 0.01 && c.ahead.geometry.drawRange.count > 1;
      }
      if (marks.visible) marks.material.opacity = 0.4 + 0.6 * o;
    },
  };
}
