// Live traffic cameras, projected into the 3D city.
//   Networks: TfL JamCams (London: stills + 10-second video clips), NYC DOT (through the local helper or the website's
//   relay), Caltrans (California, by district), Fintraffic weather cameras (Finland); live video from DelDOT (Delaware),
//   Iowa DOT, Statens vegvesen (Norway) and MoDOT (Missouri; its list through the relay); stills from Hong Kong's Transport
//   Department, Singapore's LTA, the City of Calgary and DriveBC (its list through the relay). Each loads once it is in
//   view. Live video is HLS: Safari plays it itself, elsewhere hls.js (light build) loads on first use.
//   Some agencies' stills send no CORS headers: they show in the card, and project only through the relay (or as video).
//   Project into 3D: the picture is cast from where the camera stands, like a projector, onto the ground of this globe
//   (or onto Google's photoreal buildings when that layer is on), with a floating image plane in its view frustum and its
//   coverage drawn on the ground. Feeds don't say where a camera points: core/campose.js guesses (words in its title,
//   its direction field, the road it stands on). "Look through" puts you in its seat with the picture over the 3D world;
//   drag to line them up, then Save (kept in this browser; data/camera_poses.json can ship shared alignments).
import { C, $, esc, toast, store, PHONE, getJSON, getText, relayed } from './env.js';
import { viewer, scene, camera, ctrl, camHeight, camAGL } from './viewer.js';
import { Terrain } from './terrain.js';
import { L, setCount } from './layers.js';
import { state, hooks } from './state.js';
import { release } from './follow.js';
import { Photoreal } from './photoreal.js';
import { overpass } from './overpass.js';
import { estimatePose, footprint, axes, roadBearings } from '../core/campose.js';

const PINK = '#ff6fb5', MAX_DIST = 300, FADE_FROM = 120;   // metres: the cast picture fades out on the ground between these
const CALTRANS = { '01': [39.5, -124.5, 42.0, -122.9], '02': [39.4, -123.3, 42.0, -119.99], '03': [38.0, -122.4, 40.5, -119.9], '04': [36.9, -123.1, 38.9, -121.2], '05': [34.3, -122.2, 37.0, -119.4], '06': [34.8, -121.0, 37.7, -118.0], '07': [33.6, -119.5, 34.9, -117.6], '08': [33.4, -117.8, 35.8, -114.1], '09': [35.7, -119.0, 38.4, -116.9], '10': [36.9, -121.6, 38.6, -118.9], '11': [32.5, -117.4, 33.5, -114.4], '12': [33.35, -118.2, 33.95, -117.4] };
const https = u => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : '');
const DIRS = { N: 'north', NE: 'northeast', E: 'east', SE: 'southeast', S: 'south', SW: 'southwest', W: 'west', NW: 'northwest' };
const SG = 'https://api.data.gov.sg/v1/transport/traffic-images';

