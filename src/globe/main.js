// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// 3D globe: wiring, the frame hooks, feeds on timers, and boot.
import { C, $, toast, PHONE, EMBED, ON_SITE } from './env.js';
import { viewer, scene, globe, camera, satPts, airPts, airIcons, qkPts, camHeight } from './viewer.js';
import { L, initDock } from './layers.js';
import { hooks, state } from './state.js';
import { Earth, BASES, setBase, currentBase, sunlitView, marbleLayer, nightLayer, fxShell, cloudShell, limbShell, Fx, moonPosition } from './earth.js';
import { Follow, MODEL_FIX, SOLAR_AXIS } from './follow.js';
import { Sats, SatModels, SHADOW_FILL } from './satellites.js';
import { warmModels, warmAgain, warmSlowly } from './warm.js';
import { Air, AirModels, airShown } from './aircraft.js';
import { AIR_TTL } from '../core/airgrid.js';
import { createPoller } from '../core/poll.js';
import { Time } from './time.js';
import { Quakes } from './quakes.js';
import { Lighthouses } from './lighthouses.js';
import { updateStats, updateBand, PRESETS, Lighting, select } from './ui.js';
import { Space } from './space.js';
import { Quality, LEVELS } from './quality.js';
import { Conj } from './conjunctions.js';
import { Reentry } from './reentry.js';
import { LookUp } from './lookup.js';
import { Eclipses } from './eclipses.js';
import { initMobile } from './mobile.js';
import { initNavpad } from './navpad.js';
import { Weather, initWeather } from './weather.js';
import { Aurora } from './aurora.js';
import { LightMap } from './lightmap.js';
import { Flybys } from './flybys.js';
import { Companies } from './companies.js';
import { Volcanoes } from './volcanoes.js';
import { Buoys, Darts, Tides } from './ocean.js';
import { SeaImagery, AirQuality } from './seaair.js';
import { SunLine } from './sunline.js';
import { Buildings } from './buildings.js';
import { Share } from './share.js';
import { Tour } from './tour.js';
import { Wind } from './wind.js';
import { Country } from './country.js';
import { toggle as toggleNerd } from './nerd.js';
import { Tonight } from './tonight.js';
import { Flight } from './flight.js';
import { Snapshot } from './snapshot.js';
import { Search } from './search.js';
import { Launches } from './launches.js';
import { Crew } from './crew.js';
import { Ops } from './ops.js';
import { Voice } from './voice.js';
import { Photoreal } from './photoreal.js';
import { Storms } from './storms.js';
import { Directions } from './directions.js';
import { Ascent } from './ascent.js';
import { Director } from './director.js';
import { Surveil } from './surveil.js';
import { Alpr } from './alpr.js';
import { Military } from './military.js';
import { Radio } from './radio.js';
import { Cams, Look } from './cams.js';
import { Transit } from './transit.js';
import { Traffic } from './traffic.js';
import { Terrain } from './terrain.js';
import { Fires } from './fires.js';
import { Imagery } from './imagery.js';
import { Measure } from './measure.js';
import { Ships } from './ships.js';
import { Bikes } from './bikes.js';
import { Saver } from './saver.js';
import { Model } from './model.js';
import { Airports, Aviation } from './aviation.js';
import { LandWatch } from './landwatch.js';   // after aviation.js, which loads it (the module order stays as it was)
import { Now } from './now.js';
import { Events } from './events.js';
import { TimeTravel } from './timetravel.js';
import './exportview.js';   // the dock's "Export what's in view" (provenance included)

