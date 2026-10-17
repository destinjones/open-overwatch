// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// METAR and TAF decoding (src/core/metar.js): every real report in the fixtures (191 METARs and 41 TAFs from
// aviationweather.gov, 2026-10-13, from Denver to Moscow, Tokyo and Santiago) checked against AWC's own decode of the
// same text, plus the words the airport card shows and the hand-picked groups that matter most.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMetar, parseTaf, metarWords, tafWords, tafAt, tafWorst, flightCategory, worseCat, ceilingFt, parseWind, parseCloud, parseWeather, weatherText,
  windText, visText, cloudText, humidity, compass, reportTime, tafPeriod, readAwcMetars, readAwcTafs, metarUrl, tafUrl, idBatches, ageText, conditionText, CATEGORIES, CAT_COLOR } from '../src/core/metar.js';

const fx = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const METARS = fx('awc-metar.json').metars, TAFS = fx('awc-taf.json').tafs;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);
const metar = id => { const x = METARS.find(m => m.icaoId === id); return parseMetar(x.rawOb, { now: x.obsTime * 1000 + 60e3 }); };
const taf = id => { const x = TAFS.find(t => t.icaoId === id); return { x, t: parseTaf(x.rawTAF, { now: x.validTimeFrom * 1000 }) }; };

test('metar: every fixture parses fully and agrees with AWC (wind, visibility, cloud, temperature, category)', () => {
  assert.ok(METARS.length > 150);
  const awcVis = v => (v === '6+' ? 6 : v === '10+' ? 10 : +v);
  for (const x of METARS) {
    const r = parseMetar(x.rawOb, { now: x.obsTime * 1000 + 60e3 }), id = x.rawOb;
    assert.ok(r, id); assert.equal(r.station, x.icaoId, id);
    assert.deepEqual(r.unparsed, [], id);
    if (x.wspd != null) assert.equal(r.wind.speedKt, x.wspd, id);
    if (typeof x.wdir === 'number' && x.wspd) assert.equal(r.wind.dir, x.wdir, id);
    if (x.wdir === 'VRB') assert.equal(r.wind.vrb, true, id);
    if (x.wgst != null) assert.equal(r.wind.gustKt, x.wgst, id);
    if (x.temp != null) near(r.tempC, x.temp, 0.05, id);
    if (x.dewp != null) near(r.dewC, x.dewp, 0.05, id);
    if (x.altim != null) near(r.altimHpa, x.altim, 0.6, id);
    if (x.visib != null) { if (x.visib === '6+') assert.ok(r.visSM >= 6, id); else near(r.visSM, awcVis(x.visib), 0.01, id); }
    const theirs = (x.clouds || []).filter(c => c.cover !== 'OVX').map(c => c.cover + c.base).join(' ');
    if (theirs) assert.equal(r.clouds.map(c => c.cover + c.baseFt).join(' '), theirs, id);
    if (x.fltCat) assert.equal(r.category, x.fltCat, id);
  }
});