// ------------------------------------------------------------------------------------------------ networks
const NETS = {
  tfl: { name: 'TfL JamCams', box: [51.25, -0.56, 51.72, 0.34], credit: 'London cameras: Powered by TfL Open Data', async load() {
    const d = await getJSON('https://api.tfl.gov.uk/Place/Type/JamCam', { timeout: 40000 });
    return (d || []).filter(p => Number.isFinite(p.lat)).map(p => { const a = {}; for (const x of p.additionalProperties || []) a[x.key] = x.value;
      return { net: 'tfl', id: 'tfl:' + p.id, name: p.commonName, view: a.view, lat: p.lat, lon: p.lon, image: https(a.imageUrl), video: https(a.videoUrl), online: a.available !== 'false', link: 'https://tfl.gov.uk/traffic/status/' }; });
  } },
  nyc: { name: 'NYC DOT', box: [40.47, -74.27, 40.93, -73.68], credit: 'New York cameras: NYC DOT', async load() {
    if (!relayed('https://webcams.nyctmc.org/api/cameras')) return [];
    const d = await getJSON('https://webcams.nyctmc.org/api/cameras', { relay: true, timeout: 40000 });
    return (d || []).filter(c => Number.isFinite(+c.latitude)).map(c => ({ net: 'nyc', id: 'nyc:' + c.id, name: c.name, view: c.area, lat: +c.latitude, lon: +c.longitude,
      image: relayed(https(c.imageUrl)) || '', online: String(c.isOnline) !== 'false', link: 'https://webcams.nyctmc.org/' }));
  } },
  finland: { name: 'Fintraffic weather cameras', box: [59.6, 19.0, 70.2, 31.7], credit: 'Finland cameras: Fintraffic / digitraffic.fi (CC BY 4.0)', async load() {
    const d = await getJSON('https://tie.digitraffic.fi/api/weathercam/v1/stations', { timeout: 60000 });
    return (d.features || []).filter(f => f.geometry && f.properties).map(f => { const [lon, lat] = f.geometry.coordinates, p = f.properties, pr = (p.presets || []).filter(x => x.inCollection !== false);
      return { net: 'finland', id: 'fi:' + p.id, station: p.id, name: String(p.name || p.id).replace(/_/g, ' '), lat, lon, presets: pr.map(x => ({ id: x.id })), preset: 0,
        image: pr[0] ? `https://weathercam.digitraffic.fi/${encodeURIComponent(pr[0].id)}.jpg` : '', online: p.collectionStatus !== 'REMOVED_TEMPORARILY', link: 'https://www.digitraffic.fi/' }; })
      .filter(c => Number.isFinite(c.lat) && c.image);
  } },
  deldot: { name: 'DelDOT', box: [38.45, -75.79, 39.84, -75.05], credit: 'Delaware cameras: DelDOT', async load() {
    const d = await getJSON('https://tmc.deldot.gov/json/videocamera.json', { timeout: 40000 });
    return (d.videoCameras || []).filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lon) && https(c.urls?.m3u8s)).map(c => ({ net: 'deldot', id: 'de:' + c.id, name: c.title,
      view: c.county ? c.county + ' County' : '', lat: c.lat, lon: c.lon, image: '', video: https(c.urls.m3u8s), online: c.enabled !== false && c.status === 'Active', link: 'https://deldot.gov/map/' }));
  } },
  iowa: { name: 'Iowa DOT', box: [40.37, -96.64, 43.51, -90.14], credit: 'Iowa cameras: Iowa DOT', async load() {
    const d = await getJSON('https://services.arcgis.com/8lRhdTsQyJpO52F1/arcgis/rest/services/Traffic_Cameras_View/FeatureServer/0/query?where=1%3D1&outFields=COMMON_ID,Desc_,ImageURL,VideoURL,Route,Type,latitude,longitude&returnGeometry=false&f=json&resultRecordCount=2000', { timeout: 60000 });
    return (d.features || []).map(f => f.attributes || {}).filter(a => Number.isFinite(a.latitude) && Number.isFinite(a.longitude)).map(a => ({ net: 'iowa', id: 'ia:' + (a.COMMON_ID || a.Desc_),
      name: String(a.Desc_ || 'Iowa DOT camera').replace(/^RWIS - /, ''), view: [a.Route, a.Type === 'RWIS' ? 'weather station' : a.Type === 'Rest Area/Parking' ? 'rest area' : ''].filter(Boolean).join(' · '),
      lat: a.latitude, lon: a.longitude, image: https(a.ImageURL), cors: false, video: https(a.VideoURL), link: 'https://www.511ia.org/' })).filter(c => c.image || c.video);
  } },
  missouri: { name: 'MoDOT', box: [35.99, -95.77, 40.62, -89.1], credit: 'Missouri cameras: MoDOT Traveler Information', async load() {
    const url = 'https://traveler.modot.org/timconfig/feed/desktop/StreamingCams2.json'; if (!relayed(url)) return [];
    const d = await getJSON(url, { relay: true, timeout: 40000 });
    return (Array.isArray(d) ? d : []).filter(c => Number.isFinite(c.x) && Number.isFinite(c.y) && https(c.html)).map(c => ({ net: 'missouri', id: 'mo:' + ((c.html.match(/\/([^/]+)\/playlist/) || [])[1] || c.location),
      name: c.location, lat: c.y, lon: c.x, image: '', video: https(c.html), link: 'https://traveler.modot.org/map/' }));
  } },
  norway: { name: 'Statens vegvesen', box: [57.9, 4.4, 71.3, 31.3], credit: 'Norway cameras: Statens vegvesen (NLOD)', async load() {
    const d = await getJSON('https://ogckart-sn1.atlas.vegvesen.no/ogc/features/v1/collections/datex_3_1:CctvSimple/items?f=application/geo%2Bjson&limit=5000', { timeout: 60000 });
    return (d.features || []).filter(f => f.geometry && f.properties).map(f => { const [lon, lat] = f.geometry.coordinates, p = f.properties;
      return { net: 'norway', id: 'no:' + p.cameraId, name: p.description || p.cameraId, view: [p.roadNumber, p.orientationDescription ? 'towards ' + p.orientationDescription : ''].filter(Boolean).join(' · '),
        lat, lon, image: https(p.stillImageUrl), cors: false, video: p.videoEncodingStandard === 'hls' ? https(p.videoUrl) : '', online: !/Unavailable/i.test(p['status.stillImageAvailability'] || ''), link: 'https://www.vegvesen.no/trafikk/' }; })
      .filter(c => Number.isFinite(c.lat) && (c.image || c.video));
  } },
  bc: { name: 'DriveBC', box: [48.2, -139.1, 60.0, -114.0], credit: 'British Columbia cameras: DriveBC', async load() {
    const url = 'https://www.drivebc.ca/api/webcams/'; if (!relayed(url)) return [];
    const d = await getJSON(url, { relay: true, timeout: 60000 });
    return (Array.isArray(d) ? d : d.results || []).filter(c => c.location?.coordinates && c.should_appear !== false).map(c => ({ net: 'bc', id: 'bc:' + c.id, name: c.name, view: c.caption || '',
      direction: DIRS[c.orientation] || '', lat: +c.location.coordinates[1], lon: +c.location.coordinates[0], image: `https://www.drivebc.ca/images/${encodeURIComponent(c.id)}.jpg`,
      online: !c.marked_stale && c.is_on !== false, link: 'https://www.drivebc.ca/' }))
      .filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lon));
  } },
  calgary: { name: 'City of Calgary', box: [50.84, -114.32, 51.21, -113.86], credit: 'Calgary cameras: City of Calgary (Open Government Licence – City of Calgary)', async load() {
    const d = await getJSON('https://data.calgary.ca/resource/k7p9-kppz.json?$limit=1000', { timeout: 40000 });
    return (Array.isArray(d) ? d : []).filter(r => r.point && r.camera_url?.url).map(r => { const [lon, lat] = r.point.coordinates, img = String(r.camera_url.url).replace(/^http:/, 'https:');
      return { net: 'calgary', id: 'yyc:' + img.replace(/^.*\//, '').replace(/\.\w+$/, ''), name: r.camera_location || r.camera_url.description, view: r.quadrant ? r.quadrant + ' Calgary' : '',
        lat, lon, image: https(img), cors: false, link: 'https://data.calgary.ca/' }; });
  } },
  hk: { name: 'Hong Kong Transport Department', box: [22.15, 113.82, 22.57, 114.45], credit: 'Hong Kong cameras: Transport Department (DATA.GOV.HK)', async load() {
    const xml = new DOMParser().parseFromString(await getText('https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml', { timeout: 40000 }), 'text/xml');
    const t = (el, k) => (el.getElementsByTagName(k)[0]?.textContent || '').trim();
    return [...xml.getElementsByTagName('image')].map(el => ({ net: 'hk', id: 'hk:' + t(el, 'key'), name: t(el, 'description').replace(/\s*\[[^\]]*\]\s*$/, ''),
      view: [t(el, 'district'), t(el, 'region')].filter(Boolean).join(', '), lat: +t(el, 'latitude'), lon: +t(el, 'longitude'), image: https(t(el, 'url')), link: 'https://www.hkemobility.gov.hk/' }))
      .filter(c => Number.isFinite(c.lat) && c.lat && c.image);
  } },
  sg: { name: 'LTA Singapore', box: [1.15, 103.6, 1.48, 104.1], credit: 'Singapore cameras: Land Transport Authority (data.gov.sg)', async load() {
    const d = await getJSON(SG, { timeout: 30000 }); sgAt = Date.now();
    return ((d.items || [])[0]?.cameras || []).filter(c => c.location).map(c => ({ net: 'sg', id: 'sg:' + c.camera_id, name: 'Traffic camera ' + c.camera_id, lat: +c.location.latitude, lon: +c.location.longitude,
      image: https(c.image), fresh: true, cors: false, link: 'https://data.gov.sg/' }));
  } },
  ...Object.fromEntries(Object.entries(CALTRANS).map(([n, [s, w, nn, e]]) => ['ca' + n, { name: 'Caltrans district ' + +n, box: [s, w, nn, e], credit: 'California cameras: Caltrans', async load() {
    const d = await getJSON(`https://cwwp2.dot.ca.gov/data/d${+n}/cctv/cctvStatusD${n}.json`, { timeout: 60000 });
    return (d.data || []).map(r => r.cctv || r).filter(x => x && x.location && +x.location.latitude).map(x => { const l = x.location, st = (x.imageData && x.imageData.static) || {};
      return { net: 'caltrans', id: `ca${n}:${x.index || l.locationName}`, name: String(l.locationName || 'Caltrans camera').replace(/^\S+\s+--\s+/, ''), view: [l.route, l.nearbyPlace].filter(Boolean).join(' · '),
        direction: l.direction, lat: +l.latitude, lon: +l.longitude, image: https(st.currentImageURL), online: x.inService !== 'false', link: 'https://cwwp2.dot.ca.gov/' }; }).filter(c => c.image);
  } }])),
};

