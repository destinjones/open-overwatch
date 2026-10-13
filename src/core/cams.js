// Public traffic camera networks, the pure parts: where each network's list lives, the box it covers, its credit, and the
// parser that turns its list into cameras. The globe (src/globe/cams.js) loads them in the browser (some through the
// relay, which a browser needs for agencies that send no CORS headers); the MCP server (mcp/cams.mjs) asks them directly.
// No DOM: Hong Kong's XML is read with a small tag reader. Tests: test/cams.test.mjs.
//
// A camera is { net, id, name, view, lat, lon, image (a still, https or ''), video (HLS or a clip, https or ''), online,
// link, direction?, cors? (false: its stills send no CORS headers), station?, presets?, fresh? (a new address each capture) }.

const https = u => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : '');
const DIRS = { N: 'north', NE: 'northeast', E: 'east', SE: 'southeast', S: 'south', SW: 'southwest', W: 'west', NW: 'northwest' };

/** Caltrans districts and the box each covers: [south, west, north, east]. */
export const CALTRANS = Object.freeze({ '01': [39.5, -124.5, 42.0, -122.9], '02': [39.4, -123.3, 42.0, -119.99], '03': [38.0, -122.4, 40.5, -119.9], '04': [36.9, -123.1, 38.9, -121.2],
  '05': [34.3, -122.2, 37.0, -119.4], '06': [34.8, -121.0, 37.7, -118.0], '07': [33.6, -119.5, 34.9, -117.6], '08': [33.4, -117.8, 35.8, -114.1], '09': [35.7, -119.0, 38.4, -116.9],
  '10': [36.9, -121.6, 38.6, -118.9], '11': [32.5, -117.4, 33.5, -114.4], '12': [33.35, -118.2, 33.95, -117.4] });

