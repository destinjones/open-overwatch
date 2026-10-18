// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Ships from AIS, the pure parts: Fintraffic's Digitraffic marine feed (positions as GeoJSON, ship details as JSON),
// AIS codes in words (ship type, navigational status, flag from the MMSI, ETA bits), and where a ship is between reports
// (along its course at its speed, through the turn it reports). No DOM, no Cesium (test/ais.test.mjs).
import { destination } from './geo.js';

/** Fintraffic's marine API (keyless, CORS; asks callers to name themselves) and the sea its coastal network hears ([s, w, n, e]). */
export const DIGITRAFFIC_AIS = 'https://meri.digitraffic.fi/api/ais/v1/';
export const DIGITRAFFIC_HEADERS = Object.freeze({ 'Digitraffic-User': 'OpenOverwatch/0.9' });
export const AIS_AREA = Object.freeze([56.5, 15.5, 66.5, 35.0]);

const KN = 0.514444, D2R = Math.PI / 180, R2D = 180 / Math.PI;
const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** AIS rate of turn (ROT_AIS, -126..126; ±127 = turning fast without a sensor, -128 = none) → degrees a second, or null. */
export function rotDegPerSec(rot) {
  if (!Number.isFinite(rot) || Math.abs(rot) > 126 || rot === 0) return rot === 0 ? 0 : null;
  return Math.sign(rot) * (rot / 4.733) ** 2 / 60;
}

/**
 * One AIS report's motion with the "not available" codes made null: speed 102.3 (anything from 102 kn), course 360,
 * heading 511 (anything from 360), rate of turn ±127/-128 (rotDegPerSec). Takes Digitraffic's names (sog, cog, heading,
 * rot, navStat) or aisstream.io's PositionReport names (Sog, Cog, TrueHeading, RateOfTurn, NavigationalStatus) →
 * { sog (kn), cog (deg), heading (deg), turn (deg/s), navStat (15 = not defined) }.
 * @param {Record<string, any>} r
 */
export function cleanAisSentinels(r) {
  const sog = num(r?.sog ?? r?.Sog), cog = num(r?.cog ?? r?.Cog), hdg = num(r?.heading ?? r?.TrueHeading), nav = num(r?.navStat ?? r?.NavigationalStatus);
  return { sog: sog != null && sog >= 0 && sog < 102 ? sog : null, cog: cog != null && cog >= 0 && cog < 360 ? cog : null,
    heading: hdg != null && hdg >= 0 && hdg < 360 ? hdg : null, turn: rotDegPerSec(r?.rot ?? r?.RateOfTurn), navStat: nav != null && nav >= 0 && nav <= 15 ? nav : 15 };
}

/**
 * Digitraffic `/api/ais/v1/locations` (GeoJSON) → reports { mmsi, lat, lon, sog (kn), cog (deg or null), heading (deg or
 * null), turn (deg/s or null), navStat, t (ms, when the network heard it) }. AIS "not available" codes become null
 * (course 360, heading 511, speed 102.3: cleanAisSentinels).
 */
