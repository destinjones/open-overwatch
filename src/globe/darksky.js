// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// "Your sky" and "Deep sky tonight" for Tonight (the globe's card and tonight.html): how dark the sky is where you stand
// (the Falchi et al. 2016 light pollution atlas, CC BY-NC), the nearest darker sky, one "how good is tonight" line, and
// the deep-sky objects (OpenNGC, CC-BY-SA-4.0) your eyes, binoculars or a small telescope can find tonight. The grids
// load when Tonight opens with a place (about 1.7 MB + 170 kB, kept for the visit; the borders, 370 kB, only to keep the
// nearest dark sky off the sea). The maths and the words are core/darksky.js (tested).
import { esc, store } from './env.js';
import { loadAtlas, skyAt } from '../core/lightpollution.js';
import { loadDeepsky } from '../core/deepsky.js';
import { prepare, countryAt } from '../core/borders.js';
import { fetchAsset } from '../core/assets.js';
import { skyWords, nearestDarker, darkText, deepSkyTonight, GEAR, gearLimits, ATLAS_SHORT, ATLAS_URL, NGC_URL } from '../core/darksky.js';
import { provenance, provenanceHtml } from '../core/provenance.js';

const once = f => { let p = null; return () => p || (p = f().catch(e => { p = null; throw e; })); };
const YEAR = 365.25 * 864e5;
// static data: dated by when it was made (the atlas models 2014-15 VIIRS data; OpenNGC by its release), "reported" for years
const ATLAS_PROV = () => provenance([{ id: 'falchi2016', name: 'Falchi et al. 2016 (CC BY-NC)', url: ATLAS_URL, licence: 'CC BY-NC 4.0', dataAt: Date.UTC(2015, 0, 1) }], { maxAgeMs: 30 * YEAR });
const NGC_PROV = () => provenance([{ id: 'openngc', name: 'OpenNGC v20260501 (CC-BY-SA-4.0)', url: NGC_URL, licence: 'CC-BY-SA-4.0', dataAt: Date.UTC(2026, 4, 1) }], { maxAgeMs: 30 * YEAR });
const prov = p => `<div class="prov-box" style="font-size:11px;color:var(--faint);margin:4px 0 8px">${provenanceHtml(p)}</div>`;

export const DarkSky = {
  atlas: once(() => loadAtlas('data/lightpollution.bin', u => fetchAsset(u).then(b => new Response(b)))),
  deepsky: once(() => loadDeepsky('data/deepsky.json', u => fetchAsset(u).then(b => new Response(b)))),
  borders: once(() => fetchAsset('data/borders.json', 'json').then(b => prepare(b))),
  /** The sky at a place in words, then (a moment later) the nearest darker sky: { sky, words, dark, darkText }. */
  async at(lat, lon) {
    const g = await this.atlas(), sky = skyAt(g, lat, lon);
    if (!sky) return { sky: null, outside: true };
    const out = { sky, words: skyWords(sky), dark: undefined };
    out.more = (sky.bortle <= 3 ? Promise.resolve(null) : this.borders().catch(() => null)).then(b => {
      out.dark = nearestDarker(g, lat, lon, { land: b ? (la, lo) => !!countryAt(b, lo, la) : null }); out.darkText = darkText(out.dark);
    });
    return out;
  },
  gear: () => (g => (GEAR[g] ? g : 'eyes'))(store.get('dsGear', 'eyes')),
};