/** The text inside each <tag>…</tag> of a flat XML list, per record (Hong Kong's camera list). Entities are decoded. */
export function xmlRecords(text, record, fields) {
  const out = [], ent = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const re = new RegExp(`<${record}\\b[^>]*>([\\s\\S]*?)</${record}>`, 'g');
  for (const m of String(text || '').matchAll(re)) {
    const o = {};
    for (const f of fields) { const v = m[1].match(new RegExp(`<${f}\\b[^>]*>([\\s\\S]*?)</${f}>`)); o[f] = v ? ent(v[1].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')).trim() : ''; }
    out.push(o);
  }
  return out;
}

/**
 * Every network: { name, box: [s, w, n, e], credit, url, as: 'json' | 'text', relay (a browser needs the relay for the
 * list), parse(list) -> cameras }. `relay` lists come straight from the agency outside a browser.
 */
export const CAM_NETS = Object.freeze({
  tfl: { name: 'TfL JamCams', box: [51.25, -0.56, 51.72, 0.34], credit: 'London cameras: Powered by TfL Open Data', url: 'https://api.tfl.gov.uk/Place/Type/JamCam', as: 'json',
    parse: d => (Array.isArray(d) ? d : []).filter(p => Number.isFinite(p.lat)).map(p => { const a = {}; for (const x of p.additionalProperties || []) a[x.key] = x.value;
      return { net: 'tfl', id: 'tfl:' + p.id, name: p.commonName, view: a.view, lat: p.lat, lon: p.lon, image: https(a.imageUrl), video: https(a.videoUrl), online: a.available !== 'false', link: 'https://tfl.gov.uk/traffic/status/' }; }) },
  nyc: { name: 'NYC DOT', box: [40.47, -74.27, 40.93, -73.68], credit: 'New York cameras: NYC DOT', url: 'https://webcams.nyctmc.org/api/cameras', as: 'json', relay: true,
    parse: d => (Array.isArray(d) ? d : []).filter(c => Number.isFinite(+c.latitude)).map(c => ({ net: 'nyc', id: 'nyc:' + c.id, name: c.name, view: c.area, lat: +c.latitude, lon: +c.longitude,
      image: https(c.imageUrl), online: String(c.isOnline) !== 'false', link: 'https://webcams.nyctmc.org/' })) },
  finland: { name: 'Fintraffic weather cameras', box: [59.6, 19.0, 70.2, 31.7], credit: 'Finland cameras: Fintraffic / digitraffic.fi (CC BY 4.0)', url: 'https://tie.digitraffic.fi/api/weathercam/v1/stations', as: 'json',
    parse: d => ((d && d.features) || []).filter(f => f.geometry && f.properties).map(f => { const [lon, lat] = f.geometry.coordinates, p = f.properties, pr = (p.presets || []).filter(x => x.inCollection !== false);
      return { net: 'finland', id: 'fi:' + p.id, station: p.id, name: String(p.name || p.id).replace(/_/g, ' '), lat, lon, presets: pr.map(x => ({ id: x.id })), preset: 0,
        image: pr[0] ? `https://weathercam.digitraffic.fi/${encodeURIComponent(pr[0].id)}.jpg` : '', online: p.collectionStatus !== 'REMOVED_TEMPORARILY', link: 'https://www.digitraffic.fi/' }; })
      .filter(c => Number.isFinite(c.lat) && c.image) },
  deldot: { name: 'DelDOT', box: [38.45, -75.79, 39.84, -75.05], credit: 'Delaware cameras: DelDOT', url: 'https://tmc.deldot.gov/json/videocamera.json', as: 'json',
    parse: d => ((d && d.videoCameras) || []).filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lon) && https(c.urls && c.urls.m3u8s)).map(c => ({ net: 'deldot', id: 'de:' + c.id, name: c.title,
      view: c.county ? c.county + ' County' : '', lat: c.lat, lon: c.lon, image: '', video: https(c.urls.m3u8s), online: c.enabled !== false && c.status === 'Active', link: 'https://deldot.gov/map/' })) },
  iowa: { name: 'Iowa DOT', box: [40.37, -96.64, 43.51, -90.14], credit: 'Iowa cameras: Iowa DOT', as: 'json',
    url: 'https://services.arcgis.com/8lRhdTsQyJpO52F1/arcgis/rest/services/Traffic_Cameras_View/FeatureServer/0/query?where=1%3D1&outFields=COMMON_ID,Desc_,ImageURL,VideoURL,Route,Type,latitude,longitude&returnGeometry=false&f=json&resultRecordCount=2000',
    parse: d => ((d && d.features) || []).map(f => f.attributes || {}).filter(a => Number.isFinite(a.latitude) && Number.isFinite(a.longitude)).map(a => ({ net: 'iowa', id: 'ia:' + (a.COMMON_ID || a.Desc_),
      name: String(a.Desc_ || 'Iowa DOT camera').replace(/^RWIS - /, ''), view: [a.Route, a.Type === 'RWIS' ? 'weather station' : a.Type === 'Rest Area/Parking' ? 'rest area' : ''].filter(Boolean).join(' · '),
      lat: a.latitude, lon: a.longitude, image: https(a.ImageURL), cors: false, video: https(a.VideoURL), link: 'https://www.511ia.org/' })).filter(c => c.image || c.video) },
  missouri: { name: 'MoDOT', box: [35.99, -95.77, 40.62, -89.1], credit: 'Missouri cameras: MoDOT Traveler Information', url: 'https://traveler.modot.org/timconfig/feed/desktop/StreamingCams2.json', as: 'json', relay: true,
    parse: d => (Array.isArray(d) ? d : []).filter(c => Number.isFinite(c.x) && Number.isFinite(c.y) && https(c.html)).map(c => ({ net: 'missouri', id: 'mo:' + ((c.html.match(/\/([^/]+)\/playlist/) || [])[1] || c.location),
      name: c.location, lat: c.y, lon: c.x, image: '', video: https(c.html), link: 'https://traveler.modot.org/map/' })) },
  norway: { name: 'Statens vegvesen', box: [57.9, 4.4, 71.3, 31.3], credit: 'Norway cameras: Statens vegvesen (NLOD)', as: 'json',
    url: 'https://ogckart-sn1.atlas.vegvesen.no/ogc/features/v1/collections/datex_3_1:CctvSimple/items?f=application/geo%2Bjson&limit=5000',
    parse: d => ((d && d.features) || []).filter(f => f.geometry && f.properties).map(f => { const [lon, lat] = f.geometry.coordinates, p = f.properties;
      return { net: 'norway', id: 'no:' + p.cameraId, name: p.description || p.cameraId, view: [p.roadNumber, p.orientationDescription ? 'towards ' + p.orientationDescription : ''].filter(Boolean).join(' · '),
        lat, lon, image: https(p.stillImageUrl), cors: false, video: p.videoEncodingStandard === 'hls' ? https(p.videoUrl) : '', online: !/Unavailable/i.test(p['status.stillImageAvailability'] || ''), link: 'https://www.vegvesen.no/trafikk/' }; })
      .filter(c => Number.isFinite(c.lat) && (c.image || c.video)) },
  bc: { name: 'DriveBC', box: [48.2, -139.1, 60.0, -114.0], credit: 'British Columbia cameras: DriveBC', url: 'https://www.drivebc.ca/api/webcams/', as: 'json', relay: true,
    parse: d => (Array.isArray(d) ? d : (d && d.results) || []).filter(c => c.location && c.location.coordinates && c.should_appear !== false).map(c => ({ net: 'bc', id: 'bc:' + c.id, name: c.name, view: c.caption || '',
      direction: DIRS[c.orientation] || '', lat: +c.location.coordinates[1], lon: +c.location.coordinates[0], image: `https://www.drivebc.ca/images/${encodeURIComponent(c.id)}.jpg`,
      online: !c.marked_stale && c.is_on !== false, link: 'https://www.drivebc.ca/' }))
      .filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lon)) },
  calgary: { name: 'City of Calgary', box: [50.84, -114.32, 51.21, -113.86], credit: 'Calgary cameras: City of Calgary (Open Government Licence – City of Calgary)', url: 'https://data.calgary.ca/resource/k7p9-kppz.json?$limit=1000', as: 'json',
    parse: d => (Array.isArray(d) ? d : []).filter(r => r.point && r.camera_url && r.camera_url.url).map(r => { const [lon, lat] = r.point.coordinates, img = String(r.camera_url.url).replace(/^http:/, 'https:');
      return { net: 'calgary', id: 'yyc:' + img.replace(/^.*\//, '').replace(/\.\w+$/, ''), name: r.camera_location || r.camera_url.description, view: r.quadrant ? r.quadrant + ' Calgary' : '',
        lat, lon, image: https(img), cors: false, link: 'https://data.calgary.ca/' }; }) },
  hk: { name: 'Hong Kong Transport Department', box: [22.15, 113.82, 22.57, 114.45], credit: 'Hong Kong cameras: Transport Department (DATA.GOV.HK)', url: 'https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml', as: 'text',
    parse: text => xmlRecords(text, 'image', ['key', 'description', 'district', 'region', 'latitude', 'longitude', 'url']).map(t => ({ net: 'hk', id: 'hk:' + t.key, name: t.description.replace(/\s*\[[^\]]*\]\s*$/, ''),
      view: [t.district, t.region].filter(Boolean).join(', '), lat: +t.latitude, lon: +t.longitude, image: https(t.url), link: 'https://www.hkemobility.gov.hk/' }))
      .filter(c => Number.isFinite(c.lat) && c.lat && c.image) },
  sg: { name: 'LTA Singapore', box: [1.15, 103.6, 1.48, 104.1], credit: 'Singapore cameras: Land Transport Authority (data.gov.sg)', url: 'https://api.data.gov.sg/v1/transport/traffic-images', as: 'json', fresh: true,
    parse: d => ((((d && d.items) || [])[0] || {}).cameras || []).filter(c => c.location).map(c => ({ net: 'sg', id: 'sg:' + c.camera_id, name: 'Traffic camera ' + c.camera_id, lat: +c.location.latitude, lon: +c.location.longitude,
      image: https(c.image), fresh: true, cors: false, link: 'https://data.gov.sg/' })) },
  ...Object.fromEntries(Object.entries(CALTRANS).map(([n, box]) => ['ca' + n, { name: 'Caltrans district ' + +n, box, credit: 'California cameras: Caltrans', url: `https://cwwp2.dot.ca.gov/data/d${+n}/cctv/cctvStatusD${n}.json`, as: 'json',
    parse: d => ((d && d.data) || []).map(r => r.cctv || r).filter(x => x && x.location && +x.location.latitude).map(x => { const l = x.location, st = (x.imageData && x.imageData.static) || {};
      return { net: 'caltrans', id: `ca${n}:${x.index || l.locationName}`, name: String(l.locationName || 'Caltrans camera').replace(/^\S+\s+--\s+/, ''), view: [l.route, l.nearbyPlace].filter(Boolean).join(' · '),
        direction: l.direction, lat: +l.latitude, lon: +l.longitude, image: https(st.currentImageURL), online: x.inService !== 'false', link: 'https://cwwp2.dot.ca.gov/' }; }).filter(c => c.image) }])),
});

