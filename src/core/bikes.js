// Bike share, the pure parts: the CityBikes directory (~800 systems worldwide) and a system's stations, with how full each
// one is. No DOM, no Cesium (test/bikes.test.mjs).

const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : null);
/** CityBikes times look like "2026-10-11T00:45:26.482297+00:00Z" (an offset and a Z): read them either way. */
export function cbTime(s) {
  if (typeof s !== 'string') return null;
  let t = Date.parse(s); if (Number.isFinite(t)) return t;
  t = Date.parse(s.replace(/([+-]\d\d:\d\d)Z$/, '$1')); return Number.isFinite(t) ? t : null;
}

/** `/v2/networks` → [{ id, name, company, city, country, lat, lon }]. */
export function parseNetworks(doc) {
  const out = [];
  for (const n of doc?.networks || []) {
    const l = n.location || {}, lat = num(l.latitude), lon = num(l.longitude);
    if (!n.id || lat == null || lon == null) continue;
    out.push({ id: String(n.id), name: String(n.name || n.id), company: [].concat(n.company || []).filter(Boolean).join(', '), city: String(l.city || ''), country: String(l.country || ''), lat, lon });
  }
  return out;
}

/** `/v2/networks/{id}` → stations [{ id, name, lat, lon, bikes, ebikes, docks (free), total, renting, returning, virtual, t, address }]. */
export function parseStations(doc) {
  const out = [];
  for (const s of doc?.network?.stations || []) {
    const lat = num(s.latitude), lon = num(s.longitude); if (lat == null || lon == null) continue;
    const x = s.extra || {}, bikes = num(s.free_bikes), docks = num(s.empty_slots), slots = num(x.slots);
    const ebikes = num(x.ebikes) ?? (num(x.electric_bikes) ?? null);
    out.push({ id: String(s.id), name: String(s.name || ''), lat, lon, bikes: bikes ?? 0, ebikes, docks,
      total: slots ?? (docks != null ? (bikes ?? 0) + docks : null), renting: x.renting === 0 || x.renting === false ? false : true,
      returning: x.returning === 0 || x.returning === false ? false : true, virtual: !!x.virtual, t: cbTime(s.timestamp), address: String(x.address || '') });
  }
  return out;
}

/** How a station is doing: 'offline' (not renting), 'empty' (no bikes), 'low' (a few), 'full' (no free docks), 'ok'. */
export function stationState(s) {
  if (s.renting === false) return 'offline';
  if (!s.bikes) return 'empty';
  if (s.docks === 0 && !s.virtual) return 'full';
  if (s.bikes <= 2 || (s.total && s.bikes / s.total < 0.2)) return 'low';
  return 'ok';
}

/** Systems with their centre within `km` of a point, nearest first. */
export function networksNear(list, lat, lon, km = 40, max = 4) {
  const k = Math.cos(lat * Math.PI / 180), out = [];
  for (const n of list) { const d = Math.hypot(n.lat - lat, (((n.lon - lon + 540) % 360) - 180) * k) * 111.32; if (d <= km) out.push([d, n]); }
  return out.sort((a, b) => a[0] - b[0]).slice(0, max).map(([, n]) => n);
}
