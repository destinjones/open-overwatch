// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The Leaflet map and its base maps (incl. dated NASA GIBS imagery). The Sun and the day/night line: core/sky.js.
import { $, Store, debounce } from './util.js';

/* ============================================================ map */
export const savedView = (v => v && [v.lat, v.lon, v.z].every(Number.isFinite) && Math.abs(v.lat) <= 85 ? v : { lat: 34, lon: -20, z: 3 })(Store.get('view', null));
export const map = L.map('map', { zoomControl: true, worldCopyJump: true, preferCanvas: true, minZoom: 2, maxZoom: 19, zoomSnap: 0.5, wheelPxPerZoomLevel: 90 })
  .setView([savedView.lat, savedView.lon], savedView.z);
L.control.scale({ imperial: true, metric: true, position: 'bottomleft' }).addTo(map);
// reduced motion: the map jumps where it would fly or glide (Center, search, the Brief, Follow, Follow ISS all come through here)
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
map.flyTo = function (c, z, o) { return REDUCED.matches ? this.setView(c, z, { animate: false }) : L.Map.prototype.flyTo.call(this, c, z, o); };
map.panTo = function (c, o) { return L.Map.prototype.panTo.call(this, c, REDUCED.matches ? { ...o, animate: false } : o); };
map.panBy = function (off, o) { return L.Map.prototype.panBy.call(this, off, REDUCED.matches ? { ...o, animate: false } : o); };
map.on('moveend', debounce(() => { const c = map.getCenter(); Store.set('view', { lat: c.lat, lon: c.lng, z: map.getZoom() }); }, 400));
export const vecRenderer = L.canvas({ padding: 0.3 });

export const gibsDate = () => new Date(Date.now() - 36 * 3600e3).toISOString().slice(0, 10); // newest complete GIBS day
export let imgDate = gibsDate();
export const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
// Esri's attribution rules: "Powered by Esri" plus each service's own copyrightText; OpenStreetMap's credit links to
// its licence page (the OSMF attribution guidelines and the tile.openstreetmap.org usage policy ask for that)
const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
const POWERED = 'Powered by <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>';
const ESRI_REF = `${POWERED} · Esri, HERE, Garmin, ${OSM}, and the GIS User Community`;
export const gibsBasemaps = d => ({ // dated NASA layers; rebuilt when the day rolls over (see below) so a long-open tab stays current
  viirs: { name: `NASA VIIRS true color · ${d}`, layers: [[`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${d}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`, { maxNativeZoom: 9, maxZoom: 13, attribution: 'NASA GIBS / Worldview (VIIRS SNPP)' }], [ESRI + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 13, opacity: .7, attribution: ESRI_REF }]] },
  night: { name: `NASA night lights · ${d}`, layers: [[`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_DayNightBand_At_Sensor_Radiance/default/${d}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`, { maxNativeZoom: 8, maxZoom: 13, attribution: 'NASA GIBS / Worldview (VIIRS DNB)' }], [ESRI + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 13, opacity: .6, attribution: ESRI_REF }]] },
});
export const BASEMAPS = { // no API keys anywhere (CARTO's free tiles started demanding one)
  esridark: { name: 'Dark gray (Esri)', layers: [[ESRI + 'Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 16, maxZoom: 19, attribution: ESRI_REF }], [ESRI + 'Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 16, maxZoom: 19, opacity: .8, attribution: ESRI_REF }]] },
  osmdark: { name: 'Dark streets (OSM, inverted)', layers: [['https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'tiles-invert', attribution: OSM }]] },
  sat: { name: 'Satellite imagery (Esri)', layers: [[ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: `${POWERED} · Imagery: Esri, Vantor, Earthstar Geographics, and the GIS User Community` }], [ESRI + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, opacity: .85, attribution: `Labels: Esri, HERE, Garmin, ${OSM}, and the GIS User Community` }]] },
  osm: { name: 'Streets (OpenStreetMap)', layers: [['https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: OSM }]] },
  topo: { name: 'Terrain (OpenTopoMap)', layers: [['https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { subdomains: 'abc', maxZoom: 17, attribution: `Map data ${OSM}, SRTM · Map style <a href="https://opentopomap.org/" target="_blank" rel="noopener">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener">CC-BY-SA</a>)` }]] },
  esritopo: { name: 'Topographic (Esri)', layers: [[ESRI + 'World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: `${POWERED} · Esri, HERE, Garmin, USGS, NGA, ${OSM}, and the GIS User Community` }]] },
  ...gibsBasemaps(imgDate),
};
export let baseLayer = null;
export function setBasemap(id) {
  const b = BASEMAPS[id] || BASEMAPS.esridark; if (!BASEMAPS[id]) id = 'esridark';
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = L.layerGroup(b.layers.map(([url, o], i) => L.tileLayer(url, { ...o, crossOrigin: false, detectRetina: false, zIndex: i, updateWhenIdle: true, keepBuffer: 3 }))).addTo(map);
  Store.set('basemap', id); $('#basemap').value = id;
}
(function initBasemapSelect() { const s = $('#basemap'); for (const [id, b] of Object.entries(BASEMAPS)) { const o = document.createElement('option'); o.value = id; o.textContent = b.name; s.appendChild(o); } s.addEventListener('change', () => setBasemap(s.value)); setBasemap(Store.get('basemap', 'esridark')); })();
setInterval(() => { // day rollover: re-date the NASA layers, their menu labels and, if one is showing, the tiles
  const d = gibsDate(); if (d === imgDate) return; imgDate = d; Object.assign(BASEMAPS, gibsBasemaps(d));
  for (const o of $('#basemap').options) if (BASEMAPS[o.value]) o.textContent = BASEMAPS[o.value].name;
  if (['viirs', 'night'].includes($('#basemap').value)) setBasemap($('#basemap').value);
}, 3600e3);
