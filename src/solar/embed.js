// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The Solar System as the far half of one continuous zoom: globe.html loads this page in an iframe (?embed=1) and hands
// the camera over past the Moon; zooming back into Earth hands it back. Cameras cross as Earth-centred vectors in the
// ecliptic frame (metres) plus the vertical field of view, so both renderers show the same picture at the switch.
import * as THREE from 'three';
import { AU_KM } from '../core/units.js';
import { byKey } from './world.js';
import { CALM } from './util.js';
import { FLIGHT, ease, slerpDir } from '../core/motion.js';

export const EMBED = new URLSearchParams(location.search).has('embed');
const AU_M = AU_KM * 1000;
export const EXIT_M = 2.2e8;   // zooming into Earth below this hands back to the globe (the globe hands over at 3.0e8: hysteresis)

const Z = new THREE.Vector3(0, 0, 1), v = new THREE.Vector3();

/**
 * camera/controls/nav/clock: the view's objects. loop: { pause(), resume() } for the render loop.
 * Returns { api (exposed as OOSS.embed), frame(view) -> true while a hand-over animation owns the camera }.
 */
export function createEmbed({ camera, controls, nav, clock, loop, update }) {
  let anim = null, active = false, armed = false;   // armed: the camera has been out past EXIT_M since the hand-over
  const parentSpace = () => { try { return window.parent !== window && window.parent.OO3D && window.parent.OO3D.space; } catch (e) { return null; } };

  const api = {
    ready: false,
    get active() { return active; },
    /** From the globe: { offset, dir, up } (ecliptic, metres from Earth's centre), fovy (radians). */
    enterFromGlobe(s) {
      if (s.live) clock.goLive(); else { clock.setJd(s.jd); clock.setRate(s.rate); }
      update(clock.jd);
      const earth = byKey.earth, off = new THREE.Vector3(s.offset.x, s.offset.y, s.offset.z).divideScalar(AU_M);
      nav.focus = earth; nav.fly = null; nav.free = false;
      camera.fov = THREE.MathUtils.radToDeg(s.fovy); camera.updateProjectionMatrix();
      camera.position.copy(earth.pos).add(off);
      camera.up.set(s.up.x, s.up.y, s.up.z).normalize();
      const aim = camera.position.clone().addScaledVector(new THREE.Vector3(s.dir.x, s.dir.y, s.dir.z).normalize(), off.length());
      controls.target.copy(aim); camera.lookAt(aim); controls.minDistance = earth.radius * 1.15;
      // then, over 1.6 s (core/motion.js FLIGHT.handover, eased like every other flight): aim at Earth's centre and roll "up" to the ecliptic north, the frame the solar view orbits in.
      // The roll is Earth-centred (Earth moves ~170,000 km in 1.6 s at the globe's 1 h/s), and ends at least a little
      // past EXIT_M, so a fast clock can't leave the camera inside it and bounce the view straight back to the globe.
      const d0 = off.length(), d1 = Math.max(d0, EXIT_M * 1.05 / AU_M);
      anim = { t0: performance.now(), dur: CALM.matches ? 1 : FLIGHT.handover * 1000, up0: camera.up.clone().normalize(), dir: off.clone().divideScalar(d0), d0, d1, aimRel: aim.clone().sub(earth.pos) };
      armed = false;
      controls.enabled = false; active = true; loop.resume();
    },
    pause() { active = false; loop.pause(); },
    /** Fly down to Earth; crossing EXIT_M hands back to the globe (the "3D globe" link, the Earth card). */
    goToEarth() { nav.focusOn(byKey.earth, EXIT_M * 0.8 / AU_M, FLIGHT.rung, false); },
  };

  function frame() {
    if (anim) {
      const k = Math.min(1, (performance.now() - anim.t0) / anim.dur), e = ease(k), earth = byKey.earth.pos;
      camera.position.copy(earth).addScaledVector(anim.dir, anim.d0 + (anim.d1 - anim.d0) * e);
      controls.target.copy(earth).add(anim.aimRel).lerp(earth, e);
      slerpDir(anim.up0, Z, e, camera.up);   // along the great circle: a lerp from an upside-down globe camera passes through zero and flips the view
      if (k >= 1) { camera.up.copy(Z); anim = null; controls.enabled = true; }
      return true;
    }
    const space = parentSpace(), dEarth = camera.position.distanceTo(byKey.earth.pos) * AU_M;
    if (dEarth >= EXIT_M) armed = true;
    // hand Earth back to the globe: measured to Earth itself, and not mid-flight (a flight's target is still moving)
    if (active && armed && space && !nav.fly && nav.focus === byKey.earth && dEarth < EXIT_M) {
      const earth = byKey.earth.pos;
      active = false;
      space.leave({
        offset: v.copy(camera.position).sub(earth).multiplyScalar(AU_M).clone(),
        dir: camera.getWorldDirection(new THREE.Vector3()),
        up: new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion),
        live: clock.live, jd: clock.jd, rate: clock.rate,
      });
    }
    return false;
  }
  return { api, frame };
}
