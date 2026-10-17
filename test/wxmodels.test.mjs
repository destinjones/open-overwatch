// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The two weather models (src/core/wxmodels.js): runs, files, inventories, parameters; and the new fields in words
// (src/core/voicecmd.js: gusts, pressure, waves).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, ecmwfCycles, ecmwfFile, gfsWaveFile, parseEcIndex, paramKey, bracketFor, partsOf, runWords, reachH, runEnd, gustNote, clockWords, snapFits, SNAP_SPAN } from '../src/core/wxmodels.js';
import { idxRanges, parseIdx } from '../src/core/grib2.js';
import { cycleAt, gfsCycles, timeline } from '../src/core/gfs.js';
import { weatherSentence, seaWords } from '../src/core/voicecmd.js';

const H = 3600e3;

test('ECMWF runs: 00 and 12 UTC, the newest from 7.5 h after it starts', () => {
  assert.deepEqual(ecmwfCycles(Date.UTC(2026, 9, 11, 7, 0), 3).map(c => c.date + c.hour), ['2026101012', '2026101000', '2026100912']);
  assert.deepEqual(ecmwfCycles(Date.UTC(2026, 9, 11, 7, 31), 1).map(c => c.date + c.hour), ['2026101100']);
  assert.deepEqual(ecmwfCycles(Date.UTC(2026, 9, 11, 23, 59), 1).map(c => c.date + c.hour), ['2026101112']);
});

test('files and inventories of both models', () => {
  const c = cycleAt(Date.UTC(2026, 9, 11, 0));
  assert.equal(ecmwfFile(c, 6), 'https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com/20261011/00z/ifs/0p25/oper/20261011000000-6h-oper-fc.grib2');
  assert.equal(MODELS.ecmwf.indexOf(ecmwfFile(c, 144, 'wave')), 'https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com/20261011/00z/ifs/0p25/wave/20261011000000-144h-wave-fc.index');
  assert.equal(gfsWaveFile(c, 6), 'https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20261011/00/wave/gridded/gfswave.t00z.global.0p25.f006.grib2');
  assert.equal(MODELS.gfs.file(c, 6, 'wave'), gfsWaveFile(c, 6));
  assert.equal(MODELS.gfs.indexOf(MODELS.gfs.file(c, 12)), 'https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20261011/00/atmos/gfs.t00z.pgrb2.1p00.f012.idx');
  for (const m of Object.values(MODELS)) {   // a newer run's cache path is in every file of that run, and only that run
    assert.ok(m.file(c, 6).includes(m.cachePath(c)) && m.file(c, 6, m.kinds.wave.stream).includes(m.cachePath(c)), m.id);
    assert.ok(!m.file(cycleAt(c.t + 12 * H), 6).includes(m.cachePath(c)));
    assert.deepEqual(Object.keys(m.kinds).sort(), ['cloud', 'gust', 'pres', 'rain', 'temp', 'wave', 'wind']);
  }
});

const EC_INDEX = [
  '{"domain": "g", "date": "20261011", "time": "0000", "expver": "0001", "class": "od", "type": "fc", "stream": "oper", "levtype": "sfc", "step": "6", "param": "tp", "_offset": 0, "_length": 603934}',
  '{"domain": "g", "date": "20261011", "time": "0000", "expver": "0001", "class": "od", "type": "fc", "stream": "oper", "step": "6", "levtype": "pl", "levelist": "850", "param": "u", "_offset": 603934, "_length": 500}',
  '{"domain": "g", "date": "20261011", "time": "0000", "expver": "0001", "class": "od", "type": "fc", "stream": "oper", "step": "6", "levtype": "sfc", "param": "10u", "_offset": 604434, "_length": 743323}',
  '{"domain": "g", "date": "20261011", "time": "0000", "expver": "0001", "class": "od", "type": "fc", "stream": "oper", "step": "6", "levtype": "sfc", "param": "10v", "_offset": 1347757, "_length": 738263}',
  'not json', '',
  '{"domain": "g", "date": "20261011", "time": "0000", "expver": "0001", "class": "od", "type": "fc", "stream": "oper", "step": "6", "levtype": "sfc", "param": "msl", "_offset": 98378138, "_length": 523971}',
].join('\n');

test('ECMWF inventory: rows like NOAA\'s, so the same byte-range picking works', () => {
  const rows = parseEcIndex(EC_INDEX);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[2], { n: 3, start: 604434, end: 1347756, variable: '10u', level: 'sfc', forecast: '6 hour fcst', date: '202610110000' });
  assert.equal(rows[1].level, 'pl 850');
  const wind = idxRanges(rows, MODELS.ecmwf.kinds.wind.wants);
  assert.deepEqual(wind, [{ start: 604434, end: 2086019, fields: [['10u', 'sfc'], ['10v', 'sfc']] }], 'neighbours, one request');
  assert.deepEqual(idxRanges(rows, MODELS.ecmwf.kinds.pres.wants), [{ start: 98378138, end: 98902108, fields: [['msl', 'sfc']] }]);
  assert.deepEqual(idxRanges(rows, [['u', 'sfc']]), [], 'the 850 hPa u is not the 10 m wind');
});

