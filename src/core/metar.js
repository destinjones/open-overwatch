// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// METAR and TAF: the airport weather reports pilots read, decoded from their raw text into numbers and then into plain
// words ("Wind from the west at 22 knots, gusting 30. Overcast at 300 feet."), with the flight category (VFR, MVFR, IFR,
// LIFR) from the visibility and the ceiling. Reads the WMO/ICAO code and the US variant (statute miles, inches of
// mercury, the RMK T-group); what it does not recognise is kept in `unparsed`, never guessed at. The text comes from the
// Aviation Weather Center's data API (aviationweather.gov /api/data/metar and /taf, format=json: the raw text sits in
// rawOb / rawTAF). DOM-free (test/metar.test.mjs checks every report against AWC's own decode).

const KT_PER_MPS = 1.943844, KT_PER_KMH = 0.539957, M_PER_SM = 1609.344, HPA_PER_INHG = 33.8639;

/** The FAA flight categories, best to worst, and their colours on the map. */
export const CATEGORIES = Object.freeze(['VFR', 'MVFR', 'IFR', 'LIFR']);
export const CAT_COLOR = Object.freeze({ VFR: '#3ee08f', MVFR: '#5fb0ff', IFR: '#ff6b6b', LIFR: '#e070ff' });
export const CAT_WORDS = Object.freeze({
  VFR: 'VFR: clear enough to fly by sight', MVFR: 'Marginal VFR: low cloud or haze', IFR: 'IFR: instruments only (cloud under 1,000 ft or under 3 miles)',
  LIFR: 'Low IFR: cloud under 500 ft or under a mile',
});

/**
 * The flight category from the visibility (statute miles) and the ceiling (feet above the field: the lowest broken or
 * overcast layer, or the vertical visibility into fog). LIFR under 1 mile or 500 ft, IFR under 3 miles or 1,000 ft, MVFR
 * up to 5 miles or 3,000 ft, else VFR. Missing values count as good; both missing gives null.
 */
export function flightCategory(visSM, ceilFt) {
  const v = Number.isFinite(visSM) ? visSM : null, c = Number.isFinite(ceilFt) ? ceilFt : null;
  if (v == null && c == null) return null;
  const V = v ?? 99, Cf = c ?? 1e5;
  if (V < 1 || Cf < 500) return 'LIFR';
  if (V < 3 || Cf < 1000) return 'IFR';
  if (V <= 5 || Cf <= 3000) return 'MVFR';
  return 'VFR';
}
/** The worse of two categories (null counts as nothing). */
export const worseCat = (a, b) => (!a ? b : !b ? a : CATEGORIES.indexOf(a) >= CATEGORIES.indexOf(b) ? a : b);

/** The ceiling in feet: the lowest BKN or OVC layer, or the vertical visibility; null when there is none. */
export function ceilingFt(clouds = [], vvFt = null) {
  let c = Number.isFinite(vvFt) ? vvFt : null;
  for (const l of clouds) if ((l.cover === 'BKN' || l.cover === 'OVC') && Number.isFinite(l.baseFt) && (c == null || l.baseFt < c)) c = l.baseFt;
  return c;
}

// ---- the groups both reports share ----

