// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The globe's layer switches (remembered per browser) and the dock that shows them.
import { $, esc, fmt, store, PHONE } from './env.js';
import { hooks } from './state.js';

export const LAYERS = [
  { id: 'stations', group: 'Space', name: 'Space stations', color: '#7dffa6', on: true, sat: ['stations'], size: 7 },
  { id: 'visual', group: 'Space', name: 'Bright satellites', color: '#e6edf3', on: true, sat: ['visual'], size: 3.5 },
  { id: 'gnss', group: 'Space', name: 'Navigation (GPS · Galileo · GLONASS · BeiDou)', color: '#ffd45c', on: true, sat: ['gps-ops', 'galileo', 'glo-ops', 'beidou'], size: 4 },
  { id: 'geo', group: 'Space', name: 'Geostationary belt', color: '#b48cff', on: true, sat: ['geo'], size: 3.5 },
  { id: 'weather', group: 'Space', name: 'Weather satellites', color: '#62e0c8', on: true, sat: ['weather'], size: 4 },
  // Off by default on phones (~8,000 dots, the most of any layer): one tap shows them. The hint is for the dock line only;
  // the name stays a plain label (the satellite card, search and the export list use it)
  { id: 'starlink', group: 'Space', name: 'Starlink', hint: PHONE ? '~8,000 dots: off by default on phones' : '', color: '#d9ccff', on: !PHONE, sat: ['starlink'], size: 1.6, alpha: 0.55 },
  // last, so the groups above keep their own objects: every other active satellite CelesTrak lists, then the debris
  // clouds of the 2007 Fengyun-1C test and the 2009 Iridium 33 / Cosmos 2251 collision. (The full catalogue, with every
  // rocket body and fragment, is Space-Track's and may not be redistributed.) Off by default on phones: ~5,000 more dots.
  { id: 'active', group: 'Space', name: 'All other active satellites', color: '#8fb8ff', on: !PHONE, sat: ['active'], size: 2, alpha: 0.75 },
  { id: 'debris', group: 'Space', name: 'Debris (Fengyun-1C, Iridium 33, Cosmos 2251)', color: '#ff6b6b', on: !PHONE, sat: ['fengyun-1c-debris', 'iridium-33-debris', 'cosmos-2251-debris'], size: 1.8, alpha: 0.8 },
  { id: 'launches', group: 'Space', name: 'Rocket launches (next 40, pads)', color: '#ff9f5c', on: true },
  { id: 'reentry', group: 'Space', name: 'Re-entry corridors: falling in the next 30 days (predicted here)', color: '#ff5a4f', on: false },
  { id: 'air', group: 'Air', name: 'Civil aircraft (OpenSky, every 15 min)', color: '#5fd3ff', on: true },
  { id: 'mil', group: 'Air', name: 'Military aircraft (adsb.lol, every 60 s)', color: '#ffb44d', on: true },
  { id: 'airq', group: 'Air', name: 'Air quality: PM2.5 and AQI, modelled (CAMS via Open-Meteo)', color: '#ffe066', on: false },
  { id: 'smoke', group: 'Air', name: 'Smoke and dust from space (NASA OMPS aerosol index, daily)', color: '#c9a07a', on: false },
  { id: 'airports', group: 'Air', name: 'Airports and their arrivals and departures (OurAirports)', color: '#9fe3ff', on: !PHONE },
  { id: 'quakes', group: 'Earth', name: 'Earthquakes M2.5+ · 24 h', color: '#ff7b4f', on: true },
  { id: 'transit', group: 'Earth', name: 'Live transit (Boston · Helsinki · Norway · Austin · Minneapolis)', color: '#3ee08f', on: false },
  { id: 'buoys', group: 'Earth', name: 'Ocean buoys: waves, wind, water temperature (NOAA NDBC, live)', color: '#62e0c8', on: false },
  { id: 'dart', group: 'Earth', name: 'Tsunami buoys on the sea floor (NOAA DART)', color: '#ffd45c', on: false },
  { id: 'tides', group: 'Earth', name: 'Tide gauges: water level, next high and low (NOAA, US)', color: '#5fd3ff', on: false },
  { id: 'sst', group: 'Earth', name: 'Sea-surface temperature (NASA GHRSST, daily)', color: '#ff9f5c', on: false },
  { id: 'ships', group: 'Earth', name: 'Ships: live AIS, northern Baltic (Fintraffic)', color: '#5fb0ff', on: false },
  { id: 'bikes', group: 'Earth', name: 'Bike share: stations and free bikes, worldwide (CityBikes)', color: '#7dffb0', on: false },
  { id: 'traffic', group: 'Earth', name: 'Traffic: simulated cars on real roads (measured speeds: New York · Finland)', color: '#f5c26b', on: false },
  { id: 'storms', group: 'Earth', name: 'Tropical cyclones and forecast cones (NOAA NHC · GDACS · NASA EONET)', color: '#7fd0ff', on: true },
  { id: 'events', group: 'Earth', name: 'Natural events: eruptions, fires, floods, ice (NASA EONET; 20 days, or the time shown)', color: '#ffb36b', on: false },
  { id: 'fires', group: 'Earth', name: 'Wildfires: satellite hot spots (NASA VIIRS, 24 h) and US perimeters (NIFC)', color: '#ff7a2f', on: false },
  { id: 'radio', group: 'Earth', name: 'World radio (radio-browser.info)', color: '#ff6fd8', on: false },
  { id: 'lighthouses', group: 'Earth', name: 'Lighthouses of the world', color: '#ffe27a', on: !PHONE },
  { id: 'sun', group: 'Earth', name: 'Sun overhead and time zones', color: '#ffd45c', on: false },
  { id: 'terrain', group: 'Earth', name: '3D terrain: mountains and valleys (Mapterhorn via Re:Earth, no key)', color: '#c9b38f', on: !PHONE },
  { id: 'buildings', group: 'Earth', name: '3D buildings with mapped heights (OpenStreetMap, close up)', color: '#c9d3e0', on: false },
  { id: 'cams', group: 'Earth', name: 'Live traffic cameras and video, projected into 3D (12 regions: US, Canada, Europe, Asia)', color: '#ff6fb5', on: false },
  { id: 'cctv', group: 'Earth', name: 'Mapped cameras and plate readers (OpenStreetMap, close up)', color: '#c9a0ff', on: false },
  { id: 'alpr', group: 'Earth', name: 'Licence-plate readers: US and Canada (OpenStreetMap via DeFlock, hourly)', color: '#ff4d5e', on: false },
  { id: 'milareas', group: 'Earth', name: 'Military areas (OpenStreetMap, outlined)', color: '#ff6b5e', on: false },
  { id: 'photoreal', group: 'Earth', name: 'Photoreal 3D cities (Google, with your free Cesium ion token)', color: '#9fe3ff', on: false },
  { id: 'volcanoes', group: 'Earth', name: 'Volcanoes of the world (Wikidata)', color: '#ff5a36', on: !PHONE },
  { id: 'companies', group: 'Earth', name: 'Big employers as towers (Wikidata)', color: '#ff9f5c', on: !PHONE },
  { id: 'lightpollution', group: 'Earth', name: 'Light pollution: how bright the night sky is (Falchi et al. 2016, CC BY-NC)', color: '#ffd45c', on: false },
  { id: 'aurora', group: 'Earth', name: 'Aurora forecast (NOAA, live)', color: '#7dffb0', on: !PHONE },
  { id: 'clouds', group: 'Earth', name: 'Clouds (NASA Blue Marble)', color: '#e6edf3', on: true },
  { id: 'night', group: 'Earth', name: 'City lights on the night side', color: '#fff1d0', on: true },
  { id: 'labels', group: 'Earth', name: 'Place names when close', color: '#8b9bab', on: true },
];
export const L = Object.fromEntries(LAYERS.map(l => [l.id, l]));
for (const l of LAYERS) l.on = store.get('ly.' + l.id, l.on);

