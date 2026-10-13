// Talk to the globe with no key and no AI service: the browser's own speech recognition hears one sentence,
// core/voicecmd.js turns it into one action, and the answer is spoken back with the browser's speech synthesis (the
// nicest voice it has in your language). Press V or the mic, or hold Space while you speak. "What's this?" means the
// thing the pointer rests on (or the open card, or the middle of the view); when an answer lists several things, "the
// second one" opens it. Questions are answered from what the globe already holds: "how many planes over Texas?",
// "what's the weather in Paris?" (the model at the moment weather mode shows, else Open-Meteo for now).
// Privacy: recognition is the browser's service (Chrome and Edge send the audio to their makers, Safari to Apple); this
// site receives nothing. Place names go to Photon (places.js) like a typed search; a weather question sends the point
// it is about to Open-Meteo.
import { C, $, toast, store, fmt, esc } from './env.js';
import { scene, camera, camHeight } from './viewer.js';
import { state, hooks } from './state.js';
import { L, LAYERS, syncDock } from './layers.js';
import { Follow } from './follow.js';
import { Sats, SatModels } from './satellites.js';
import { Air, AirModels, airClass } from './aircraft.js';
import { Airports } from './airports.js';
import { AcInfo } from './acinfo.js';
import { Trails } from './trails.js';
import { Country } from './country.js';
import { Time } from './time.js';
import { select, flyToObject, PRESETS, tipFor } from './ui.js';
import { ALIAS } from './search.js';
import { findPlaces, flyToPlace } from './places.js';
import { Ops } from './ops.js';
import { Directions, resolvePair } from './directions.js';
import { Measure } from './measure.js';
import { Wind } from './wind.js';
import { Weather } from './weather.js';
import { Ships } from './ships.js';
import { Transit } from './transit.js';
import { Cams } from './cams.js';
import { Quakes } from './quakes.js';
import { parse, EXAMPLES, weatherSentence } from '../core/voicecmd.js';
import { windFrom } from '../core/gfs.js';
import { shipTypeName } from '../core/ais.js';
import { inCountry } from '../core/borders.js';
import { findAirport, etaText } from '../core/airports.js';
import { metarWords, tafWords, tafWorst, CAT_WORDS } from '../core/metar.js';
import { historyText } from '../core/runwaylog.js';
import { FieldWx } from './fieldwx.js';
import { FieldWatch } from './fieldwatch.js';
import { Runways } from './runways.js';
import { flightPhase } from '../core/phase.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const SENSOR_SAY = { normal: 'Normal colour.', nvg: 'Night vision.', flir: 'Thermal, white hot.', flirbh: 'Thermal, black hot.', iron: 'Thermal, ironbow.', crt: 'Old monitor.', noir: 'Noir.' };
// what people call each layer
const LAYER_WORDS = {
  quakes: 'earthquake earthquakes quakes seismic', storms: 'storms hurricanes cyclones typhoons hurricane typhoon cyclone tropical storms', air: 'planes aircraft flights airplanes civil air traffic', mil: 'military military aircraft military planes',
  stations: 'space stations stations', starlink: 'starlink', debris: 'debris space junk junk', gnss: 'gps navigation galileo glonass beidou',
  geo: 'geostationary geo', weather: 'weather satellites', visual: 'bright satellites', active: 'other satellites active satellites',
  launches: 'launch pads launches rockets', lighthouses: 'lighthouses', volcanoes: 'volcanoes', companies: 'employers companies towers',
  aurora: 'aurora northern lights', cams: 'traffic cameras live cameras webcams traffic cams', transit: 'buses trams trains metro transit public transport subway', traffic: 'cars car road traffic street traffic simulated traffic simulated cars', fires: 'fires fire wildfires wildfire hot spots hotspots burning', ships: 'ships ship boats boat vessels vessel ais maritime marine traffic', bikes: 'bikes bike bicycles bicycle bike share bikeshare city bikes cycling', radio: 'radio radios stations radio stations music', cctv: 'cameras camera cctv surveillance plate readers alpr anpr surveillance cameras mapped cameras', clouds: 'clouds', night: 'city lights night lights', labels: 'place names labels names', buildings: 'buildings 3d buildings', sun: 'sun time zones',
  alpr: 'plate readers license plate readers licence plate readers alpr anpr flock flock cameras', milareas: 'military areas military bases military base bases army bases military land',
};
const VIEW_OF = { moon: 'moon', 'the moon': 'moon', 'solar system': 'space', space: 'space', planets: 'space', 'geo belt': 'geo', 'outer space': 'space' };

