// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The Solar System view as a link, and back: solar.html#f=craft:Voyager%201&t=2026-10-12T06:00&d=0.0012&r=1
//   f  focus: a body key (planet 'mars', moon 'moon:Titan', 'craft:Juno', 'comet:1P/Halley', 'ast:433 Eros', ...)
//   q  a search to run instead when there is no key (hand-written links: solar.html#q=halley)
//   t  the moment, UTC to the minute ('YYYY-MM-DDTHH:MM'); left out = live (the clock follows the real time)
//   d  camera distance from the focus, AU (3 significant figures)
//   r  clock rate in days per second, when not live (0 = paused)
// Pure functions; nothing in a hash is trusted: keys are length- and character-limited, numbers range-checked.

import { jdFromMs, msFromJd } from './time.js';

const KEY = /^[\p{L}\p{N} :./'()+,_-]{1,80}$/u;
const sig = (v, n) => Number(Number(v).toPrecision(n));

/** 'YYYY-MM-DDTHH:MM' (UTC) for a Julian Date. */
export function isoMinute(jd) {
  return new Date(Math.round(msFromJd(jd) / 60000) * 60000).toISOString().slice(0, 16);
}

/** Julian Date for 'YYYY-MM-DD', 'YYYY-MM-DDTHH:MM' or with seconds / a Z; null if it does not parse. */
export function parseIsoMinute(s) {
  const m = String(s || '').match(/^(-?\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?Z?$/);
  if (!m) return null;
  const [y, mo, d, h = 0, mi = 0, se = 0] = m.slice(1).map(x => (x === undefined ? undefined : +x));
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi, se);
  return Number.isFinite(ms) ? jdFromMs(ms) : null;
}

/** view: { focus: key | null, query?: text, jd: number | null (null = live), dist?: AU, rate?: days/s } -> 'f=...&t=...' */
export function encodeSolarView(v) {
  const p = new URLSearchParams();
  if (v.focus && KEY.test(v.focus)) p.set('f', v.focus);
  else if (v.query) p.set('q', String(v.query).slice(0, 60));
  if (v.jd != null && Number.isFinite(v.jd)) {
    p.set('t', isoMinute(v.jd));
    if (Number.isFinite(v.rate)) p.set('r', String(sig(v.rate, 4)));
  }
  if (Number.isFinite(v.dist) && v.dist > 0) p.set('d', String(sig(v.dist, 3)));
  return p.toString();
}

/** '#f=...' -> { focus, query, jd, rate, dist } (each null when absent or invalid), or null when the hash names nothing. */
export function decodeSolarView(hash, { minJd = 2378496.5, maxJd = 2524593.5 } = {}) {
  const s = String(hash || '').replace(/^#/, ''); if (!s) return null;
  let p; try { p = new URLSearchParams(s); } catch (e) { return null; }
  const f = p.get('f'), q = p.get('q'), out = { focus: null, query: null, jd: null, rate: null, dist: null };
  if (f && KEY.test(f)) out.focus = f;
  if (!out.focus && q && q.trim().length >= 2) out.query = q.trim().slice(0, 60);
  const jd = parseIsoMinute(p.get('t'));
  if (jd != null && jd >= minJd && jd <= maxJd) out.jd = jd;
  const r = Number(p.get('r'));
  if (out.jd != null && p.has('r') && Number.isFinite(r) && Math.abs(r) <= 3652.5) out.rate = r;
  const d = Number(p.get('d'));
  if (p.has('d') && Number.isFinite(d) && d > 1e-9 && d < 1e15) out.dist = d;
  return out.focus || out.query || out.jd != null ? out : null;
}