/** Singapore's pictures have a new address every capture: re-read the list (at most once a minute). */
let sgAt = 0;
async function refreshSg() {
  if (Date.now() - sgAt < 60e3) return; sgAt = Date.now();
  try { const d = await getJSON(SG, { timeout: 20000 }), m = new Map(((d.items || [])[0]?.cameras || []).map(c => ['sg:' + c.camera_id, https(c.image)]));
    for (const c of all) if (c.net === 'sg' && m.get(c.id)) c.image = m.get(c.id); } catch (e) { console.warn('singapore cameras', e.message); }
}

// ------------------------------------------------------------------------------------------------ live video
const HLS_JS = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.light.mjs';
const isStream = cam => /\.m3u8(\?|$)/i.test(cam?.video || '');
let hlsLib = null;
/** One live stream at a time (HLS), shared by the card and the projection; it closes once neither shows it. */
export const Live = {
  cam: null, video: null, hls: null, failed: false,
  async open(cam) {
    if (this.cam === cam && this.video) return this.video;
    this.close();
    const v = document.createElement('video');
    Object.assign(v, { muted: true, autoplay: true, playsInline: true, crossOrigin: 'anonymous' }); v.setAttribute('playsinline', '');
    this.cam = cam; this.video = v; this.failed = false;
    // moving the element between the card and the look-through view pauses it (the HTML rule for a removed element)
    v.addEventListener('pause', () => setTimeout(() => { if (this.video === v && v.paused) v.play().catch(() => {}); }, 60));
    if (v.canPlayType('application/vnd.apple.mpegurl')) v.src = cam.video;   // Safari, iOS
    else {
      let Hls;
      try { Hls = (await (hlsLib ||= import(HLS_JS).catch(e => { hlsLib = null; throw e; }))).default; }   // a failed load is tried again next time, not cached
      catch (e) { console.warn('camera video', e.message); if (this.video === v) this.failed = true; return null; }
      if (this.video !== v) return null;
      if (!Hls.isSupported()) { this.failed = true; return null; }
      const h = this.hls = new Hls({ maxBufferLength: 8, backBufferLength: 0, liveSyncDurationCount: 2 });
      let tries = 0;
      h.on(Hls.Events.ERROR, (ev, d) => {
        if (!d.fatal || this.hls !== h) return;
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR && tries++ < 2) { h.startLoad(); return; }
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR && tries++ < 2) { h.recoverMediaError(); return; }
        console.warn('camera video', d.details); this.failed = true; v.dispatchEvent(new Event('oo-failed'));
      });
      h.loadSource(cam.video); h.attachMedia(v);
    }
    v.play().catch(() => {});
    return v;
  },
  close() {
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    const v = this.video; this.video = null; this.cam = null;
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); }
  },
};
setInterval(() => {   // nobody watching: stop downloading
  if (Live.cam && Proj.cam !== Live.cam && !(state.selected === Live.cam && $('#card').classList.contains('show'))) Live.close();
}, 2000);

// ------------------------------------------------------------------------------------------------ the layer
const pts = scene.primitives.add(new C.PointPrimitiveCollection());
const cover = scene.primitives.add(new C.PolylineCollection());
const loaded = new Map();   // net -> its load (a promise; dropped 2 min after a failure, to try again)
let all = [], shared = {}, sharedTried = false;
const saved = id => store.get('campose.' + id, null) || shared[id] || null;
const credits = new Set();

function card(cam) {
  const pose = cam.pose || estimatePose({ ...cam, calibrated: saved(cam.id) });
  const facing = `${Math.round(pose.heading)}° ${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(pose.heading / 45) % 8]}`;
  const presets = cam.presets && cam.presets.length > 1 ? `<div class="acts">${cam.presets.map((p, i) => `<button class="chipbtn" data-cpre="${i}" style="${i === cam.preset ? 'color:' + PINK : ''}">${esc(p.name || 'View ' + (i + 1))}</button>`).join('')}</div>` : '';
  return `<div class="k" style="--c:${PINK}">Traffic camera · ${esc(NETS[cam.net === 'caltrans' ? cam.id.slice(0, 4).replace(':', '') : cam.net]?.name || cam.net)}</div><h2>${esc(cam.name)}</h2>
    ${isStream(cam) ? `<div class="cam-live cam-video" id="camMedia"${cam.image ? ` style="background-image:url('${esc(encodeURI(bust(cam.image, cam)).replace(/[()']/g, c => '%' + c.charCodeAt(0).toString(16)))}')"` : ''}><span class="cam-badge">LIVE</span></div>`
      : cam.image ? `<img class="cam-live" id="camLive"${cam.cors === false ? '' : ' crossorigin="anonymous"'} alt="Latest picture from ${esc(cam.name)}" src="${esc(bust(cam.image, cam))}">` : '<p class="note">No picture from this camera.</p>'}
    ${presets}<dl>${cam.view ? `<dt>View</dt><dd>${esc(cam.view)}</dd>` : ''}<dt>Facing</dt><dd>${esc(facing)} · ${esc(pose.source === 'calibrated' ? 'lined up' : 'estimated from ' + pose.source)}</dd>
    <dt>Position</dt><dd>${cam.lat.toFixed(5)}, ${cam.lon.toFixed(5)}</dd>${cam.online === false ? '<dt>Status</dt><dd>offline</dd>' : ''}</dl>
    <div class="acts"><button class="chipbtn" id="camProj" style="color:${PINK}">${Proj.cam === cam ? 'Stop projecting' : 'Project into 3D'}</button><button class="chipbtn" id="camLook">Look through</button>${cam.video && !isStream(cam) ? '<button class="chipbtn" id="camVid">▶ Video clip</button>' : ''}${https(cam.link) ? `<a class="chipbtn" href="${esc(cam.link)}" target="_blank" rel="noopener">Source</a>` : ''}</div>
    <div class="note" style="margin-top:8px">${isStream(cam) ? 'The agency\'s live video.' : 'The agency\'s latest picture.'} Feeds don't publish where a camera points, so its aim here is a guess: <b>Look through</b>, then drag until the picture lines up with the world, and Save.</div>`;
}
const bust = (url, cam) => cam.net === 'nyc' || cam.fresh ? url : url + (url.includes('?') ? '&' : '?') + 't=' + Math.floor(Date.now() / 60000);   // a fresh still each minute (the relay caches NYC itself)
/** A still WebGL may read: the picture itself where its server sends CORS, else through the relay, else none. */
const texSrc = cam => !cam.image ? '' : cam.cors === false ? (relayed(cam.image) ? bust(relayed(cam.image), cam) : '') : bust(cam.image, cam);