// ---- the bubble that shows what was heard and what happened
const bubble = document.createElement('div');
bubble.id = 'voiceBubble'; bubble.className = 'glass'; bubble.setAttribute('role', 'status'); bubble.setAttribute('aria-live', 'polite');
document.body.append(bubble);
let hideTimer = 0;
function show(heard, reply, listening = false) {
  bubble.innerHTML = `<span class="vb-mic${listening ? ' on' : ''}">●</span><div>${heard ? `<q>${esc(heard)}</q>` : '<q class="dim">Listening…</q>'}${reply ? `<b>${esc(reply)}</b>` : ''}</div>`;
  bubble.classList.add('show'); clearTimeout(hideTimer);
  if (!listening) hideTimer = setTimeout(() => bubble.classList.remove('show'), 5000);
}
// the nicest voice the browser has in the page's language: the neural / online ones first, then the well-known good ones
let voice = null;
function pickVoice() {
  if (!window.speechSynthesis) return null;
  const lang = (navigator.language || 'en-US').toLowerCase(), base = lang.slice(0, 2);
  const rank = v => (/natural|neural|online/i.test(v.name) ? 0 : /google|samantha|daniel|serena|aria|jenny|guy|libby|sonia|karen|moira|alex/i.test(v.name) ? 1 : 2) + (v.lang.toLowerCase() === lang ? 0 : 0.5);
  return speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().replace('_', '-').startsWith(base)).sort((a, b) => rank(a) - rank(b))[0] || null;
}
if (window.speechSynthesis) { voice = pickVoice(); speechSynthesis.addEventListener?.('voiceschanged', () => { voice = pickVoice(); }); }
function say(text, heard) {
  show(heard, text); chime('done');
  try {
    if (!window.speechSynthesis || store.get('voiceMute', false)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/·/g, ',').replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, '')); u.rate = 1.04; u.pitch = 0.95; u.lang = navigator.language || 'en-US';
    if (voice) u.voice = voice;
    speechSynthesis.speak(u);
  } catch (e) { /* speech output is a nicety */ }
}
/** A short sound: rising when it starts listening, falling when an answer comes. */
let actx = null;
function chime(kind) {
  if (store.get('voiceMute', false)) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain(), [f0, f1] = kind === 'start' ? [620, 930] : [880, 620];
    o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + 0.11);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.2);
  } catch (e) { /* no audio: fine */ }
}

