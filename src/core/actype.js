// What kind of aircraft a feed record is: from the ICAO type designator ("A20N", "B77W", "EC35"), else the readsb
// emitter category ("A5" heavy, "A7" rotorcraft), else the type text adsbdb gives ("Airbus A330 202"). Also reads an
// adsbdb answer into one plain record, checks whether its route on file fits where the plane actually is, and names the
// country an ICAO 24-bit address was allocated to. DOM-free.

/** The classes, with how a card names them and the 3D model drawn for each (brand/models/aircraft has airliner,
 *  heavy, prop, tprop, heli and fighter; scale shrinks the model for the smaller members of a shape). */
export const CLASSES = {
  narrowbody: { name: 'Narrow-body airliner', shape: 'airliner', scale: 1 },
  widebody: { name: 'Wide-body airliner', shape: 'heavy', scale: 1 },
  regional: { name: 'Regional jet', shape: 'airliner', scale: 0.78 },
  turboprop: { name: 'Turboprop airliner', shape: 'tprop', scale: 0.8 },
  bizjet: { name: 'Business jet', shape: 'airliner', scale: 0.5 },
  helicopter: { name: 'Helicopter', shape: 'heli', scale: 1 },
  light: { name: 'Light aircraft', shape: 'prop', scale: 1 },
  fighter: { name: 'Fighter or jet trainer', shape: 'fighter', scale: 1 },
  military: { name: 'Military transport, tanker or patrol', shape: 'heavy', scale: 1 },
  militaryprop: { name: 'Military turboprop', shape: 'tprop', scale: 1 },
  glider: { name: 'Glider, balloon or ultralight', shape: 'prop', scale: 0.8 },
  drone: { name: 'Drone (uncrewed)', shape: 'prop', scale: 0.8 },
};

