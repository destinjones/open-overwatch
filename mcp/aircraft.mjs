// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// aircraft_lookup: what a plane is and where a flight goes, from adsbdb (api.adsbdb.com, keyless; the globe's aircraft
// cards ask it too): by registration ("G-XLEA", "N628TS") or ICAO 24-bit address ("4007f6") the type, maker, class,
// registered owner and a photo link; by callsign ("BAW15", "UAL1") the airline and the route on file, with the airports
// and the great-circle distance. core/actype.js reads the answers (the same reader as the globe's cards).
import { parseAdsbdb, classify, hexCountry, gcKm, bearing } from '../src/core/actype.js';
import { compass } from '../src/core/passes.js';
import { ToolError } from './feeds.mjs';
import { frame, globeUrl } from './place.mjs';

const API = 'https://api.adsbdb.com/v0';
const HEX = /^~?[0-9a-f]{6}$/i, REG = /^[A-Z0-9][A-Z0-9-]{1,9}$/i, CALLSIGN = /^[A-Z0-9]{2,8}$/i;
const portWords = p => `${p.name}${p.iata ? ` (${p.iata})` : p.icao ? ` (${p.icao})` : ''}${p.city && !p.name.includes(p.city) ? `, ${p.city}` : ''}${p.country ? `, ${p.country}` : ''}`;
const port = p => p && { name: p.name, iata: p.iata || null, icao: p.icao || null, city: p.city || null, country: p.country || null, lat: p.lat, lon: p.lon };