// ---- what the pointer rests on: "what's this?" (250 ms still, remembered for 30 s)
let rest = null, restTimer = 0, listed = { items: [], t: 0 };
scene.canvas.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') return;
  clearTimeout(restTimer); const x = e.offsetX, y = e.offsetY;
  restTimer = setTimeout(() => { rest = { x, y, t: performance.now() }; }, 250);
}, { passive: true });
scene.canvas.addEventListener('pointerleave', () => clearTimeout(restTimer));
/** Everything drawn at a screen point (up to 6, nearest first) and the ground there: { objs, lat, lon } (lat null off the Earth). */
function at(x, y) {
  const pos = new C.Cartesian2(x, y), objs = [];
  for (const p of scene.drillPick(pos, 8, 9, 9)) { const id = p && p.id, o = id ? (id.kind ? id : id.sat || id.air || id.obj || null) : null; if (o && !objs.includes(o)) objs.push(o); }
  const g = camera.pickEllipsoid(pos, C.Ellipsoid.WGS84), c = g && C.Cartographic.fromCartesian(g);
  return { objs: objs.slice(0, 6), lat: c ? C.Math.toDegrees(c.latitude) : null, lon: c ? C.Math.toDegrees(c.longitude) : null };
}
const pointerSpot = () => rest && performance.now() - rest.t < 30e3 ? at(rest.x, rest.y) : null;
const centreSpot = () => at(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2);
const sayable = t => String(t || '').replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, '').replace(/\s*·\s*/g, ', ').trim();
/** One thing, said in a sentence. */
function describe(o) {
  if (o.kind === 'sat') { const i = Sats.info(o); return `${o.name}, ${fmt(i.alt)} kilometres up, moving at ${fmt(i.speed)} kilometres an hour.`; }
  if (o.kind === 'air') {   // what it is (adsbdb when known), what it is doing, where it is going (only a route that fits)
    const a = o.info && o.info.aircraft, k = airClass(o), what = a && (a.manufacturer || a.type) ? [a.manufacturer, a.type].filter(Boolean).join(' ') : o.type ? o.type : k.why !== 'guess' ? k.name.toLowerCase() : '';
    const op = o.op || (a && a.owner) || '', ap = Airports.index.list.length ? Airports.index.nearest(o.cur?.lat ?? o.lat, o.cur?.lon ?? o.lon, 300) : null;
    const ph = flightPhase({ ...o, lat: o.cur?.lat ?? o.lat, lon: o.cur?.lon ?? o.lon, cls: k.cls }, ap), rt = o.info && o.info.route, fit = AcInfo.fit(o);
    const doing = o.ground ? ph.words.toLowerCase() + ' on the ground' : `${ph.words.toLowerCase()} at ${fmt((o.alt || 0) / 0.3048)} feet${o.gs ? `, ${fmt(o.gs * 1.94384)} knots` : ''}`;
    const going = fit && fit.fits ? ` From ${rt.origin.city || rt.origin.name} to ${rt.destination.city || rt.destination.name}${fit.etaS != null && !o.ground ? `, about ${etaText(fit.etaS)} to go` : ''}.` : '';
    return `${nameOf(o)}${what ? ', ' + (/^[aeiou]/i.test(what) ? 'an ' : 'a ') + what : ''}${op ? ', ' + op : ''}. ${doing[0].toUpperCase() + doing.slice(1)}.${going}`;
  }
  if (o.kind === 'airport') { const b = Airports.board(o); return `${o.name}: ${b.arriving.length} arriving, ${b.departing.length} departing, ${b.ground.length} on the ground that the feeds can see.`; }
  if (o.kind === 'quake') return `A magnitude ${o.mag.toFixed(1)} earthquake, ${o.place}, ${ago(Date.now() - o.time)}.`;
  if (o.kind === 'storm') return `${o.title}${o.kt ? `, winds ${fmt(o.kt)} knots` : ''}.`;
  if (o.kind === 'ship') { const m = o.m || {}; return `${o.label}, ${shipTypeName(m.type).split(' · ')[0].toLowerCase()}${o.sog >= 0.5 ? `, doing ${Math.round(o.sog)} knots` : ''}${m.destination ? `, heading for ${m.destination}` : ''}.`; }
  if (o.kind === 'cam') return `${o.name}: a ${o.video && /m3u8/.test(o.video) ? 'live video' : 'traffic'} camera. Its card can project it into 3D.`;
  return sayable(tipFor(o) || nameOf(o) || 'Something') + '.';
}
const ago = ms => ms < 3600e3 ? Math.max(1, Math.round(ms / 60e3)) + ' minutes ago' : ms < 172800e3 ? Math.round(ms / 3600e3) + ' hours ago' : Math.round(ms / 864e5) + ' days ago';
const ordinal = n => ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'][n - 1] || n;
const IMPERIAL = /^en-(us|lr)$|^my\b/i.test(navigator.language || '');
/** The weather at a point: the model at the moment weather mode shows (with whatever layers are loaded: pressure,
 *  gusts, waves), else Open-Meteo for now (with gusts, pressure and, over water, its marine model's waves). */