const WX_INT = { '-': 'light', '+': 'heavy', VC: 'nearby' };
const WX_DESC = { MI: 'shallow', PR: 'partial', BC: 'patches of', DR: 'low drifting', BL: 'blowing', SH: 'showers of', TS: 'thunderstorm', FZ: 'freezing' };
const WX_PHEN = {
  DZ: 'drizzle', RA: 'rain', SN: 'snow', SG: 'snow grains', IC: 'ice crystals', PL: 'ice pellets', GR: 'hail', GS: 'small hail', UP: 'unknown precipitation',
  BR: 'mist', FG: 'fog', FU: 'smoke', VA: 'volcanic ash', DU: 'dust', SA: 'sand', HZ: 'haze', PY: 'spray',
  PO: 'dust whirls', SQ: 'squalls', FC: 'funnel cloud', SS: 'sandstorm', DS: 'duststorm',
};
const WX_RE = /^(RE)?(-|\+|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?((?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS){0,3})$/;

/** A present-weather group ("-SHRA", "+TSRA", "VCSH", "FZFG", "RERA") -> { code, intensity, desc, phen: [codes],
 *  recent, text } or null. */
export function parseWeather(tok) {
  const m = WX_RE.exec(tok);
  if (!m || (!m[3] && !m[4]) || tok === 'RE') return null;
  const phen = (m[4] || '').match(/../g) || [];
  return { code: tok, recent: !!m[1], intensity: m[2] || '', desc: m[3] || '', phen, text: weatherText({ intensity: m[2] || '', desc: m[3] || '', phen }) };
}
/** Plain words for a weather group: "light rain", "heavy thunderstorm with rain", "showers nearby", "freezing fog". */
export function weatherText({ intensity = '', desc = '', phen = [] }) {
  const p = phen.map(c => WX_PHEN[c] || c);
  let s;
  if (desc === 'TS') s = p.length ? `thunderstorm with ${p.join(' and ')}` : 'thunderstorm';
  else if (desc === 'SH') s = p.length ? `${p.join(' and ')} showers` : 'showers';
  else s = [WX_DESC[desc], p.join(' and ')].filter(Boolean).join(' ');
  if (intensity === 'VC') return `${s} nearby`;
  return [WX_INT[intensity], s].filter(Boolean).join(' ');
}

const COVER = { FEW: 'a few clouds', SCT: 'scattered cloud', BKN: 'broken cloud', OVC: 'overcast' };
/** A cloud group ("BKN014", "SCT024TCU", "OVC///", "FEW005") -> { cover, baseFt, type } or null. */
export function parseCloud(tok) {
  const m = /^(FEW|SCT|BKN|OVC)(\d{3}|\/\/\/)(CB|TCU|\/\/\/)?$/.exec(tok);
  if (!m) return null;
  return { cover: m[1], baseFt: m[2] === '///' ? null : +m[2] * 100, type: m[3] && m[3] !== '///' ? m[3] : '' };
}

/** A wind group ("27022G30KT", "VRB03KT", "36003MPS", "00000KT") -> { dir (° true, null when variable or not reported:
 *  "///15KT"), vrb, speedKt, gustKt (null when none or not reported: "27015G//KT"), calm } or null. Speeds in knots. */
export function parseWind(tok) {
  const m = /^(\d{3}|VRB|\/\/\/)(\d{2,3}|\/\/)(?:G(\d{2,3}|\/\/))?(KT|MPS|KMH)$/.exec(tok);
  if (!m) return null;
  const k = m[4] === 'MPS' ? KT_PER_MPS : m[4] === 'KMH' ? KT_PER_KMH : 1;
  const sp = m[2] === '//' ? null : Math.round(+m[2] * k), g = m[3] && m[3] !== '//' ? Math.round(+m[3] * k) : null;
  const dir = /^\d{3}$/.test(m[1]) ? +m[1] : null;   // 360 stays 360 (north), as written
  if (dir > 360) return null;   // "97802KT" is no wind: a garbled group, kept in unparsed
  return { dir: sp === 0 ? null : dir, vrb: m[1] === 'VRB', speedKt: sp, gustKt: g, calm: sp === 0, unit: m[4] };
}

/** A report's wind when the runway-by-wind guess can use it (a direction, or variable, or calm, with a speed), else null:
 *  "///15KT" (no direction) and "/////KT" (nothing) are not, and the cards fall back to the model's wind. */
export const usableWind = w => (w && w.speedKt != null && (w.dir != null || w.vrb || w.calm) ? w : null);

/** "1/2", "3/4", "1 1/2" (two tokens joined), "10" -> a number of statute miles. */
function miles(s) {
  const parts = s.trim().split(/\s+/); let v = 0;
  for (const p of parts) { const f = /^(\d+)\/(\d+)$/.exec(p); if (f) { if (+f[2] === 0) return null; v += +f[1] / +f[2]; } else if (/^\d+$/.test(p)) v += +p; else return null; }
  return Number.isFinite(v) ? v : null;   // 400 nines are Infinity, not a visibility
}

/** Visibility from one or two tokens at `i` -> { visSM, visM, plus, minus, used } or null. "9999" is 10 km or more; "CAVOK"
 *  is handled by the caller. A direction suffix ("4000NE", a sector's minimum) is read but not kept. */
function readVis(toks, i) {
  const t = toks[i];
  let m = /^(\d{4})(NDV|N|NE|E|SE|S|SW|W|NW)?$/.exec(t);
  if (m) { const plus = +m[1] === 9999, v = plus ? 10000 : +m[1]; return { visM: v, visSM: v / M_PER_SM, plus, minus: false, unit: 'M', used: 1 }; }
  m = /^([MP])?(\d+(?:\/\d+)?)SM$/.exec(t);
  if (m) { const v = miles(m[2]); return v == null ? null : { visSM: v, visM: v * M_PER_SM, plus: m[1] === 'P', minus: m[1] === 'M', unit: 'SM', used: 1 }; }
  // "1 1/2SM": a whole number, then the fraction
  if (/^\d$/.test(t) && /^\d\/\d+SM$/.test(toks[i + 1] || '')) { const v = miles(t + ' ' + toks[i + 1].replace('SM', '')); if (v != null) return { visSM: v, visM: v * M_PER_SM, plus: false, minus: false, unit: 'SM', used: 2 }; }
  return null;
}

/** A temperature ("M02" = -2) in °C. */
const temp = s => (s == null || s === '' || /\//.test(s) ? null : s[0] === 'M' ? -+s.slice(1) : +s);

/** The day/hour/minute of a report ("131450Z") as a time (ms) in the month of `now`, or the month before when that
 *  would be more than a day in the future. */
export function reportTime(ddhhmm, now = Date.now()) {
  const m = /^(\d{2})(\d{2})(\d{2})Z$/.exec(ddhhmm || '');
  if (!m || !dayHour(m[1], m[2], 23) || +m[3] > 59) return null;   // "911597Z" would roll over into another month
  const n = new Date(now);
  let t = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), +m[1], +m[2], +m[3]);
  if (t - now > 86400e3) t = Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, +m[1], +m[2], +m[3]);
  else if (now - t > 25 * 86400e3) t = Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, +m[1], +m[2], +m[3]);
  return t;
}