/** Make the dock's switches match the layers' state (after something else changed them). */
export function syncDock() { for (const l of LAYERS) { const b = document.querySelector(`[data-ly="${l.id}"]`); if (b) b.classList.toggle('off', !l.on); } }
export function setCount(id, n) { const el = $('#n-' + id); if (el) el.textContent = n ? fmt(n) : ''; }

/** bases: { id: { name } }, currentBase(): id, onBase(id); saver: { on(), set(on) } (the battery saver) */
export function initDock({ bases, currentBase, onBase, quality, saver }) {
  const counts = {};
  function render() {
    for (const l of LAYERS) { const el = $('#n-' + l.id); if (el) counts[l.id] = el.textContent; }
    let html = '', g = '';
    for (const l of LAYERS) {
      if (l.group !== g) { html += (g ? '<div class="sep"></div>' : '') + `<h3>${esc(l.group)}</h3>`; g = l.group; }
      html += `<button class="ly ${l.on ? '' : 'off'}" data-ly="${l.id}" style="--c:${l.color}"><i></i><span class="t">${esc(l.name)}${l.hint ? ` <small>(${esc(l.hint)})</small>` : ''}</span><span class="n" id="n-${l.id}">${esc(counts[l.id] || '')}</span></button>`;
    }
    html += '<div class="sep"></div><h3>Base map</h3>' + Object.entries(bases).map(([id, b]) => `<button class="ly ${currentBase() === id ? '' : 'off'}" data-base="${id}" style="--c:#e6edf3"><i></i><span class="t">${esc(b.name)}</span></button>`).join('');
    if (quality) {
      const auto = quality.chosen() === 'auto';
      html += '<div class="sep"></div><h3>Graphics</h3>' + [['auto', `Auto (${quality.levels[quality.current()].name.toLowerCase()})`], ...Object.entries(quality.levels).map(([id, q]) => [id, q.name])]
        .map(([id, name]) => `<button class="ly ${(auto ? id === 'auto' : id === quality.chosen()) ? '' : 'off'}" data-q="${id}" style="--c:#e6edf3"><i></i><span class="t">${esc(name)}</span></button>`).join('');
    }
    if (saver) html += `<button class="ly ${saver.on() ? '' : 'off'}" data-saver="1" style="--c:#7dffa6"><i></i><span class="t">Battery saver: fewer frames while nothing moves</span></button>`;
    html += '<div class="sep"></div><button class="ly" data-nerd="1" style="--c:#ffd27a"><i></i><span class="t">Under the hood: speed, data age, accuracy</span></button>';
    html += '<div class="sep"></div><div id="dockExport"></div>';   // exportview.js: save a live layer's items in view, with provenance
    html += '<p class="note">Drag to orbit, scroll to zoom, right-drag to tilt. Click anything for details.</p>';
    $('#dock').innerHTML = html;
    hooks.renderExport?.($('#dockExport'));
  }
  render();
  $('#dock').addEventListener('click', e => {
    const b = e.target.closest('[data-ly]'), base = e.target.closest('[data-base]'), q = e.target.closest('[data-q]');
    if (base) { onBase(base.dataset.base); render(); return; }
    if (q) { quality.choose(q.dataset.q); render(); return; }
    if (e.target.closest('[data-saver]')) { saver.set(!saver.on()); render(); return; }
    if (e.target.closest('[data-nerd]')) { hooks.toggleNerd?.(); return; }
    if (!b) return;
    const l = L[b.dataset.ly]; l.on = !l.on; store.set('ly.' + l.id, l.on); b.classList.toggle('off', !l.on); hooks.applyVisibility();
  });
  $('#btnDock').addEventListener('click', () => $('#dock').classList.toggle('open'));
}