async function weatherAt(lat, lon) {
  if (Weather.on && (Wind.cur || Wind.grid)) {
    const r = Wind.reading(lat, lon); if (r) { const w = windFrom(r.u, r.v); return { ...r, from: w.from, speed: w.speed, when: Wind.cur ? Weather.frames[Weather.frame] : null }; }
  }
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 6000), q = `latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`;
  try {
    const u = `https://api.open-meteo.com/v1/forecast?${q}&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,cloud_cover,precipitation,weather_code&wind_speed_unit=ms`;
    const sea = fetch(`https://marine-api.open-meteo.com/v1/marine?${q}&current=wave_height,wave_direction`, { signal: ctl.signal }).then(r => r.json()).then(j => j.current || {}).catch(() => ({}));   // waves: over water only (null on land)
    const [c, m] = await Promise.all([fetch(u, { signal: ctl.signal }).then(r => r.json()).then(j => j.current), sea]);
    return { temp: c.temperature_2m, speed: c.wind_speed_10m, from: c.wind_direction_10m, gust: c.wind_gusts_10m, pres: c.pressure_msl, cloud: c.cloud_cover, rain: c.precipitation, code: c.weather_code,
      wave: m.wave_height ?? NaN, waveFrom: m.wave_direction ?? NaN, source: 'Open-Meteo' };
  } finally { clearTimeout(t); }
}
async function placeName(lat, lon) {
  const k = await Country.at(lon, lat).catch(() => null);
  return k ? k.facts.name : `Open water, ${Math.abs(lat).toFixed(1)} degrees ${lat >= 0 ? 'north' : 'south'}, ${Math.abs(lon).toFixed(1)} ${lon >= 0 ? 'east' : 'west'}`;
}
/** Where a spoken place is: a country (its outline) or anything Photon finds (its box, or 50 km round a point). */
async function area(q) {
  const name = q.replace(/^the /, ''), c = (await Country.search(name).catch(() => []))[0];
  if (c && c.name.toLowerCase() === name) { const o = await Country.byIso(c.iso); if (o) return { name: c.name, inside: (lat, lon) => inCountry(o.border, lon, lat), lat: null, lon: null }; }
  const pl = (await findPlaces(name, 1).catch(() => null) || [])[0];
  if (!pl) return null;
  const e = pl.extent && Math.abs(pl.extent[2] - pl.extent[0]) > 0.05 ? pl.extent : null, k = 0.45 / Math.max(0.2, Math.cos(pl.lat * Math.PI / 180));
  return { name: pl.name + (e ? '' : ' (within about 50 kilometres)'), lat: pl.lat, lon: pl.lon,
    inside: e ? (lat, lon) => lat <= e[1] && lat >= e[3] && lon >= e[0] && lon <= e[2] : (lat, lon) => Math.abs(lat - pl.lat) <= 0.45 && Math.abs(lon - pl.lon) <= k };
}
/** The things of one kind the globe holds now, with where they are: [{ lat, lon }]. */
function things(what) {
  const ll = p => { const g = C.Cartographic.fromCartesian(p); return { lat: C.Math.toDegrees(g.latitude), lon: C.Math.toDegrees(g.longitude) }; };
  if (what === 'sat') return Sats.list.filter(o => o.pt && o.pt.show).map(o => ll(o.pt.position));
  if (what === 'air' || what === 'mil') return [...Air.map.values()].filter(a => what === 'air' ? !a.mil : a.mil).map(a => ({ lat: a.cur?.lat ?? a.lat, lon: a.cur?.lon ?? a.lon }));
  if (what === 'quake') return Quakes.list;
  if (what === 'ship') return [...Ships.ships.values()].map(s => s.at);
  if (what === 'transit') return [...Transit.vehicles.values()];
  if (what === 'cam') return Cams.list;
  return ['sat', 'air', 'mil', 'quake', 'ship', 'transit'].flatMap(things);
}
const WORD = { sat: 'satellites', air: 'aircraft', mil: 'military aircraft', quake: 'earthquakes', ship: 'ships', transit: 'transit vehicles', cam: 'cameras', all: 'tracked things' };
/** List several things aloud, numbered, and remember them for "the second one". */
function listOut(objs, heard, lead) {
  listed = { items: objs, t: performance.now() };
  return say(`${lead} ${objs.map((o, i) => `${ordinal(i + 1)}, ${sayable(tipFor(o) || nameOf(o)).split(', ')[0]}`).join('; ')}. Say "the second one" to open it.`, heard);
}