/** A TAF validity "1315/1418" (day+hour / day+hour) -> [from, to] ms near `ref`. Hour 24 is midnight. */
export function tafPeriod(s, ref) {
  const m = /^(\d{2})(\d{2})\/(\d{2})(\d{2})$/.exec(s || '');
  if (!m || !dayHour(m[1], m[2]) || !dayHour(m[3], m[4])) return null;
  const at = (d, h) => { const n = new Date(ref); let t = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), +d, +h); if (t < ref - 15 * 86400e3) t = Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, +d, +h); return t; };
  return [at(m[1], m[2]), at(m[3], m[4])];
}

/** A day of the month (01-31) and an hour (00 to `maxH`; a TAF's 24 is midnight), as written. */
const dayHour = (d, h, maxH = 24) => +d >= 1 && +d <= 31 && +h <= maxH;

// ---- METAR ----

/**
 * A METAR or SPECI as text -> { type, station, time (ms), auto, cor, nil, wind, windVar ([from, to] °), visSM, visM,
 * visPlus, visMinus, cavok, rvr: [{ runway, text }], weather: [parseWeather], recent: [...], clouds: [parseCloud],
 * clear ('CLR'|'SKC'|'NSC'|'NCD'|'CAVOK'|''), vvFt, tempC, dewC, altimHpa, altimInHg, trend ('NOSIG', 'TEMPO …', …),
 * remarks (text), ceilFt, category, unparsed: [tokens] } or null when it is not a report. `now` places the day/time.
 */
export function parseMetar(raw, { now = Date.now() } = {}) {
  const text = String(raw || '').replace(/\s+/g, ' ').replace(/=$/, '').trim();
  if (!text) return null;
  const [body, rmk = ''] = splitOnce(text, ' RMK ');
  const toks = body.split(' ');
  const out = { raw: text, type: 'METAR', station: '', time: null, auto: false, cor: false, nil: false, wind: null, windVar: null, visSM: null, visM: null,
    visPlus: false, visMinus: false, cavok: false, rvr: [], weather: [], recent: [], clouds: [], clear: '', vvFt: null, tempC: null, dewC: null,
    altimHpa: null, altimInHg: null, windShear: [], runwayState: [], trend: '', remarks: rmk.trim(), unparsed: [] };
  let i = 0;
  if (toks[i] === 'METAR' || toks[i] === 'SPECI') out.type = toks[i++];
  if (toks[i] === 'COR') { out.cor = true; i++; }
  if (!/^[A-Z][A-Z0-9]{3}$/.test(toks[i] || '')) return null;
  out.station = toks[i++];
  if (/^\d{6}Z$/.test(toks[i] || '')) out.time = reportTime(toks[i++], now);
  for (; i < toks.length; i++) {
    const t = toks[i];
    if (t === 'NIL') { out.nil = true; continue; }
    if (t === 'AUTO') { out.auto = true; continue; }
    if (t === 'COR') { out.cor = true; continue; }
    if (t === 'NOSIG' || t === 'TEMPO' || t === 'BECMG') { out.trend = toks.slice(i).join(' '); break; }
    let g;
    if (!out.wind && (g = parseWind(t))) { out.wind = g; continue; }
    if (out.wind && !out.windVar && (g = /^(\d{3})V(\d{3})$/.exec(t)) && +g[1] <= 360 && +g[2] <= 360) { out.windVar = [+g[1], +g[2]]; continue; }
    if (t === 'CAVOK') { out.cavok = true; out.clear = 'CAVOK'; out.visM = 10000; out.visSM = 10000 / M_PER_SM; out.visPlus = true; continue; }
    if (out.visSM == null && (g = readVis(toks, i))) { out.visSM = g.visSM; out.visM = g.visM; out.visPlus = g.plus; out.visMinus = g.minus; out.visUnit = g.unit; i += g.used - 1; continue; }
    if (out.visSM != null && /^\d{4}(N|NE|E|SE|S|SW|W|NW)$/.test(t)) continue;   // the lowest sector's visibility
    if ((g = /^R(\d{2}[LCR]?)\/([MP]?\d{4})(?:V([MP]?\d{4}))?(FT)?\/?([UDN])?$/.exec(t))) { out.rvr.push({ runway: g[1], text: rvrText(g) }); continue; }
    if (/^R\d{2}[LCR]?\/(\d{6}|[\d\/]{6}|CLRD\d\d)$/.test(t) || /^R\d{2}[LCR]?\/\/{6}$/.test(t)) { out.runwayState.push(t); continue; }   // runway surface state (Europe)
    if (t === 'WS') { const n = toks[i + 1] === 'ALL' ? 3 : 1; out.windShear.push(toks.slice(i, i + 1 + n).join(' ')); i += n; continue; }
    if ((g = parseCloud(t))) { out.clouds.push(g); continue; }
    if ((g = /^VV(\d{3}|\/\/\/)$/.exec(t))) { out.vvFt = g[1] === '///' ? 0 : +g[1] * 100; continue; }   // VV///: hidden, height unknown
    if (/^(CLR|SKC|NSC|NCD)$/.test(t)) { out.clear = t; continue; }
    if ((g = /^(M?\d{2}|\/\/)\/(M?\d{2}|\/\/)?$/.exec(t))) { out.tempC = temp(g[1]); out.dewC = temp(g[2]); continue; }
    if ((g = /^A(\d{4})$/.exec(t))) { out.altimInHg = +g[1] / 100; out.altimHpa = Math.round(out.altimInHg * HPA_PER_INHG * 10) / 10; continue; }
    if ((g = /^Q(\d{3,4})$/.exec(t))) { out.altimHpa = +g[1]; out.altimInHg = Math.round(+g[1] / HPA_PER_INHG * 100) / 100; continue; }
    if ((g = parseWeather(t))) { (g.recent ? out.recent : out.weather).push(g); continue; }
    if (t === '//' || t === '////' || t === '//////' || t === '$') continue;   // a sensor reporting nothing
    out.unparsed.push(t);
  }
  // the US remarks worth reading: the T-group (tenths of a degree), sea-level pressure, station type
  const tg = /\bT([01])(\d{3})([01])(\d{3})\b/.exec(out.remarks);
  if (tg) { out.tempC = (tg[1] === '1' ? -1 : 1) * +tg[2] / 10; out.dewC = (tg[3] === '1' ? -1 : 1) * +tg[4] / 10; }
  const slp = /\bSLP(\d{3})\b/.exec(out.remarks);
  if (slp) { const v = +slp[1] / 10; out.slpHpa = v < 50 ? 1000 + v : 900 + v; }
  if (/\bAO2\b/.test(out.remarks)) out.station2 = 'automated, with a precipitation sensor';
  else if (/\bAO1\b/.test(out.remarks)) out.station2 = 'automated';
  const pk = /\bPK WND (\d{3})(\d{2,3})\/(\d{2})?(\d{2})\b/.exec(out.remarks);
  if (pk) out.peakWind = { dir: +pk[1], speedKt: +pk[2] };
  out.ceilFt = ceilingFt(out.clouds, out.vvFt);
  // like AWC: no category without a sky report (a ceiling can't be told), unless the visibility alone says IFR or worse
  const sky = out.clouds.length || out.clear || out.vvFt != null || out.cavok;
  out.category = out.nil ? null : sky ? flightCategory(out.visSM, out.ceilFt) : out.visSM != null && out.visSM < 3 ? flightCategory(out.visSM, null) : null;
  return out;
}

