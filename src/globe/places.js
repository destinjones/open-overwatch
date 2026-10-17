// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Places by name: cities, landmarks, airports, addresses. Photon (komoot), a free geocoder over OpenStreetMap data with
// no key and CORS. Only the words typed (or said) are sent, never the camera position. Used by Search and voice.
import { C } from './env.js';
import { camera } from './viewer.js';
import { release } from './follow.js';
// the search itself is in geocode.js (no Cesium: tonight.html uses it too)
export { findPlaces, setGeocoder, placesCredit } from './geocode.js';

/** Fly to a place: a country or region by its outline, anything smaller at a height that suits it, tilted. */
export function flyToPlace(pl) {
  release();
  const big = { country: 2.6e6, state: 9.0e5, county: 2.5e5, region: 9.0e5, city: 2.6e4, town: 1.2e4, village: 6.0e3, island: 6.0e4, aerodrome: 6.0e3, airport: 6.0e3 }[pl.type];
  const wide = pl.extent && Math.max(Math.abs(pl.extent[2] - pl.extent[0]), Math.abs(pl.extent[1] - pl.extent[3])) > 0.6;   // ~60 km: a region, not a building
  if (pl.extent && (pl.type === 'country' || pl.type === 'state' || pl.type === 'region' || (!pl.type && wide))) {
    const [w, n, e, s] = pl.extent;
    camera.flyTo({ destination: C.Rectangle.fromDegrees(w, s, e, n), duration: 3 }); return;
  }
  const h = big || 2500, back = h / Math.tan(C.Math.toRadians(42)) / 111000;   // stand off to the south so a 42-degree tilt looks at it
  camera.flyTo({ destination: C.Cartesian3.fromDegrees(pl.lon, pl.lat - back, h), orientation: { heading: 0, pitch: C.Math.toRadians(-42), roll: 0 }, duration: 3 });
}
