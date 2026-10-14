// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Light pollution on the globe: the 2015 World Atlas of artificial sky brightness (Falchi et al. 2016, CC BY-NC 4.0,
// non-commercial; data/lightpollution.bin) painted here into one picture by Bortle class (clear where the sky is dark,
// blue, green, yellow, orange, red, then pink and white over city centres) and laid over the Earth. Off by default; the
// 1.7 MB grid loads the first time the layer is switched on and is shared with Tonight (darksky.js).
import { C, PHONE } from './env.js';
import { viewer } from './viewer.js';
import { L } from './layers.js';
import { DarkSky } from './darksky.js';
import { paintAtlas, ATLAS_CREDIT } from '../core/darksky.js';

export const LightMap = {
  layer: null, loading: false, failed: 0,
  async load() {
    if (this.loading || Date.now() - this.failed < 60e3) return; this.loading = true;
    try {
      const g = await DarkSky.atlas(), w = PHONE ? 1800 : 3600, h = Math.round(w * g.rows / g.cols);   // 1/10 or 1/5 degree: the brightest cell under each pixel
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const cx = cv.getContext('2d'), img = cx.createImageData(w, h); img.data.set(paintAtlas(g, w, h)); cx.putImageData(img, 0, 0);
      const south = g.lat0 - g.rows * g.step;
      const provider = await C.SingleTileImageryProvider.fromUrl(cv.toDataURL(), { rectangle: C.Rectangle.fromDegrees(g.lon0, south, g.lon0 + g.cols * g.step, g.lat0), credit: new C.Credit(ATLAS_CREDIT) });
      this.layer = viewer.imageryLayers.addImageryProvider(provider); this.layer.alpha = 0.85; this.apply();
    } catch (e) { console.warn('light pollution', e); this.failed = Date.now(); } finally { this.loading = false; }
  },
  apply() {
    if (this.layer) { this.layer.show = L.lightpollution.on; if (L.lightpollution.on) viewer.imageryLayers.raiseToTop(this.layer); viewer.scene.requestRender(); }
    else if (L.lightpollution.on) this.load();
  },
};
