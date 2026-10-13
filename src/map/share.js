// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Share links for the 2D map, in the globe's format (core/viewlink.js): #c=lon,lat,height,0,-90 &l=layers &d=drawing.
// The map's zoom and the globe's camera height convert both ways, so a link opens the same area in either view; the
// drawing (measure.js) goes in as its points. A link made on the globe opens here too: its layers that have a 2D
// counterpart are switched on, the others left as they are. "3D globe" opens the globe on this view.
import { $, toast, Store } from './util.js';
import { map } from './mapview.js';
import { Layers } from './engine.js';
import { Measure } from './measure.js';
import { late } from './util.js';
import { encodeView, decodeView, zoomToHeight, heightToZoom, globeLayersFor, mapLayersFor, weatherFor, mapWeatherFor } from '../core/viewlink.js';

const wrap = lon => ((lon + 540) % 360) - 180;
const onIds = () => Layers.defs.filter(d => d.on).map(d => d.id);
const wxModel = () => Store.get('wx.model', 'gfs');   // the forecast layers' model (weather.js)
export const Share = {
  /** This view as a hash (layers: the 2D map's own ids, exactly). */
  hash() {
    const c = map.getCenter();
    return encodeView({ lon: wrap(c.lng), lat: c.lat, height: zoomToHeight(map.getZoom(), c.lat), heading: 0, pitch: -90, layers: onIds(), weather: weatherFor(onIds(), wxModel()), drawing: Measure.exportShapes() });
  },
  link() { return location.origin + location.pathname + '#' + this.hash(); },
  /** The same view on the globe: its matching layers switched on, weather mode with the forecast layers, the drawing carried. */
  globeLink() {
    const c = map.getCenter();
    return 'globe.html#' + encodeView({ lon: wrap(c.lng), lat: c.lat, height: zoomToHeight(map.getZoom(), c.lat), heading: 0, pitch: -90, add: globeLayersFor(onIds()), weather: weatherFor(onIds(), wxModel()), drawing: Measure.exportShapes() });
  },
  async copy() {
    const url = this.link(), n = Measure.exportShapes().length, carried = /[#&]d=/.test(url);
    try { await navigator.clipboard.writeText(url); toast(n ? (carried ? `Link copied, with the drawing (${n} shape${n === 1 ? '' : 's'})` : 'Link copied without the drawing: too many points for a link (GeoJSON keeps them all)') : 'Link to this view copied'); }
    catch (e) { prompt('Copy this link:', url); }
  },
  /** Apply a link's hash; true if there was one. Nothing in it is trusted (decodeView checks every part). */
  restore() {
    const v = decodeView(location.hash); if (!v) return false;
    map.setView([v.lat, v.lon], heightToZoom(v.height, v.lat), { animate: false });
    const known = id => !!Layers.byId[id];
    if (v.layers && v.layers.length && v.layers.every(known)) Layers.apply(v.layers);   // a 2D link: exactly its layers
    else if (v.layers) for (const id of mapLayersFor(v.layers)) Layers.set(id, true, { silent: true });   // a globe link: the counterparts, added
    for (const id of v.add ? [...v.add.filter(known), ...mapLayersFor(v.add)] : []) Layers.set(id, true, { silent: true });
    for (const id of v.drop ? v.drop.filter(known) : []) Layers.set(id, false, { silent: true });
    if (v.weather) { const w = mapWeatherFor(v.weather); late.Wx?.setModel(w.model); for (const id of w.layers) Layers.set(id, true, { silent: true }); }   // the globe's weather mode: its forecast fields
    if (v.drawing) Measure.importShapes(v.drawing).then(() => { if (Measure.shapes.length) { Measure.open(); toast(`A shared drawing: ${Measure.shapes.length} shape${Measure.shapes.length === 1 ? '' : 's'}`); } });
    history.replaceState(null, '', location.pathname + location.search);   // the map keeps its own view from here on
    return true;
  },
};
// the rail's "3D globe" button opens the globe where the map is
const g = $('#btnGlobe'); if (g) g.addEventListener('click', e => { if (e.button || e.metaKey || e.ctrlKey || e.shiftKey) { g.href = Share.globeLink(); return; } e.preventDefault(); location.href = Share.globeLink(); });
// a middle-click fires auxclick, not click, and "open in new tab" reads the address on the context menu
if (g) for (const ev of ['auxclick', 'contextmenu']) g.addEventListener(ev, () => { g.href = Share.globeLink(); });
const s = $('#btnShare'); if (s) s.addEventListener('click', () => Share.copy());
window.addEventListener('hashchange', () => Share.restore());
late.Share = Share;