function splitOnce(s, sep) { const k = s.indexOf(sep); return k < 0 ? [s, ''] : [s.slice(0, k), s.slice(k + sep.length)]; }
function rvrText(g) {
  const one = s => (s[0] === 'P' ? 'more than ' : s[0] === 'M' ? 'less than ' : '') + fmtInt(+s.replace(/^[MP]/, ''));
  const unit = g[4] ? ' ft' : ' m', tr = { U: ', improving', D: ', getting worse', N: ', steady' }[g[5]] || '';
  return (g[3] ? `${one(g[2])} to ${one(g[3])}` : one(g[2])) + unit + tr;
}
const fmtInt = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ---- words ----

const COMPASS = ['north', 'north-north-east', 'north-east', 'east-north-east', 'east', 'east-south-east', 'south-east', 'south-south-east',
  'south', 'south-south-west', 'south-west', 'west-south-west', 'west', 'west-north-west', 'north-west', 'north-north-west'];
/** "the west" for 270°: the 16-point compass name of a direction. */
export const compass = deg => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

/** Wind in words: "Calm", "Wind from the west (270°) at 22 knots, gusting 30", "Light and variable wind (3 knots)",
 *  "Wind direction not reported, 15 knots" (a "///15KT" group: the direction is missing, which is not "variable"). */
export function windText(w, varRange = null) {
  if (!w || w.speedKt == null) return '';
  if (w.calm) return 'Calm';
  const g = w.gustKt ? `, gusting ${w.gustKt}` : '';
  if (w.dir == null && !w.vrb) return `Wind direction not reported, ${w.speedKt} knot${w.speedKt === 1 ? '' : 's'}${g}`;
  if (w.dir == null) return w.speedKt <= 6 ? `Light and variable wind (${w.speedKt} knots${g})` : `Wind variable in direction at ${w.speedKt} knots${g}`;
  const v = varRange ? `, swinging between ${String(varRange[0]).padStart(3, '0')}° and ${String(varRange[1]).padStart(3, '0')}°` : '';
  return `Wind from the ${compass(w.dir)} (${String(w.dir).padStart(3, '0')}°) at ${w.speedKt} knot${w.speedKt === 1 ? '' : 's'}${g}${v}`;
}