// ---- finding things
function findSat(q) {
  const s = q.toLowerCase().replace(/^(the )/, ''), id = ALIAS[s];
  if (id && Sats.byId.get(id)) return Sats.byId.get(id);
  if (/^\d{1,6}$/.test(s)) return Sats.byId.get(String(+s)) || Sats.byId.get(s.padStart(5, '0'));
  const rank = o => (o.layer === 'stations' ? 0 : o.layer === 'visual' ? 1 : 2) + (o.name.toLowerCase().startsWith(s) ? 0 : 0.5);
  return Sats.list.filter(o => o.name.toLowerCase().includes(s)).sort((a, b) => rank(a) - rank(b))[0] || null;
}
function findPlane(q) {
  const s = q.toUpperCase().replace(/\s+/g, '');
  return [...Air.map.values()].find(a => (a.flight || '').trim().toUpperCase() === s || String(a.hex || '').toUpperCase() === s || (a.reg || '').toUpperCase().replace(/-/g, '') === s.replace(/-/g, '')) || null;
}
function findLayers(name) {
  const n = name.toLowerCase();
  if (/^(all )?(the )?(satellites|sats)$/.test(n)) return LAYERS.filter(l => l.sat);
  if (/^(all )?(the )?(planes|aircraft|flights)$/.test(n)) return LAYERS.filter(l => l.id === 'air' || l.id === 'mil');
  const own = LAYERS.find(l => l.id === n); if (own) return [own];   // a layer's own name first: "traffic" is the cars, not air traffic or traffic cameras
  return LAYERS.filter(l => l.id === n || (LAYER_WORDS[l.id] || '').split(' ').includes(n) || ` ${LAYER_WORDS[l.id] || ''} `.includes(` ${n} `) || l.name.toLowerCase().startsWith(n));
}
function setLayers(list, on) { for (const l of list) l.on = on; syncDock(); hooks.applyVisibility(); }
const nameOf = o => o.kind === 'sat' ? o.name : o.kind === 'air' ? (o.flight || o.hex || '').trim() : o.name || o.place || '';

async function follow(o) {
  select(o);
  if (o.kind === 'sat') await SatModels.follow(o); else if (o.kind === 'air') AirModels.follow(o);
}

