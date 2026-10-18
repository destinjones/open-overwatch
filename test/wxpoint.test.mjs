// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The weather at a point (src/core/wxpoint.js): the forecaster's words for pressure tendency, wind, thunder energy,
// visibility, UV and the sea; the extremes ahead from Open-Meteo's hourly answer; whether the models agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tendencyWords, beaufort, capeWords, visibilityWords, uvWords, seaState, hourIndex, extreme, readDetails, modelSpread, spreadLine, readMarine, MODELS } from '../src/core/wxpoint.js';

test('wxpoint: the words for pressure tendency, Beaufort, CAPE, visibility, UV and sea state at their edges', () => {
  assert.deepEqual([0, 0.05, -0.1, 1.5, -1.6, 3.5, 3.6, -5.9, 6, -8].map(tendencyWords),
    ['steady', 'steady', 'falling slowly', 'rising slowly', 'falling', 'rising', 'rising quickly', 'falling quickly', 'rising very rapidly', 'falling very rapidly']);
  assert.equal(tendencyWords(NaN), '');
  assert.deepEqual([0, 0.5, 3.3, 10.7, 10.8, 20.8, 32.6, 33, 60].map(v => beaufort(v).force), [0, 1, 2, 5, 6, 9, 11, 12, 12]);
  assert.equal(beaufort(18).name, 'gale'); assert.equal(beaufort(-1), null); assert.equal(beaufort(null), null);
  assert.deepEqual([50, 200, 800, 1500, 3000].map(capeWords), ['', 'a little energy for showers', 'enough energy for thunderstorms', 'energy for strong thunderstorms', 'energy for severe thunderstorms']);
  assert.deepEqual([100, 800, 3000, 8000, 20000, null].map(visibilityWords), ['thick fog', 'fog', 'mist', 'haze', '', '']);
  assert.deepEqual([1, 3, 6, 8, 11].map(uvWords), ['low', 'moderate', 'high', 'very high', 'extreme']);
  assert.deepEqual([0, 0.07, 0.3, 1, 2, 3, 5, 7, 10, 20].map(m => seaState(m).code), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(seaState(3).name, 'rough'); assert.equal(seaState(undefined), null);
});

test('wxpoint: the hour now in the local times, and the extreme of a series from then on (gaps skipped)', () => {
  const times = ['2026-10-01T18:00', '2026-10-01T19:00', '2026-10-01T20:00', '2026-10-01T21:00', '2026-10-01T22:00'];
  assert.equal(hourIndex(times, '2026-10-01T21:45'), 3); assert.equal(hourIndex(times, '2026-10-02T00:00'), -1); assert.equal(hourIndex(null, 'x'), -1);
  const v = [5, 9, null, 2, 7];
  assert.deepEqual(extreme(times, v), { value: 9, time: times[1], i: 1 });
  assert.deepEqual(extreme(times, v, 2), { value: 7, time: times[4], i: 4 });
  assert.deepEqual(extreme(times, v, 2, { low: true }), { value: 2, time: times[3], i: 3 });
  assert.deepEqual(extreme(times, v, 3, { hours: 1 }), { value: 2, time: times[3], i: 3 }, 'only the hours asked for');
  assert.equal(extreme(times, [null, null]), null);
});

test('wxpoint: an Open-Meteo answer read into now, the tendency over three hours, and the extremes ahead', () => {
  const time = Array.from({ length: 10 }, (_, i) => `2026-10-01T${String(18 + i).padStart(2, '0')}:00`.replace('T24', 'T00'));
  const d = { timezone: 'Europe/Helsinki', current: { time: '2026-10-01T21:00', pressure_msl: 1000, wind_speed_10m: 14, wind_gusts_10m: 22, wind_direction_10m: 200, cape: 300, visibility: 900 },
    hourly: { time, pressure_msl: [1004, 1003, 1002, 1000, 998, 996, 995, 996, 998, 1001], wind_gusts_10m: [10, 10, 10, 22, 25, 30, 28, 20, 15, 12], cape: [0, 0, 0, 300, 600, 1200, 0, 0, 0, 0],
      visibility: [9000, 5000, 900, 900, 2000, 10000, 20000, 20000, 20000, 20000], precipitation: [9, 9, 9, 1, 2, 0, 0, 0.5, 0, 0], precipitation_probability: [0, 0, 0, 80, 90, 40, 0, 10, 0, 0] } };
  const r = readDetails(d, 6);
  assert.equal(r.tendency_hpa, -4); assert.equal(r.tendency, 'falling quickly'); assert.equal(r.now.beaufort.force, 7); assert.equal(r.now.gusts_ms, 22);
  assert.equal(r.ahead.hours, 6); assert.deepEqual(r.ahead.lowest_pressure, { value: 995, time: time[6], i: 6 });
  assert.equal(r.ahead.strongest_gust.value, 30); assert.equal(r.ahead.most_cape.value, 1200);
  assert.equal(r.ahead.rain_mm, 3.5, 'from the hour now on: the past three hours are not ahead');
  assert.equal(r.ahead.rain_chance_max.value, 90); assert.equal(r.timezone, 'Europe/Helsinki');
  assert.equal(readDetails({}), null); assert.equal(readDetails({ current: {}, hourly: {} }), null);
});

test('wxpoint: the models side by side, the verdict per day, and one sentence (grouped, metric or imperial)', () => {
  const d = { daily: { time: ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'],
    temperature_2m_max_ecmwf_ifs025: [11, 11, 9, 12], temperature_2m_max_gfs_seamless: [12, 11.5, 14, 13.5], temperature_2m_max_icon_seamless: [11, 11, 10, 12],
    precipitation_sum_ecmwf_ifs025: [0, 0, 0, 4], precipitation_sum_gfs_seamless: [0, 0.5, 12, 6], precipitation_sum_icon_seamless: [0, 0, 0.1, 5],
    wind_gusts_10m_max_ecmwf_ifs025: [10, 10, 10, 10], wind_gusts_10m_max_gfs_seamless: [10, 11, 12, 18], wind_gusts_10m_max_icon_seamless: [11, 10, 10, 11] } };
  const days = modelSpread(d);
  assert.deepEqual(days.map(x => x.agree), ['agree', 'agree', 'disagree', 'differ a little']);
  assert.deepEqual(days[2].spread, { high: 5, rain: 12, gust: 2 }); assert.deepEqual(Object.keys(days[0].models), Object.keys(MODELS));
  assert.equal(spreadLine(days, x => x.slice(5)), 'The models (ECMWF IFS, NOAA GFS, DWD ICON) agree on 10-02 to 10-03; disagree on 10-04 (rain 0-12 mm, highs 9-14 °C); differ a little on 10-05 (gusts 36-65 km/h).');
  assert.match(spreadLine(days, x => x, { imperial: true }), /rain 0\.00-0\.47 in, highs 48-57 °F\).*gusts 22-40 mph/);
  assert.deepEqual(modelSpread({ daily: { time: ['x'], temperature_2m_max_gfs_seamless: [1] } }), [], 'one model is no comparison');
  assert.equal(spreadLine([]), '');
});