// things on the ground: from look-up mode's eye height they become huge streaks across the sky, so they hide there
const GROUND = ['airports', 'companies', 'volcanoes', 'lighthouses', 'launches', 'quakes', 'sun', 'buildings', 'cctv', 'alpr', 'milareas', 'storms', 'events', 'radio', 'cams', 'transit', 'traffic', 'fires', 'ships', 'bikes', 'buoys', 'dart', 'tides', 'airq'];
function applyVisibility() {
  const held = state.lookup ? GROUND.map(id => [id, L[id].on]) : null;   // switch them off for this pass only (the dock keeps its state)
  if (held) for (const [id] of held) L[id].on = false;
  try { applyAll(); } finally { if (held) for (const [id, on] of held) L[id].on = on; }
}
function applyAll() {
  for (const s of Sats.list) if (s.pt) s.pt.show = L[s.layer].on && !s.ent && !s.docked && !s.gone;
  airPts.show = airIcons.show = !state.weather; satPts.show = !state.weather;
  for (const a of Air.map.values()) { const on = airShown(a); a.pt.show = on && !a.ent; a.icon.show = on && !a.ent; if (!on && a.ent) AirModels.drop(a); }
  qkPts.show = L.quakes.on; Lighthouses.apply(); Aurora.apply(); LightMap.apply(); Companies.apply(); Volcanoes.apply(); SunLine.apply(); Buildings.apply(); Launches.apply(); Reentry.apply(); Photoreal.apply(); Storms.apply(); Events.apply(); Surveil.apply(); Alpr.apply(); Military.apply(); Radio.apply(L.radio.on); Cams.apply(); Transit.apply(L.transit.on); Traffic.apply(L.traffic.on); Terrain.apply(L.terrain.on); Fires.apply(); Imagery.apply(); Measure.apply(); Directions.apply(); Ships.apply(L.ships.on); Bikes.apply(L.bikes.on); Airports.apply(); Buoys.apply(); Darts.apply(); Tides.apply(); SeaImagery.apply(); AirQuality.apply();
  Earth.apply(); updateBand(); updateStats();
}
hooks.applyVisibility = applyVisibility;
hooks.updateStats = updateStats;
initDock({ bases: BASES, currentBase, onBase: setBase, quality: { levels: LEVELS, chosen: () => Quality.chosen, current: () => Quality.level, choose: id => Quality.choose(id) }, saver: { on: () => Saver.on, set: on => Saver.set(on) } });
Quality.follow(q => { AirModels.max = q.air; SatModels.max = q.sat; cloudShell.material.uniforms.octaves = q.octaves; });

// before each frame: follow camera, model lighting; before rendering: sun direction, satellite dots, Earth fades
scene.preUpdate.addEventListener((sc, time) => { Follow.track(time); Ops.ride(time); Lighting.update(); });   // the cockpit sits on the followed position of this frame, so it rides after track
scene.preRender.addEventListener((sc, time) => { SatModels.updateSun(time); Sats.update(Time.nowMs()); Earth.update(camHeight()); Space.update(); Transit.update(Date.now()); Ships.update(Date.now()); Traffic.update(); });   // transit and ships are live: the time bar doesn't move them
PRESETS.space = () => Space.go();
PRESETS.conj = () => Conj.openList();
PRESETS.reentry = () => Reentry.openList();
PRESETS.lookup = () => { hooks.clearPresets(); LookUp.enter(); };
PRESETS.eclipses = () => Eclipses.openList();
PRESETS.weather = () => Weather.toggle();
PRESETS.tour = () => { hooks.clearPresets(); Tour.start(); };
PRESETS.flybys = () => { hooks.clearPresets(); Flybys.openList(); };
Tonight.use({   // the globe's own feeds for the Tonight card (tonight.html wires light versions of the same)
  sats: Sats, auroraGrid: () => Aurora.grid(), countryName: (lon, lat) => Country.at(lon, lat).then(k => k && k.facts.name),
  launches: () => Launches.load().then(() => Launches.list), showLaunch: l => Launches.show(l),
  nextEclipse: (lat, lon) => Eclipses.nextFrom(lat, lon), watchEclipse: e => Eclipses.watch(e), lookUp: t => LookUp.enter(t),
});
PRESETS.tonight = () => Tonight.open();
hooks.satPasses = o => Tonight.forSat(o);
PRESETS.search = () => Search.open();
PRESETS.crew = () => Crew.open();
PRESETS.launches = () => { hooks.clearPresets(); Launches.openList(); };
hooks.showLaunch = o => Launches.show(o);
PRESETS.flight = () => Flight.open();
PRESETS.route = () => Directions.open();
PRESETS.imagery = () => Imagery.open();
PRESETS.measure = () => Measure.open();
PRESETS.now = () => Now.toggle();
PRESETS.history = () => TimeTravel.toggle();
hooks.openHistory = () => { if (!TimeTravel.open) TimeTravel.show(); document.querySelector('#band [data-go="history"]')?.classList.add('on'); };
hooks.shareCopy = () => Share.copy();
hooks.closeWeather = () => { if (Weather.on) Weather.close(); };
hooks.snapshot = () => Snapshot.share();
hooks.toggleNerd = toggleNerd;
initMobile();   // phones only: the bottom dock
initNavpad();
initWeather();   // everything else: zoom, north and reset buttons
$('#luExit').onclick = () => LookUp.leave();
addEventListener('keydown', e => { if (e.key === 'Escape' && (LookUp.active || LookUp.state.starting)) LookUp.leave(); });
setInterval(() => SatModels.refresh(), 400);
setInterval(() => AirModels.refresh(), 500);
// aircraft dead reckoning: 4 times a second close in, once a second from high up (a quarter-second of flight is invisible
// from 1,000 km, and each pass moves ~8,000 dots: the globe's biggest main-thread cost on a phone)
{ let lastAir = 0; setInterval(() => { const now = Date.now(); if (state.weather) return; if (now - lastAir < (camHeight() > 1.0e6 ? 1000 : 250)) return; lastAir = now; Air.update(now); }, 250); }
setInterval(() => Air.prune(), 30e3);

