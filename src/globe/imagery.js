// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Before and after: recent satellite pictures of the place in view, split by a slider. NASA's Harmonized Landsat
// Sentinel-2 (HLS: Landsat 8/9 and Sentinel-2, 30 m, a picture every few days where it is clear), found through NASA CMR
// for the point at the centre of the view, and NASA VIIRS (daily, 250-375 m) for the days in between; all drawn from NASA
// GIBS (keyless, CORS). The "before" picture shows left of the slider, the "after" one right of it.
import { C, $, esc, toast, getText } from './env.js';
import { viewer, scene, camera, camHeight } from './viewer.js';
import { state, hooks } from './state.js';
import { Earth } from './earth.js';
import { parseCmrCsv, imageryDates, pickPair, gibsTemplate, IMAGERY } from '../core/hazards.js';

const CMR = 'https://cmr.earthdata.nasa.gov/search/granules.csv?collection_concept_id=C2021957295-LPCLOUD&collection_concept_id=C2021957657-LPCLOUD&sort_key=-start_date&page_size=200';
const COLOR = '#9fe3ff', MAX_H = 2.5e6;
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const label = d => `${d.date} · ${IMAGERY[d.sensor].name}${d.cloud != null ? ` · ${Math.round(d.cloud)}% cloud` : ''}`;

function centre() {
  const p = camera.pickEllipsoid(new C.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2), C.Ellipsoid.WGS84) || camera.positionWC;
  const g = C.Cartographic.fromCartesian(p); return { lat: C.Math.toDegrees(g.latitude), lon: C.Math.toDegrees(g.longitude) };
}

// ---- the slider: a bar over the globe; dragging it moves scene.splitPosition
let bar = null;
function slider(on) {
  if (!on) { if (bar) bar.style.display = 'none'; return; }
  if (!bar) {
    bar = document.createElement('div'); bar.id = 'imgSplit';
    bar.innerHTML = '<div class="is-line"></div><button class="is-grip" aria-label="Drag to compare">⇆</button><span class="is-l"></span><span class="is-r"></span><button class="is-x" aria-label="End the comparison">×</button>';
    document.body.appendChild(bar);
    const grip = bar.querySelector('.is-grip');
    grip.addEventListener('pointerdown', e => {
      grip.setPointerCapture(e.pointerId);
      const move = ev => { const r = scene.canvas.getBoundingClientRect(); Imagery.split = Math.min(0.98, Math.max(0.02, (ev.clientX - r.left) / r.width)); place(); };
      const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
    });
    bar.querySelector('.is-x').onclick = () => Imagery.end();
  }
  bar.style.display = 'block'; place();
}
function place() {
  if (!bar) return;
  const r = scene.canvas.getBoundingClientRect(), x = r.left + Imagery.split * r.width;
  bar.style.left = x + 'px'; scene.splitPosition = Imagery.split; scene.requestRender();
  const [b, a] = Imagery.shown;
  bar.querySelector('.is-l').textContent = b ? 'Before · ' + b.date : '';
  bar.querySelector('.is-r').textContent = a ? 'After · ' + a.date : '';
}

