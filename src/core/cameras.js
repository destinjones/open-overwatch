// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Public traffic and weather cameras: every agency network the 2D map and the globe show, as one table: where its list
// is, the box it covers, its credit, and a parser from its answer to cameras. Pure (the views fetch; Hong Kong's XML is
// read here with a small tag reader, so Node can test it). A camera: { net, id, name, view, direction, lat, lon, image,
// video, stream, online, link, cors (false: its stills send no CORS headers), relayImage (stills only through a relay),
// presets, fresh (a new address each capture) }. Only https addresses are kept.

const https = u => (typeof u === 'string' && /^https:\/\//i.test(u.trim()) ? u.trim() : '');
const okLL = c => Number.isFinite(c.lat) && Number.isFinite(c.lon) && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180 && !(c.lat === 0 && c.lon === 0);
const DIRS = { N: 'north', NE: 'northeast', E: 'east', SE: 'southeast', S: 'south', SW: 'southwest', W: 'west', NW: 'northwest' };
const s = v => (v == null ? '' : String(v));

/** Caltrans publishes one list per district (1-3 MB each): [s, w, n, e] per district, so only those in view load. */
export const CALTRANS_DISTRICTS = Object.freeze({ '01': [39.5, -124.5, 42.0, -122.9], '02': [39.4, -123.3, 42.0, -119.99], '03': [38.0, -122.4, 40.5, -119.9], '04': [36.9, -123.1, 38.9, -121.2],
  '05': [34.3, -122.2, 37.0, -119.4], '06': [34.8, -121.0, 37.7, -118.0], '07': [33.6, -119.5, 34.9, -117.6], '08': [33.4, -117.8, 35.8, -114.1], '09': [35.7, -119.0, 38.4, -116.9],
  '10': [36.9, -121.6, 38.6, -118.9], '11': [32.5, -117.4, 33.5, -114.4], '12': [33.35, -118.2, 33.95, -117.4] });

/** Text of the first <tag> inside an XML fragment, entities decoded (Hong Kong's list). */
export function xmlText(frag, tag) {
  const m = String(frag).match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  return m[1].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (_, e) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[e.toLowerCase()]
    ?? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1))).trim();
}

export const SG_URL = 'https://api.data.gov.sg/v1/transport/traffic-images';
/** Singapore's cameras (its stills change address each capture: re-read the list for fresh pictures). */
export const parseSingapore = d => (((d && d.items) || [])[0]?.cameras || []).filter(c => c && c.location).map(c => ({ net: 'sg', id: 'sg:' + c.camera_id, name: 'Traffic camera ' + c.camera_id,
  view: c.timestamp ? 'Expressway camera · ' + s(c.timestamp).replace('T', ' ').slice(0, 16) : 'Expressway camera', lat: +c.location.latitude, lon: +c.location.longitude,
  image: https(c.image), fresh: true, cors: false, online: true, link: 'https://data.gov.sg/',
  t: Number.isFinite(Date.parse(c.timestamp)) ? Date.parse(c.timestamp) : null })).filter(c => okLL(c) && c.image);   // when the still was taken

function caltrans(n) {
  return d => ((d && d.data) || []).map(r => (r && r.cctv) || r).filter(x => x && x.location && +x.location.latitude).map(x => {
    const l = x.location, st = (x.imageData && x.imageData.static) || {};
    return { net: 'caltrans', id: `ca${n}:${x.index || l.locationName}`, name: s(l.locationName || 'Caltrans camera').replace(/^\S+\s+--\s+/, ''), view: [l.route, l.nearbyPlace].filter(Boolean).map(s).join(' · '),
      direction: s(l.direction), route: s(l.route), lat: +l.latitude, lon: +l.longitude, image: https(st.currentImageURL), stream: https(x.imageData && x.imageData.streamingVideoURL),
      online: s(x.inService) !== 'false', link: 'https://cwwp2.dot.ca.gov/' };
  }).filter(c => okLL(c) && c.image);
}

/**
 * The networks: { name, box: [s, w, n, e], credit, url, relay (its list needs a relay: no CORS), xml (the answer is text),
 * group (the 2D map's picker: Caltrans districts share one), parse(answer) → cameras }.
 */