/** Run a feed now and every `ms` (core/poll.js), resting while the tab is hidden: back in view, each feed that came due
 *  runs once, a moment apart. A failure is logged and retried on the next run; only one that keeps failing (three in a
 *  row) is mentioned, and not as a scary "Failed to fetch" on a first visit. A feed that can't answer on this page (the
 *  website's relay doesn't carry it: env.js notCarried) stops for the visit, with no "retrying". */
const poller = createPoller();
document.addEventListener('visibilitychange', () => poller.setHidden(document.hidden));
poller.setHidden(document.hidden);
function every(ms, fn, label, { keep, onStop } = {}) {
  return poller.add(ms, fn, { keep, onStop: e => { console.warn(label, e.message); onStop ? onStop(e) : later(`${label}: ${HERE}`, 4000); },
    onError: (e, fails) => { console.warn(label, e); if (fails === 3) toast(`${label} is unavailable right now; retrying`, 3500); } });
}
// why a feed can't answer on this page: the website's relay doesn't carry it, anywhere else only the local helper relays it
const HERE = ON_SITE ? 'not on the website for now; they come with the free download' : 'they need the local helper (serve.js or serve.py, on localhost)';
// a line for the visitor once the globe is showing: a feed stops long before the boot screen lifts, and #toast sits under
// it; two such lines take turns instead of the second hiding the first
let laterFree = 0;
function later(msg, ms, cond = () => true) {
  if (EMBED) return;
  const tell = () => { if (!Share.booted) return setTimeout(tell, 1000); const now = Date.now(), wait = Math.max(1500, laterFree - now); laterFree = now + wait + ms; setTimeout(() => cond() && toast(msg, ms), wait); };
  tell();
}
// no aircraft feed answers here (layers.js names them "download version" / "needs the local helper"): one line, once,
// and the header's AIR and MIL give way to SAT and QK on phones (globe.html: body.no-air)
function noAir() {
  if (Air.offSite) return; Air.offSite = true; document.body.classList.add('no-air'); updateStats();
  later(ON_SITE ? 'No live aircraft on the website: they come with the free download' : 'No live aircraft here: they need the local helper (serve.js or serve.py, on localhost)', 6000, () => L.air.on || L.mil.on);
}
// a plane being watched for its landing (landwatch.js) or followed keeps its feeds running in a hidden tab (trails.js too)
const airKeep = () => LandWatch.map.size > 0 || Follow.obj?.kind === 'air';
hooks.airKeep = airKeep;

