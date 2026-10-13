// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Renders for the airport card's METAR/TAF, board estimates and runway history (grow2-aviation, 2026-10-13):
//   OW_WORK=%LOCALAPPDATA%\oo-brand-<you> OO_URL=http://localhost:<port>/globe.html node brand/tools/airport_wx_shot.mjs <out_prefix> [WxH]
// globe_shot blocks the aircraft feeds, so the planes and the runway-history events are test fixtures injected here
// (src 'adsb.lol (test fixture)'); the METAR, TAF and dot colours are the live Aviation Weather Center answers.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [out = 'airport_wx', size = '1440x900'] = process.argv.slice(2);
const inject = `
  const { Air } = await import('/src/globe/aircraft.js');
  const { FieldWatch } = await import('/src/globe/fieldwatch.js');
  const now = Date.now(), FT = 0.3048, KT = 0.514444, elev = 5431 * FT;
  // along 34R's extended centre line (threshold 39.8641 N, 104.687 W), then a few others around Denver
  const mk = (hex, flight, type, lat, lon, altFt, gsKt, track, fpm, ground = false) => Air.upsert({ hex, flight, type, lat, lon, alt: ground ? 0 : altFt * FT, ground,
    gs: gsKt * KT, track, vr: fpm * FT / 60, squawk: '', emerg: false, mil: false, ts: now - 2000, src: 'adsb.lol (test fixture)' });
  mk('a00001', 'TEST101', 'B39M', 39.80, -104.687, 7400, 150, 0, -750);
  mk('a00002', 'TEST102', 'B38M', 39.68, -104.687, 9600, 185, 0, -900);
  mk('a00003', 'TEST103', 'A21N', 39.62, -104.62, 12500, 250, 350, -1500);
  mk('a00004', 'TEST104', 'CRJ9', 39.40, -104.30, 15500, 280, 320, -1800);
  mk('a00005', 'TEST105', 'A321', 40.30, -105.20, 16000, 290, 140, -1200);
  mk('a00006', 'TEST106', 'B772', 39.95, -104.697, 7600, 175, 0, 2500);
  mk('a00007', 'TEST107', 'B737', 40.10, -104.74, 11500, 260, 340, 2200);
  mk('a00008', 'TEST108', 'A320', 39.865, -104.672, 0, 12, 90, 0, true);
  // the last hour's landings and take-offs (test events: the render has no live trails)
  const ev = [['16L', 'landing', 58], ['17R', 'landing', 55], ['16R', 'landing', 51], ['16L', 'landing', 47], ['34R', 'landing', 38], ['35L', 'landing', 33],
    ['34R', 'landing', 27], ['35L', 'landing', 22], ['34R', 'landing', 14], ['34R', 'landing', 6], ['25', 'takeoff', 50], ['8', 'takeoff', 44],
    ['34L', 'takeoff', 30], ['34L', 'takeoff', 18], ['25', 'takeoff', 12], ['34L', 'takeoff', 4]];
  ev.forEach(([rwy, kind, min], k) => FieldWatch.log.add({ icao: 'KDEN', rwy: rwy === '8' ? '08' : rwy, kind, t: now - min * 60e3, hex: 'f' + k }));
`;
const steps = [
  `await new Promise(r => setTimeout(r, 6000)); ${inject} await OO3D.Aviation.Airports.show('KDEN'); return 'shown';`, 16,
  `const c = document.querySelector('#apMetar')?.closest('.card, #card, aside') || document.querySelector('#apMetar').parentElement; const b = document.querySelector('#apBoard'); b.scrollIntoView({ block: 'start' }); return [...b.querySelectorAll('.ab-row')].map(x => x.innerText.replace(/\s+/g, ' ')).join(' | ');`, 3,
  `document.querySelector('.ap-hist')?.scrollIntoView({ block: 'center' }); OO3D.viewer.camera.zoomOut(400000); return 'hist';`, 12,
];
const tool = fileURLToPath(new URL('./globe_shot.mjs', import.meta.url));
spawn(process.execPath, [tool, out, size, ...steps.map(String)], { stdio: 'inherit' }).on('exit', c => process.exit(c ?? 0));
