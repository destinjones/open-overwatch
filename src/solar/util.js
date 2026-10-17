// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// three.js helpers shared by the Solar System view: log-depth shader chunks, textures with a site fallback, glows.
import * as THREE from 'three';
import { SITE } from '../core/assets.js';

export const PHONE = matchMedia('(max-width: 900px)').matches || (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600);
// reduced motion: camera flights jump instead of swooping (read live, so changing the setting applies at once)
export const CALM = matchMedia('(prefers-reduced-motion: reduce)');

// every custom shader must carry these, or it fights the logarithmic depth buffer
export const LOGDEPTH_V = '#include <common>\n#include <logdepthbuf_pars_vertex>\n';
export const LOGDEPTH_F = '#include <logdepthbuf_pars_fragment>\n';

/** A ShaderMaterial whose vertex shader passes view-space position, normal and uv; `frag` writes `col` and `alpha`. */
export function surfaceMaterial({ uniforms, frag, ...opts }) {
  return new THREE.ShaderMaterial({
    uniforms, ...opts,
    vertexShader: LOGDEPTH_V + `varying vec3 vN; varying vec3 vP; varying vec2 vUv;
      void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vP = mv.xyz; vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: LOGDEPTH_F + `varying vec3 vN; varying vec3 vP; varying vec2 vUv;
      ${frag.decl || ''}
      void main() {
        #include <logdepthbuf_fragment>
        vec3 col = vec3(0.0); float alpha = 1.0;
        ${frag.body}
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }`,
  });
}

const loader = new THREE.TextureLoader();
/** Load a texture from the page's folder, else from the published site; resolves null if both fail. */
export function loadTexture(path, { srgb = true } = {}) {
  return new Promise(resolve => {
    const done = t => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; resolve(t); };
    loader.load(path, done, undefined, () => loader.load(SITE + path, done, undefined, () => resolve(null)));
  });
}
// Everything starts on the 2k maps; the 4k ones (45 MB of GPU memory each with mipmaps) load only for what you fly
// close to, on desktops (Sharpen). Loading every 4k map up front cost ~600 MB of GPU memory and a 1.1 s upload freeze
// when the globe handed over to this view.
export const planetTexture = name => `brand/textures/planets/${name}_2k.jpg`;
export const sharpTexture = name => `brand/textures/planets/${name}.jpg`;
/** Swap a texture uniform's value, freeing the old texture. */
export function swapTexture(u, t) { const old = u.value; u.value = t; if (old && old !== t && old.dispose) old.dispose(); }
/** Sharper textures on demand: add(when, path, apply) loads `path` the first frame `when()` is true (desktop only). */
export const Sharpen = {
  camera: null, items: [],
  add(when, path, apply, opts) { if (!PHONE) this.items.push({ when, path, apply, opts }); },
  /** Same, on every device: textures that load only once they are about to be seen (phones were downloading 9 MB up front). */
  need(when, path, apply, opts) { this.items.push({ when, path, apply, opts }); },
  /** On-screen radius of a body in CSS pixels. */
  px(b) { const c = this.camera; return b.radius / Math.max(c.position.distanceTo(b.pos), 1e-12) * innerHeight / (2 * Math.tan(c.fov * Math.PI / 360)); },
  tick() {
    if (!this.camera || !this.items.length) return;
    this.items = this.items.filter(it => { if (!it.when()) return true; loadTexture(it.path, it.opts).then(t => t && it.apply(t)); return false; });
  },
};

/** Radial-gradient sprite texture. stops: [[offset, css colour], ...] */
export function glowTexture(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  stops.forEach(([o, col]) => gr.addColorStop(o, col)); g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export const STAR_TEXTURE = glowTexture([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,255,255,.75)'], [0.5, 'rgba(255,255,255,.12)'], [1, 'rgba(255,255,255,0)']]);

/** Smoothstep on a log scale: 0 below a, 1 above b. Most fades here are by distance across many decades. */
export function smoothLog(a, b, x) {
  const t = Math.min(1, Math.max(0, (Math.log(x) - Math.log(a)) / (Math.log(b) - Math.log(a))));
  return t * t * (3 - 2 * t);
}

export const toVector3 = (o, out = new THREE.Vector3()) => out.set(o.x, o.y, o.z);

/** A 1-pixel texture in one colour (sRGB '#rrggbb'): a globe's stand-in until its map arrives. */
export function flatTexture(hex) {
  const n = parseInt(hex.slice(1), 16), t = new THREE.DataTexture(new Uint8Array([n >> 16, n >> 8 & 255, n & 255, 255]), 1, 1);   // sRGB bytes
  t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; t.userData.flat = true; return t;
}

/**
 * A line (an orbit) drawn relative to its body. Meshes stay steady far out because three.js composes model-view
 * matrices in float64 on the CPU, but a line's vertices go to the GPU as float32: at 39 AU that is ~570 km (Saturn
 * 143 km, Eris 1,100 km), so absolute orbit lines jitter and miss their bodies close up. The line sits at an origin
 * (its Object3D position) and holds path minus origin; fill(out, origin) writes its n points (orbitPath's origin) with
 * one vertex on the origin (orbitPath through, conicArc at), so the body never sits mid-chord, where a 720-point line
 * passes 56,000 km from Pluto. reach: how far the body may move, in camera distances, before the line is refilled
 * around it (the chord then sags from it by reach * (2pi/n) / 2 of the camera distance, well under a pixel).
 */
export function rebasedLine(n, material, fill, { Line = THREE.LineLoop, reach = 0.1 } = {}) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const line = new Line(g, material); Object.assign(line.userData, { fill, reach, based: false }); return line;
}
/** New points for a rebasedLine (the next rebase writes them). */
export function refill(line, fill) { line.userData.fill = fill; line.userData.based = false; }
/** Refill a rebasedLine around `to` (its body) once the body has moved `reach` camera distances from its origin, or its
 *  points changed. The float32 error near the body is then a few ulps of that distance: nothing on screen. */
export function rebase(line, to, camera) {
  const u = line.userData;
  if (u.based && line.position.distanceTo(to) <= u.reach * camera.position.distanceTo(to)) return false;
  const a = line.geometry.attributes.position;
  u.fill(a.array, to); a.needsUpdate = true; line.position.copy(to); line.geometry.computeBoundingSphere(); u.based = true;
  return true;
}
