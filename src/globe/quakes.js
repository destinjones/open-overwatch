// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Earthquakes: USGS M2.5+ in the last 24 h (the feed sends CORS headers, so no relay; parsed by core/quakes.js, like the 2D map's).
import { C, getJSON } from './env.js';
import { qkPts } from './viewer.js';
import { L, setCount } from './layers.js';
import { hooks } from './state.js';
import { parseUsgs, usgsUrl } from '../core/quakes.js';

const COLOR = C.Color.fromCssColorString('#ff7b4f');
export const Quakes = {
  list: [],
  async load() {
    const list = parseUsgs(await getJSON(usgsUrl('2.5_day')));
    qkPts.removeAll(); this.list = list;
    for (const q of list) {
      q.kind = 'quake'; q.mag = q.mag ?? 0;
      q.pt = qkPts.add({ position: C.Cartesian3.fromDegrees(q.lon, q.lat, 0), pixelSize: 4 + q.mag * 2.2, color: COLOR.withAlpha(0.75), outlineColor: COLOR, outlineWidth: 1, id: q, show: L.quakes.on, disableDepthTestDistance: 0 });
    }
    setCount('quakes', list.length); hooks.updateStats();
  },
};