/** The network a camera belongs to (Caltrans cameras carry their district in their id). */
export const netOf = cam => CAM_NETS[cam.net === 'caltrans' ? cam.id.slice(0, 4).replace(':', '') : cam.net] || null;

/** Networks whose box comes within `km` of a point: their ids, nearest box first. */
export function camNetsNear(lat, lon, km = 0) {
  const out = [];
  for (const [id, n] of Object.entries(CAM_NETS)) {
    const [s, w, nn, e] = n.box, padLat = km / 111.32, padLon = km / (111.32 * Math.max(0.05, Math.cos(lat * Math.PI / 180)));
    if (lat < s - padLat || lat > nn + padLat || lon < w - padLon || lon > e + padLon) continue;
    const dy = lat < s ? s - lat : lat > nn ? lat - nn : 0, dx = lon < w ? w - lon : lon > e ? lon - e : 0;
    out.push([id, dy * dy + dx * dx]);
  }
  return out.sort((a, b) => a[1] - b[1]).map(a => a[0]);
}

/** Every network's name, for "where are there cameras" answers. */
export const camCoverage = () => [...new Set(Object.values(CAM_NETS).map(n => n.name.replace(/ district \d+$/, '')))];

/** Cameras within `km` of a point, nearest first, each with `km` (its distance; flat Earth, fine at city scale). */
export function camsNear(list, lat, lon, km) {
  const kx = 111.32 * Math.cos(lat * Math.PI / 180), out = [];
  for (const c of list) { const d = Math.hypot((c.lat - lat) * 111.32, (c.lon - lon) * kx); if (d <= km) out.push({ ...c, km: d }); }
  return out.sort((a, b) => a.km - b.km);
}

/** A picture's kind from its first bytes (JPEG, PNG, GIF, WebP), or null when it is not one. */
export function imageType(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}