export function aircraftTool(ctx) {
  const { feeds } = ctx, site = feeds.siteBase;
  const ask = async (path, what, signal) => {
    try { return await feeds.json(`${API}/${path}`, { ttl: 24 * 3600e3, timeout: 15e3, signal }); }
    catch (e) { if (e instanceof ToolError && e.code === 'not_found') throw new ToolError(`adsbdb has no record of ${what}`, 'not_found'); throw e; }
  };
  return {
    name: 'aircraft_lookup',
    title: 'What a plane is, and where a flight goes',
    description: `Look up an aircraft or a flight in adsbdb, the open aircraft and route database: by registration (tail number, e.g. "G-XLEA", "N628TS", "JA873A") or ICAO 24-bit address (hex, e.g. "4007f6") its type and ICAO type code, maker, class (narrow-body, wide-body, business jet, helicopter…), registered owner and country, the country its address was allocated to, and a photo link; by callsign ("BAW15", "UAL1", "QFA1") the airline and the route it usually flies, with both airports and the distance. Routes on file are what a callsign normally flies, not a live flight plan. The globe link draws the route${feeds.hasAircraft ? ' and looks for the flight' : ' (live aircraft show only in the download version of Open Overwatch)'}.`,
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        aircraft: { type: 'string', maxLength: 12, description: 'A registration ("G-XLEA", "N628TS") or a 6-digit hex ICAO address ("4007f6").' },
        callsign: { type: 'string', maxLength: 8, description: 'A flight callsign, ICAO style ("BAW15", "UAL1", "DLH400"); IATA flight numbers ("BA15") are often found too.' },
      },
    },
    async run(a, { signal }) {
      let reg = a.aircraft ? a.aircraft.trim().replace(/\s+/g, '') : '';
      const cs = a.callsign ? a.callsign.trim().toUpperCase().replace(/\s+/g, '') : '';
      if (!reg && !cs) throw new ToolError('Give an aircraft (registration or hex address) or a callsign', 'invalid_arguments');
      if (reg && !HEX.test(reg) && !REG.test(reg)) throw new ToolError('aircraft must be a registration ("G-XLEA") or a 6-digit hex address ("4007f6")', 'invalid_arguments');
      if (cs && !CALLSIGN.test(cs)) throw new ToolError('callsign must be 2 to 8 letters and digits ("BAW15")', 'invalid_arguments');
      // "~" marks a non-ICAO address (a TIS-B track number, an anonymous address): its digits belong to some other, real
      // airframe, so it is never looked up as one; with a callsign only the route is
      const anon = reg && reg.startsWith('~') ? reg.toLowerCase() : '';
      if (anon && !cs) throw new ToolError(`${anon} is a non-ICAO address (a TIS-B track or an anonymous one, marked "~"): it names no airframe to look up. Give the flight's callsign instead`, 'not_found');
      if (anon) reg = '';
      const key = reg ? (HEX.test(reg) ? reg.replace(/^~/, '').toLowerCase() : reg.toUpperCase()) : '';
      const d = reg ? await ask(`aircraft/${encodeURIComponent(key)}${cs ? `?callsign=${encodeURIComponent(cs)}` : ''}`, `aircraft ${key}`, signal) : await ask(`callsign/${encodeURIComponent(cs)}`, `callsign ${cs}`, signal);
      const { aircraft: ac, route } = parseAdsbdb(d);
      if (!ac && !route) throw new ToolError(`adsbdb has no record of ${reg ? `aircraft ${key}` : `callsign ${cs}`}`, 'not_found');
      const out = [], data = { source: 'adsbdb.com (open aircraft and flight-route data)' }, live = feeds.hasAircraft;
      if (anon) { out.push(`${anon} is a non-ICAO address (a TIS-B track or an anonymous one): it names no airframe, so only the callsign was looked up.`); data.non_icao_address = anon; }
      if (ac) {
        const k = classify({ type: ac.icaoType, desc: ac.type }), alloc = hexCountry(ac.hex);
        out.push(`${ac.reg || key}${ac.hex ? ` (ICAO ${ac.hex})` : ''}: ${[ac.manufacturer && !ac.type.toLowerCase().startsWith(ac.manufacturer.toLowerCase().split(' ')[0]) ? ac.manufacturer : '', ac.type].filter(Boolean).join(' ') || 'type unknown'}${ac.icaoType ? ` (${ac.icaoType})` : ''}, ${k.why === 'guess' ? 'class unknown' : k.name.toLowerCase()}.`
          + `${ac.owner ? ` Registered to ${ac.owner}${ac.ownerCountry ? ` (${ac.ownerCountry})` : ''}.` : ''}${alloc && alloc !== ac.ownerCountry ? ` Its address block is ${alloc}'s.` : ''}${ac.photo ? ` Photo: ${ac.photo}` : ''}`);
        data.aircraft = { registration: ac.reg || null, icao_hex: ac.hex || null, type: ac.type || null, icao_type: ac.icaoType || null, manufacturer: ac.manufacturer || null, class: k.why === 'guess' ? null : k.cls,
          class_name: k.why === 'guess' ? null : k.name, owner: ac.owner || null, owner_country: ac.ownerCountry || null, address_allocated_to: alloc || null, operator_code: ac.operatorCode || null, photo: ac.photo || null };
      }
      let url = null;
      if (route) {
        const o = route.origin, dst = route.destination, al = route.airline;
        if (o && dst) {
          const km = gcKm(o.lat, o.lon, dst.lat, dst.lon), mid = route.midpoint;
          out.push(`${route.callsign || cs}${al ? ` (${al.name}${al.callsign ? `, radio "${al.callsign}"` : ''})` : ''}: ${portWords(o)} → ${mid ? `${portWords(mid)} → ` : ''}${portWords(dst)}; ${Math.round(km).toLocaleString('en-US')} km great circle, setting off to the ${compass(bearing(o.lat, o.lon, dst.lat, dst.lon))}. This is the route on file for the callsign, not a live flight plan.`);
          const coords = [[o.lon, o.lat], ...(mid ? [[mid.lon, mid.lat]] : []), [dst.lon, dst.lat]];
          const c = { lat: (o.lat + dst.lat) / 2, lon: Math.abs(o.lon - dst.lon) > 180 ? (((o.lon + dst.lon) / 2 + 360) % 360) - 180 : (o.lon + dst.lon) / 2 };
          url = globeUrl(site, { camera: frame(c.lat, c.lon, Math.max(300, km * 0.75)), on: live ? ['air', 'airports'] : ['airports'], flight: live ? route.icao || route.callsign || cs : null, drawing: [{ kind: coords.length === 2 ? 'arrow' : 'line', coords, name: route.callsign || cs }] });
          data.route = { callsign: route.callsign || cs, callsign_iata: route.iata || null, airline: al ? { name: al.name, icao: al.icao || null, iata: al.iata || null, country: al.country || null, radio_callsign: al.callsign || null } : null,
            origin: port(o), midpoint: port(mid), destination: port(dst), distance_km: Math.round(km), note: 'the route on file for this callsign (callsigns can be reused); not a live flight plan' };
        } else if (al) {
          out.push(`${route.callsign || cs} is flown by ${al.name}${al.country ? ` (${al.country})` : ''}${al.callsign ? `, radio callsign "${al.callsign}"` : ''}; no route on file.`);
          data.route = { callsign: route.callsign || cs, airline: { name: al.name, icao: al.icao || null, iata: al.iata || null, country: al.country || null, radio_callsign: al.callsign || null }, origin: null, destination: null };
        }
      } else if (cs) out.push(`No route on file for ${cs}.`);
      const drawn = !!url;
      if (live) {
        if (!url) url = globeUrl(site, { camera: frame(30, 0, 9000), on: ['air'], flight: cs && /^[A-Z0-9]{2,8}$/.test(cs) ? cs : null });
        out.push(`${drawn ? 'The route' : 'Live aircraft'} on the globe${cs ? ` (it looks for ${route?.icao || route?.callsign || cs} in the live traffic)` : ''}: ${url}`);
      } else {   // the website has no live aircraft: the link draws the route (or opens the airports), and says where planes are
        if (!url) url = globeUrl(site, { camera: frame(30, 0, 9000), on: ['airports'] });
        out.push(`${drawn ? 'The route' : 'The airports'} on the globe (live aircraft show in the download version of Open Overwatch, not on the website): ${url}`);
        data.live_aircraft = 'in the download version only';
      }
      return { text: out.join('\n'), data: { ...data, url } };
    },
  };
}