/** The "Your sky" section: the quality line (core/darksky.js tonightQuality), the class and what it means, the way to darker skies. */
export function yourSkyHtml(d, q, err = false) {
  const head = '<h3>Your sky <small>· light pollution</small></h3>';
  if (err) return `${head}<p class="tn-p">The light pollution map didn't load.</p>`;
  if (!d) return `${head}<p class="tn-p">${q ? `<b class="${q.score >= 0.5 ? 'ok' : q.score < 0.3 ? 'cl' : ''}">${esc(q.text)}</b> ` : ''}Reading the light pollution map…</p>`;
  if (d.outside) return `${head}<p class="tn-p">${q ? `<b>${esc(q.text)}</b> ` : ''}The light pollution atlas covers 60°S to 85°N; this spot is outside it.</p>`;
  const w = d.words;
  return `${head}<p class="tn-p">${q ? `<b class="${q.score >= 0.5 ? 'ok' : q.score < 0.3 ? 'cl' : ''}">${esc(q.text)}</b>` : ''}</p>
    <div class="tn-list"><div class="tn-row"><span><b>Bortle ${w.bortle}</b> · ${esc(w.name)} · SQM ${w.sqm.toFixed(2)} mag/arcsec² · ${esc(w.bright)}</span></div></div>
    <p class="tn-p" style="margin-top:6px">${esc(w.milky)} ${esc(w.eye)}</p>
    <p class="tn-p" style="margin-top:6px">${d.darkText ? esc(d.darkText) : d.sky.bortle <= 3 ? 'You are already under a dark (Bortle 3 or better) sky.' : 'Looking for the nearest darker sky…'}</p>
    <p class="tn-p"><small>A modelled clear, moonless night in 2014-15: real nights add the Moon, haze and newer lights, so take it as this spot's best case, give or take a class.</small></p>${prov(ATLAS_PROV())}`;
}

/** The "Deep sky tonight" section with the gear picker; rows carry data-dso="i" for the page to make tappable. */
export function deepSkyHtml(list, { gear, sqm, err = false, loading = false, more = false, canFind = false } = {}) {
  const pick = `<div class="tn-b" role="group" aria-label="What you observe with" style="flex-wrap:wrap;margin:2px 0 6px">${Object.entries(GEAR).map(([k, g]) => `<button class="chipbtn" data-gear="${k}" aria-pressed="${k === gear}" title="${esc(g.note)}"${k === gear ? ' style="color:#7dffa6;border-color:#7dffa6"' : ''}>${esc(g.label)}</button>`).join('')}</div>`;
  const head = `<h3>Deep sky tonight <small>· galaxies, clusters, nebulae</small></h3>`;
  if (err) return `${head}<p class="tn-p">The deep-sky catalogue didn't load.</p>`;
  if (loading || !list) return `${head}${pick}<p class="tn-p">Finding what is up tonight…</p>`;
  const lim = sqm != null ? gearLimits(gear, sqm) : null;
  const rows = list.slice(0, more ? 30 : 10).map((v, i) => `<div class="tn-row"><span><b>${esc(v.label)}</b>: ${esc(v.text)}.<br><small>Highest ${esc(v.when)}, ${Math.round(v.alt)}° up in the ${esc(v.dir)}.</small></span>${canFind ? `<span class="tn-b"><button class="chipbtn" data-dso="${i}" title="Find it in look-up mode">Find it</button></span>` : ''}</div>`).join('');
  return `${head}${pick}${lim ? `<p class="tn-p"><small>${esc(GEAR[gear].label)} under this sky: objects to about magnitude ${lim.maxMag.toFixed(1)}, ${list.length ? `${list.length >= 30 ? '30 or more' : list.length} well placed (25°+ up while it's dark)` : 'none well placed tonight'}.</small></p>` : ''}
    ${rows ? `<div class="tn-list">${rows}</div>` : '<p class="tn-p">Nothing within reach is well placed tonight. Try binoculars, or a darker sky.</p>'}
    ${list.length > 10 ? `<div style="margin-top:6px"><button class="chipbtn" id="dsMore">${more ? 'Fewer' : `All ${Math.min(30, list.length)}`}</button></div>` : ''}
    ${canFind ? '' : '<p class="tn-p"><small>On the 3D globe, "Find it" points you at each one in look-up mode.</small></p>'}${prov(NGC_PROV())}`;
}

/** The list for a place (deepsky.js visibleTonight under the gear's limits), with "when" in the page's clock. */
export function deepSkyFor(cat, lat, lon, now, { gear, sqm, time, minLeft }) {
  return deepSkyTonight(cat, lat, lon, now, { gear, sqm, minLeft, limit: 30 }).map(v => ({ ...v, when: time(v.best) }));
}
export { ATLAS_SHORT };