/** Visibility in words, in the report's own units: "10 km or more", "3/4 of a mile", "6 miles or more", "800 metres". */
export function visText(r) {
  if (r.visSM == null) return '';
  if (r.visUnit !== 'SM' && r.visPlus && r.visM >= 10000) return '10 km or more';
  if (r.visUnit === 'SM') {
    const s = r.visSM, frac = { 0.0625: '1/16', 0.125: '1/8', 0.1875: '3/16', 0.25: '1/4', 0.3125: '5/16', 0.375: '3/8', 0.4375: '7/16', 0.5: '1/2',
      0.625: '5/8', 0.75: '3/4', 0.875: '7/8' };   // the US reportable values (FMH-1: sixteenths in fog at manual stations)
    const whole = Math.floor(s), rest = Math.round((s - whole) * 10000) / 10000;
    const words = rest && frac[rest] ? (whole ? `${whole} ${frac[rest]} miles` : `${frac[rest]} of a mile`) : `${Math.round(s * 10) / 10} mile${s === 1 ? '' : 's'}`;
    return (r.visMinus ? 'less than ' : '') + words + (r.visPlus ? ' or more' : '');
  }
  return r.visM >= 5000 ? `${Math.round(r.visM / 100) / 10} km` : `${fmtInt(r.visM)} metres`;
}

/** Cloud in words: "Overcast at 300 feet", "A few clouds at 1,700 feet, scattered cloud at 25,000 feet", "Sky clear". */
export function cloudText(r) {
  if (r.vvFt != null) return r.vvFt ? `Sky hidden (fog or snow): vertical visibility ${fmtInt(r.vvFt)} feet` : 'Sky hidden (fog or snow)';
  if (!r.clouds.length) return { CLR: 'No cloud below 12,000 feet', SKC: 'Sky clear', NSC: 'No significant cloud', NCD: 'No cloud detected', CAVOK: 'No cloud below 5,000 feet' }[r.clear] || '';
  const s = r.clouds.map(c => `${COVER[c.cover]}${c.baseFt != null ? ` at ${fmtInt(c.baseFt)} feet` : ''}${c.type === 'CB' ? ' (thunderclouds)' : c.type === 'TCU' ? ' (towering cumulus)' : ''}`).join(', ');
  return s[0].toUpperCase() + s.slice(1);
}

/** Relative humidity (%) from temperature and dew point (Magnus). */
export function humidity(t, d) {
  if (!Number.isFinite(t) || !Number.isFinite(d)) return null;
  const f = x => Math.exp(17.625 * x / (243.04 + x));
  return Math.round(100 * f(d) / f(t));
}

/** A decoded METAR as plain sentences: [{ k (what), text }], in the order a pilot reads them. */
export function metarWords(r) {
  if (!r) return [];
  if (r.nil) return [{ k: 'report', text: 'The station sent no report (NIL).' }];
  const out = [], cap = s => s && s[0].toUpperCase() + s.slice(1);
  const w = windText(r.wind, r.windVar); if (w) out.push({ k: 'wind', text: w + '.' });
  if (r.cavok) out.push({ k: 'vis', text: 'Ceiling and visibility OK: 10 km or more, no cloud below 5,000 feet, no weather that matters.' });
  else {
    const v = visText(r); if (v) out.push({ k: 'vis', text: `Visibility ${v}.` });
    const wx = r.weather.map(x => x.text).join(', '); if (wx) out.push({ k: 'wx', text: cap(wx) + '.' });
    const c = cloudText(r); if (c) out.push({ k: 'cloud', text: c + '.' });
  }
  if (r.rvr.length) out.push({ k: 'rvr', text: 'Runway visual range ' + r.rvr.map(x => `${x.runway}: ${x.text}`).join('; ') + '.' });
  if (r.tempC != null) {
    const h = humidity(r.tempC, r.dewC);
    out.push({ k: 'temp', text: `${round1(r.tempC)} °C (${Math.round(r.tempC * 9 / 5 + 32)} °F)` + (r.dewC != null ? `, dew point ${round1(r.dewC)} °C${h != null ? `, humidity ${h}%` : ''}` : '') + '.' });
  }
  if (r.altimHpa != null) out.push({ k: 'pres', text: `Pressure ${Math.round(r.altimHpa)} hPa (${r.altimInHg.toFixed(2)} inHg).` });
  if (r.recent.length) out.push({ k: 'recent', text: 'Recently: ' + r.recent.map(x => x.text).join(', ') + '.' });
  if (r.windShear.length) out.push({ k: 'ws', text: 'Wind shear reported: ' + r.windShear.join(', ') + '.' });
  if (r.trend) out.push({ k: 'trend', text: trendText(r.trend) });
  return out;
}
const round1 = v => Math.round(v * 10) / 10;
function trendText(t) {
  if (t.startsWith('NOSIG')) return 'No significant change expected in the next two hours.';
  const p = parseTafChanges(t.split(' '), 0, null)[0];
  if (!p) return `Next two hours: ${t}.`;
  return `Next two hours, ${p.kind === 'TEMPO' ? 'at times' : 'becoming'}: ${conditionText(p) || t}.`;
}

