// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The Sun side of space weather (src/core/spaceweather.js) against NOAA SWPC's own answers captured on 2026-10-14 at
// 19:50 UTC (test/fixtures/spaceweather/: the real-time solar wind thinned to 5-minute rows with three spacecraft side
// by side, GOES X-rays, the latest flare, the alerts of the last few weeks, the one-minute summaries).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SW_URLS, parseMag, parseWind, parseXrays, parseFlares, flareClass, classFlux, rScale, flareWords, bzWords, windWords, swTime, swpcTime,
  parseAlerts, topAlerts, sunNow, sunLine, bzSpark,
} from '../src/core/spaceweather.js';

const J = f => JSON.parse(readFileSync(new URL('./fixtures/spaceweather/' + f, import.meta.url), 'utf8'));
const NOW = Date.parse('2026-10-14T19:50:00Z'), MIN = 60e3, H = 3600e3;
const all = () => ({ mag: J('rtsw_mag_1m.json'), wind: J('rtsw_wind_1m.json'), xrays: J('xrays-1-day.json'), flare: J('xray-flares-latest.json'), alerts: J('alerts.json') });

test('spaceweather: the feeds are SWPC files that exist (products/solar-wind/ is gone)', () => {
  for (const u of Object.values(SW_URLS)) assert.match(u, /^https:\/\/services\.swpc\.noaa\.gov\/(json|products)\//);
  assert.ok(!Object.values(SW_URLS).some(u => u.includes('products/solar-wind/')));
});

test('spaceweather: times with and without Z, SWPC message times', () => {
  assert.equal(swTime('2026-10-14T19:45:00'), Date.parse('2026-10-14T19:45:00Z'));
  assert.equal(swTime('2026-10-13 20:58:58.750'), Date.parse('2026-10-13T20:58:58.750Z'));
  assert.equal(swpcTime('2026 Oct 13 2058 UTC'), Date.parse('2026-10-13T20:58:00Z'));
  assert.ok(Number.isNaN(swTime(null)) && Number.isNaN(swpcTime('soon')));
});

test('spaceweather: the real-time wind keeps the operational spacecraft only, oldest first', () => {
  const raw = J('rtsw_mag_1m.json'), m = parseMag(raw);
  assert.ok(new Set(raw.map(r => r.source)).size === 3, 'the fixture has three spacecraft');
  assert.deepEqual([...new Set(m.map(r => r.source))], ['SOLAR1']);
  assert.ok(m.every((r, i) => !i || r.t >= m[i - 1].t));
  assert.equal(m[m.length - 1].t, Date.parse('2026-10-14T19:45:00Z'));
  const w = parseWind(J('rtsw_wind_1m.json'));
  assert.ok(w.length > 200 && w.every(r => r.speed > 200 && r.speed < 1200));
  // the one-minute summaries parse the same way
  assert.equal(parseMag(J('summary-mag.json'))[0].bz, 3);
  assert.equal(parseWind(J('summary-speed.json'))[0].speed, 548);
  // fill values and garbage are dropped, not plotted
  assert.deepEqual(parseMag([{ time_tag: '2026-10-14T00:00:00', bz_gsm: -99999.9 }, { time_tag: 'x', bz_gsm: 1 }, null, 7]), []);
});

test('spaceweather: flare classes from flux and back, and the R scale', () => {
  assert.equal(flareClass(2.2562e-6), 'C2.2');
  assert.equal(flareClass(7.2775e-7), 'B7.2');
  assert.equal(flareClass(1e-5), 'M1.0');
  assert.equal(flareClass(2.8e-3), 'X28');
  assert.equal(flareClass(9.99e-5), 'M9.9');
  assert.equal(flareClass(9.9996e-5), 'X1.0');   // inside the tolerance under a decade: the higher letter at 1.0, not "X0.9"
  assert.equal(flareClass(9.9999e-6), 'M1.0');
  assert.equal(flareClass(9.99951e-7), 'C1.0');
  assert.equal(flareClass(9.9996e-8), 'B1.0');
  assert.equal(flareClass(5e-9), 'A0.5');        // below A1 stays as it is
  assert.equal(flareClass(0), '');
  assert.ok(Math.abs(classFlux('M6.4') - 6.4e-5) < 1e-12);
  assert.deepEqual([classFlux('C9.9'), classFlux('M1'), classFlux('M5'), classFlux('X1'), classFlux('X10'), classFlux('X20')].map(rScale), [0, 1, 2, 3, 4, 5]);
  assert.match(flareWords('M6.4'), /moderate radio blackout \(R2\)/);
  assert.match(flareWords('X2.1'), /major flare/);
  assert.match(flareWords('B7.2'), /quiet/);
});

test('spaceweather: Bz says southward is aurora-friendly; the wind says when it arrives', () => {
  assert.match(bzWords(-4.2), /^southward \(−4\.2 nT\), aurora-friendly$/);
  assert.match(bzWords(-15), /strongly southward/);
  assert.match(bzWords(3), /northward/);
  assert.match(bzWords(0.5), /near zero/);
  assert.match(windWords(550, 6.4), /550 km\/s \(fast, 6\.4 protons\/cm³\); it reaches Earth about 45 min/);
  assert.match(windWords(900, 25), /extremely fast.*very dense/);
});

test('spaceweather: alerts on the day of a G3 storm (2026-10-10 19:30 UTC)', () => {
  const list = parseAlerts(J('alerts.json'), { now: Date.parse('2026-10-10T19:30:00Z') }), act = list.filter(e => e.active);
  // in force: the Kp 7 and Kp 6 warnings, the Kp 7 alert for its 18-21 UTC period, the G2 watch, the electron alert
  assert.ok(act.some(e => e.kind === 'warning' && e.scale === 'G3' && /Kp 7 or more/.test(e.text)));
  assert.ok(act.some(e => e.kind === 'alert' && /Kp reached 7 at 19:26 UTC/.test(e.text)));
  const watch = act.filter(e => e.kind === 'watch');
  assert.equal(watch.length, 1, 'a watch supersedes every earlier watch');
  assert.equal(watch[0].scale, 'G2'); assert.match(watch[0].text, /Oct 11 G2 \(moderate\)/);
  // earlier the same day: the M6.4 flare, its type II radio burst (a CME) and the shock's arrival, kept as recent
  const recent = list.filter(e => !e.active);
  assert.ok(recent.some(e => /Flare M6\.4 peaked at 15:10 UTC/.test(e.text) && e.scale === 'R2'));
  assert.ok(recent.some(e => e.cme && /929 km\/s/.test(e.text)));
  assert.ok(recent.some(e => /shock hit Earth's magnetic field at 15:16 UTC \(a 56 nT jump\)/.test(e.text)));
  // nothing issued after `now` leaks in
  assert.ok(list.every(e => e.issued <= Date.parse('2026-10-10T19:35:00Z')));
  const top = topAlerts(act, 3);
  assert.equal(top[0].scale, 'G3'); assert.equal(top.filter(e => /^ALTK/.test(e.code)).length <= 1, true);
});

test('spaceweather: extended warnings replace the one they extend; cancelled watches go', () => {
  const list = parseAlerts(J('alerts.json'), { now: Date.parse('2026-10-14T06:00:00Z') });
  const k4 = list.filter(e => e.code === 'WARK04');
  assert.equal(k4.length, 1); assert.equal(k4[0].serial, '5435'); assert.ok(k4[0].active);
  assert.match(k4[0].text, /until Oct 14 12:00 UTC/);
  assert.ok(!list.some(e => e.id === 'WATA30:285'), 'serial 285 was cancelled by 286');
  // a watch for days ahead is in force until its last storm day ends; a CME in the comment is named
  const cme = parseAlerts(J('alerts.json'), { now: Date.parse('2026-10-07T12:00:00Z') }).find(e => e.kind === 'watch');
  assert.ok(cme.active && cme.cme); assert.match(cme.text, /G2 moderate.*Oct 9.*as a CME/);
  assert.equal(cme.until, Date.parse('2026-10-10T00:00:00Z'));
});

test('spaceweather: Sun now, from the captured answers', () => {
  const s = sunNow(all(), { now: NOW });
  assert.equal(s.wind.speed, 550); assert.equal(s.wind.craft, 'SWFO-L1'); assert.equal(s.wind.arrivalMin, 45);
  assert.equal(s.bz.now, 2.9); assert.equal(s.bz.south, false); assert.match(s.bz.text, /^northward \(\+2\.9 nT\)/);
  assert.ok(s.bz.min24 < 0 && s.bz.max24 > 0);
  assert.ok(s.bz.series.length >= 60 && s.bz.series.length <= 73, '6 hours of 5-minute means');
  assert.equal(s.flare.now.cls, 'B7.3'); assert.equal(s.flare.peak.cls, 'C6.9'); assert.equal(s.flare.latest.cls, 'C2.2'); assert.equal(s.flare.latest.ongoing, false);
  assert.equal(s.alerts.active.length, 0, 'the last Kp 4 warning ended at 12:00 UTC');
  assert.ok(s.alerts.recent.some(e => e.code === 'WARK04'));
  assert.equal(s.line, 'Solar wind 550 km/s · Bz +2.9 nT northward · X-rays B7.3 now, C6.9 peak (24 h) · no SWPC warnings in force');
});

test('spaceweather: the browser\'s lighter set (the week\'s flare list, no flux file) finds the same peak', () => {
  const fl = parseFlares(J('xray-flares-7-day.json'));
  assert.ok(fl.length > 40 && fl.every(f => /^[ABCMX]\d/.test(f.cls)), 'rows without a peak (a flare still rising) are skipped');
  const { xrays, ...light } = all(), s = sunNow({ ...light, flares: J('xray-flares-7-day.json') }, { now: NOW });
  assert.equal(s.flare.now.cls, 'B7.2', 'the class now from the latest-flare file');
  assert.equal(s.flare.peak.cls, 'C6.9'); assert.equal(s.flare.peak.t, Date.parse('2026-10-14T02:21:00Z'));
  assert.equal(s.flare.prov.confidence, 'reported');
});

test('spaceweather: every part carries provenance from the feed\'s own time; Bz goes stale after 15 minutes', () => {
  const s = sunNow(all(), { now: NOW, fetchedAt: NOW });
  for (const p of [s.wind, s.bz, s.flare]) { assert.equal(p.prov.confidence, 'reported'); assert.equal(p.prov.sources[0].licence, 'Public domain (US Government, NOAA SWPC)'); }
  assert.equal(s.bz.prov.ageMs, 5 * MIN, 'data time 19:45, not the download');
  assert.equal(s.bz.prov.maxAgeMs, 15 * MIN);
  assert.match(s.bz.prov.sources[0].name, /SWFO-L1/);
  for (const e of s.alerts.recent) assert.equal(e.prov.sources[0].dataAt, e.issued);
  const later = sunNow(all(), { now: NOW + 30 * MIN });
  assert.equal(later.bz.prov.confidence, 'stale'); assert.equal(later.wind.prov.confidence, 'stale');
});

test('spaceweather: missing feeds leave their part empty, never throw', () => {
  const s = sunNow({ mag: J('summary-mag.json'), wind: J('summary-speed.json') }, { now: NOW });
  assert.equal(s.flare, null); assert.equal(s.alerts, null);
  assert.equal(s.wind.density, null); assert.equal(s.bz.now, 3);
  assert.equal(sunLine(s), 'Solar wind 548 km/s · Bz +3.0 nT northward');
  const none = sunNow({}, { now: NOW });
  assert.deepEqual([none.wind, none.bz, none.flare, none.alerts, none.line], [null, null, null, null, '']);
  assert.equal(sunNow({ flare: J('xray-flares-latest.json') }, { now: NOW }).flare.now.cls, 'B7.2', 'the latest-flare file alone gives the class now');
});

test('spaceweather: the Bz sparkline is accessible SVG and breaks at gaps', () => {
  const s = sunNow(all(), { now: NOW }), svg = bzSpark(s.bz.series, { id: 't1' });
  assert.match(svg, /^<svg class="sw-spark"[^>]+role="img" aria-labelledby="t1t t1d"/);
  assert.match(svg, /<desc id="t1d">From \d\d:\d\d UTC to 19:4\d UTC: Bz between -?\d/);
  const gap = bzSpark([{ t: 0, bz: -5 }, { t: 5 * MIN, bz: -3 }, { t: H, bz: 2 }, { t: H + 5 * MIN, bz: 4 }]);
  assert.equal((gap.match(/M/g) || []).length >= 2 + 2, true, 'two runs in the line, plus fills');
  assert.equal(bzSpark([{ t: 0, bz: 1 }]), '');
  assert.ok(!bzSpark(s.bz.series, { id: '"><script>' }).includes('<script>'));
});