/** @type {Readonly<Record<string, { name: string, place: string, box: number[], group?: string, [k: string]: any }>>} */
export const CAMERA_NETS = Object.freeze({
  tfl: { name: 'TfL JamCams', place: 'London', box: [51.25, -0.56, 51.72, 0.34], credit: 'London cameras: Powered by TfL Open Data', url: 'https://api.tfl.gov.uk/Place/Type/JamCam',
    parse: d => (Array.isArray(d) ? d : []).filter(p => p && Number.isFinite(p.lat)).map(p => { const a = {}; for (const x of p.additionalProperties || []) if (x) a[x.key] = x.value;
      return { net: 'tfl', id: 'tfl:' + p.id, name: s(p.commonName), view: s(a.view), lat: +p.lat, lon: +p.lon, image: https(a.imageUrl), video: https(a.videoUrl), online: a.available !== 'false', link: 'https://tfl.gov.uk/traffic/status/' }; }).filter(okLL) },
  nyc: { name: 'NYC DOT', place: 'New York', box: [40.47, -74.27, 40.93, -73.68], credit: 'New York cameras: NYC DOT', url: 'https://webcams.nyctmc.org/api/cameras', relay: true,
    parse: d => (Array.isArray(d) ? d : []).filter(c => c && Number.isFinite(+c.latitude)).map(c => ({ net: 'nyc', id: 'nyc:' + c.id, name: s(c.name), view: s(c.area), lat: +c.latitude, lon: +c.longitude,
      image: https(c.imageUrl), relayImage: true, online: s(c.isOnline) !== 'false', link: 'https://webcams.nyctmc.org/' })).filter(okLL) },
  finland: { name: 'Fintraffic weather cameras', place: 'Finland', box: [59.6, 19.0, 70.2, 31.7], credit: 'Finland cameras: Fintraffic / digitraffic.fi (CC BY 4.0)', url: 'https://tie.digitraffic.fi/api/weathercam/v1/stations',
    parse: d => ((d && d.features) || []).filter(f => f && f.geometry && f.properties).map(f => { const [lon, lat] = f.geometry.coordinates || [], p = f.properties, pr = (p.presets || []).filter(x => x && x.inCollection !== false);
      return { net: 'finland', id: 'fi:' + p.id, station: s(p.id), name: s(p.name || p.id).replace(/_/g, ' '), view: '', lat: +lat, lon: +lon, presets: pr.map(x => ({ id: s(x.id) })), preset: 0,
        image: pr[0] ? `https://weathercam.digitraffic.fi/${encodeURIComponent(pr[0].id)}.jpg` : '', online: !/^REMOVED/.test(s(p.collectionStatus)), link: 'https://www.digitraffic.fi/' }; })
      .filter(c => okLL(c) && c.image) },
  deldot: { name: 'DelDOT', place: 'Delaware', box: [38.45, -75.79, 39.84, -75.05], credit: 'Delaware cameras: DelDOT', url: 'https://tmc.deldot.gov/json/videocamera.json',
    parse: d => ((d && d.videoCameras) || []).filter(c => c && Number.isFinite(c.lat) && Number.isFinite(c.lon) && https(c.urls && c.urls.m3u8s)).map(c => ({ net: 'deldot', id: 'de:' + c.id, name: s(c.title),
      view: c.county ? c.county + ' County' : '', lat: c.lat, lon: c.lon, image: '', video: https(c.urls.m3u8s), online: c.enabled !== false && c.status === 'Active', link: 'https://deldot.gov/map/' })).filter(okLL) },
  iowa: { name: 'Iowa DOT', place: 'Iowa', box: [40.37, -96.64, 43.51, -90.14], credit: 'Iowa cameras: Iowa DOT',
    url: 'https://services.arcgis.com/8lRhdTsQyJpO52F1/arcgis/rest/services/Traffic_Cameras_View/FeatureServer/0/query?where=1%3D1&outFields=COMMON_ID,Desc_,ImageURL,VideoURL,Route,Type,latitude,longitude&returnGeometry=false&f=json&resultRecordCount=2000',
    parse: d => ((d && d.features) || []).map(f => (f && f.attributes) || {}).filter(a => Number.isFinite(a.latitude) && Number.isFinite(a.longitude)).map(a => ({ net: 'iowa', id: 'ia:' + (a.COMMON_ID || a.Desc_),
      name: s(a.Desc_ || 'Iowa DOT camera').replace(/^RWIS - /, ''), view: [a.Route, a.Type === 'RWIS' ? 'weather station' : a.Type === 'Rest Area/Parking' ? 'rest area' : ''].filter(Boolean).map(s).join(' · '),
      lat: a.latitude, lon: a.longitude, image: https(a.ImageURL), cors: false, video: https(a.VideoURL), online: true, link: 'https://www.511ia.org/' })).filter(c => okLL(c) && (c.image || c.video)) },
  missouri: { name: 'MoDOT', place: 'Missouri', box: [35.99, -95.77, 40.62, -89.1], credit: 'Missouri cameras: MoDOT Traveler Information', url: 'https://traveler.modot.org/timconfig/feed/desktop/StreamingCams2.json', relay: true,
    parse: d => (Array.isArray(d) ? d : []).filter(c => c && Number.isFinite(c.x) && Number.isFinite(c.y) && https(c.html)).map(c => ({ net: 'missouri', id: 'mo:' + ((c.html.match(/\/([^/]+)\/playlist/) || [])[1] || c.location),
      name: s(c.location), lat: c.y, lon: c.x, image: '', video: https(c.html), online: true, link: 'https://traveler.modot.org/map/' })).filter(okLL) },
  norway: { name: 'Statens vegvesen', place: 'Norway', box: [57.9, 4.4, 71.3, 31.3], credit: 'Norway cameras: Statens vegvesen (NLOD)',
    url: 'https://ogckart-sn1.atlas.vegvesen.no/ogc/features/v1/collections/datex_3_1:CctvSimple/items?f=application/geo%2Bjson&limit=5000',
    parse: d => ((d && d.features) || []).filter(f => f && f.geometry && f.properties).map(f => { const [lon, lat] = f.geometry.coordinates || [], p = f.properties;
      return { net: 'norway', id: 'no:' + p.cameraId, name: s(p.description || p.cameraId), view: [p.roadNumber, p.orientationDescription ? 'towards ' + p.orientationDescription : ''].filter(Boolean).map(s).join(' · '),
        lat: +lat, lon: +lon, image: https(p.stillImageUrl), cors: false, video: p.videoEncodingStandard === 'hls' ? https(p.videoUrl) : '', online: !/Unavailable/i.test(s(p['status.stillImageAvailability'])), link: 'https://www.vegvesen.no/trafikk/' }; })
      .filter(c => okLL(c) && (c.image || c.video)) },
  bc: { name: 'DriveBC', place: 'British Columbia', box: [48.2, -139.1, 60.0, -114.0], credit: 'British Columbia cameras: DriveBC', url: 'https://www.drivebc.ca/api/webcams/', relay: true,
    parse: d => (Array.isArray(d) ? d : (d && d.results) || []).filter(c => c && c.location && c.location.coordinates && c.should_appear !== false).map(c => ({ net: 'bc', id: 'bc:' + c.id, name: s(c.name), view: s(c.caption),
      direction: DIRS[c.orientation] || '', lat: +c.location.coordinates[1], lon: +c.location.coordinates[0], image: `https://www.drivebc.ca/images/${encodeURIComponent(c.id)}.jpg`,
      online: !c.marked_stale && c.is_on !== false, link: 'https://www.drivebc.ca/' })).filter(okLL) },
  calgary: { name: 'City of Calgary', place: 'Calgary', box: [50.84, -114.32, 51.21, -113.86], credit: 'Calgary cameras: City of Calgary (Open Government Licence – City of Calgary)', url: 'https://data.calgary.ca/resource/k7p9-kppz.json?$limit=1000',
    parse: d => (Array.isArray(d) ? d : []).filter(r => r && r.point && r.camera_url && r.camera_url.url).map(r => { const [lon, lat] = r.point.coordinates || [], img = s(r.camera_url.url).replace(/^http:/, 'https:');
      return { net: 'calgary', id: 'yyc:' + img.replace(/^.*\//, '').replace(/\.\w+$/, ''), name: s(r.camera_location || r.camera_url.description), view: r.quadrant ? r.quadrant + ' Calgary' : '',
        lat: +lat, lon: +lon, image: https(img), cors: false, online: true, link: 'https://data.calgary.ca/' }; }).filter(c => okLL(c) && c.image) },
  hk: { name: 'Hong Kong Transport Department', place: 'Hong Kong', box: [22.15, 113.82, 22.57, 114.45], credit: 'Hong Kong cameras: Transport Department (DATA.GOV.HK)', xml: true,
    url: 'https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml',
    parse: text => (s(text).match(/<image[\s>][\s\S]*?<\/image>/gi) || []).map(el => ({ net: 'hk', id: 'hk:' + xmlText(el, 'key'), name: xmlText(el, 'description').replace(/\s*\[[^\]]*\]\s*$/, ''),
      view: [xmlText(el, 'district'), xmlText(el, 'region')].filter(Boolean).join(', '), lat: +xmlText(el, 'latitude'), lon: +xmlText(el, 'longitude'), image: https(xmlText(el, 'url')), online: true, link: 'https://www.hkemobility.gov.hk/' }))
      .filter(c => okLL(c) && c.image) },
  sg: { name: 'LTA Singapore', place: 'Singapore', box: [1.15, 103.6, 1.48, 104.1], credit: 'Singapore cameras: Land Transport Authority (data.gov.sg)', url: SG_URL, parse: parseSingapore },
  ...Object.fromEntries(Object.entries(CALTRANS_DISTRICTS).map(([n, box]) => ['ca' + n, { name: 'Caltrans district ' + +n, place: 'California', group: 'caltrans', box, credit: 'California cameras: Caltrans',
    url: `https://cwwp2.dot.ca.gov/data/d${+n}/cctv/cctvStatusD${n}.json`, parse: caltrans(n) }])),
});