function attach(cam) {
  cam.tip = () => `📷 ${cam.name}${cam.view ? ' · ' + cam.view : ''}`;
  cam.cardHtml = () => card(cam);
  cam.afterCard = c => {
    const q = s => c.querySelector(s);
    q('#camProj').onclick = () => Proj.cam === cam ? Proj.stop() : Proj.start(cam);
    q('#camLook').onclick = () => Look.enter(cam);
    if (q('#camVid')) q('#camVid').onclick = () => { if (Proj.cam !== cam) Proj.start(cam, { video: true }); else Proj.useVideo(true); };
    c.querySelectorAll('[data-cpre]').forEach(b => { b.onclick = () => { cam.preset = +b.dataset.cpre; const p = cam.presets[cam.preset]; cam.image = `https://weathercam.digitraffic.fi/${encodeURIComponent(p.id)}.jpg`; cam.view = p.name; cam.presetDir = p.dir; cam.pose = null; if (Proj.cam === cam) Proj.start(cam); hooks.reselect(cam); }; });
    const img = q('#camLive'); if (img) img.onerror = () => { img.replaceWith(Object.assign(document.createElement('p'), { className: 'note', textContent: 'The picture is not reachable right now.' })); };
    const box = q('#camMedia');
    if (box) Live.open(cam).then(v => {
      if (!v) { box.insertAdjacentHTML('beforeend', '<p class="note cam-fail">The live video can\'t play here right now.</p>'); return; }
      if (!box.isConnected) return;
      box.prepend(v); v.play().catch(() => {});
      v.addEventListener('oo-failed', () => { if (box.isConnected) box.insertAdjacentHTML('beforeend', '<p class="note cam-fail">The live video stopped (the agency\'s server).</p>'); }, { once: true });
    }).catch(e => { console.warn('camera video', e.message); if (box.isConnected) box.insertAdjacentHTML('beforeend', '<p class="note cam-fail">The live video can\'t play here right now.</p>'); });
    if (cam.net === 'sg') refreshSg().then(() => { const i = q('#camLive'); if (i && i.isConnected) i.src = bust(cam.image, cam); });
    if (cam.net === 'finland' && !cam.detail) finlandDetail(cam);
  };
  cam.pt = pts.add({ position: C.Cartesian3.fromDegrees(cam.lon, cam.lat, 6), pixelSize: 7, color: C.Color.fromCssColorString(PINK).withAlpha(cam.online === false ? 0.35 : 0.9),
    outlineColor: C.Color.BLACK.withAlpha(0.6), outlineWidth: 1, id: cam, show: L.cams.on && !state.lookup, disableDepthTestDistance: 3000 });
}
async function finlandDetail(cam) {   // preset names and directions live in the station's own record
  cam.detail = true;
  try {
    const d = await getJSON('https://tie.digitraffic.fi/api/weathercam/v1/stations/' + encodeURIComponent(cam.station), { timeout: 20000 });
    cam.presets = (d.properties.presets || []).filter(x => x.inCollection !== false).map(x => ({ id: x.id, name: x.presentationName || '', dir: x.direction === 'DECREASING_DIRECTION' ? 'decreasing' : 'increasing' }));
    const p = cam.presets[cam.preset || 0]; if (p) { cam.view = p.name; cam.presetDir = p.dir; cam.pose = null; }
    if (state.selected === cam) hooks.reselect(cam);
  } catch (e) { console.warn('fintraffic preset', e.message); }
}

/** Load a network once (a second ask while it loads waits for the same load). */
function loadNet(id) {
  if (!loaded.has(id)) loaded.set(id, (async () => {
    const net = NETS[id], seen = new Set(all.map(c => c.id));
    try {
      const list = (await net.load()).filter(c => !seen.has(c.id) && seen.add(c.id));   // some feeds list a camera twice
      for (const c of list) { c.kind = 'cam'; attach(c); all.push(c); }
      setCount('cams', all.length);
      if (list.length && !credits.has(id)) { credits.add(id); viewer.creditDisplay.addStaticCredit(new C.Credit(net.credit)); }
    } catch (err) { console.warn('cameras', id, err.message); setTimeout(() => loaded.delete(id), 120e3); }
  })());
  return loaded.get(id);
}
async function loadNear() {
  if (!L.cams.on || state.lookup || camHeight() > 6.0e5) return;
  if (!sharedTried) { sharedTried = true; fetch('data/camera_poses.json').then(r => r.ok ? r.json() : {}).then(d => { if (d && typeof d.poses === 'object') shared = d.poses; }).catch(() => {}); }
  const r = camera.computeViewRectangle(); if (!r) return;
  const deg = C.Math.toDegrees, w = deg(r.west), s = deg(r.south), e = deg(r.east), n = deg(r.north);
  for (const [id, net] of Object.entries(NETS)) {
    const [bs, bw, bn, be] = net.box; if (bs > n || bn < s || bw > e || be < w) continue;
    await loadNet(id);
  }
}

