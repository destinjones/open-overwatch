// Director scenes: a list of camera shots to fly through, as compact text for links and files. Pure (Node tests it).
// A shot: { lon, lat, h (metres), heading, pitch, roll (degrees), dur (seconds to fly here), sensor, hold (seconds) }.
// Link form: "#scene=" + base64url of "v1;" + shots joined by "|", each "lon,lat,h,heading,pitch,roll,dur,hold,sensor".
import { SENSORS } from './voicecmd.js';

export const MAX_SHOTS = 40;
const r = (v, n) => +Number(v).toFixed(n);
const ok = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;

/** A clean shot, or null if anything is out of range. Nothing from a link or file is trusted. */
export function cleanShot(s) {
  if (!s || typeof s !== 'object') return null;
  const wrap = (v, lo) => ((((v - lo) % 360) + 360) % 360) + lo;   // a camera reports roll 359.99 for -0.01: same angle
  const lon = +s.lon, lat = +s.lat, h = +s.h, heading = wrap(+s.heading, 0), pitch = +s.pitch, roll = wrap(+(s.roll || 0), -180), dur = +(s.dur ?? 4), hold = +(s.hold ?? 0);
  if (!ok(lon, -180, 180) || !ok(lat, -90, 90) || !ok(h, 1, 1e10) || !ok(heading, 0, 360) || !ok(pitch, -90, 90) || !ok(roll, -180, 180) || !ok(dur, 0, 120) || !ok(hold, 0, 60)) return null;
  return { lon: r(lon, 5), lat: r(lat, 5), h: Math.round(h), heading: r(heading, 1) + 0, pitch: r(pitch, 1) + 0, roll: r(roll, 1) + 0, dur: r(dur, 1), hold: r(hold, 1), sensor: SENSORS.includes(s.sensor) ? s.sensor : 'normal' };
}

const b64 = s => (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = s => { const t = s.replace(/-/g, '+').replace(/_/g, '/'); return typeof atob === 'function' ? atob(t) : Buffer.from(t, 'base64').toString('binary'); };

export function encodeScene(shots) {
  const list = shots.map(cleanShot).filter(Boolean).slice(0, MAX_SHOTS);
  return b64('v1;' + list.map(s => [s.lon, s.lat, s.h, s.heading, s.pitch, s.roll, s.dur, s.hold, s.sensor].join(',')).join('|'));
}

/** Shots from encodeScene's text, or [] if it is not a scene. */
export function decodeScene(text) {
  let s; try { s = unb64(String(text || '').trim().slice(0, 8000)); } catch (e) { return []; }
  if (!s.startsWith('v1;')) return [];
  return s.slice(3).split('|').slice(0, MAX_SHOTS).map(p => { const [lon, lat, h, heading, pitch, roll, dur, hold, sensor] = p.split(','); return cleanShot({ lon, lat, h, heading, pitch, roll, dur, hold, sensor }); }).filter(Boolean);
}

/** A scene file (JSON) to shots: { "openOverwatchScene": 1, "title": ..., "shots": [...] }. */
export function parseSceneFile(json) {
  let d; try { d = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return null; }
  if (!d || d.openOverwatchScene !== 1 || !Array.isArray(d.shots)) return null;
  return { title: String(d.title || 'Scene').slice(0, 80), shots: d.shots.slice(0, MAX_SHOTS).map(cleanShot).filter(Boolean) };
}
export const sceneFile = (title, shots) => JSON.stringify({ openOverwatchScene: 1, title: String(title || 'Scene').slice(0, 80), shots: shots.map(cleanShot).filter(Boolean) }, null, 1);
