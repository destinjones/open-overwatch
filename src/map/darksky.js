// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Light pollution on the 2D map, as on the globe: the 2015 World Atlas of artificial sky brightness (Falchi et al. 2016,
// CC BY-NC 4.0, non-commercial; data/lightpollution.bin, 1/15°) drawn here tile by tile in Web Mercator, coloured by
// Bortle class and clear where the sky is dark (core/darksky.js paintTile). Off by default; the 1.7 MB grid loads the first
// time the layer is switched on.
import { Net } from './util.js';
import { map } from './mapview.js';
import { Layers, feed } from './engine.js';
import { decodeAtlas } from '../core/lightpollution.js';
import { overlayTable, paintTile, ATLAS_SHORT, ATLAS_URL } from '../core/darksky.js';

let grid = null, table = null, tiles = null;
const LightTiles = L.GridLayer.extend({
  createTile(c) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    if (grid) { const cx = cv.getContext('2d'), img = cx.createImageData(256, 256); img.data.set(paintTile(grid, c.z, c.x, c.y, 256, table)); cx.putImageData(img, 0, 0); }
    return cv;
  },
});

export const lyLight = Layers.add({ id: 'lightpollution', group: 'Sea & sky', name: 'Light pollution', desc: `How bright the night sky is, by Bortle class: blue 3, green 4, yellow 5, orange 6, red 7, pink and white 8-9 (city centres); clear where it is dark · World Atlas 2015 (${ATLAS_SHORT}, non-commercial) · drawn here`, color: '#ffd45c', default: false });
lyLight.enable = () => { if (tiles) tiles.addTo(map); };
lyLight.disable = () => { if (tiles) map.removeLayer(tiles); };
feed(lyLight, { interval: 86400, fetch: async () => {
  if (!grid) { grid = await decodeAtlas(await Net.bytes('data/lightpollution.bin', { timeout: 90000 })); table = overlayTable(grid); }
  if (!tiles) tiles = new LightTiles({ opacity: 0.75, maxNativeZoom: 9, maxZoom: 19, tileSize: 256, keepBuffer: 1, updateWhenZooming: false, className: 'lightpollution-ov',
    attribution: `Light pollution: <a href="${ATLAS_URL}" target="_blank" rel="noopener">Falchi et al. 2016</a> (CC BY-NC)` });
  if (lyLight.on && !map.hasLayer(tiles)) tiles.addTo(map);
  lyLight.feed.count = 0;   // a picture, not a count of things
} });