// ---- running a command
async function run(cmd, heard) {
  switch (cmd.act) {
    case 'sensor': Ops.setSensor(cmd.mode); return say(SENSOR_SAY[cmd.mode], heard);
    case 'hud': Ops.setHud(cmd.on ?? !Ops.hud); return say(Ops.hud ? 'Tactical display on.' : 'Tactical display off.', heard);
    case 'detect': Ops.setDetect(cmd.on ?? !Ops.detect); return say(Ops.detect ? `Detection on. ${fmt(Ops.countInView())} contacts in view.` : 'Detection off.', heard);
    case 'cockpit': {
      const want = cmd.on ?? !Ops.cockpit; await Ops.setCockpit(want);
      return say(Ops.cockpit ? `Cockpit. Riding ${nameOf(Follow.obj)}.` : want ? 'Pick a satellite to ride first. Say: track the ISS.' : 'Left the cockpit.', heard);
    }
    case 'stop': if (Ops.cockpit) await Ops.setCockpit(false); else if (Follow.obj) Follow.stop(); return say('Released.', heard);
    case 'reset': if (Ops.cockpit) await Ops.setCockpit(false); PRESETS.earth(); return say('Globe view.', heard);
    case 'north': case 'topdown':
      if (Follow.obj) return say('Stop tracking first.', heard);
      camera.flyTo({ destination: camera.positionWC.clone(), orientation: { heading: 0, pitch: cmd.act === 'topdown' ? -Math.PI / 2 : camera.pitch, roll: 0 }, duration: 0.8 });
      return say(cmd.act === 'north' ? 'North up.' : 'Looking straight down.', heard);
    case 'zoom': { const h = Math.max(300, camHeight()); if (cmd.dir === 'in') camera.zoomIn(h * 0.6); else camera.zoomOut(h * 1.2); return say(cmd.dir === 'in' ? 'Closer.' : 'Pulling back.', heard); }
    case 'live': Time.goLive(); return say('Live.', heard);
    case 'pause': Time.setRate(0); return say('Time paused.', heard);
    case 'faster': { const r = Time.live ? 60 : Time.rate >= 600 ? 3600 : Time.rate >= 60 ? 600 : 60; Time.setRate(r); return say(r >= 3600 ? 'One hour a second.' : r >= 600 ? 'Ten minutes a second.' : 'One minute a second.', heard); }
    case 'count': {
      const word = WORD[cmd.what] || WORD.all;
      if ((cmd.what === 'air' || cmd.what === 'mil') && !Air.map.size) return say('No aircraft loaded. Live aircraft need the download version.', heard);
      if (!cmd.place) {
        if (['sat', 'air', 'mil', 'quake', 'all'].includes(cmd.what)) { const n = Ops.countInView(cmd.what); return say(`${fmt(n)} ${n === 1 ? word.replace(/s$/, '') : word} in view.`, heard); }
        const n = things(cmd.what).length; return say(`${fmt(n)} ${word} loaded right now.`, heard);
      }
      const where = await area(cmd.place);
      if (!where) return say(`I couldn't find ${cmd.place}.`, heard);
      const all = things(cmd.what), n = all.filter(o => Number.isFinite(o.lat) && where.inside(o.lat, o.lon)).length;
      const off = cmd.what === 'ship' && !L.ships.on ? ' The ships layer is off: turn on ships first.' : cmd.what === 'transit' && !L.transit.on ? ' Live transit is off: turn it on first.' : cmd.what === 'cam' && !L.cams.on ? ' Cameras are off: turn them on first.' : '';
      return say(`${fmt(n)} ${n === 1 ? word.replace(/s$/, '') : word} ${cmd.what === 'sat' ? 'over' : 'in'} ${where.name} right now.${off}`, heard);
    }
    case 'what': {
      const o = Follow.obj || ($('#card').classList.contains('show') ? state.selected : null);   // an open card is what you're asking about
      if (o) return say(describe(o), heard);
      const spot = pointerSpot() || centreSpot();
      if (spot.objs.length === 1) { select(spot.objs[0]); return say(describe(spot.objs[0]), heard); }
      if (spot.objs.length > 1) return listOut(spot.objs, heard, `${spot.objs.length} things there:`);
      if (spot.lat == null) return say(`You're in space, ${fmt(camHeight() / 1000)} kilometres from Earth.`, heard);
      const h = camHeight(), up = h > 1e5 ? fmt(h / 1000) + ' kilometres up' : fmt(h) + ' metres up', name = await placeName(spot.lat, spot.lon);
      const r = Weather.on ? await weatherAt(spot.lat, spot.lon).catch(() => null) : null;
      return say(`${name}${r ? '. ' + weatherSentence(r, IMPERIAL) : ', from ' + up}.`, heard);
    }
    case 'pick': {
      if (!listed.items.length || performance.now() - listed.t > 120e3) return say('Ask "what\'s this?" over a few things first.', heard);
      const o = listed.items[cmd.n - 1]; if (!o) return say(`There were only ${listed.items.length}.`, heard);
      select(o); flyToObject(o); return say(describe(o), heard);
    }
    case 'weather': {
      let lat, lon, name;
      if (cmd.place) {
        const pl = (await findPlaces(cmd.place, 1).catch(() => null) || [])[0];
        if (!pl) return say(`I couldn't find ${cmd.place}.`, heard);
        ({ lat, lon } = pl); name = pl.name;
      } else {
        const spot = pointerSpot() || centreSpot();
        if (spot.lat == null) return say('Point at a place on the Earth first.', heard);
        ({ lat, lon } = spot); name = await placeName(lat, lon);
      }
      const r = await weatherAt(lat, lon).catch(() => null);
      if (!r) return say('The weather service is not answering right now.', heard);
      const when = r.when && r.when.fcst ? ` (forecast for ${new Date(r.when.t).toLocaleString([], { weekday: 'long', hour: 'numeric' })})` : '';
      return say(`${name}${when}: ${weatherSentence(r, IMPERIAL)}.`, heard);
    }
    case 'view': { const b = document.querySelector(`#band [data-go="${cmd.go}"]`); if (b) b.click(); else if (PRESETS[cmd.go]) PRESETS[cmd.go](); return say(b ? b.textContent.replace(/[⌕▶↗]/g, '').trim() + '.' : 'Opening.', heard); }
    case 'layer': {
      const list = findLayers(cmd.name); if (!list.length) return say(`There's no layer called ${cmd.name}.`, heard);
      setLayers(list, cmd.on); return say(`${list.length > 1 ? cmd.name : list[0].name.split(' (')[0]} ${cmd.on ? 'on' : 'off'}.`, heard);
    }
    case 'track': {
      const o = findSat(cmd.what) || findPlane(cmd.what);
      if (!o) return say(Sats.list.length ? `I can't find ${cmd.what} in orbit or in the air.` : 'The satellites are still loading.', heard);
      await follow(o); return say(`Tracking ${nameOf(o)}.`, heard);
    }
    case 'go': {
      const q = cmd.place;
      if (VIEW_OF[q]) { PRESETS[VIEW_OF[q]](); return say(VIEW_OF[q] === 'space' ? 'The Solar System.' : q.replace(/^the /, '') + '.', heard); }
      const sat = ALIAS[q] ? findSat(q) : null; if (sat) { select(sat); flyToObject(sat); return say(`${sat.name}.`, heard); }
      const lays = findLayers(q); if (lays.length) { setLayers(lays, true); return say(`${lays.length > 1 ? q : lays[0].name.split(' (')[0]} on.`, heard); }
      const plane = findPlane(q); if (plane) { select(plane); flyToObject(plane); return say(`${nameOf(plane)}.`, heard); }
      const c = (await Country.search(q).catch(() => []))[0];   // a country by its own name gets its dossier
      if (c && c.name.toLowerCase() === q.replace(/^the /, '')) { const o = await Country.byIso(c.iso); if (o) { select(o); Country.fly(o); return say(`${c.name}.`, heard); } }
      const places = await findPlaces(q, 1).catch(() => null);
      if (places && places[0]) { hooks.closeCard?.(); flyToPlace(places[0]); return say(`${places[0].name}${places[0].sub ? ', ' + places[0].sub.split(' · ').pop() : ''}.`, heard); }
      return say(places === null ? 'The place search is unavailable right now.' : `I couldn't find ${q}.`, heard);
    }
    case 'route': {
      let a, b; try { [a, b] = await resolvePair(cmd.from, cmd.to); } catch (e) { return say(`I couldn't find ${e.message.replace(/^no place called /, '')}.`, heard); }
      Directions.open({ from: a, to: b, mode: cmd.mode });
      const r = await Directions.go(a, b, cmd.mode).catch(() => null);
      return say(r ? `${{ walk: 'Walking', cycle: 'Cycling', drive: 'Driving' }[cmd.mode]}: ${r.distance >= 1000 ? (r.distance / 1000).toFixed(1) + ' kilometres' : Math.round(r.distance) + ' metres'}, about ${Math.max(1, Math.round(r.duration / 60))} minutes. Say "fly it" to ride along.` : 'No route between those places.', heard);
    }
    case 'measure': case 'outline': case 'draw': case 'pin': case 'undoDraw': case 'clearDraw': case 'drawInfo':
      return say(await Measure.voice(cmd, { here: () => pointerSpot() || centreSpot(), famousSat: q => ALIAS[q] ? findSat(q) : null }), heard);
    case 'flyroute': if (!Directions.route) return say('Ask for a route first, like: walking route from Big Ben to the Tower of London.', heard); Directions.fly(); return say('Flying the route.', heard);
    case 'board': {
      await Airports.load();
      const a = findAirport(Airports.list, cmd.place); if (!a) return say(`I don't know an airport called ${cmd.place}.`, heard);
      if (!L.air.on && !L.mil.on) setLayers([L.air, L.mil], true);
      await Airports.show(a.icao);
      const b = Airports.board(a), list = cmd.which ? b[cmd.which] : [...b.arriving, ...b.departing];
      if (!list.length) return say(`${a.name}: no ${cmd.which || 'arriving or departing'} aircraft the feeds can see right now.`, heard);
      const top = list.slice(0, 3).map(e => `${nameOf(e.r)}${e.status === 'arriving' && e.etaS != null ? ` in ${etaText(e.etaS)}` : ''}`).join(', ');
      listed = { items: list.map(e => e.r), t: performance.now() };   // "the second one" opens it
      return say(`${a.name}: ${b.arriving.length} arriving, ${b.departing.length} departing. ${cmd.which === 'departing' ? 'Departing' : cmd.which === 'arriving' ? 'Next in' : 'First'}: ${top}.`, heard);
    }
    case 'airwx': {   // the airport's METAR / TAF in words (download version), or the runways it is using
      await Airports.load();
      const a = findAirport(Airports.list, cmd.place); if (!a) return say(`I don't know an airport called ${cmd.place}.`, heard);
      await Airports.show(a.icao);
      if (cmd.what === 'runway') {
        const s = FieldWatch.available ? FieldWatch.log.summary(a.icao, Date.now(), 60) : null;
        if (s && s.total) return say(`${a.name}, the last hour: ${historyText(s)}`, heard);
        await Runways.load();
        const b = Airports.board(a), use = Runways.inUse(a, b.arriving.map(e => ({ ...e.r, lat: e.r.cur?.lat ?? e.r.lat, lon: e.r.cur?.lon ?? e.r.lon })), null);
        return say(use ? `${a.name}: arrivals are lined up with runway ${use.end.ident}.` : `${a.name}: I can't tell yet. The card counts the runways as planes land and take off while it is open.`, heard);
      }
      if (!FieldWx.available) return say(`${a.name}: its METAR and TAF need the download version; the card shows the model weather.`, heard);
      if (cmd.what === 'taf') {
        const t = await FieldWx.taf(a.icao).catch(() => null);
        if (!t) return say(`${a.name} has no TAF on the Aviation Weather Center.`, heard);
        const lines = tafWords(t, { hours: 12 }).slice(0, 3).map(l => l.text), worst = tafWorst(t, { hours: 6 });
        return say(`${a.name} forecast${worst ? `, at worst ${worst} in the next 6 hours` : ''}. ${lines.join('. ')}.`, heard);
      }
      const m = await FieldWx.metar(a.icao).catch(() => null);
      if (!m) return say(`${a.name} has no recent METAR on the Aviation Weather Center.`, heard);
      return say(`${a.name}: ${m.category ? CAT_WORDS[m.category] + '. ' : ''}${metarWords(m).slice(0, 5).map(w => w.text).join(' ')}`, heard);
    }
    case 'trails': Trails.setOn(cmd.on); return say(cmd.on ? 'Trails on: the plane you follow or open draws where it has been.' : 'Trails off.', heard);
    case 'help': return say(`Try: ${EXAMPLES.slice(0, 5).join(' · ')}.`, heard);
    default: return say(`Didn't catch a command. Try "take me to Tokyo" or "night vision".`, heard);
  }
}