// ---- TAF ----

/**
 * A TAF as text -> { station, issued (ms), from, to, amended, periods: [{ kind ('BASE'|'FM'|'BECMG'|'TEMPO'|'PROB'),
 * prob (%), from, to, wind, visSM, visM, visPlus, cavok, weather, clouds, vvFt, nsw, ceilFt, category }], unparsed } or
 * null. `now` places the days.
 */
export function parseTaf(raw, { now = Date.now() } = {}) {
  const text = String(raw || '').replace(/\s+/g, ' ').replace(/=$/, '').trim();
  if (!text) return null;
  const [body, rmk = ''] = splitOnce(text, ' RMK ');
  const toks = body.split(' ');
  let i = 0;
  const out = { raw: text, station: '', issued: null, from: null, to: null, amended: false, corrected: false, periods: [], remarks: rmk.trim(), unparsed: [] };
  if (toks[i] === 'TAF') i++;
  while (toks[i] === 'AMD' || toks[i] === 'COR') { if (toks[i] === 'AMD') out.amended = true; else out.corrected = true; i++; }
  if (!/^[A-Z][A-Z0-9]{3}$/.test(toks[i] || '')) return null;
  out.station = toks[i++];
  if (/^\d{6}Z$/.test(toks[i] || '')) out.issued = reportTime(toks[i++], now);
  const ref = out.issued ?? now;
  const v = tafPeriod(toks[i], ref);
  if (v) { [out.from, out.to] = v; i++; }
  out.periods = parseTafChanges(toks, i, out, ref);
  return out;
}

/** The change groups of a TAF (or a METAR trend) from token i: the base forecast, then FM / BECMG / TEMPO / PROBnn. */
function parseTafChanges(toks, i, taf, ref = Date.now()) {
  const periods = [];
  let p = { kind: 'BASE', prob: null, from: taf ? taf.from : null, to: taf ? taf.to : null, wind: null, visSM: null, visM: null, visPlus: false, cavok: false, weather: [], clouds: [], clear: '', vvFt: null, nsw: false, temps: [] };
  const push = () => { if (p.kind !== 'BASE' || p.wind || p.visSM != null || p.clouds.length || p.weather.length || p.clear || p.cavok) periods.push(p); };
  const fresh = (kind, extra = {}) => ({ kind, prob: null, from: null, to: null, wind: null, visSM: null, visM: null, visPlus: false, cavok: false, weather: [], clouds: [], clear: '', vvFt: null, nsw: false, temps: [], ...extra });
  for (; i < toks.length; i++) {
    const t = toks[i]; let g;
    if ((g = /^FM(\d{2})(\d{2})(\d{2})$/.exec(t)) && dayHour(g[1], g[2], 23) && +g[3] <= 59) {
      push(); const n = new Date(ref); let at = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), +g[1], +g[2], +g[3]); if (at < ref - 15 * 86400e3) at = Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, +g[1], +g[2], +g[3]);
      p = fresh('FM', { from: at }); continue;
    }
    if (t === 'BECMG' || t === 'TEMPO' || t === 'INTER' || (g = /^PROB(\d{2})$/.exec(t))) {
      push();
      if (t === 'BECMG' || t === 'TEMPO') p = fresh(t);
      else if (t === 'INTER') p = fresh('TEMPO', { inter: true });   // Australia: intermittent, under 30 minutes at a time
      else { p = fresh('PROB', { prob: +g[1] }); if (toks[i + 1] === 'TEMPO') { i++; p.tempo = true; } }
      const per = tafPeriod(toks[i + 1], ref); if (per) { [p.from, p.to] = per; i++; }
      continue;
    }
    if (!p.wind && (g = parseWind(t))) { p.wind = g; continue; }
    if (t === 'CAVOK') { p.cavok = true; p.visM = 10000; p.visSM = 10000 / M_PER_SM; p.visPlus = true; continue; }
    if (p.visSM == null && (g = readVis(toks, i))) { p.visSM = g.visSM; p.visM = g.visM; p.visPlus = g.plus; p.visMinus = g.minus; p.visUnit = g.unit; i += g.used - 1; continue; }
    if ((g = parseCloud(t))) { p.clouds.push(g); continue; }
    if ((g = /^VV(\d{3}|\/\/\/)$/.exec(t))) { p.vvFt = g[1] === '///' ? 0 : +g[1] * 100; continue; }   // VV///: sky hidden, height unknown (counts as the lowest)
    if (/^(SKC|NSC|CLR|NCD)$/.test(t)) { p.clear = t; continue; }
    if (t === 'NSW') { p.nsw = true; continue; }
    if ((g = parseWeather(t))) { p.weather.push(g); continue; }
    if ((g = /^T([XN])(M?\d{2})\/(\d{4})Z$/.exec(t))) { p.temps.push({ kind: g[1] === 'X' ? 'max' : 'min', c: temp(g[2]), at: g[3] }); continue; }
    if (/^(WS\d{3}\/\d{5}KT|QNH\d{4}INS|[56]\d{5}|AMD|COR|NIL|CNL)$/.test(t)) continue;   // wind shear, icing/turbulence layers, amendment marks
    if (taf) taf.unparsed.push(t);
  }
  push();
  for (const q of periods) { q.ceilFt = ceilingFt(q.clouds, q.vvFt); q.category = flightCategory(q.visSM, q.ceilFt); }
  return periods;
}