// coverage: the ground each nearby camera is guessed to see, drawn below ~6 km
let lastCover = '';
function drawCoverage() {
  const h = camAGL(), on = L.cams.on && !state.lookup && h < 6000;
  if (!on) { if (lastCover) { cover.removeAll(); lastCover = ''; } return; }
  const c = C.Cartographic.fromCartesian(camera.pickEllipsoid(new C.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2), C.Ellipsoid.WGS84) || camera.positionWC);
  const lat = C.Math.toDegrees(c.latitude), lon = C.Math.toDegrees(c.longitude), key = `${lat.toFixed(3)},${lon.toFixed(3)},${all.length}`;
  if (key === lastCover) return; lastCover = key;
  cover.removeAll();
  const near = all.filter(k => Math.abs(k.lat - lat) < 0.05 && Math.abs(k.lon - lon) < 0.08).slice(0, PHONE ? 60 : 160);
  for (const k of near) {
    const pose = k.pose || estimatePose({ ...k, calibrated: saved(k.id) }), fp = footprint({ ...pose, height: pose.height }, 16 / 9, 90);
    if (!fp) continue;
    const enu = C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(k.lon, k.lat, Terrain.near(k.lat, k.lon) + 0.5)), at = ([x, y]) => C.Matrix4.multiplyByPoint(enu, new C.Cartesian3(x, y, 0), new C.Cartesian3());
    const o = at([0, 0]);
    cover.add({ positions: [o, at(fp[0]), at(fp[3]), at(fp[2]), at(fp[1]), o], width: 1.2, material: C.Material.fromType('Color', { color: C.Color.fromCssColorString(PINK).withAlpha(saved(k.id) ? 0.85 : 0.45) }) });
  }
}

// ------------------------------------------------------------------------------------------------ projection
const FS = `
uniform sampler2D image;
uniform mat4 u_proj;
uniform float u_alpha;
czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material m = czm_getDefaultMaterial(materialInput);
  vec4 p = u_proj * vec4(-materialInput.positionToEyeEC, 1.0);
  if (p.w <= 0.3) discard;
  vec2 ndc = p.xy / p.w;
  if (abs(ndc.x) > 1.0 || abs(ndc.y) > 1.0) discard;
  vec4 c = texture(image, ndc * 0.5 + 0.5);
  float edge = smoothstep(1.0, 0.94, max(abs(ndc.x), abs(ndc.y)));
  float far = 1.0 - smoothstep(${FADE_FROM.toFixed(1)}, ${MAX_DIST.toFixed(1)}, p.w);
  m.diffuse = c.rgb; m.alpha = u_alpha * edge * far;
  return m;
}`;
const TILE_FS = `void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  if (u_camOn < 0.5) return;
  vec4 p = u_camProj * vec4(fsInput.attributes.positionEC, 1.0);
  if (p.w <= 0.3) return;
  vec2 ndc = p.xy / p.w;
  if (abs(ndc.x) > 1.0 || abs(ndc.y) > 1.0) return;
  // only surfaces that face the camera take its picture: edge-on ones smear, back-facing ones it can't see. Google's tiles
  // carry no normals, so take the surface's from the screen-space change of position, turned toward the viewer
  vec3 pe = fsInput.attributes.positionEC;
  vec3 n = normalize(cross(dFdx(pe), dFdy(pe)));
  n *= sign(dot(n, -pe));
  float facing = dot(n, normalize(u_camEye - pe));
  vec4 c = texture(u_camImg, ndc * 0.5 + 0.5);
  float k = smoothstep(1.0, 0.94, max(abs(ndc.x), abs(ndc.y))) * (1.0 - smoothstep(250.0, 450.0, p.w)) * smoothstep(0.06, 0.32, facing) * 0.94;
  material.diffuse = mix(material.diffuse, c.rgb, k);
}`;

function quad(corners, normal) {   // a two-triangle mesh with normals and st, for the image plane
  const v = new Float64Array(12), n = new Float32Array(12); corners.forEach((p, i) => { v.set([p.x, p.y, p.z], i * 3); n.set([normal.x, normal.y, normal.z], i * 3); });
  return new C.Geometry({ attributes: { position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: v }),
    normal: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: n }),
    st: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]) }) },
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]), primitiveType: C.PrimitiveType.TRIANGLES, boundingSphere: C.BoundingSphere.fromPoints(corners) });
}
function pyramid(apex, base, color) {   // the coverage volume: four translucent sides from the camera to its ground patch
  const pos = [apex, ...base], v = new Float64Array(15); pos.forEach((p, i) => v.set([p.x, p.y, p.z], i * 3));
  return new C.GeometryInstance({ geometry: new C.Geometry({ attributes: { position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: v }) },
    indices: new Uint16Array([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1]), primitiveType: C.PrimitiveType.TRIANGLES, boundingSphere: C.BoundingSphere.fromPoints(pos) }),
    attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(color) } });
}

