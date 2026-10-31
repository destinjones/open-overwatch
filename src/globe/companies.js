// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The world's big employers as towers at their headquarters: height and glow follow the number of people employed, colour follows
// the industry. ~1,000 companies from Wikidata (CC0, data/companies.json, made by brand/tools/make_companies.py): Wikidata is
// edited by volunteers, so figures can be wrong, and market value is deliberately not shown (its values there are stale and
// in mixed currencies). Visible below ~40,000 km; the data loads when the layer is first on.
import { C } from './env.js';
import { scene } from './viewer.js';
import { L, setCount } from './layers.js';
import { state } from './state.js';
import { fetchAsset } from '../core/assets.js';
import { settled } from './state.js';
import { sliced } from '../core/slices.js';

const dots = scene.primitives.add(new C.PointPrimitiveCollection());
let towers = null;   // ONE batched primitive for all the shafts: 1,000 PolylineCollection lines cost a tenth of every frame
export const GROUPS = [
  ['Energy', '#ff7b4f', /oil|petrol|gas|energy|electric|power|coal|mining|utilit/i], ['Finance', '#ffd45c', /bank|financ|insur|invest|payment|credit/i],
  ['Retail & food', '#ff8fd0', /retail|supermarket|food|restaurant|beverage|tobacco|coffee|grocery|consumer|fashion|apparel/i],
  ['Technology', '#5fd3ff', /software|computer|semiconductor|electronic|internet|information tech|IT service|technology|e-commerce|cloud/i],
  ['Industry & vehicles', '#b48cff', /auto|vehicle|aerospace|aviation|steel|machin|manufactur|defen|ship|construction|engineering|metal/i],
  ['Transport & mail', '#7dffa6', /rail|logistic|transport|mail|postal|airline|shipping|delivery|freight/i], ['Health & chemicals', '#62e0c8', /pharma|health|medic|chemical|biotech/i],
  ['Telecom & media', '#8fb8ff', /telecom|media|broadcast|publish|entertainment|film/i],
];
export const groupOf = ind => GROUPS.find(g => g[2].test(ind || '')) || ['Other', '#cfd8e3'];

export const Companies = {
  list: [], loading: null,
  load() {
    if (!this.loading) this.loading = settled.wait().then(() => fetchAsset('data/companies.json', 'json')).then(async d => {   // after the first picture, in slices
      const ix = Object.fromEntries(d.cols.map((c, i) => [c, i])); this.credit = d.source; const shafts = [], ddc = new C.DistanceDisplayCondition(0, 4.0e7), paint = new Map();
      await sliced(d.rows, r => {
        const o = { kind: 'company', name: r[ix.name], lat: r[ix.lat], lon: r[ix.lon], country: r[ix.country], industry: r[ix.industry], employees: r[ix.employees], founded: r[ix.founded], exchange: r[ix.exchange], wiki: r[ix.wiki] };
        const [grp, hex] = groupOf(o.industry); o.group = grp; o.color = hex;
        if (!paint.has(hex)) { const c = C.Color.fromCssColorString(hex); paint.set(hex, [c, c.withAlpha(0.15), c.withAlpha(0.95), c.withAlpha(0.35)]); }
        const [col, foot, top, rim] = paint.get(hex), h = 140000 * Math.sqrt(o.employees / 1e5);
        const p0 = C.Cartesian3.fromDegrees(o.lon, o.lat, 0), p1 = C.Cartesian3.fromDegrees(o.lon, o.lat, h);
        shafts.push(new C.GeometryInstance({ geometry: new C.PolylineGeometry({ positions: [p0, p1], width: 3, vertexFormat: C.PolylineColorAppearance.VERTEX_FORMAT, colors: [foot, top], colorsPerVertex: true }),
          attributes: { distanceDisplayCondition: new C.DistanceDisplayConditionGeometryInstanceAttribute(0, 4.0e7) } }));
        o.pt = dots.add({ position: p1, pixelSize: 7, color: col, outlineColor: rim, outlineWidth: 5, distanceDisplayCondition: ddc, show: L.companies.on, id: o });
        this.list.push(o);
      });
      towers = scene.primitives.add(new C.Primitive({ geometryInstances: shafts, appearance: new C.PolylineColorAppearance({ translucent: true }), show: L.companies.on && !state.lookup }));
      setCount('companies', this.list.length);
    }).catch(e => { this.loading = null; console.warn('companies', e); });
    return this.loading;
  },
  apply() { const on = L.companies.on; dots.show = on; if (towers) towers.show = on; if (on && !this.loading) this.load(); scene.requestRender(); },
  top(inPoly, n = 6) { return this.list.filter(inPoly).sort((a, b) => b.employees - a.employees).slice(0, n); },
};