// boot: a mostly sunlit Earth, held behind the boot screen until the globe has something to show. Behind that screen the
// camera first dips to 600 km for a moment: below ~800 km Cesium switches on fog and atmosphere in the globe's and the
// models' shaders, so those versions compile now instead of freezing the first zoom down (2.3 s of compiles measured).
// Every model type is drawn once at both heights (warm.js); model options must match aircraft.js / satellites.js where
// they change the shader (the satellites' shadow CustomShader does, sizes don't).
const AIR_WARM = ['airliner', 'prop', 'heli', 'fighter', 'heavy', 'tprop'].flatMap(t => ['civ', 'mil'].map(k => ({ uri: `brand/models/aircraft/${t}_${k}.glb` })));
const SAT_WARM = (PHONE ? ['starlink', 'smallsat'] : ['starlink', 'smallsat', 'rocketbody', 'gnss', 'geo', 'weather', 'soyuz', 'hubble', 'iss', 'css'])
  .flatMap(t => [{ uri: `brand/models/${t}.glb`, runAnimations: false }, { uri: `brand/models/${t}.glb`, runAnimations: false, customShader: SHADOW_FILL }]);
updateBand(); applyVisibility();
(async () => {
  const [lon, lat] = sunlitView(), t0 = Date.now();
  const until = (ms, cond = () => false) => new Promise(res => { const id = setInterval(() => { if (cond() || Date.now() - t0 > ms) { clearInterval(id); res(); } }, 100); });
  const say = t => { const el = $('#boot div'); if (el) el.textContent = t; $('#boot')?.classList.remove('fail'); };   // a slow boot the watchdog spoke too soon about
  let high;
  if (PHONE) {   // phones: a fast first view matters more; the models warm up in the background, from orbit only
    camera.setView({ destination: C.Cartesian3.fromDegrees(lon, lat, 2.0e7) }); say('Loading the Earth…');
    // the cloud and glint shells compile on their first draw (half a second on a phone): let that happen behind the
    // boot screen; the models then warm one by one once the globe is showing
    await until(9000, () => Fx.ok && globe.tilesLoaded && !!scene.skyBox);   // + the star cube map (its upload was a 0.5 s hitch)
    high = new Promise(res => setTimeout(() => res(warmSlowly([...AIR_WARM, ...SAT_WARM])), 6000));
  } else {
    say('Preparing the 3D models…');
    camera.setView({ destination: C.Cartesian3.fromDegrees(lon, lat, 6.0e5) });
    await Promise.race([Promise.all([warmModels([...AIR_WARM, ...SAT_WARM]), until(4000, () => globe.tilesLoaded)]), until(5000)]);
    camera.setView({ destination: C.Cartesian3.fromDegrees(lon, lat, 2.0e7) });
    say('Loading the Earth…');
    high = warmAgain();
  }
  await until(10000, () => globe.tilesLoaded);
  $('#boot').classList.add('out'); setTimeout(() => $('#boot').remove(), 900);
  updateBand(); Share.booted = true;
  const linked = Director.restore() ? null : Share.restore().catch(e => console.warn('share link', e)); if (!EMBED) Tonight.peek().catch(e => console.warn('tonight', e));
  if (EMBED) $('#embedOut').href = Share.link();   // the way out keeps the view
  if (EMBED && window.parent !== window) Promise.resolve(linked).finally(() => window.parent.postMessage({ type: 'oo:ready' }, '*'));   // the page framing this one (the MCP panel) can lift its veil
  return high;
})();
// a new hash in the open page (a link pasted into the same tab, or the page framing this one moving it): go there
addEventListener('hashchange', () => {
  if (!Share.booted || Director.restore()) return;
  Share.restore({ fly: true }).catch(e => console.warn('share link', e)).finally(() => { if (EMBED) $('#embedOut').href = Share.link(); });
});
Sats.ready = Sats.load().catch(e => toast('Satellites failed: ' + e.message));   // Tonight waits for every group, not just the first
// load the Solar System view in the background once the globe has settled, so zooming out never waits on it (its
// start-up was 6 s of main-thread work on a phone, landing in the middle of the pinch); phones a little later
{ // ...and on phones only while nobody is touching it (the work would otherwise land in the middle of a gesture)
  let lastInput = performance.now();
  for (const ev of ['pointerdown', 'pointermove', 'wheel']) addEventListener(ev, () => { lastInput = performance.now(); window.OO_inputAt = Date.now(); }, { passive: true, capture: true });   // OO_inputAt: read by the preloaded Solar System view
  const t0 = performance.now(), wait = setInterval(() => {
    const now = performance.now();
    if (now - t0 < (PHONE ? 15e3 : 10e3) || (PHONE && now - lastInput < 3000)) return;
    clearInterval(wait); (window.requestIdleCallback || setTimeout)(() => Space.preload());
    setTimeout(function warm() { if (PHONE && performance.now() - lastInput < 3000) return setTimeout(warm, 2000); Weather.prewarm(); }, 6000);   // weather's first open would otherwise freeze the globe ~0.6 s
  }, 1000);
}
every(AIR_TTL.point * 1000, () => Air.civil(), 'Civil aircraft', { keep: airKeep, onStop: noAir });   // OpenSky every 15 min with the helper, adsb.lol near the camera where the website's relay carries it
every(60e3, () => Air.military(), 'Military aircraft', { keep: airKeep, onStop: noAir });
every(10 * 60e3, () => Quakes.load(), 'Earthquakes');
every(30 * 60e3, () => Storms.load(), 'Tropical cyclones');
setInterval(() => Aurora.apply(), 60e3);   // refreshes itself every 10 minutes while the layer is on
setInterval(() => { if (L.events.on && !Events.past) Events.load(); }, 30 * 60e3);
// time travel: the layers with history follow the clock into the past (their archives) and back (core/history.js)
{ const travel = () => { Quakes.sync(); Storms.sync(); Events.sync(); Sats.travel(); }; Time.onChange(travel); setInterval(travel, 1000); }