export const Proj = {
  cam: null, pose: null, ground: 0, aspect: 4 / 3, video: null, prims: [], mats: [], PV: new C.Matrix4(), M: new C.Matrix4(), eye: null, eyeEC: new C.Cartesian3(), tileShader: null,
  async start(cam, { video = false } = {}) {
    this.stop(); this.cam = cam; const token = this.token = {};
    // the pose: lined-up one, else words + the road it stands on (one Overpass request), else words, else defaults
    let roads = [];
    if (!saved(cam.id)) roads = await nearbyRoads(cam.lat, cam.lon).catch(() => []);
    if (this.token !== token) return;
    this.roads = roads; cam.pose = estimatePose({ ...cam, calibrated: saved(cam.id) }, roads); this.pose = { ...cam.pose };
    this.ground = 0;
    if (Terrain.on && !state.photoreal) {   // the street under it, from the terrain (flat around the camera: a good fit in town)
      const [g] = await Terrain.heights([{ lat: cam.lat, lon: cam.lon }]);
      if (this.token !== token) return;
      this.ground = g;
    }
    if (state.photoreal && Photoreal.tileset) {   // stand on Google's ground, not on the ellipsoid ~50 m below it
      let g = null; try { [g] = await scene.sampleHeightMostDetailed([C.Cartographic.fromDegrees(cam.lon, cam.lat)], []); } catch (e) { console.warn('camera ground height', e.message); }
      if (this.token !== token) return;
      if (g && Number.isFinite(g.height)) this.ground = g.height;
    }
    if (cam.net === 'sg') await refreshSg();
    this.src = isStream(cam) ? '' : texSrc(cam);   // a live camera projects its video
    // the picture's real proportions (TfL and Caltrans send ~1.23:1, Fintraffic 16:9), which also proves it can be read (CORS)
    if (this.src) {
      const size = await new Promise(res => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res(null); i.src = this.src; });
      if (this.token !== token) return;
      if (!size) { toast("This camera's picture can't be read right now", 3500); this.cam = null; return; }
      if (size[0] > 0 && size[1] > 0) this.aspect = size[0] / size[1];
    } else if (!cam.video) {
      toast(cam.image ? "This agency's server doesn't let its pictures be drawn into 3D here (the download's local helper can)" : 'No picture from this camera', 4500); this.cam = null; return;
    }
    if ((video || !this.src) && cam.video) { await this.useVideo(true, false); if (this.token !== token) return; if (!this.video) { toast("This camera's video can't play here right now", 3500); this.cam = null; return; } }
    this.build(); this.frameView();
    if (state.selected === cam) hooks.reselect(cam);
    toast(`Projecting ${cam.name} · its aim is ${this.pose.source === 'calibrated' ? 'lined up' : 'a guess: Look through to line it up'}`, 4200);
  },
  async useVideo(on, rebuild = true) {
    if (on && this.cam && this.cam.video) {
      const cam = this.cam; let v;
      if (isStream(cam)) { v = await Live.open(cam); if (this.cam !== cam || !v) return; }   // live: the stream the card may already be showing
      else { v = document.createElement('video'); Object.assign(v, { crossOrigin: 'anonymous', muted: true, loop: true, playsInline: true, autoplay: true, src: cam.video }); v.play().catch(() => {}); }   // a TfL clip
      this.video = v;
      const fit = () => { if (this.video === v && v.videoWidth && v.videoHeight) { this.aspect = v.videoWidth / v.videoHeight; this.build(); if (Look.on) Look.place(); } };
      if (v.videoWidth) this.aspect = v.videoWidth / v.videoHeight; else v.addEventListener('loadedmetadata', fit, { once: true });
    } else { if (this.video && this.video !== Live.video) { this.video.pause(); this.video.removeAttribute('src'); this.video.load(); } this.video = null; }
    if (rebuild) this.build();
  },
  /** The image source for materials: the video clip while playing, else the still. */
  source() { return this.video || this.src; },
  /** What a material is made with: the still (Cesium's materials only take a <video> after they exist). */
  initial() { return this.src || C.Material.DefaultImageId; },
  build() {
    this.clearPrims();
    const cam = this.cam, pose = this.pose; if (!cam || !pose || !this.source()) return;
    const groundPos = C.Cartesian3.fromDegrees(cam.lon, cam.lat, this.ground), enu = C.Transforms.eastNorthUpToFixedFrame(groundPos);
    const vec = v => C.Matrix4.multiplyByPointAsVector(enu, new C.Cartesian3(...v), new C.Cartesian3()), pt = v => C.Matrix4.multiplyByPoint(enu, new C.Cartesian3(...v), new C.Cartesian3());
    const { f, r, u } = axes(pose), eye = pt([0, 0, pose.height]), dir = vec(f), up = vec(u), right = vec(r);
    this.eye = eye; this.dir = dir; this.up = up;
    const view = C.Matrix4.computeView(eye, dir, up, right, new C.Matrix4());
    const fr = new C.PerspectiveFrustum({ fov: C.Math.toRadians(pose.fov), aspectRatio: this.aspect, near: 0.5, far: 3000 });
    C.Matrix4.multiply(fr.projectionMatrix, view, this.PV);
    const pink = C.Color.fromCssColorString(PINK);
    // 1. the picture on the ground (this globe's surface is the ellipsoid: exact), hidden under Google's city
    const fp = footprint(pose, this.aspect, MAX_DIST);
    if (fp) {
      const mat = new C.Material({ fabric: { uniforms: { image: this.initial(), u_proj: C.Matrix4.toArray(C.Matrix4.IDENTITY), u_alpha: 0.95 }, source: FS }, translucent: true });   // a matrix uniform must be a 16-number array: Material makes the Matrix4
      const hull = fp.map(p => pt([p[0], p[1], 0]));   // the patch of ground in view (the shader trims to the frustum)
      this.ground_ = this.add(new C.Primitive({ geometryInstances: new C.GeometryInstance({ geometry: new C.PolygonGeometry({ polygonHierarchy: new C.PolygonHierarchy(hull), height: this.ground + 0.25, vertexFormat: C.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat }) }),
        appearance: new C.MaterialAppearance({ material: mat, flat: true, translucent: true, faceForward: true }), asynchronous: false }));
      this.mats.push(mat);
      // the coverage volume and its outline
      const base = fp.map(p => pt([p[0], p[1], 0.3]));
      this.volume = this.add(new C.Primitive({ geometryInstances: pyramid(eye, base, pink.withAlpha(0.03)), appearance: new C.PerInstanceColorAppearance({ flat: true, translucent: true }), asynchronous: false }));
    }
    // 2. the image plane, 14 m out in its frustum, and the frustum's edges
    const d = 14, th = Math.tan(C.Math.toRadians(pose.fov) / 2) * d, tv = th / this.aspect, at = (x, y) => C.Cartesian3.add(eye, C.Cartesian3.add(C.Cartesian3.multiplyByScalar(dir, d, new C.Cartesian3()),
      C.Cartesian3.add(C.Cartesian3.multiplyByScalar(right, x * th, new C.Cartesian3()), C.Cartesian3.multiplyByScalar(up, y * tv, new C.Cartesian3()), new C.Cartesian3()), new C.Cartesian3()), new C.Cartesian3());
    const corners = [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
    const imgMat = new C.Material({ fabric: { type: 'Image', uniforms: { image: this.initial() } }, translucent: false }); this.mats.push(imgMat);
    if (this.video) for (const m of this.mats) m.uniforms.image = this.video;   // a <video> is accepted only once a material exists (then it updates every frame)
    this.plane = this.add(new C.Primitive({ geometryInstances: new C.GeometryInstance({ geometry: quad(corners, C.Cartesian3.negate(dir, new C.Cartesian3())) }), appearance: new C.MaterialAppearance({ material: imgMat, flat: true, translucent: false, closed: false }), asynchronous: false }));
    const lines = this.lines = this.add(new C.PolylineCollection()), lm = C.Material.fromType('Color', { color: pink.withAlpha(0.9) });
    for (const c of corners) lines.add({ positions: [eye, c], width: 1.4, material: lm });
    lines.add({ positions: [...corners, corners[0]], width: 2, material: lm });
    // 3. Google's photoreal city, when it is on: the picture is cast onto the buildings themselves
    if (Photoreal.tileset && this.still()) {
      this.tileShader = new C.CustomShader({ uniforms: { u_camImg: { type: C.UniformType.SAMPLER_2D, value: new C.TextureUniform({ url: this.src }) },
        u_camProj: { type: C.UniformType.MAT4, value: new C.Matrix4() }, u_camEye: { type: C.UniformType.VEC3, value: new C.Cartesian3() }, u_camOn: { type: C.UniformType.FLOAT, value: 0 } }, fragmentShaderText: TILE_FS });
      Photoreal.tileset.customShader = this.tileShader;
    }
  },
  still() { return this.src; },
  add(p) { scene.primitives.add(p); this.prims.push(p); return p; },
  clearPrims() {
    for (const p of this.prims) scene.primitives.remove(p); this.prims = []; this.mats = []; this.ground_ = this.plane = this.lines = this.volume = null;
    if (this.tileShader && Photoreal.tileset && Photoreal.tileset.customShader === this.tileShader) Photoreal.tileset.customShader = undefined;
    this.tileShader = null;
  },
  /** Before each render: the projector as seen from this frame's camera (positions arrive in eye coordinates). */
  frame() {
    if (!this.cam || !this.eye) return;
    C.Matrix4.multiply(this.PV, camera.inverseViewMatrix, this.M);
    for (const m of this.mats) if (m.uniforms.u_proj) C.Matrix4.clone(this.M, m.uniforms.u_proj);
    // looking through: only the 3D world and the picture laid over it (the screen would fill the view, the cast picture would double it)
    const onTiles = !!(state.photoreal && this.tileShader) && !Look.on;
    if (this.ground_) this.ground_.show = !state.photoreal && !Look.on;
    for (const p of [this.plane, this.lines, this.volume]) if (p) p.show = !Look.on;
    if (this.tileShader) { this.tileShader.setUniform('u_camProj', this.M); this.tileShader.setUniform('u_camEye', C.Matrix4.multiplyByPoint(camera.viewMatrix, this.eye, this.eyeEC)); this.tileShader.setUniform('u_camOn', onTiles ? 1 : 0); }
  },
  /** A view of the projection from behind and above the camera. */
  frameView() {
    if (!this.eye || Look.on) return;
    release();
    const back = C.Cartesian3.add(C.Cartesian3.multiplyByScalar(this.dir, -55, new C.Cartesian3()), C.Cartesian3.multiplyByScalar(C.Cartesian3.normalize(this.eye, new C.Cartesian3()), 38, new C.Cartesian3()), new C.Cartesian3());
    const from = C.Cartesian3.add(this.eye, back, new C.Cartesian3()), target = C.Cartesian3.add(this.eye, C.Cartesian3.multiplyByScalar(this.dir, 40, new C.Cartesian3()), new C.Cartesian3());
    const dir = C.Cartesian3.normalize(C.Cartesian3.subtract(target, from, new C.Cartesian3()), new C.Cartesian3()), upW = C.Cartesian3.normalize(from, new C.Cartesian3());
    const side = C.Cartesian3.normalize(C.Cartesian3.cross(dir, upW, new C.Cartesian3()), new C.Cartesian3());
    camera.flyTo({ destination: from, orientation: { direction: dir, up: C.Cartesian3.cross(side, dir, new C.Cartesian3()) }, duration: 2.2 });
  },
  stop() {
    this.token = {}; const cam = this.cam; this.clearPrims(); this.useVideo(false, false); this.cam = null; this.eye = null;
    if (Look.on) Look.leave();
    if (cam && state.selected === cam) hooks.reselect(cam);
  },
};