export const Imagery = {
  at: null, box: null, dates: [], shown: [], layers: [], split: 0.5, lastYear: false,
  /** Open the panel for the place in view: find the pictures, start with a sensible pair. */
  async open() {
    if (camHeight() > MAX_H) { toast('Before and after: fly down to a place first (below about 2,500 km)', 3500); return; }
    const c = $('#card'); hooks.clearSelection?.();
    this.at = centre(); this.lastYear = false;
    const h = Math.max(2e3, Math.min(camHeight(), 1e6)), dLat = Math.min(4, h / 111e3 * 1.2), dLon = dLat / Math.max(0.2, Math.cos(this.at.lat * Math.PI / 180));
    this.box = [this.at.lon - dLon, this.at.lat - dLat, this.at.lon + dLon, this.at.lat + dLat];
    c.innerHTML = `<button class="x" aria-label="Close">×</button><div class="k" style="--c:${COLOR}">NASA Landsat · Sentinel-2 · VIIRS</div><h2>Before and after</h2><p class="note">Looking for pictures of ${this.at.lat.toFixed(2)}, ${this.at.lon.toFixed(2)}…</p>`;
    c.classList.add('show'); c.querySelector('.x').onclick = () => c.classList.remove('show');
    const run = this.run = (this.run || 0) + 1, mark = c.querySelector('.note'); mark.dataset.wait = 'imagery';
    let dates;
    try { dates = await this.search(Date.now() - 120 * 864e5, Date.now()); }
    catch (e) { console.warn('imagery search', e.message); dates = []; if (run === this.run) toast('NASA\'s catalogue is not answering right now: daily VIIRS pictures only', 3500); }
    if (run !== this.run || !c.querySelector('[data-wait="imagery"]') || !c.classList.contains('show')) return;   // another card opened, or Esc, while the catalogue answered
    this.dates = dates;
    const now = Date.now();   // VIIRS covers every day (coarse): the last week, for the gaps between clear HLS days
    for (let k = 1; k <= 7; k++) this.dates.push({ date: iso(now - k * 864e5), sensor: 'VIIRS', cloud: null, t: Date.parse(iso(now - k * 864e5)) });
    this.dates.sort((a, b) => b.t - a.t);
    const pair = pickPair(this.dates.filter(d => d.sensor !== 'VIIRS'));
    if (pair) this.compare(pair.before, pair.after);
    this.render();
  },
  /** HLS pictures of the centre point between two times: one entry per day and sensor, newest first. */
  async search(from, to) {
    const csv = await getText(`${CMR}&point=${this.at.lon.toFixed(4)},${this.at.lat.toFixed(4)}&temporal=${new Date(from).toISOString()},${new Date(to).toISOString()}`, { timeout: 30000 });
    return imageryDates(parseCmrCsv(csv));
  },
  render() {
    const c = $('#card'); if (!c.classList.contains('show')) return;
    const [b, a] = this.shown, box = this.box, thumb = d => `https://wvs.earthdata.nasa.gov/api/v1/snapshot?REQUEST=GetSnapshot&LAYERS=${IMAGERY[d.sensor].layer}&CRS=EPSG:4326&TIME=${d.date}&BBOX=${box[1].toFixed(3)},${box[0].toFixed(3)},${box[3].toFixed(3)},${box[2].toFixed(3)}&WIDTH=120&HEIGHT=72&FORMAT=image/jpeg`;
    const row = (d, i) => `<div class="ib-row${d === b ? ' is-b' : ''}${d === a ? ' is-a' : ''}"><img loading="lazy" alt="" src="${esc(thumb(d))}"><div class="ib-t"><b>${esc(d.date)}</b>`
      + `<span>${esc(IMAGERY[d.sensor].name)} · ${esc(IMAGERY[d.sensor].res)}${d.cloud != null ? ` · ${Math.round(d.cloud)}% cloud` : ''}</span>`
      + `<span class="ib-b"><button class="chipbtn" data-b="${i}">Before</button><button class="chipbtn" data-a="${i}">After</button></span></div></div>`;
    const sharp = [], daily = [];   // the sharp 30 m pictures first; the coarse daily ones after, for the gaps
    this.dates.forEach((d, i) => (d.sensor === 'VIIRS' ? daily : sharp).push(row(d, i)));
    const rows = sharp.slice(0, 40).join('') + (daily.length ? `<p class="note" style="margin:6px 0 0">Daily, coarse (VIIRS), for the days in between:</p>${daily.join('')}` : '');
    c.innerHTML = `<button class="x" aria-label="Close">×</button><div class="k" style="--c:${COLOR}">NASA Landsat · Sentinel-2 · VIIRS</div><h2>Before and after</h2>
      <dl><dt>Before</dt><dd>${b ? esc(label(b)) : 'pick one'}</dd><dt>After</dt><dd>${a ? esc(label(a)) : 'pick one'}</dd></dl>
      <div class="acts"><button class="chipbtn" id="ibSwap">Swap</button><button class="chipbtn" id="ibYear">${this.lastYear ? 'Last year added' : 'Add last year'}</button><button class="chipbtn" id="ibEnd">End comparison</button></div>
      <div class="ib-list">${rows || '<p class="note">No pictures found here in the last 120 days.</p>'}</div>
      <p class="note" style="margin-top:8px">Drag the slider on the globe: before on the left, after on the right. Landsat and Sentinel-2 (30 m) pass every few days; cloudy days show cloud. VIIRS (daily, 250-375 m) fills the gaps. NASA GIBS · HLS (NASA/USGS/ESA).</p>`;
    c.querySelector('.x').onclick = () => c.classList.remove('show');
    c.querySelector('#ibSwap').onclick = () => { if (b && a) this.compare(a, b); this.render(); };
    c.querySelector('#ibEnd').onclick = () => this.end();
    c.querySelector('#ibYear').onclick = async () => {
      if (this.lastYear) return; this.lastYear = true;
      try { const more = await this.search(Date.now() - 400 * 864e5, Date.now() - 330 * 864e5); this.dates.push(...more); this.dates.sort((x, y) => y.t - x.t); }
      catch (e) { toast('No answer from NASA\'s catalogue', 3000); }
      this.render();
    };
    c.querySelector('.ib-list').onclick = e => {
      const bb = e.target.closest('[data-b]'), ab = e.target.closest('[data-a]');
      if (bb) this.compare(this.dates[+bb.dataset.b], this.shown[1] || this.dates[0]);
      else if (ab) this.compare(this.shown[0] || this.dates[this.dates.length - 1], this.dates[+ab.dataset.a]);
      else return;
      this.render();
    };
  },
  /** Show two pictures split by the slider (or one, everywhere, if both are the same). */
  compare(before, after) {
    this.clear();
    const add = (d, dir) => {
      const s = IMAGERY[d.sensor], p = new C.UrlTemplateImageryProvider({ url: gibsTemplate(d.sensor, d.date), tilingScheme: new C.WebMercatorTilingScheme(), maximumLevel: s.max,
        rectangle: C.Rectangle.fromDegrees(...this.box), credit: new C.Credit(`${s.name} ${d.date} · NASA GIBS`) });
      const l = viewer.imageryLayers.addImageryProvider(p); l.splitDirection = dir; l.show = !Earth.hidden && !Earth.covered; this.layers.push(l);
    };
    if (before === after) add(after, C.SplitDirection.NONE);
    else { add(before, C.SplitDirection.LEFT); add(after, C.SplitDirection.RIGHT); }
    this.shown = [before === after ? null : before, after];
    slider(before !== after);
    if (state.photoreal) toast('Before and after shows on the map: Google\'s 3D city covers it below 200 km (turn photoreal off, or fly higher)', 5000);
  },
  clear() { for (const l of this.layers) viewer.imageryLayers.remove(l, true); this.layers = []; },
  /** Remove the pictures and the slider. */
  end() { this.clear(); this.shown = []; slider(false); const c = $('#card'); if (c.classList.contains('show') && c.querySelector('.ib-list')) c.classList.remove('show'); },
  /** Visibility follows the globe's own layers (look-up mode and Google's 3D city hide them). */
  apply() { for (const l of this.layers) l.show = !Earth.hidden && !Earth.covered; if (bar && this.layers.length > 1) bar.style.display = state.lookup ? 'none' : 'block'; },
};
addEventListener('resize', () => { if (bar && bar.style.display !== 'none') place(); });