test('wxpoint: the sea now and the highest waves ahead; nothing over land', () => {
  const m = readMarine({ current: { time: '2026-10-01T21:00', wave_height: 3.2, wave_direction: 250, wave_period: 8, swell_wave_height: 2, sea_surface_temperature: 12.3, ocean_current_velocity: 3.6, ocean_current_direction: 45 },
    hourly: { time: ['2026-10-01T20:00', '2026-10-01T21:00', '2026-10-01T22:00'], wave_height: [9, 3.2, 4.4] } });
  assert.equal(m.sea.name, 'rough'); assert.equal(m.current_ms, 1); assert.equal(m.sea_temperature_c, 12.3);
  assert.deepEqual(m.highest_waves, { value: 4.4, time: '2026-10-01T22:00', i: 2 }, 'from the hour now on');
  assert.equal(readMarine({ current: { time: 'x', wave_height: null, swell_wave_height: null, sea_surface_temperature: null } }), null);
  assert.equal(readMarine(null), null);
});

test('wxpoint: the tendency spans exactly three hours when "current" is between the hours', () => {
  // a steady fall of 1 hPa an hour, current at 14:45: 3.0 hPa in 3 h ('falling'), not 14:45 minus 11:00 (3.75, 'falling quickly')
  const time = ['11', '12', '13', '14', '15'].map(h => `2026-10-01T${h}:00`), fall = h => 1010 - (h - 11);
  const d = { current: { time: '2026-10-01T14:45', pressure_msl: fall(14.75) }, hourly: { time, pressure_msl: [11, 12, 13, 14, 15].map(fall) } };
  const r = readDetails(d, 2);
  assert.equal(r.tendency_hpa, -3); assert.equal(r.tendency, 'falling');
  // the hour after the one three back missing: the span is scaled to three hours instead
  const gap = structuredClone(d); gap.hourly.pressure_msl[1] = null;
  assert.equal(readDetails(gap, 2).tendency_hpa, -3);
  // no current pressure: the hourly value at 14:00 against 11:00's, three hours exactly
  const hourly = structuredClone(d); delete hourly.current.pressure_msl;
  assert.equal(readDetails(hourly, 2).tendency_hpa, -3);
  // on the hour, as before
  const top = structuredClone(d); top.current = { time: '2026-10-01T14:00', pressure_msl: fall(14) };
  assert.equal(readDetails(top, 2).tendency_hpa, -3);
});