async function nearbyRoads(lat, lon) {
  const q = `[out:json][timeout:15];way(around:45,${lat.toFixed(6)},${lon.toFixed(6)})["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"];out geom;`;
  let t = 0;   // through the shared queue, but never held up more than 15 s behind other layers' requests
  const late = new Promise((res, rej) => { t = setTimeout(() => rej(new Error('Overpass queue busy')), 15000); });
  try { return roadBearings((await Promise.race([overpass(q, { timeout: 12000, gap: 0 }), late])).elements, lat, lon); }
  finally { clearTimeout(t); }
}

// ------------------------------------------------------------------------------------------------ look through + line up
export const Look = {
  on: false, cam: null, drag: null, saveFov: null, el: null,
  async enter(cam) {
    if (Proj.cam !== cam) await Proj.start(cam);
    if (!Proj.eye) return;
    this.on = true; this.cam = cam; this.saveFov = camera.frustum.fov; ctrl.enableInputs = false; release();
    document.body.classList.add('cam-look');
    const el = this.el = document.createElement('div'); el.id = 'camLookUi';
    el.innerHTML = `<div class="cl-pic"></div><div class="cl-bar glass"><b>${esc(cam.name)}</b><label>Blend <input type="range" min="0" max="1" step="0.05" value="0.55" id="clBlend"></label>
      <button class="chipbtn" data-cl="turn" title="Face the other way">↻ 180°</button><button class="chipbtn" data-cl="lower">− m</button><button class="chipbtn" data-cl="higher">+ m</button>
      <button class="chipbtn" data-cl="reset" title="Back to the estimate">Reset</button><button class="chipbtn" data-cl="save" style="color:#7dffa6">Save</button><button class="chipbtn" data-cl="copy" title="Copy this alignment to share it">Copy</button><button class="chipbtn" data-cl="exit">Done</button>
      <span class="note">Drag to aim · scroll to zoom · line the picture up with the world</span></div>`;
    document.body.append(el);
    if (Proj.video) { const v = Proj.video; el.querySelector('.cl-pic').append(v); v.play().catch(() => {}); }   // moved here, not cloned (a stream can't be)
    else el.querySelector('.cl-pic').append(Object.assign(new Image(), { crossOrigin: 'anonymous', src: Proj.src, alt: '' }));
    const blend = el.querySelector('#clBlend'); const setBlend = () => { el.querySelector('.cl-pic').style.opacity = blend.value; }; blend.oninput = setBlend; setBlend();
    el.querySelector('.cl-bar').onclick = e => { const b = e.target.closest('[data-cl]'); if (b) this.act(b.dataset.cl); };
    el.querySelector('.cl-pic').onpointerdown = e => { this.drag = { x: e.clientX, y: e.clientY, h: Proj.pose.heading, p: Proj.pose.pitch }; e.currentTarget.setPointerCapture(e.pointerId); };
    el.querySelector('.cl-pic').onpointermove = e => { const d = this.drag; if (!d) return; const k = Proj.pose.fov / Math.max(300, innerWidth);
      Proj.pose.heading = ((d.h - (e.clientX - d.x) * k) % 360 + 360) % 360; Proj.pose.pitch = Math.max(-89, Math.min(30, d.p + (e.clientY - d.y) * k)); this.rebuildSoon(); };
    el.querySelector('.cl-pic').onpointerup = () => { this.drag = null; };
    el.querySelector('.cl-pic').onwheel = e => { e.preventDefault(); Proj.pose.fov = Math.max(10, Math.min(110, Proj.pose.fov * (e.deltaY > 0 ? 1.04 : 0.96))); this.rebuildSoon(); };
    this.place();
  },
  rebuildSoon() { clearTimeout(this.t); this.t = setTimeout(() => Proj.build(), 120); this.place(); },
  /** The seat: the camera at the projector, field of view matched across the screen's width, the picture laid over it. */
  place() {
    if (!this.on) return;
    const { f, r, u } = axes(Proj.pose), enu = C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(this.cam.lon, this.cam.lat, Proj.ground));
    const vec = v => C.Matrix4.multiplyByPointAsVector(enu, new C.Cartesian3(...v), new C.Cartesian3()); void r;
    const eye = C.Matrix4.multiplyByPoint(enu, new C.Cartesian3(0, 0, Proj.pose.height), new C.Cartesian3());
    const W = innerWidth, H = innerHeight, hfov = C.Math.toRadians(Proj.pose.fov);
    camera.frustum.fov = W >= H ? hfov : 2 * Math.atan(Math.tan(hfov / 2) * H / W);   // Cesium's fov is the wider side's
    camera.setView({ destination: eye, orientation: { direction: vec(f), up: vec(u) } });
    const pic = this.el.querySelector('.cl-pic'); pic.style.width = W + 'px'; pic.style.height = (W / Proj.aspect) + 'px'; pic.style.top = ((H - W / Proj.aspect) / 2) + 'px';
  },
  act(a) {
    const p = Proj.pose, cam = this.cam;
    if (a === 'turn') p.heading = (p.heading + 180) % 360;
    else if (a === 'lower') p.height = Math.max(1, p.height - 1);
    else if (a === 'higher') p.height = Math.min(80, p.height + 1);
    else if (a === 'reset') { store.set('campose.' + cam.id, null); Object.assign(p, estimatePose({ ...cam, calibrated: null }, Proj.roads || [])); cam.pose = { ...p }; lastCover = ''; }
    else if (a === 'save') { const s = { heading: +p.heading.toFixed(1), pitch: +p.pitch.toFixed(1), fov: +p.fov.toFixed(1), height: p.height }; store.set('campose.' + cam.id, s); cam.pose = { ...p, ...s, source: 'calibrated' }; toast('Alignment saved in this browser', 2500); lastCover = ''; }
    else if (a === 'copy') { const t = JSON.stringify({ [cam.id]: { heading: +p.heading.toFixed(1), pitch: +p.pitch.toFixed(1), fov: +p.fov.toFixed(1), height: p.height } }); navigator.clipboard.writeText(t).then(() => toast('Alignment copied: share it to add it to data/camera_poses.json', 3500), () => window.prompt('Copy:', t)); return; }
    else if (a === 'exit') { this.leave(); return; }
    this.rebuildSoon();
  },
  leave() {
    if (!this.on) return; this.on = false; clearTimeout(this.t);
    if (this.el) this.el.remove(); this.el = null; document.body.classList.remove('cam-look');
    if (Proj.video) Proj.video.play().catch(() => {});   // removing it from the page paused it
    if (this.saveFov) camera.frustum.fov = this.saveFov; ctrl.enableInputs = true;
    if (Proj.cam) { Proj.build(); Proj.frameView(); }
  },
};
addEventListener('keydown', e => { if (e.key === 'Escape' && Look.on) { e.stopImmediatePropagation(); Look.leave(); } }, true);
addEventListener('resize', () => Look.place());

