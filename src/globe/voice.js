// Talk to the globe with no key and no AI service: the browser's own speech recognition hears one sentence,
// core/voicecmd.js turns it into one action, and the answer is spoken back with the browser's speech synthesis.
// Privacy: recognition is the browser's service (Chrome and Edge send the audio to their makers, Safari to Apple); this
// site receives nothing. Place names go to Photon (places.js) like a typed search.
import { C, $, toast, store, fmt, esc } from './env.js';
import { camera, camHeight } from './viewer.js';
import { state, hooks } from './state.js';
import { LAYERS, syncDock } from './layers.js';
import { Follow } from './follow.js';
import { Sats, SatModels } from './satellites.js';
import { Air, AirModels } from './aircraft.js';
import { Country } from './country.js';
import { Time } from './time.js';
import { select, flyToObject, PRESETS } from './ui.js';
import { ALIAS } from './search.js';
import { findPlaces, flyToPlace } from './places.js';
import { Ops } from './ops.js';
import { parse, EXAMPLES } from '../core/voicecmd.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const SENSOR_SAY = { normal: 'Normal colour.', nvg: 'Night vision.', flir: 'Thermal, white hot.', flirbh: 'Thermal, black hot.', iron: 'Thermal, ironbow.', crt: 'Old monitor.', noir: 'Noir.' };
// what people call each layer
const LAYER_WORDS = {
  quakes: 'earthquake earthquakes quakes seismic', storms: 'storms hurricanes cyclones typhoons hurricane typhoon cyclone tropical storms', air: 'planes aircraft flights airplanes civil air traffic', mil: 'military military aircraft military planes',
  stations: 'space stations stations', starlink: 'starlink', debris: 'debris space junk junk', gnss: 'gps navigation galileo glonass beidou',
  geo: 'geostationary geo', weather: 'weather satellites', visual: 'bright satellites', active: 'other satellites active satellites',
  launches: 'launch pads launches rockets', lighthouses: 'lighthouses', volcanoes: 'volcanoes', companies: 'employers companies towers',
  aurora: 'aurora northern lights', clouds: 'clouds', night: 'city lights night lights', labels: 'place names labels names', buildings: 'buildings 3d buildings', sun: 'sun time zones',
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
function say(text, heard) {
  show(heard, text);
  try {
    if (!window.speechSynthesis || store.get('voiceMute', false)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/·/g, ',')); u.rate = 1.06; u.pitch = 0.92; u.lang = navigator.language || 'en-US';
    speechSynthesis.speak(u);
  } catch (e) { /* speech output is a nicety */ }
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
      const n = Ops.countInView(cmd.what), word = { sat: 'satellites', air: 'aircraft', mil: 'military aircraft', quake: 'earthquakes', all: 'tracked objects' }[cmd.what];
      if ((cmd.what === 'air' || cmd.what === 'mil') && !Air.map.size) return say('No aircraft loaded. Live aircraft need the download version.', heard);
      return say(`${fmt(n)} ${n === 1 ? word.replace(/s$/, '') : word} in view.`, heard);
    }
    case 'what': {
      const o = Follow.obj || ($('#card').classList.contains('show') ? state.selected : null);   // an open card is what you're asking about
      if (o && o.kind === 'sat') { const i = Sats.info(o); return say(`${o.name}. ${fmt(i.alt)} kilometres up, moving at ${fmt(i.speed)} kilometres an hour.`, heard); }
      if (o && o.kind === 'air') return say(`${nameOf(o)}. ${o.ground ? 'On the ground' : fmt((o.alt || 0) / 0.3048) + ' feet'}${o.type ? ', a ' + o.type : ''}.`, heard);
      const W = innerWidth, H = innerHeight, p = camera.pickEllipsoid(new C.Cartesian2(W / 2, H / 2), C.Ellipsoid.WGS84);
      if (!p) return say(`You're in space, ${fmt(camHeight() / 1000)} kilometres from Earth.`, heard);
      const g = C.Cartographic.fromCartesian(p), lon = C.Math.toDegrees(g.longitude), lat = C.Math.toDegrees(g.latitude);
      const k = await Country.at(lon, lat).catch(() => null), h = camHeight(), up = h > 1e5 ? fmt(h / 1000) + ' kilometres up' : fmt(h) + ' metres up';
      return say(k ? `${k.facts.name}, from ${up}.` : `Open water, ${Math.abs(lat).toFixed(1)} degrees ${lat >= 0 ? 'north' : 'south'}, ${Math.abs(lon).toFixed(1)} ${lon >= 0 ? 'east' : 'west'}.`, heard);
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
  try { rec.start(); listening = true; $('#opsMic')?.classList.add('live'); show('', '', true); } catch (e) { toast('Voice could not start: ' + e.message); }
}
Ops.onVoice = listen;
if (!SR) $('#opsMic')?.setAttribute('title', 'Voice needs Chrome, Edge or Safari');

export const Voice = { listen, run: text => run(parse(text), text), supported: !!SR };