test('metar: groups that need care', () => {
  const den = metar('KDEN');   // METAR KDEN 131353Z 06010KT 3/4SM R35L/P6000FT BR OVC003 09/08 A2999 RMK AO2 SFC VIS 6 SLP100 T00890078
  assert.equal(den.visSM, 0.75); assert.equal(den.ceilFt, 300); assert.equal(den.category, 'LIFR');
  assert.deepEqual(den.rvr, [{ runway: '35L', text: 'more than 6,000 ft' }]);
  assert.equal(den.tempC, 8.9, 'the RMK T-group beats the whole degrees'); assert.equal(den.dewC, 7.8); near(den.slpHpa, 1010.0, 0.01);
  assert.equal(den.weather[0].text, 'mist'); assert.equal(den.time, Date.UTC(2026, 9, 13, 13, 53));
  const uuee = metar('UUEE');  // 36003MPS 330V120 ... R06R/290245 runway state
  assert.equal(uuee.wind.speedKt, 6, '3 m/s'); assert.equal(uuee.wind.dir, 360); assert.deepEqual(uuee.windVar, [330, 120]);
  assert.equal(uuee.runwayState.length, 2); assert.equal(uuee.trend, 'NOSIG');
  const cyys = parseMetar('METAR KCYS 131353Z 17006KT 1/2SM FG VV002 07/07 A3000 RMK AO2 SLP123 T00720072 RVRNO', { now: Date.UTC(2026, 9, 13, 14) });
  assert.equal(cyys.vvFt, 200); assert.equal(cyys.ceilFt, 200, 'vertical visibility is a ceiling'); assert.equal(cyys.category, 'LIFR');
  const mixed = parseMetar('KXYZ 131200Z 24015G25KT 1 1/2SM -TSRA BKN008CB OVC020 M02/M05 A2992', { now: Date.UTC(2026, 9, 13, 13) });
  assert.equal(mixed.visSM, 1.5); assert.equal(mixed.tempC, -2); assert.equal(mixed.dewC, -5); assert.equal(mixed.clouds[0].type, 'CB');
  assert.equal(mixed.weather[0].text, 'light thunderstorm with rain'); assert.equal(mixed.category, 'IFR');
  const lt = parseMetar('KXYZ 131200Z 00000KT M1/4SM FZFG VV001 M01/M01 A3001', { now: Date.UTC(2026, 9, 13, 13) });
  assert.equal(lt.visMinus, true); assert.equal(lt.wind.calm, true); assert.equal(lt.weather[0].text, 'freezing fog'); assert.equal(lt.category, 'LIFR');
  const cavok = parseMetar('LEMD 131430Z 35002KT CAVOK 28/10 Q1025 NOSIG', { now: Date.UTC(2026, 9, 13, 15) });
  assert.equal(cavok.cavok, true); assert.equal(cavok.category, 'VFR'); assert.equal(cavok.altimHpa, 1025); near(cavok.altimInHg, 30.27, 0.01);
  assert.equal(parseMetar('KP28 131356Z AUTO 15003KT 22/20 A2986 RMK AO1', { now: Date.UTC(2026, 9, 13, 14) }).category, null, 'no sky report: no category (like AWC)');
  assert.equal(parseMetar('XXXX 131356Z AUTO 15003KT 1/2SM 22/20', { now: Date.UTC(2026, 9, 13, 14) }).category, 'LIFR', '... unless the visibility alone decides');
  assert.equal(parseMetar('EGLL 131350Z NIL', { now: Date.UTC(2026, 9, 13, 14) }).nil, true);
  assert.equal(parseMetar(''), null); assert.equal(parseMetar('hello world'), null);
  const kept = parseMetar('KXYZ 131200Z 24015KT 10SM FOO CLR 10/05 A3000', { now: Date.UTC(2026, 9, 13, 13) });
  assert.deepEqual(kept.unparsed, ['FOO'], 'unknown groups are kept, not guessed');
});

test('metar: the plain words on the card', () => {
  const w = metarWords(metar('KDEN')).map(x => x.text);
  assert.deepEqual(w.slice(0, 4), ['Wind from the east-north-east (060°) at 10 knots.', 'Visibility 3/4 of a mile.', 'Mist.', 'Overcast at 300 feet.']);
  assert.match(w.join(' '), /8\.9 °C \(48 °F\), dew point 7\.8 °C, humidity 93%/);
  assert.match(w.join(' '), /Pressure 1016 hPa \(29\.99 inHg\)/);
  const eham = metarWords(metar('EHAM')).map(x => x.text).join(' ');   // 24021G31KT 9999 FEW009 BKN014 BKN030 ... TEMPO 7000 -RADZ
  assert.match(eham, /west-south-west \(240°\) at 21 knots, gusting 31/); assert.match(eham, /10 km or more/);
  assert.match(eham, /Next two hours, at times: 7 km, light rain and drizzle/);
  assert.match(metarWords(metar('SCEL')).map(x => x.text).join(' '), /^Light and variable wind \(3 knots\)/);
  assert.match(metarWords(metar('LEMD')).map(x => x.text).join(' '), /Ceiling and visibility OK/);
  assert.equal(windText(parseWind('00000KT')), 'Calm');
  assert.equal(windText(parseWind('VRB12KT')), 'Wind variable in direction at 12 knots');
  // a missing direction is not "variable", and a missing gust keeps the wind
  assert.equal(windText(parseWind('///15KT')), 'Wind direction not reported, 15 knots');
  assert.equal(windText(parseWind('///03KT')), 'Wind direction not reported, 3 knots');
  assert.deepEqual(parseWind('27015G//KT'), { dir: 270, vrb: false, speedKt: 15, gustKt: null, calm: false, unit: 'KT' });
  const noGust = parseMetar('KXYZ 012353Z 27015G//KT 2 1/2SM BR OVC009 20/10 A3010', { now: Date.UTC(2026, 10, 2) });
  assert.equal(noGust.wind.speedKt, 15); assert.deepEqual(noGust.unparsed, []);
  assert.equal(windText(noGust.wind), 'Wind from the west (270°) at 15 knots');
  assert.equal(visText({ visSM: 0.75, visUnit: 'SM' }), '3/4 of a mile'); assert.equal(visText({ visSM: 1.5, visUnit: 'SM' }), '1 1/2 miles');
  assert.equal(visText({ visSM: 6, visUnit: 'SM', visPlus: true }), '6 miles or more');
  // the US sixteenths and 7/8, not "0.1 miles"
  const sm = v => visText(parseMetar(`KSFO 010056Z 00000KT ${v}SM FG VV001 12/12 A3001`, { now: Date.UTC(2026, 10, 1, 2) }));
  assert.equal(sm('1/16'), '1/16 of a mile'); assert.equal(sm('3/16'), '3/16 of a mile'); assert.equal(sm('5/16'), '5/16 of a mile');
  assert.equal(sm('7/16'), '7/16 of a mile'); assert.equal(sm('7/8'), '7/8 of a mile'); assert.equal(sm('1 7/8'), '1 7/8 miles'); assert.equal(sm('1 3/8'), '1 3/8 miles');
  assert.equal(visText({ visSM: 800 / 1609.344, visM: 800, visUnit: 'M' }), '800 metres');
  assert.equal(cloudText({ clouds: [], clear: 'CLR' }), 'No cloud below 12,000 feet');
  assert.equal(cloudText({ clouds: [parseCloud('SCT024TCU')], clear: '' }), 'Scattered cloud at 2,400 feet (towering cumulus)');
  assert.equal(compass(270), 'west'); assert.equal(compass(359), 'north'); assert.equal(compass(22.5), 'north-north-east');
  near(humidity(20, 20), 100, 0); near(humidity(25, 10), 39, 1);
});