// ICAO Doc 8643 designators, by class. Exact codes first; the family patterns below catch the rest.
const LIST = {
  narrowbody: 'A318 A319 A320 A321 A19N A20N A21N BCS1 BCS3 B712 B721 B722 B731 B732 B733 B734 B735 B736 B737 B738 B739 B37M B38M B39M B3XM B752 B753 MD80 MD81 MD82 MD83 MD87 MD88 MD90 DC91 DC93 DC94 DC95 T204 T214 T154 C919 A21X',
  widebody: 'A306 A30B A310 A332 A333 A337 A338 A339 A342 A343 A345 A346 A359 A35K A388 A3ST B741 B742 B743 B744 B748 B74R B74S BLCF B762 B763 B764 B772 B773 B77L B77W B778 B779 B788 B789 B78X DC10 MD11 L101 IL86 IL96 A124 A225',
  regional: 'CRJ1 CRJ2 CRJ7 CRJ9 CRJX E135 E145 E45X E170 E75L E75S E190 E195 E290 E295 RJ70 RJ85 RJ1H B461 B462 B463 F70 F100 SU95 A148 A158 J328 AJ27 YK42',
  turboprop: 'AT43 AT44 AT45 AT46 AT72 AT73 AT75 AT76 ATP DH8A DH8B DH8C DH8D DHC6 DHC7 SF34 SB20 D328 JS31 JS32 JS41 E110 E120 F27 F50 AN24 AN28 L410 B190 SW3 SW4 C212 D228 Y12 MA60 MA70 S340 BE99 BE20 BE30 BE35 C208 PC12 B350 SH36 SH33 J41 L188 IL18 AN38 AN140 TBM7 TBM8 TBM9 P180 KODI',
  bizjet: 'C25A C25B C25C C25M C500 C501 C510 C525 C526 C550 C551 C55B C560 C56X C650 C680 C68A C700 C750 CL30 CL35 CL60 GL5T GL6T GL7T GL8T GLEX GLF2 GLF3 GLF4 GLF5 GLF6 G150 G200 G280 GA5C GA6C GA7C GA8C LJ23 LJ24 LJ25 LJ28 LJ31 LJ35 LJ40 LJ45 LJ55 LJ60 LJ70 LJ75 FA10 FA20 FA50 FA7X FA8X F2TH F900 FA6X E50P E55P E35L E545 E550 H25A H25B H25C HDJT PC24 BE40 PRM1 SF50 EA50 ASTR GALX WW24 SBR1 SBR2',
  helicopter: 'A109 A119 A129 A139 A149 A169 A189 AS32 AS3B AS50 AS55 AS65 B06 B06T B105 B212 B222 B230 B407 B412 B427 B429 B430 B505 B47G BK17 EC20 EC25 EC30 EC35 EC45 EC55 EC75 H160 H175 MI2 MI8 MI14 MI24 MI26 MI28 MI38 KA27 KA32 KA50 KA52 R22 R44 R66 S61 S64 S76 S92 UH1 UH1Y H1 H60 H64 H47 H53 H53S NH90 TIGR EH10 LYNX GAZL ALO2 ALO3 ALH EXPL H500 H269 S300 EN28 EN48 CABR GYRO',
  light: 'C150 C152 C162 C170 C172 C175 C177 C180 C182 C185 C188 C195 C206 C207 C210 C303 C310 C337 C340 C402 C404 C414 C421 C425 C441 P28A P28B P28R P28T P32R P32T P46T PA18 PA20 PA22 PA24 PA27 PA30 PA31 PA32 PA34 PA44 PA46 BE23 BE24 BE33 BE36 BE55 BE58 BE60 BE76 BE95 SR20 SR22 S22T DA20 DA40 DA42 DA50 DA62 M20P M20T RV4 RV6 RV7 RV8 RV9 RV10 RV12 RV14 J3 AA5 TB10 TB20 TB21 AT3 GLAS EVOT DR40 CH60 G115 G120 CTSW PIVI SAVG ULAC TOBA',
  fighter: 'F14 F15 F16 F18 F18S F22 F35 F35A F35B F35C F4 F5 F117 EUFI RFAL TOR JAS39 GRIF A10 AV8B HAR M2000 MIR2 MIR4 SU24 SU25 SU27 SU30 SU33 SU34 SU35 SU57 MG21 MG23 MG25 MG29 MG31 J7 J8 J10 J11 J15 J16 J20 JF17 LCA KFIR T38 T7 T45 HAWK AJET M346 M339 L39 L59 L159 K8 T50 YK13 MB39 TUCA KT1 A4 JAGR F111',
  military: 'C17 C5 C5M A400 IL76 IL78 Y20 KC10 K35R K35E K35T KC35 K46 KC46 E3TF E3CF E6 E7 E8 E737 R135 C135 C40 C32 C37 C38 VC25 P8 GLHK Q4 B703 B707 B720 IL62 AN22 AN70 AN72 AN74 E390 C2 TU16 TU22 TU95 TU60 B1 B2 B52 Q9 MQ9 RQ4',
  militaryprop: 'C130 C30J C27J CN35 C295 C160 AN12 AN26 AN30 AN32 P3 P3C CP14 E2 C2A V22 IL38 BE9L KC13 HC13 MC13 AC13 EC13 Y8 Y9 G222 PC21 PC9 PC7 T6 TEX2 EMB3 A29 ST10',
};
const BY_CODE = new Map();
for (const [cls, s] of Object.entries(LIST)) for (const c of s.split(/\s+/)) if (c && !c.includes('?') && !BY_CODE.has(c)) BY_CODE.set(c, cls);

// family patterns for designators not listed above (order matters: helicopters before light aircraft and so on)
const FAMILIES = [
  ['helicopter', /^(EC\d|AS\d|H\d\d|MI\d|KA\d|B4\d\d|B2\d\d|A1\d\d|S6\d|S7\d|S9\d|R[246]\d)/],
  ['fighter', /^(F\d{1,3}[A-Z]?|SU\d\d|MG\d\d|J\d\d|MIR\d)$/],
  ['widebody', /^(A3[345]\d|A35|A38|B74|B76|B77|B78)/],
  ['narrowbody', /^(A3[12]\d|A2[01]N|B73|B3\dM|MD8|MD9)/],
  ['regional', /^(CRJ|E1[79]\d|E2\d\d|E1[34]\d)/],
  ['turboprop', /^(AT[47]\d|DH8|DHC)/],
  ['bizjet', /^(C5\d\d|C6\d\d|C7\d\d|CL\d\d|GL[A-Z0-9]{2}|G[0-9]{3}|LJ\d\d|FA\d[A-Z]?|H25)/],
  ['light', /^(C1\d\d|C2\d\d|P2\d|PA\d\d|BE\d\d|SR2\d|DA\d\d|M20|RV\d)/],
];

// readsb / DO-260 emitter categories
const CATEGORY = { A1: 'light', A2: 'bizjet', A3: 'narrowbody', A4: 'narrowbody', A5: 'widebody', A6: 'fighter', A7: 'helicopter', B1: 'glider', B2: 'glider', B4: 'glider', B6: 'drone' };