/** The 2D map's picker: one entry per network, Caltrans' districts as one. */
export const CAMERA_GROUPS = Object.freeze([...new Set(Object.entries(CAMERA_NETS).map(([id, n]) => n.group || id))].map(id => {
  const nets = Object.keys(CAMERA_NETS).filter(k => (CAMERA_NETS[k].group || k) === id), n = CAMERA_NETS[nets[0]];
  const box = nets.map(k => CAMERA_NETS[k].box).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
  return { id, name: n.place, title: id === 'caltrans' ? 'Caltrans CCTV, all 12 districts' : n.name, nets, box };
}));
/** The network that names a camera (Caltrans: its district). */
export const netOf = cam => CAMERA_NETS[cam.net === 'caltrans' ? String(cam.id).slice(0, 4).replace(':', '') : cam.net] || null;

/** Whether a box [s, w, n, e] meets the view's bounds { s, w, n, e } (w > e: across the antimeridian). */
export function boxInView(box, v) {
  if (v.n < box[0] || v.s > box[2]) return false;
  if (v.e - v.w >= 359.9) return true;   // Leaflet's bounds run past ±180 when zoomed out
  const span = ((v.e - v.w) % 360 + 360) % 360;
  const inLon = x => ((x - v.w) % 360 + 360) % 360 <= span;
  return inLon(box[1]) || inLon(box[3]) || ((v.w - box[1]) % 360 + 360) % 360 <= ((box[3] - box[1]) % 360 + 360) % 360;
}