test('GFS inventory picks pressure, gusts and the wave fields', () => {
  const idx = parseIdx('1:0:d=2026101100:PRMSL:mean sea level:6 hour fcst:\n2:525887:d=2026101100:CLMR:1 hybrid level:6 hour fcst:\n14:925887:d=2026101100:GUST:surface:6 hour fcst:\n15:999999:d=2026101100:HGT:surface:6 hour fcst:\n');
  assert.deepEqual(idxRanges(idx, MODELS.gfs.kinds.pres.wants), [{ start: 0, end: 525886, fields: [['PRMSL', 'mean sea level']] }]);
  assert.deepEqual(idxRanges(idx, MODELS.gfs.kinds.gust.wants), [{ start: 925887, end: 999998, fields: [['GUST', 'surface']] }]);
  const ww = parseIdx('4:2342768:d=2026101100:VGRD:surface:6 hour fcst:\n5:3031321:d=2026101100:HTSGW:surface:6 hour fcst:\n6:3460533:d=2026101100:PERPW:surface:6 hour fcst:\n7:3966850:d=2026101100:DIRPW:surface:6 hour fcst:\n8:4849530:d=2026101100:WVHGT:surface:6 hour fcst:\n');
  assert.deepEqual(idxRanges(ww, MODELS.gfs.kinds.wave.wants).map(r => [r.start, r.end]), [[3031321, 3460532], [3966850, 4849529]]);
});

test('GRIB2 parameters → our fields, with ECMWF\'s cloud fraction as a percentage', () => {
  assert.deepEqual(paramKey({ discipline: 0, category: 3, number: 1 }), { key: 'pres', scale: 1 });
  assert.deepEqual(paramKey({ discipline: 0, category: 3, number: 0 }), { key: 'pres', scale: 1 });
  assert.deepEqual(paramKey({ discipline: 0, category: 6, number: 192 }), { key: 'cloud', scale: 100 });
  assert.deepEqual(paramKey({ discipline: 0, category: 2, number: 22 }), { key: 'gust', scale: 1 });
  assert.deepEqual(paramKey({ discipline: 10, category: 0, number: 3 }), { key: 'wave', scale: 1 });
  assert.equal(paramKey({ discipline: 10, category: 0, number: 14 }).key, 'wavedir');
  assert.equal(paramKey({ discipline: 10, category: 0, number: 10 }).key, 'wavedir');
  assert.equal(paramKey({ discipline: 0, category: 2, number: 2 }).key, 'u');
  assert.equal(paramKey({ discipline: 10, category: 0, number: 2 }), null, 'ocean 0.2 is not wind');
  assert.deepEqual(partsOf('wave'), ['wave', 'wavedir']); assert.deepEqual(partsOf('pres'), ['pres']);
});

test('bracket: both models step 3 hours; ECMWF stops at its last hour', () => {
  const c = cycleAt(Date.UTC(2026, 9, 11, 0));
  assert.deepEqual(bracketFor(MODELS.ecmwf, c, c.t + 7.5 * H, 120), { h0: 6, h1: 9, w: 0.5 });
  assert.deepEqual(bracketFor(MODELS.ecmwf, c, c.t + 300 * H, 200), { h0: 141, h1: 144, w: 1 });
  assert.deepEqual(bracketFor(MODELS.gfs, c, c.t + 300 * H, 120), { h0: 117, h1: 120, w: 1 });
  assert.equal(runWords(c), 'the 00:00 UTC run of 11/10');
});

test('weather in words: gusts, pressure and its trend, the sea', () => {
  assert.equal(weatherSentence({ temp: 9, speed: 8, from: 270, gust: 19, pres: 987.4, presTrend: -3.2, wave: 3.4, waveFrom: 250 }),
    '9 degrees Celsius, wind 29 kilometres an hour from the west, gusting 68, pressure 987 hectopascals and falling, a rough sea, waves 3 metres from the west');
  assert.equal(weatherSentence({ speed: 8, from: 90, gust: 9, pres: 1020, wave: 0.05 }), 'wind 29 kilometres an hour from the east, pressure 1020 hectopascals, a calm sea', 'gusts only when they matter');
  assert.equal(weatherSentence({ speed: 8, from: 90, gust: 19, pres: 1013.25, presTrend: 2, wave: 1.2, waveFrom: 0 }, true),
    'wind 18 miles an hour from the east, gusting 43, pressure 29.92 inches and rising, a slight sea, waves 4 feet from the north');
  assert.equal(weatherSentence({ temp: 20, wave: NaN, pres: NaN }), '20 degrees Celsius');
  assert.equal(seaWords(0.7), 'slight'); assert.equal(seaWords(15), 'phenomenal'); assert.equal(seaWords(undefined), '');
});