// words in adsbdb's free text ("type" and "manufacturer"), for a plane with no designator
const WORDS = [
  ['helicopter', /\b(helicopter|eurocopter|robinson|sikorsky|agusta|leonardo aw|airbus helicopters|bell (?:\d|helicopter)|mbb|kamov|mil mi|enstrom|schweizer|md helicopters)\b/i],
  ['widebody', /\b(a3[345]0|a350|a380|747|767|777|787|md-?11|dc-?10|il-?96)\b/i],
  ['narrowbody', /\b(a3[12][019]|a32[01]|737|757|md-?8\d|md-?90|c919)\b/i],
  ['regional', /\b(crj|erj|e-?jet|e1[79]\d|e19\d|bae 146|avro rj|fokker 100|superjet)\b/i],
  ['turboprop', /\b(atr|dash ?8|dhc-?8|q400|saab 340|dornier 328|jetstream|twin otter|king ?air|caravan|pc-?12)\b/i],
  ['bizjet', /\b(citation|gulfstream|learjet|challenger|global (?:express|\d)|falcon|phenom|praetor|legacy|hawker|honda ?jet|pilatus pc-?24|cirrus sf50)\b/i],
  ['light', /\b(cessna 1\d\d|piper|cirrus sr|diamond da|mooney|beech(?:craft)? (?:bonanza|baron)|robin|vans rv|tecnam)\b/i],
  ['glider', /\b(glider|sailplane|balloon|schempp|schleicher|ultralight|microlight)\b/i],
];

/**
 * The class of an aircraft: { cls, shape, scale, name, why } from what is known about it ({ type, cat, mil, desc }).
 * why says what decided it: 'type' (designator), 'category' (emitter category), 'text' (adsbdb words) or 'guess'.
 */