/** A still's address that changes each minute, so caches don't keep an old picture (fresh networks change it themselves). */
export const bustUrl = (url, cam, now = Date.now()) => !url || cam.fresh || cam.net === 'nyc' ? url : url + (url.includes('?') ? '&' : '?') + 't=' + Math.floor(now / 60000);
export const isStream = cam => /\.m3u8(\?|$)/i.test((cam && cam.video) || '');

// ---- near a place (the MCP server's traffic_cameras tool) ------------------------------------------------------------
/** Networks whose box comes within `km` of a point: their ids, nearest box first. */
export function camNetsNear(lat, lon, km = 0) {
  const out = [], padLat = km / 111.32, padLon = km / (111.32 * Math.max(0.05, Math.cos(lat * Math.PI / 180)));
  for (const [id, n] of Object.entries(CAMERA_NETS)) {
    const [s, w, nn, e] = n.box;
    if (lat < s - padLat || lat > nn + padLat || lon < w - padLon || lon > e + padLon) continue;
    const dy = lat < s ? s - lat : lat > nn ? lat - nn : 0, dx = lon < w ? w - lon : lon > e ? lon - e : 0;
    out.push(/** @type {[string, number]} */ ([id, dy * dy + dx * dx]));
  }
  return out.sort((a, b) => a[1] - b[1]).map(a => a[0]);
}
/** Every network's name (Caltrans once), for "where are there cameras" answers. */
export const camCoverage = () => CAMERA_GROUPS.map(g => g.id === 'caltrans' ? 'Caltrans' : CAMERA_NETS[g.nets[0]].name);
/** Cameras within `km` of a point, nearest first, each with `km` (its distance; flat Earth, fine at city scale). */
export function camsNear(list, lat, lon, km) {
  const kx = 111.32 * Math.cos(lat * Math.PI / 180), out = [];
  for (const c of list) { const d = Math.hypot((c.lat - lat) * 111.32, (c.lon - lon) * kx); if (d <= km) out.push({ ...c, km: d }); }
  return out.sort((a, b) => a.km - b.km);
}
/** A picture's kind from its first bytes (JPEG, PNG, GIF, WebP), or null when it is not one (an "offline" page with a 200). */
export function imageType(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}