/**
 * The forecast in force at time t: the base or latest FM/BECMG period's values carried forward (a BECMG changes only
 * what it names, and counts from its start), and the TEMPO/PROB periods covering t as the worse case.
 * Returns { main (merged values with category), tempo: [periods], worst (category) } or null outside the TAF.
 */
export function tafAt(taf, t) {
  if (!taf || !taf.periods.length || (taf.from != null && t < taf.from) || (taf.to != null && t >= taf.to)) return null;
  let main = null;
  for (const p of taf.periods) {
    if (p.kind === 'BASE') { main = { ...p }; continue; }
    if (p.kind === 'FM' && p.from <= t) { main = { ...p }; continue; }
    if (p.kind === 'BECMG' && p.from != null && p.from <= t && main) {
      main = { ...main, kind: main.kind, from: main.from };
      if (p.wind) main.wind = p.wind;
      if (p.visSM != null) { main.visSM = p.visSM; main.visM = p.visM; main.visPlus = p.visPlus; main.cavok = p.cavok; }
      if (p.cavok) { main.clouds = []; main.clear = 'CAVOK'; main.vvFt = null; main.weather = []; }
      if (p.clouds.length || p.clear || p.vvFt != null) { main.clouds = p.clouds; main.clear = p.clear; main.vvFt = p.vvFt; }
      if (p.weather.length || p.nsw) main.weather = p.nsw ? [] : p.weather;
    }
  }
  if (!main) return null;
  main.ceilFt = ceilingFt(main.clouds, main.vvFt); main.category = flightCategory(main.visSM, main.ceilFt);
  const tempo = taf.periods.filter(p => (p.kind === 'TEMPO' || p.kind === 'PROB') && p.from != null && p.from <= t && t < p.to);
  let worst = main.category;
  for (const p of tempo) {   // a TEMPO's missing values are the main ones
    const c = flightCategory(p.visSM ?? main.visSM, (p.clouds.length || p.vvFt != null) ? p.ceilFt : main.ceilFt);
    worst = worseCat(worst, c);
  }
  return { main, tempo, worst };
}

/** Plain words for one forecast period's conditions: "wind 050° 10 kt, 5 miles in mist, overcast at 300 ft". */
export function conditionText(p) {
  const bits = [];
  if (p.wind) bits.push(p.wind.calm ? 'calm' : `wind ${p.wind.dir == null ? (p.wind.vrb ? 'variable' : 'direction not reported,') : String(p.wind.dir).padStart(3, '0') + '°'} ${p.wind.speedKt} kt${p.wind.gustKt ? ` gusting ${p.wind.gustKt}` : ''}`);
  if (p.cavok) bits.push('CAVOK (all clear)');
  else if (p.visSM != null) bits.push(visText(p));
  if (p.weather.length) bits.push(p.weather.map(w => w.text).join(', '));
  else if (p.nsw) bits.push('the weather ends');
  if (!p.cavok) {
    if (p.vvFt != null) bits.push(p.vvFt ? `sky hidden, vertical visibility ${fmtInt(p.vvFt)} ft` : 'sky hidden');
    else if (p.clouds.length) bits.push(p.clouds.map(c => `${COVER[c.cover]} at ${c.baseFt != null ? fmtInt(c.baseFt) : '?'} ft${c.type === 'CB' ? ' (thunderclouds)' : ''}`).join(', '));
    else if (p.clear) bits.push({ SKC: 'sky clear', NSC: 'no significant cloud', CLR: 'no low cloud', NCD: 'no cloud' }[p.clear] || '');
  }
  return bits.filter(Boolean).join(', ');
}

const hhmm = t => { const d = new Date(t); return `${String(d.getUTCHours()).padStart(2, '0')}${d.getUTCMinutes() ? ':' + String(d.getUTCMinutes()).padStart(2, '0') : ''}Z`; };
const utcDay = t => Math.floor(t / 86400e3);
/** A time as "18Z", or with its UTC day when that is not the day of `now`: "tomorrow 18Z", "yesterday 22Z", "03/06Z". */
const dayHhmm = (t, now) => {
  const k = utcDay(t) - utcDay(now);
  return (k === 0 ? '' : k === 1 ? 'tomorrow ' : k === -1 ? 'yesterday ' : String(new Date(t).getUTCDate()).padStart(2, '0') + '/') + hhmm(t);
};
/** The end of a span: just "20Z" when it falls on the same UTC day as the start the reader already has, else with its day. */
const endHhmm = (to, start, now) => (utcDay(to) === utcDay(start) ? hhmm(to) : dayHhmm(to, now));
const cap = s => s[0].toUpperCase() + s.slice(1);
/**
 * A TAF as lines of plain words for the card, from `now` for `hours` (periods that ended are left out): [{ kind, from,
 * to, category, text }], e.g. "Now until 17Z: wind 050° 10 kt, 5 miles, mist, overcast at 300 ft" and "17Z–19Z, at times:
 * 2 miles, light drizzle, mist". A time on another UTC day than `now` says so ("Now until tomorrow 18Z", "Tomorrow
 * 08Z–10Z, becoming: ..."), since a TAF runs 24-30 h and "18Z" alone would read as today's.
 */