export function classify(r = {}) {
  const t = String(r.type || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  let cls = null, why = 'guess';
  if (t) { cls = BY_CODE.get(t) || null; if (!cls) for (const [c, re] of FAMILIES) if (re.test(t)) { cls = c; break; } if (cls) why = 'type'; }
  if (!cls && r.desc) for (const [c, re] of WORDS) if (re.test(r.desc)) { cls = c; why = 'text'; break; }
  if (!cls && r.cat && CATEGORY[r.cat]) { cls = CATEGORY[r.cat]; why = 'category'; }
  if (!cls) {   // no type, no category: slow and low is light aircraft; everything else an airliner (most traffic is)
    cls = !r.ground && r.gs != null && r.gs < 85 && (r.alt || 0) < 5000 ? 'light' : 'narrowbody';
    if (r.mil && cls === 'narrowbody') cls = 'military';
  }
  const c = CLASSES[cls];
  return { cls, shape: c.shape, scale: c.scale, name: c.name, why };
}

/** A class in words for a card, saying how sure it is: "Narrow-body airliner (a guess: no type known)". */
export const kindWords = k => k.name + (k.why === 'guess' ? ' (a guess: no type known)' : k.why === 'category' ? ' (from its transponder category)' : '');

/** Model shape only (the sprite and glTF names in brand/). */
export const shapeOf = r => classify(r).shape;

// ---------------------------------------------------------------------------------------------- adsbdb answers
const str = (v, n = 80) => typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : '';
const num = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const PHOTO_HOSTS = /^https:\/\/(image\.|www\.)?airport-data\.com\//;
function airport(a) {
  if (!a || typeof a !== 'object') return null;
  const lat = num(a.latitude), lon = num(a.longitude);
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { icao: str(a.icao_code, 4).toUpperCase(), iata: str(a.iata_code, 3).toUpperCase(), name: str(a.name), city: str(a.municipality), country: str(a.country_name), cc: str(a.country_iso_name, 2).toUpperCase(), lat, lon, elevFt: num(a.elevation) };
}

/** An adsbdb /v0/aircraft/{hex}[?callsign=] or /v0/callsign/{cs} answer as { aircraft, route } (either may be null).
 *  "unknown aircraft" answers come back as strings: both null then. Photos only from airport-data.com over https. */
export function parseAdsbdb(json) {
  const r = json && typeof json === 'object' ? json.response : null;
  if (!r || typeof r !== 'object') return { aircraft: null, route: null };
  let aircraft = null, route = null;
  const a = r.aircraft;
  if (a && typeof a === 'object') {
    const photo = str(a.url_photo, 300), thumb = str(a.url_photo_thumbnail, 300);
    aircraft = { type: str(a.type), icaoType: str(a.icao_type, 4).toUpperCase(), manufacturer: str(a.manufacturer), hex: str(a.mode_s, 6).toLowerCase(),
      reg: str(a.registration, 12).toUpperCase(), owner: str(a.registered_owner), ownerCountry: str(a.registered_owner_country_name), ownerCc: str(a.registered_owner_country_iso_name, 2).toUpperCase(),
      operatorCode: str(a.registered_owner_operator_flag_code, 4).toUpperCase(), photo: PHOTO_HOSTS.test(photo) ? photo : '', thumb: PHOTO_HOSTS.test(thumb) ? thumb : '' };
  }
  const f = r.flightroute;
  if (f && typeof f === 'object') {
    const al = f.airline && typeof f.airline === 'object' ? f.airline : null;
    route = { callsign: str(f.callsign, 10).toUpperCase(), iata: str(f.callsign_iata, 10).toUpperCase(), icao: str(f.callsign_icao, 10).toUpperCase(),
      airline: al ? { name: str(al.name), icao: str(al.icao, 3).toUpperCase(), iata: str(al.iata, 2).toUpperCase(), country: str(al.country), callsign: str(al.callsign, 30) } : null,
      origin: airport(f.origin), destination: airport(f.destination), midpoint: airport(f.midpoint) };
    if (!route.origin || !route.destination) route = route.airline ? { ...route, origin: null, destination: null } : null;
  }
  return { aircraft, route };
}

const R_KM = 6371.0088, RAD = Math.PI / 180;
/** Great-circle distance in km. */
export function gcKm(lat1, lon1, lat2, lon2) {
  const a = Math.sin((lat2 - lat1) * RAD / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin((lon2 - lon1) * RAD / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
/** Initial bearing from 1 to 2, degrees 0-360. */
export function bearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin((lon2 - lon1) * RAD) * Math.cos(lat2 * RAD);
  const x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) - Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos((lon2 - lon1) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * Does a route on file fit the plane? adsbdb's routes are what a callsign usually flies; callsigns get reused, so it
 * can be wrong. p: { lat, lon, track, gs (m/s) }. Returns { fits, flownKm, leftKm, totalKm, progress (0-1), etaS, why }.
 * Fits when the plane is inside the ellipse origin-plane-destination <= 1.2 x the direct distance + 150 km and, when
 * airborne far from both ends, heads within 70° of the destination (a plane flying north out of Oregon is not on its
 * way from Seattle to Nashville, though it is inside that ellipse).
 */
export function routeFit(route, p) {
  if (!route || !route.origin || !route.destination || !p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
  const o = route.origin, d = route.destination;
  const totalKm = gcKm(o.lat, o.lon, d.lat, d.lon), flownKm = gcKm(o.lat, o.lon, p.lat, p.lon), leftKm = gcKm(p.lat, p.lon, d.lat, d.lon);
  let fits = flownKm + leftKm <= totalKm * 1.2 + 150, why = fits ? 'on the way' : 'off the route on file';
  if (fits && p.track != null && !p.ground && leftKm > 80 && flownKm > 80 && angDiff(p.track, bearing(p.lat, p.lon, d.lat, d.lon)) > 70) { fits = false; why = 'heading away from the destination on file'; }
  const progress = Math.max(0, Math.min(1, flownKm / Math.max(1, flownKm + leftKm)));
  const etaS = fits && p.gs > 30 ? leftKm * 1000 / p.gs : null;
  return { fits, flownKm, leftKm, totalKm, progress, etaS, why };
}

// ------------------------------------------------------------------------------- ICAO 24-bit address allocations
// ICAO Annex 10 vol. III blocks for the larger states (start, size, country). A hex inside one was allocated to that
// state; it says where the aircraft is registered, not who flies it.
const BLOCKS = [
  [0x008000, 0x8000, 'South Africa'], [0x010000, 0x8000, 'Egypt'], [0x020000, 0x8000, 'Morocco'], [0x040000, 0x1000, 'Ethiopia'],
  [0x0a0000, 0x8000, 'Algeria'], [0x0d0000, 0x8000, 'Mexico'], [0x100000, 0x100000, 'Russia'], [0x300000, 0x40000, 'Italy'],
  [0x340000, 0x40000, 'Spain'], [0x380000, 0x40000, 'France'], [0x3c0000, 0x40000, 'Germany'], [0x400000, 0x40000, 'United Kingdom'],
  [0x440000, 0x8000, 'Austria'], [0x448000, 0x8000, 'Belgium'], [0x458000, 0x8000, 'Denmark'], [0x460000, 0x8000, 'Finland'],
  [0x468000, 0x8000, 'Greece'], [0x470000, 0x8000, 'Hungary'], [0x478000, 0x8000, 'Norway'], [0x480000, 0x8000, 'Netherlands'],
  [0x488000, 0x8000, 'Poland'], [0x490000, 0x8000, 'Portugal'], [0x498000, 0x8000, 'Czechia'], [0x4a0000, 0x8000, 'Romania'],
  [0x4a8000, 0x8000, 'Sweden'], [0x4b0000, 0x8000, 'Switzerland'], [0x4b8000, 0x8000, 'Turkey'], [0x4ca000, 0x1000, 'Ireland'],
  [0x4cc000, 0x1000, 'Iceland'], [0x508000, 0x8000, 'Ukraine'], [0x710000, 0x8000, 'Saudi Arabia'], [0x718000, 0x8000, 'South Korea'],
  [0x730000, 0x8000, 'Iran'], [0x738000, 0x8000, 'Israel'], [0x750000, 0x8000, 'Malaysia'], [0x758000, 0x8000, 'Philippines'],
  [0x760000, 0x8000, 'Pakistan'], [0x768000, 0x8000, 'Singapore'], [0x780000, 0x40000, 'China'], [0x7c0000, 0x40000, 'Australia'],
  [0x800000, 0x40000, 'India'], [0x840000, 0x40000, 'Japan'], [0x880000, 0x8000, 'Thailand'], [0x888000, 0x8000, 'Vietnam'],
  [0x896000, 0x1000, 'United Arab Emirates'], [0x8a0000, 0x8000, 'Indonesia'], [0xa00000, 0x100000, 'United States'],
  [0xc00000, 0x40000, 'Canada'], [0xc80000, 0x8000, 'New Zealand'], [0xe00000, 0x40000, 'Argentina'], [0xe40000, 0x40000, 'Brazil'],
];
/** The state an ICAO address was allocated to, or '' (unknown block, or not a hex address). */
export function hexCountry(hex) {
  const h = String(hex || '').replace(/^~/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return '';
  const v = parseInt(h, 16);
  for (const [start, size, name] of BLOCKS) if (v >= start && v < start + size) return name;
  return '';
}

// ------------------------------------------------------------------------------------------------ search words
const CLASS_WORDS = [
  ['helicopter', /^(helicopters?|helis?|choppers?|rotorcraft)$/],
  ['bizjet', /^(business ?jets?|bizjets?|private ?jets?|corporate jets?)$/],
  ['widebody', /^(wide-?bod(y|ies)|jumbos?|jumbo jets?|heavies)$/],
  ['narrowbody', /^(narrow-?bod(y|ies)|airliners?)$/],
  ['regional', /^(regional ?jets?|regionals?)$/],
  ['turboprop', /^(turboprops?|props?)$/],
  ['light', /^(light aircraft|small planes?|light planes?|cessnas?)$/],
  ['fighter', /^(fighters?|fighter jets?|jet fighters?)$/],
  ['military', /^(tankers?|military transports?|transports?|awacs)$/],
  ['glider', /^(gliders?|balloons?)$/],
  ['drone', /^(drones?|uavs?)$/],
];
/** The class a search word names ("helicopters", "private jets", "jumbo"), or null. */
export function classWord(s) {
  const t = String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  for (const [cls, re] of CLASS_WORDS) if (re.test(t)) return cls;
  return null;
}
/** A query naming a type, as a test on a record's ICAO designator: a Boeing 7x7 ("747", "B777", "Boeing 737") is the
 *  whole family (B74x, B77x, B73x), an Airbus round number ("A380", "A320") its family (A38x, A32x: the A320 family
 *  includes the A321), anything else an exact designator ("B38M"). null if it can't be a type. */
export function typeMatcher(s) {
  const t = String(s || '').trim().toUpperCase().replace(/[\s-]/g, '');
  if (!/^([A-Z]{0,2}|BOEING|AIRBUS)\d{2,3}[A-Z0-9]?$/.test(t) &&!/^[A-Z]{2,4}\d{0,2}[A-Z]?$/.test(t)) return null;
  const m = t.match(/^(A|B|BOEING|AIRBUS)?(3[0-9]{2}|7[0-9]{2})$/);   // "A380", "747", "Boeing 777": the family
  if (m) {
    const num = m[2], maker = (m[1] && m[1][0] === 'B') || (!m[1] && num[0] === '7') ? 'B' : 'A';
    const fam = maker + num.slice(0, 2), exact = maker + num, family = maker === 'B' || num[2] === '0';
    return code => { const c = String(code || '').toUpperCase(); return c === exact || (family && c.length === 4 && c.startsWith(fam)); };
  }
  return code => String(code || '').toUpperCase() === t;
}