export function parseAisLocations(doc) {
  const out = [];
  for (const f of doc?.features || []) {
    const p = f.properties || {}, c = f.geometry?.coordinates || [], lon = num(c[0]), lat = num(c[1]), t = num(p.timestampExternal), mmsi = num(p.mmsi ?? f.mmsi);
    if (lat == null || lon == null || t == null || mmsi == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    out.push({ mmsi, lat, lon, ...cleanAisSentinels(p), t });
  }
  return out;
}

/** aisstream.io's WebSocket, which the download's local helper (serve.js / serve.py, its /aisstream route) connects to. */
export const AISSTREAM_UPSTREAM = 'wss://stream.aisstream.io/v0/stream';
/**
 * Where the 2D map opens its aisstream socket: the local helper's relay (ws://localhost:8787/aisstream) when the page is
 * served from this computer, otherwise null. aisstream.io works only in the download: the website never opens
 * stream.aisstream.io (its ships stay Fintraffic's).
 * @param {{ protocol: string, hostname: string, host: string }} loc a page's location
 */
export function aisstreamSocketUrl(loc) {
  if (!loc || !/^https?:$/.test(loc.protocol) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(loc.hostname)) return null;
  return (loc.protocol === 'https:' ? 'wss://' : 'ws://') + loc.host + '/aisstream';
}

/** AIS ETA bits (month << 16 | day << 11 | hour << 6 | minute, UTC; 0 / 24 / 60 = not given) → { month, day, hour, minute } or null. */
export function etaParts(eta) {
  if (!Number.isFinite(eta) || eta <= 0) return null;
  const month = (eta >> 16) & 15, day = (eta >> 11) & 31, hour = (eta >> 6) & 31, minute = eta & 63;
  if (month < 1 || month > 12 || day < 1) return null;
  return { month, day, hour: hour < 24 ? hour : null, minute: minute < 60 ? minute : null };
}
/** An ETA's time (ms): the year that puts it nearest to now (AIS ETAs carry no year). */
export function etaTime(parts, now = Date.now()) {
  if (!parts) return null;
  const y = new Date(now).getUTCFullYear();
  let best = null;
  for (const yy of [y - 1, y, y + 1]) {
    const t = Date.UTC(yy, parts.month - 1, parts.day, parts.hour ?? 12, parts.minute ?? 0);
    if (best == null || Math.abs(t - now) < Math.abs(best - now)) best = t;
  }
  return best;
}

/**
 * Digitraffic `/api/ais/v1/vessels` → details { mmsi, name, callSign, imo, type, length (m), width (m), draught (m),
 * destination, eta: parts or null, t }. Length and width come from the antenna's distances to bow, stern, port and
 * starboard (A + B, C + D); 0 means unknown.
 */
export function parseAisVessels(list) {
  const out = [];
  for (const v of Array.isArray(list) ? list : []) {
    const mmsi = num(v.mmsi); if (mmsi == null) continue;
    const a = num(v.referencePointA) || 0, b = num(v.referencePointB) || 0, c = num(v.referencePointC) || 0, d = num(v.referencePointD) || 0;
    const clean = s => String(s ?? '').replace(/@+$/, '').replace(/\s+/g, ' ').trim();   // AIS pads text with @
    out.push({ mmsi, name: clean(v.name), callSign: clean(v.callSign), imo: num(v.imo) || null, type: num(v.shipType) || 0,
      length: a + b > 0 && a + b < 500 ? a + b : null, width: c + d > 0 && c + d < 80 ? c + d : null, refA: a, refC: c,
      draught: num(v.draught) ? v.draught / 10 : null, destination: clean(v.destination), eta: etaParts(v.eta), t: num(v.timestamp) });
  }
  return out;
}

/** Ship type code → a colour group. */
export function shipKind(type) {
  const t = +type || 0;
  if (t >= 70 && t <= 79) return 'cargo';
  if (t >= 80 && t <= 89) return 'tanker';
  if (t >= 60 && t <= 69) return 'passenger';
  if ((t >= 40 && t <= 49) || (t >= 20 && t <= 29)) return 'fast';
  if (t === 30) return 'fishing';
  if (t === 36 || t === 37) return 'pleasure';
  if (t === 35 || t === 55) return 'military';
  if ((t >= 31 && t <= 34) || (t >= 50 && t <= 59)) return 'service';
  return 'other';
}
/** Colour groups: [name, colour]. */
export const SHIP_KINDS = {
  cargo: ['Cargo', '#8fd16a'], tanker: ['Tanker', '#ff6b6b'], passenger: ['Passenger', '#5fb0ff'], fast: ['High-speed craft', '#ffe066'],
  fishing: ['Fishing', '#ffa25c'], pleasure: ['Sailing and pleasure', '#ff8fd8'], military: ['Military and law enforcement', '#c9a0ff'],
  service: ['Tugs, pilots and service', '#5fe0d0'], other: ['Other', '#b0bec5'],
};
const TYPE_NAMES = { 30: 'Fishing', 31: 'Towing', 32: 'Towing a large tow', 33: 'Dredging or underwater work', 34: 'Diving support', 35: 'Military',
  36: 'Sailing', 37: 'Pleasure craft', 50: 'Pilot vessel', 51: 'Search and rescue', 52: 'Tug', 53: 'Port tender', 54: 'Anti-pollution',
  55: 'Law enforcement', 58: 'Medical transport', 59: 'Non-combatant' };
const DECADES = { 2: 'Wing in ground craft', 4: 'High-speed craft', 6: 'Passenger ship', 7: 'Cargo ship', 8: 'Tanker', 9: 'Other' };
/** Ship type code → words ("Tanker · dangerous goods, category A"). */
export function shipTypeName(type) {
  const t = +type || 0;
  if (TYPE_NAMES[t]) return TYPE_NAMES[t];
  const dec = DECADES[Math.floor(t / 10)];
  if (!dec) return 'Unknown type';
  const u = t % 10;
  return u >= 1 && u <= 4 ? `${dec} · dangerous goods, category ${'ABCD'[u - 1]}` : dec;
}
/** Navigational status codes in words. */
export const NAV_STATUS = ['under way (engine)', 'at anchor', 'not under command', 'restricted in manoeuvring', 'constrained by draught', 'moored',
  'aground', 'fishing', 'under way (sailing)', '', '', 'towing astern', 'pushing ahead or towing alongside', '', 'emergency beacon (AIS-SART)', ''];

// Maritime Identification Digits (the first three of a ship's MMSI) → flag. Ranges as "first-last".
const MID = ('201 Albania|202 Andorra|203 Austria|204 Portugal (Azores)|205 Belgium|206 Belarus|207 Bulgaria|208 Vatican|209-210 Cyprus|211 Germany|212 Cyprus|'
  + '213 Georgia|214 Moldova|215 Malta|216 Armenia|218 Germany|219-220 Denmark|224-225 Spain|226-228 France|229 Malta|230 Finland|231 Faroe Islands|'
  + '232-235 United Kingdom|236 Gibraltar|237 Greece|238 Croatia|239-241 Greece|242 Morocco|243 Hungary|244-246 Netherlands|247 Italy|248-249 Malta|'
  + '250 Ireland|251 Iceland|252 Liechtenstein|253 Luxembourg|254 Monaco|255 Portugal (Madeira)|256 Malta|257-259 Norway|261 Poland|262 Montenegro|'
  + '263 Portugal|264 Romania|265-266 Sweden|267 Slovakia|268 San Marino|269 Switzerland|270 Czechia|271 Türkiye|272 Ukraine|273 Russia|'
  + '274 North Macedonia|275 Latvia|276 Estonia|277 Lithuania|278 Slovenia|279 Serbia|301 Anguilla|303 United States (Alaska)|304-305 Antigua and Barbuda|'
  + '306 Netherlands (Caribbean)|307 Aruba|308-309 Bahamas|310 Bermuda|311 Bahamas|312 Belize|314 Barbados|316 Canada|319 Cayman Islands|'
  + '321 Costa Rica|323 Cuba|325 Dominica|327 Dominican Republic|329 Guadeloupe|330 Grenada|331 Greenland|332 Guatemala|334 Honduras|336 Haiti|'
  + '338 United States|339 Jamaica|341 Saint Kitts and Nevis|343 Saint Lucia|345 Mexico|347 Martinique|348 Montserrat|350 Nicaragua|351-357 Panama|'
  + '358 Puerto Rico|359 El Salvador|361 Saint Pierre and Miquelon|362 Trinidad and Tobago|364 Turks and Caicos|366-369 United States|370-374 Panama|'
  + '375-377 Saint Vincent and the Grenadines|378 British Virgin Islands|379 US Virgin Islands|401 Afghanistan|403 Saudi Arabia|405 Bangladesh|408 Bahrain|'
  + '410 Bhutan|412-414 China|416 Taiwan|417 Sri Lanka|419 India|422 Iran|423 Azerbaijan|425 Iraq|428 Israel|431-432 Japan|434 Turkmenistan|'
  + '436 Kazakhstan|437 Uzbekistan|438 Jordan|440-441 South Korea|443 Palestine|445 North Korea|447 Kuwait|450 Lebanon|451 Kyrgyzstan|453 Macao|'
  + '455 Maldives|457 Mongolia|459 Nepal|461 Oman|463 Pakistan|466 Qatar|468 Syria|470-471 United Arab Emirates|472 Tajikistan|473 Yemen|475 Yemen|'
  + '477 Hong Kong|478 Bosnia and Herzegovina|503 Australia|506 Myanmar|508 Brunei|510 Micronesia|511 Palau|512 New Zealand|514-515 Cambodia|'
  + '518 Cook Islands|520 Fiji|525 Indonesia|529 Kiribati|531 Laos|533 Malaysia|538 Marshall Islands|540 New Caledonia|544 Nauru|546 French Polynesia|'
  + '548 Philippines|553 Papua New Guinea|557 Solomon Islands|559 American Samoa|561 Samoa|563-566 Singapore|567 Thailand|570 Tonga|572 Tuvalu|'
  + '574 Vietnam|576-577 Vanuatu|601 South Africa|603 Angola|605 Algeria|610 Benin|613 Cameroon|615 Congo|616 Comoros|617 Cabo Verde|619 Côte d\'Ivoire|'
  + '620 Comoros|621 Djibouti|622 Egypt|624 Ethiopia|625 Eritrea|626 Gabon|627 Ghana|629 Gambia|630 Guinea-Bissau|631 Equatorial Guinea|632 Guinea|'
  + '634 Kenya|636-637 Liberia|642 Libya|645 Mauritius|647 Madagascar|650 Mozambique|654 Mauritania|657 Nigeria|659 Namibia|660 Réunion|'
  + '663 Senegal|664 Seychelles|666 Somalia|667 Sierra Leone|668 São Tomé and Príncipe|672 Tunisia|674 Tanzania|676 DR Congo|677 Tanzania|'
  + '701 Argentina|710 Brazil|720 Bolivia|725 Chile|730 Colombia|735 Ecuador|740 Falkland Islands|745 French Guiana|750 Guyana|755 Paraguay|760 Peru|'
  + '765 Suriname|770 Uruguay|775 Venezuela').split('|').reduce((m, s) => {
  const sp = s.indexOf(' '), [a, b = a] = s.slice(0, sp).split('-').map(Number), name = s.slice(sp + 1);
  for (let k = a; k <= b; k++) m[k] = name;
  return m;
}, {});
/** A ship's flag from its MMSI (9 digits, the first three the country code), or ''. */
export function flagOf(mmsi) {
  const s = String(mmsi);
  return s.length === 9 && /^[2-7]/.test(s) ? MID[+s.slice(0, 3)] || '' : '';
}

/** Making way: moving at half a knot or more, and not anchored, moored or aground. */
export const underway = s => s.sog != null && s.sog >= 0.5 && s.navStat !== 1 && s.navStat !== 5 && s.navStat !== 6;

/**
 * Where a ship is `seconds` after its report, into `out` { lat, lon, cog }: along its course over ground at its speed,
 * through the turn it reports (at most 3°/s, for at most 2 min), for at most `max` s; held where it was if it isn't
 * making way or reports no course.
 */
export function shipAt(s, seconds, out = {}, max = 600) {
  const t = Math.min(Math.max(0, seconds || 0), max), v = (s.sog || 0) * KN, cog = s.cog ?? s.heading;
  if (!underway(s) || cog == null || !(t > 0)) { out.lat = s.lat; out.lon = s.lon; out.cog = cog; return out; }
  const turn = Number.isFinite(s.turn) && Math.abs(s.turn) >= 0.05 ? Math.max(-3, Math.min(3, s.turn)) : 0;
  if (!turn) { const p = destination(s.lat, s.lon, v * t, cog); out.lat = p.lat; out.lon = p.lon; out.cog = cog; return out; }
  const ta = Math.min(t, 120), w = turn * D2R, c0 = cog * D2R, r = v / w;   // r: signed turn radius (m)
  const e = r * (Math.cos(c0) - Math.cos(c0 + w * ta)), n = r * (Math.sin(c0 + w * ta) - Math.sin(c0));
  let p = destination(s.lat, s.lon, Math.hypot(e, n), Math.atan2(e, n) * R2D);
  const c1 = ((cog + turn * ta) % 360 + 360) % 360;
  if (t > ta) p = destination(p.lat, p.lon, v * (t - ta), c1);
  out.lat = p.lat; out.lon = p.lon; out.cog = c1;
  return out;
}

/** When two AIS receivers' reports are the same ship in the same place (provenance agreement): the same MMSI, report
 *  times at most maxDtS apart, positions within posM plus the distance at the faster speed over the gap. */
export const SHIP_AGREE = Object.freeze({ maxDtS: 600, posM: 300, slack: 1.3 });
/** Do ship reports a and b ({ id (MMSI), lat, lon, t (ms), sog (kn) }) agree within SHIP_AGREE? */
export function sameShip(a, b, tol = SHIP_AGREE) {
  if (!a || !b || String(a.id) !== String(b.id)) return false;
  const dt = Number.isFinite(a.t) && Number.isFinite(b.t) ? Math.abs(a.t - b.t) / 1000 : 0;
  if (dt > tol.maxDtS) return false;
  const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos((a.lat + b.lat) / 2 * r), y = (b.lat - a.lat) * r;
  const v = Math.max(+a.sog || 0, +b.sog || 0) * 0.514444;
  return Math.hypot(x, y) * 6371008.8 <= tol.posM + v * dt * tol.slack;
}