test('metar: weather groups', () => {
  const t = s => parseWeather(s).text;
  assert.equal(t('-SHRA'), 'light rain showers'); assert.equal(t('+TSRAGR'), 'heavy thunderstorm with rain and hail'); assert.equal(t('VCSH'), 'showers nearby');
  assert.equal(t('BLSN'), 'blowing snow'); assert.equal(t('-RADZ'), 'light rain and drizzle'); assert.equal(t('TS'), 'thunderstorm'); assert.equal(t('BCFG'), 'patches of fog');
  assert.equal(parseWeather('RERA').recent, true); assert.equal(parseWeather('CAVOK'), null); assert.equal(parseWeather('9999'), null);
  assert.equal(weatherText({ intensity: '+', desc: '', phen: ['SN'] }), 'heavy snow');
});

test('flight categories: the FAA thresholds, and the worse of two', () => {
  assert.equal(flightCategory(10, null), 'VFR'); assert.equal(flightCategory(5, null), 'MVFR'); assert.equal(flightCategory(6, 3100), 'VFR');
  assert.equal(flightCategory(10, 3000), 'MVFR'); assert.equal(flightCategory(10, 999), 'IFR'); assert.equal(flightCategory(2.9, null), 'IFR');
  assert.equal(flightCategory(10, 499), 'LIFR'); assert.equal(flightCategory(0.5, 5000), 'LIFR'); assert.equal(flightCategory(null, null), null);
  assert.equal(worseCat('VFR', 'IFR'), 'IFR'); assert.equal(worseCat('LIFR', 'MVFR'), 'LIFR'); assert.equal(worseCat(null, 'MVFR'), 'MVFR');
  assert.equal(ceilingFt([{ cover: 'FEW', baseFt: 500 }, { cover: 'SCT', baseFt: 800 }, { cover: 'BKN', baseFt: 2500 }]), 2500, 'FEW and SCT are not ceilings');
  assert.deepEqual(CATEGORIES, ['VFR', 'MVFR', 'IFR', 'LIFR']); for (const c of CATEGORIES) assert.match(CAT_COLOR[c], /^#[0-9a-f]{6}$/);
});

test('times: report days and TAF periods across a month end', () => {
  assert.equal(reportTime('131450Z', Date.UTC(2026, 9, 13, 15)), Date.UTC(2026, 9, 13, 14, 50));
  assert.equal(reportTime('302350Z', Date.UTC(2026, 9, 1, 0, 10)), Date.UTC(2026, 8, 30, 23, 50), 'yesterday was last month');
  assert.equal(reportTime('010005Z', Date.UTC(2026, 9, 31, 23, 58)), Date.UTC(2026, 10, 1, 0, 5), 'a clock running a little ahead');
  assert.deepEqual(tafPeriod('3118/0124', Date.UTC(2026, 9, 31, 17)), [Date.UTC(2026, 9, 31, 18), Date.UTC(2026, 10, 2, 0)], 'hour 24, next month');
  assert.equal(reportTime('bad'), null); assert.equal(tafPeriod('13/14', 0), null);
});

test('taf: every fixture parses fully and its periods agree with AWC', () => {
  assert.ok(TAFS.length >= 40);
  for (const x of TAFS) {
    const t = parseTaf(x.rawTAF, { now: x.validTimeFrom * 1000 }), id = x.rawTAF.slice(0, 40);
    assert.ok(t, id); assert.equal(t.station, x.icaoId, id); assert.deepEqual(t.unparsed, [], id);
    assert.equal(t.from, x.validTimeFrom * 1000, id); assert.equal(t.to, x.validTimeTo * 1000, id);
    assert.equal(t.periods.length, x.fcsts.length, id);
    x.fcsts.forEach((f, k) => {
      const p = t.periods[k], tag = `${id} #${k}`;
      assert.equal(p.kind, f.fcstChange == null ? 'BASE' : f.fcstChange === 'PROB' || f.probability ? 'PROB' : f.fcstChange, tag);
      if (f.probability) assert.equal(p.prob, f.probability, tag);
      assert.equal(p.from, f.timeFrom * 1000, tag);
      if (p.kind === 'TEMPO' || p.kind === 'PROB') assert.equal(p.to, f.timeTo * 1000, tag);
      if (p.wind && f.wspd != null) assert.equal(p.wind.speedKt, f.wspd, tag);   // AWC carries values forward; ours are what the group says
      if (p.visSM != null && f.visib != null) { if (f.visib === '6+') assert.ok(p.visSM >= 6, tag); else near(p.visSM, +f.visib, 0.02, tag); }
      const theirs = (f.clouds || []).filter(c => /^(FEW|SCT|BKN|OVC)$/.test(c.cover)).map(c => c.cover + c.base).join(' ');
      if (p.clouds.length) assert.equal(p.clouds.map(c => c.cover + c.baseFt).join(' '), theirs, tag);
    });
  }
});

test('taf: the forecast at a time, the worst ahead, and the words', () => {
  const { x, t } = taf('KDEN');   // 05010KT 5SM BR OVC003 TEMPO 1315/1317 2SM -DZ BR FM131700 06007KT P6SM BKN008 OVC020 FM131900 ...
  const at = h => Date.UTC(2026, 9, 13, h);
  const a = tafAt(t, at(16));
  assert.equal(a.main.category, 'LIFR'); assert.equal(a.tempo.length, 1); assert.equal(a.worst, 'LIFR');
  assert.equal(tafAt(t, at(18)).main.category, 'IFR', 'FM1700: BKN008'); assert.equal(tafAt(t, at(22)).main.category, 'VFR');
  assert.equal(tafAt(t, x.validTimeTo * 1000 + 1), null, 'after the TAF');
  assert.equal(tafWorst(t, { now: at(19), hours: 2 }), 'MVFR'); assert.equal(tafWorst(t, { now: at(15), hours: 6 }), 'LIFR');
  const words = tafWords(t, { now: at(16) });
  assert.equal(words[0].text, 'Now until 17Z: wind 050° 10 kt, 5 miles, mist, overcast at 300 ft'); assert.equal(words[0].category, 'LIFR');
  assert.equal(words[1].text, '15Z–17Z, at times: 2 miles, light drizzle, mist');
  assert.ok(words.some(w => /^From 19Z until 21Z: wind 060° 10 kt, 6 miles or more, scattered cloud at 1,600 ft, broken cloud at 2,800 ft$/.test(w.text)));
  assert.ok(words.some(w => /^Tomorrow 00Z–06Z, 30% chance: light rain showers/.test(w.text)), 'the hours of the 14th say so');
  assert.ok(tafWords(t, { now: at(22) }).every(w => w.to > at(22)), 'periods that ended are left out');
  // BECMG changes only what it names: EGLL 27020G30KT 9999 FEW040 BECMG 1315/1318 26009KT
  const egll = taf('EGLL').t, m = tafAt(egll, Date.UTC(2026, 9, 13, 19)).main;
  assert.equal(m.wind.speedKt, 9); assert.equal(m.clouds[0].baseFt, 4000); assert.equal(m.category, 'VFR');
  // CAVOK in a BECMG clears the cloud: LSZH ... BKN060 ... BECMG 1415/1417 CAVOK
  const lszh = taf('LSZH').t; assert.equal(tafAt(lszh, Date.UTC(2026, 9, 14, 18)).main.clouds.length, 0);
  // fog in a TEMPO makes the worst LIFR: EDDF TEMPO 1400/1408 0800 FG VV001
  assert.equal(tafWorst(taf('EDDF').t, { now: Date.UTC(2026, 9, 14, 1), hours: 2 }), 'LIFR');
  // Australia's INTER is a short TEMPO
  assert.ok(taf('YSSY').t.periods.some(p => p.kind === 'TEMPO' && p.inter));
  assert.equal(conditionText({ wind: parseWind('VRB03KT'), cavok: false, visSM: null, weather: [], clouds: [], clear: 'SKC' }), 'wind variable 3 kt, sky clear');
  assert.equal(conditionText({ wind: parseWind('///15KT'), cavok: false, visSM: null, weather: [], clouds: [], clear: 'SKC' }), 'wind direction not reported, 15 kt, sky clear');
});

test('taf: a time on another UTC day than now says which day', () => {
  // valid 1 Nov 14Z to 2 Nov 18Z, read at 1 Nov 15Z: the base runs to tomorrow's 18Z, the fog comes today at 18Z
  const now = Date.UTC(2026, 10, 1, 15);
  const t = parseTaf('TAF EDDF 011400Z 0114/0218 VRB03KT CAVOK BECMG 0118/0120 0300 FG VV001 BECMG 0208/0210 9999 NSW SCT015', { now });
  assert.deepEqual(tafWords(t, { now }).map(w => w.text.split(':')[0]), ['Now until tomorrow 18Z', '18Z–20Z, becoming', 'Tomorrow 08Z–10Z, becoming']);
  // FM groups read at 18Z: "From 18Z" tomorrow is not right now
  const at = Date.UTC(2026, 10, 1, 18);
  const fm = parseTaf('TAF KXYZ 011720Z 0118/0224 27010KT P6SM SKC FM020200 30015KT P6SM BKN020 FM021800 32010KT P6SM SCT050', { now: at });
  assert.deepEqual(tafWords(fm, { now: at }).map(w => w.text.split(':')[0]), ['Now until tomorrow 02Z', 'From tomorrow 02Z until 18Z', 'From tomorrow 18Z until 03/00Z']);
  // a TEMPO still running from yesterday, and one that ends after midnight
  const late = Date.UTC(2026, 10, 2, 1);
  const tp = parseTaf('TAF KXYZ 012320Z 0200/0306 27010KT P6SM SKC TEMPO 0123/0203 3SM BR TEMPO 0222/0302 2SM RA', { now: late });
  const lines = tafWords(tp, { now: late }).map(w => w.text.split(':')[0]);
  assert.ok(lines.includes('Yesterday 23Z–03Z, at times'), lines.join(' | '));
  assert.ok(lines.includes('22Z–tomorrow 02Z, at times'), lines.join(' | '));
});

test('awc: reading the API answers, the URLs and batches', () => {
  const now = Date.UTC(2026, 9, 13, 15);
  const m = readAwcMetars([...METARS, { rawOb: 'not a metar' }, null, { rawOb: METARS[0].rawOb.replace(/\d{6}Z/, '010000Z'), obsTime: 1 }], { now });
  assert.equal(m.size, new Set(METARS.map(x => x.icaoId)).size);
  assert.equal(m.get('KDEN').time, 1791899580 * 1000, 'the newest report per station, timed by AWC');
  const t = readAwcTafs(TAFS, { now }); assert.equal(t.size, TAFS.length); assert.equal(t.get('EGLL').amended, true);
  assert.equal(metarUrl(['KDEN', 'EGLL']), 'https://aviationweather.gov/api/data/metar?ids=KDEN,EGLL&format=json');
  assert.equal(tafUrl(['KDEN']), 'https://aviationweather.gov/api/data/taf?ids=KDEN&format=json');
  assert.deepEqual(idBatches(['a', 'b', 'c'], 2), [['a', 'b'], ['c']]);
  assert.equal(ageText(now - 12 * 60e3, now), '12 min ago'); assert.equal(ageText(now - 125 * 60e3, now), '2 h 05 ago');
});