window.OO3D = { LightMap, Now, Events, TimeTravel, Aviation, Ops, Voice, Photoreal, Storms, Directions, Ascent, Director, Surveil, Alpr, Military, Radio, Cams, Look, Transit, Traffic, Terrain, Fires, Imagery, Measure, Ships, Bikes, Saver, Model, Conj, Reentry, LookUp, Eclipses, Tonight, Flight, Snapshot, Search, Launches, Crew,
  viewer, space: Space, time: Time, Earth, marbleLayer, nightLayer, fxShell, cloudShell, limbShell, Fx, Sats, Air, Quakes, Lighthouses, Weather, Wind, Country, Aurora, Flybys, Companies, Volcanoes, Buoys, Darts, Tides, SeaImagery, AirQuality, SunLine, Buildings, Share, Tour, setIonToken: t => Buildings.setToken(t), L, PRESETS, moonPosition, SatModels, AirModels, Follow, select, applyVisibility,
  /** debug: the axes test model at lon/lat/height, body X = east, Y = north, Z = up, arrays turned by `deg` */
  debugAxes(lon, lat, h, deg = 0, uri = 'brand/models/test/axes.glb') {
    const pos = C.Cartesian3.fromDegrees(lon, lat, h), R = C.Matrix4.getMatrix3(C.Transforms.eastNorthUpToFixedFrame(pos), new C.Matrix3());
    const q = C.Quaternion.multiply(C.Quaternion.fromRotationMatrix(R), MODEL_FIX, new C.Quaternion());
    return viewer.entities.add({ position: pos, orientation: q, model: { uri, minimumPixelSize: 0, nodeTransformations: { solar_1: { rotation: C.Quaternion.fromAxisAngle(SOLAR_AXIS, C.Math.toRadians(deg)) } } } });
  },
};