test('the forecast horizon: every frame of a timeline counted from now shows its own forecast hour, never the last one again', () => {
  const now = Date.UTC(2026, 9, 17, 9, 20);
  for (const shown of [120, 72]) {   // desktop, phones
    const runs = [[MODELS.gfs, gfsCycles(now, 1)[0]], [MODELS.gfs, gfsCycles(now, 2)[1]], [MODELS.ecmwf, ecmwfCycles(now, 1)[0]], [MODELS.ecmwf, ecmwfCycles(now, 2)[1]]];
    for (const [def, run] of runs) {   // GFS 00Z (9.3 h old) and 18Z; ECMWF 00Z and the 12Z before it (21.3 h old)
      const maxH = reachH(shown), top = Math.min(maxH, def.maxH);
      const until = Math.min(now + shown * H, runEnd(def, run, maxH));   // as globe/weather.js until() has it
      const frames = timeline({ obsEnd: now - 50 * 60e3, run, until }).filter(f => f.fcst);
      assert.ok(frames.length > 20, `${def.id} ${run.hour}Z`);
      for (const f of frames) {
        const b = bracketFor(def, run, f.t, maxH);
        assert.ok(!(b.w === 1 && b.h1 === top) || f.t === run.t + top * H, `${def.id} ${run.hour}Z +${f.h} h shows +${top} h`);
        assert.deepEqual([b.h0, b.w], [f.h === top ? top - def.every : f.h, f.h === top ? 1 : 0], `${def.id} ${run.hour}Z +${f.h} h`);
      }
      assert.ok(frames[frames.length - 1].t >= now + (shown - def.every) * H, `${def.id} ${run.hour}Z reaches about ${shown} h from now`);
    }
  }
  // the 4th GFS run tried (27.5 h old) is past a day's slack: the timeline stops at its last hour instead
  const old = gfsCycles(now, 4)[3], end = runEnd(MODELS.gfs, old, reachH(120));
  assert.equal(end, old.t + 144 * H);
  const last = timeline({ obsEnd: now, run: old, until: Math.min(now + 120 * H, end) }).pop();
  assert.equal(last.h, 144); assert.ok(last.t < now + 120 * H);
  assert.equal(runEnd(MODELS.ecmwf, old, 200), old.t + 144 * H, 'ECMWF files stop at 144 h');
});

test("gust notes: what each model's gust is, side by side", () => {
  assert.equal(gustNote([MODELS.gfs, MODELS.ecmwf]), 'Gusts: GFS at the hour · ECMWF strongest in the hour before');
  assert.equal(gustNote([MODELS.ecmwf]), 'Gusts: ECMWF strongest in the hour before');
  assert.equal(gustNote([]), ''); assert.equal(gustNote([null, { short: 'X', notes: {} }]), '');
});

test('one clock on the weather timeline, with its zone', () => {
  const t = Date.UTC(2026, 9, 17, 9, 20), words = clockWords(t);
  assert.match(words, /\d/);
  assert.match(words, /(UTC|GMT|[A-Z]{2,5}|[+−-]\d)\s*$/, 'the zone is named: an observed frame and a forecast frame read on the same clock');
  assert.equal(words, clockWords(t + 30e3 - 30e3));
});

test('the Open-Meteo snapshot stands in only for an observed moment near its own time', () => {
  const at = Date.UTC(2026, 9, 17, 9, 15), grid = { t: at + 40 * 60e3, at: '2026-10-17T09:15' };
  assert.equal(snapFits(grid, at - 50 * 60e3), true, 'the newest observed frame');
  assert.equal(snapFits(grid, at + SNAP_SPAN), true);
  assert.equal(snapFits(grid, at - 2.5 * H), false, 'the oldest observed frame: not now');
  assert.equal(snapFits(grid, at, true), false, 'never a forecast frame');
  assert.equal(snapFits(grid, at + 2 * 86400e3), false);
  assert.equal(snapFits({ t: at, at: 'test fixture' }, at + 30 * 60e3), true, 'no readable time: when it was fetched');
  assert.equal(snapFits({ t: at - 5 * H, at: '2026-10-17T04:15' }, at), false, 'an old mirror is not now');
  assert.equal(snapFits(null, at), false); assert.equal(snapFits({}, at), false);
});