// ---- listening
let rec = null, listening = false;
function listen() {
  if (!SR) { toast('Voice needs Chrome, Edge or Safari: this browser has no speech recognition', 4500); return; }
  if (listening && rec) { rec.stop(); return; }
  if (!store.get('voiceNoticed', false)) {
    toast("Voice uses your browser's own speech service (Chrome and Edge send the audio to Google or Microsoft, Safari to Apple). This site receives nothing.", 7000);
    store.set('voiceNoticed', true);
  }
  rec = new SR(); rec.lang = navigator.language || 'en-US'; rec.interimResults = true; rec.maxAlternatives = 3; rec.continuous = false;
  let done = false;
  rec.onresult = e => {
    const r = e.results[e.results.length - 1];
    if (!r.isFinal) { show(r[0].transcript, '', true); return; }
    done = true;
    const alts = [...r].map(a => a.transcript), best = alts.find(t => parse(t).act !== 'unknown') || alts[0];
    run(parse(best), best).catch(err => { console.warn('voice', err); say('That went wrong. Try again.', best); });
  };
  rec.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('The microphone is blocked for this site: allow it in the address bar', 5000);
    else if (e.error === 'no-speech') show('', 'Heard nothing. Press V or the mic and speak.');
    else if (e.error !== 'aborted') show('', 'Voice error: ' + e.error);
  };
  rec.onend = () => { listening = false; $('#opsMic')?.classList.remove('live'); if (!done && bubble.querySelector('.vb-mic.on')) bubble.classList.remove('show'); };
  try { rec.start(); listening = true; $('#opsMic')?.classList.add('live'); show('', '', true); chime('start'); } catch (e) { toast('Voice could not start: ' + e.message); }
}
// push to talk: hold Space (not in a text box or on a button) for 0.4 s, speak, let go
let pttTimer = 0, ptt = false;
addEventListener('keydown', e => {
  if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || /input|textarea|select|button/i.test(e.target.tagName) || e.target.isContentEditable) return;
  e.preventDefault(); clearTimeout(pttTimer);
  pttTimer = setTimeout(() => { ptt = true; if (!listening) listen(); }, 400);
}, true);
addEventListener('keyup', e => {
  if (e.code !== 'Space') return;
  clearTimeout(pttTimer);
  if (ptt) { ptt = false; if (listening && rec) rec.stop(); }   // let go: that was the sentence
}, true);
Ops.onVoice = listen;
if (!SR) $('#opsMic')?.setAttribute('title', 'Voice needs Chrome, Edge or Safari');

export const Voice = { listen, run: text => run(parse(text), text), supported: !!SR };
