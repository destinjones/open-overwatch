// Military Grid Reference System (MGRS) from latitude / longitude on WGS84, for the globe's tactical HUD.
// UTM by the usual Krüger series (millimetre-level inside a zone), with the Norway and Svalbard zone exceptions.
// Outside 80°S..84°N MGRS uses the polar UPS grid, which this does not do: null there.

const A = 6378137, F = 1 / 298.257223563, K0 = 0.9996;
const E2 = F * (2 - F), EP2 = E2 / (1 - E2);
const BANDS = 'CDEFGHJKLMNPQRSTUVWX';                      // 8° latitude bands from 80°S (X is 12° tall)
const COLS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];          // 100 km column letters, by zone mod 3
const ROWS = 'ABCDEFGHJKLMNPQRSTUV';                         // 100 km row letters (even zones start 5 letters on)

/** UTM zone number for a position, with the Norway (32V) and Svalbard (31X..37X) exceptions. */
export function utmZone(lat, lon) {
  const z = Math.floor((((lon + 180) % 360 + 360) % 360) / 6) + 1;
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) return 32;
  if (lat >= 72 && lat < 84 && lon >= 0 && lon < 42) return lon < 9 ? 31 : lon < 21 ? 33 : lon < 33 ? 35 : 37;
  return z;
}

/** { zone, band, easting, northing } (metres; northing is false-northed in the south), or null near the poles. */
export function toUtm(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -80 || lat >= 84) return null;
  const zone = utmZone(lat, lon), lon0 = (zone - 1) * 6 - 180 + 3;
  const phi = lat * Math.PI / 180, dl = ((((lon - lon0) + 540) % 360) - 180) * Math.PI / 180;
  const s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
  const N = A / Math.sqrt(1 - E2 * s * s), T = t * t, Cc = EP2 * c * c, Aa = c * dl;
  const e4 = E2 * E2, e6 = e4 * E2;
  const M = A * ((1 - E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi - (3 * E2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi) - (35 * e6 / 3072) * Math.sin(6 * phi));
  const easting = K0 * N * (Aa + (1 - T + Cc) * Aa ** 3 / 6 + (5 - 18 * T + T * T + 72 * Cc - 58 * EP2) * Aa ** 5 / 120) + 500000;
  let northing = K0 * (M + N * t * (Aa * Aa / 2 + (5 - T + 9 * Cc + 4 * Cc * Cc) * Aa ** 4 / 24 + (61 - 58 * T + T * T + 600 * Cc - 330 * EP2) * Aa ** 6 / 720));
  if (lat < 0) northing += 10000000;
  return { zone, band: BANDS[Math.min(19, Math.floor((lat + 80) / 8))], easting, northing };
}

/** "18S UJ 23487 06483" (digits = 5: 1 m; 4: 10 m; 3: 100 m), or null where MGRS needs UPS (the poles). */
export function toMgrs(lat, lon, digits = 5) {
  const u = toUtm(lat, lon); if (!u) return null;
  const col = COLS[(u.zone - 1) % 3][Math.floor(u.easting / 100000) - 1];
  const row = ROWS[(Math.floor(u.northing / 100000) + (u.zone % 2 === 0 ? 5 : 0)) % 20];
  if (!col) return null;
  const k = 10 ** (5 - digits), fix = v => String(Math.floor((v % 100000) / k)).padStart(digits, '0');
  return `${u.zone}${u.band} ${col}${row} ${fix(u.easting)} ${fix(u.northing)}`;
}