export function tafWords(taf, { now = Date.now(), hours = 30 } = {}) {
  if (!taf) return [];
  const end = now + hours * 3600e3, out = [], main = taf.periods.filter(p => p.kind === 'BASE' || p.kind === 'FM');
  const ends = p => { const k = main.indexOf(p); return k >= 0 && main[k + 1] ? main[k + 1].from : taf.to; };
  for (const p of taf.periods) {
    const from = p.from ?? taf.from, to = p.kind === 'BASE' || p.kind === 'FM' ? ends(p) : p.to;
    if (to != null && to <= now) continue;
    if (from != null && from > end) continue;
    const when = p.kind === 'BASE' || p.kind === 'FM'
      ? (from != null && from > now ? `From ${dayHhmm(from, now)}` : 'Now') + (to != null ? ` until ${endHhmm(to, from != null && from > now ? from : now, now)}` : '')
      : `${cap(dayHhmm(from, now))}–${endHhmm(to, from, now)}, ${p.kind === 'TEMPO' ? 'at times' : p.kind === 'BECMG' ? 'becoming' : `${p.prob}% chance${p.tempo ? ' at times' : ''}`}`;
    const text = conditionText(p);
    if (!text) continue;
    out.push({ kind: p.kind, from, to, category: p.kind === 'BECMG' ? null : p.category, text: `${when}: ${text}` });
  }
  return out;
}

/** The worst category the TAF allows between now and `hours` ahead (TEMPO and PROB count), checked every 30 min. */
export function tafWorst(taf, { now = Date.now(), hours = 6 } = {}) {
  let worst = null;
  for (let t = now; t <= now + hours * 3600e3; t += 1800e3) { const a = tafAt(taf, t); if (a) worst = worseCat(worst, a.worst); }
  return worst;
}

// ---- the source ----

export const AWC = 'https://aviationweather.gov/api/data/';
/** The AWC URLs for a set of station ids (max 400 characters of ids per request). */
export const metarUrl = ids => `${AWC}metar?ids=${ids.map(s => encodeURIComponent(s)).join(',')}&format=json`;
export const tafUrl = ids => `${AWC}taf?ids=${ids.map(s => encodeURIComponent(s)).join(',')}&format=json`;
/** Split ids into requests of at most `n` stations. */
export const idBatches = (ids, n = 60) => { const out = []; for (let k = 0; k < ids.length; k += n) out.push(ids.slice(k, k + n)); return out; };

/** AWC's metar JSON -> Map station -> the newest parsed report (rows whose raw text does not parse are skipped). */
export function readAwcMetars(json, { now = Date.now() } = {}) {
  const out = new Map();
  for (const row of Array.isArray(json) ? json : []) {
    if (!row || typeof row.rawOb !== 'string') continue;
    const r = parseMetar(row.rawOb, { now: Number.isFinite(row.obsTime) ? row.obsTime * 1000 + 60e3 : now });
    if (!r) continue;
    if (Number.isFinite(row.obsTime)) r.time = row.obsTime * 1000;
    const old = out.get(r.station); if (!old || (r.time || 0) > (old.time || 0)) out.set(r.station, r);
  }
  return out;
}
/** AWC's taf JSON -> Map station -> the most recent parsed TAF. */
export function readAwcTafs(json, { now = Date.now() } = {}) {
  const out = new Map();
  for (const row of Array.isArray(json) ? json : []) {
    if (!row || typeof row.rawTAF !== 'string') continue;
    const ref = Number.isFinite(row.validTimeFrom) ? row.validTimeFrom * 1000 : now;
    const t = parseTaf(row.rawTAF, { now: ref });
    if (!t) continue;
    if (Number.isFinite(row.validTimeFrom)) t.from = row.validTimeFrom * 1000;
    if (Number.isFinite(row.validTimeTo)) t.to = row.validTimeTo * 1000;
    const old = out.get(t.station); if (!old || (t.issued || 0) > (old.issued || 0)) out.set(t.station, t);
  }
  return out;
}

/** How old a report is, in words: "12 min ago", "2 h 05 ago". */
export function ageText(t, now = Date.now()) {
  if (!Number.isFinite(t)) return '';
  const m = Math.max(0, Math.round((now - t) / 60e3));
  return m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} ago`;
}