// ------------------------------------------------------------------------------------------------ wiring
export const Cams = {
  get list() { return all; },
  get Proj() { return Proj; },
  apply() { const on = L.cams.on && !state.lookup; for (const c of all) c.pt.show = on; if (!on && Proj.cam) Proj.stop(); if (on) loadNear(); drawCoverage(); },
  /** The nearest camera to a point (networks there are loaded first), within `km`. */
  async nearest(lat, lon, km = 50) {
    const near = Object.entries(NETS).filter(([, net]) => { const [s, w, n, e] = net.box; return lat >= s - 0.5 && lat <= n + 0.5 && lon >= w - 0.5 && lon <= e + 0.5; });
    await Promise.all(near.map(([id]) => loadNet(id)));
    let best = null, bd = Infinity; const kx = Math.cos(lat * Math.PI / 180);
    for (const c of all) { const d = Math.hypot((c.lat - lat) * 111.32, (c.lon - lon) * 111.32 * kx); if (d < bd && c.online !== false && (c.image || c.video)) { bd = d; best = c; } }
    return bd <= km ? best : null;
  },
  /** Hand off to the nearest camera: select it and cast its picture. */
  async handoff(lat, lon) {
    if (!L.cams.on) { L.cams.on = true; store.set('ly.cams', true); hooks.applyVisibility(); }
    const c = await this.nearest(lat, lon);
    if (!c) { toast('No public camera within 50 km (cameras: London, New York, California, Delaware, Iowa, Missouri, British Columbia, Calgary, Norway, Finland, Hong Kong, Singapore)', 5000); return null; }
    hooks.reselect(c); await Proj.start(c); return c;
  },
};
hooks.camHandoff = (lat, lon) => Cams.handoff(lat, lon);
scene.preRender.addEventListener(() => Proj.frame());
camera.moveEnd.addEventListener(() => { loadNear(); drawCoverage(); });
setInterval(() => { if (L.cams.on) { loadNear(); drawCoverage(); } }, 3000);
setInterval(() => {   // fresh stills while projecting (every minute; video clips loop on their own)
  if (!Proj.cam || Proj.video || !Proj.cam.image) return;
  if (Proj.cam.net === 'sg') refreshSg();
  const u = texSrc(Proj.cam); if (!u || u === Proj.src) return; Proj.src = u;
  for (const m of Proj.mats) if ('image' in m.uniforms) m.uniforms.image = u;
  if (Proj.tileShader) Proj.tileShader.setUniform('u_camImg', new C.TextureUniform({ url: u }));
}, 20e3);
