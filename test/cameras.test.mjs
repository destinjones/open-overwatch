// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The camera networks table (src/core/cameras.js), shared by the 2D map and the globe: each agency's answer shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA_NETS, CAMERA_GROUPS, CALTRANS_DISTRICTS, xmlText, netOf, boxInView, bustUrl, isStream, parseSingapore } from '../src/core/cameras.js';

test('every network has a box, a credit, an https list and a parser', () => {
  for (const [id, n] of Object.entries(CAMERA_NETS)) {
    assert.match(n.url, /^https:\/\//, id); assert.equal(typeof n.parse, 'function', id); assert.ok(n.credit && n.name && n.place, id);
    const [s, w, nn, e] = n.box; assert.ok(s < nn && w < e && Math.abs(s) <= 90 && Math.abs(e) <= 180, id);
    assert.deepEqual(n.parse(null), [], id + ' tolerates nothing');
  }
  assert.equal(Object.keys(CALTRANS_DISTRICTS).length, 12);
  const ct = CAMERA_GROUPS.find(g => g.id === 'caltrans');
  assert.equal(ct.nets.length, 12); assert.deepEqual(ct.box, [32.5, -124.5, 42.0, -114.1]);
  assert.equal(CAMERA_GROUPS.length, 12);
});

test('TfL, NYC, Finland', () => {
  const tfl = CAMERA_NETS.tfl.parse([{ id: 'JamCams_1', commonName: 'A40 <Westway>', lat: 51.5, lon: -0.2, additionalProperties: [{ key: 'imageUrl', value: 'https://s3/x.jpg' }, { key: 'videoUrl', value: 'http://s3/x.mp4' }, { key: 'available', value: 'false' }, { key: 'view', value: 'East' }] },
    { id: 'none', lat: null }]);
  assert.deepEqual(tfl, [{ net: 'tfl', id: 'tfl:JamCams_1', name: 'A40 <Westway>', view: 'East', lat: 51.5, lon: -0.2, image: 'https://s3/x.jpg', video: '', online: false, link: 'https://tfl.gov.uk/traffic/status/' }]);
  const nyc = CAMERA_NETS.nyc.parse([{ id: 7, name: 'FDR', area: 'Manhattan', latitude: '40.7', longitude: '-73.97', imageUrl: 'https://webcams.nyctmc.org/api/cameras/7/image', isOnline: 'true' }]);
  assert.equal(nyc[0].relayImage, true); assert.equal(nyc[0].lat, 40.7); assert.equal(CAMERA_NETS.nyc.relay, true);
  const fi = CAMERA_NETS.finland.parse({ features: [{ geometry: { coordinates: [24.9, 60.2] }, properties: { id: 'C01502', name: 'Tie_1_Espoo', collectionStatus: 'GATHERING', presets: [{ id: 'C0150201' }, { id: 'C0150202', inCollection: false }] } },
    { geometry: { coordinates: [25, 61] }, properties: { id: 'C9', presets: [] } }] });
  assert.equal(fi.length, 1); assert.equal(fi[0].name, 'Tie 1 Espoo'); assert.equal(fi[0].image, 'https://weathercam.digitraffic.fi/C0150201.jpg'); assert.deepEqual(fi[0].presets, [{ id: 'C0150201' }]);
});

test('video networks: DelDOT, MoDOT, Iowa, Norway', () => {
  const de = CAMERA_NETS.deldot.parse({ videoCameras: [{ id: 'C1', title: 'SR1', county: 'Kent', lat: 39.1, lon: -75.5, enabled: true, status: 'Active', urls: { m3u8s: 'https://video.deldot.gov/live/C1.stream/playlist.m3u8' } },
    { id: 'C2', lat: 39, lon: -75.5, urls: { m3u8s: 'http://insecure/playlist.m3u8' } }] });
  assert.equal(de.length, 1); assert.equal(de[0].view, 'Kent County'); assert.equal(isStream(de[0]), true);
  const mo = CAMERA_NETS.missouri.parse([{ location: 'I-70 at Exit 1', x: -94.5, y: 39.1, html: 'https://sfs.modot.mo.gov/rtplive/MODOT_CAM_1/playlist.m3u8' }]);
  assert.equal(mo[0].id, 'mo:MODOT_CAM_1');
  const ia = CAMERA_NETS.iowa.parse({ features: [{ attributes: { COMMON_ID: 'IDOT-1', Desc_: 'RWIS - Ames', Type: 'RWIS', Route: 'I-35', latitude: 42, longitude: -93.6, ImageURL: 'https://atmsqf.iowadot.gov/x.jpg' } }] });
  assert.equal(ia[0].name, 'Ames'); assert.equal(ia[0].view, 'I-35 · weather station'); assert.equal(ia[0].cors, false);
  const no = CAMERA_NETS.norway.parse({ features: [{ geometry: { coordinates: [10.7, 59.9] }, properties: { cameraId: '3000', description: 'Oslo', roadNumber: 'E18', orientationDescription: 'Drammen', stillImageUrl: 'https://kamera.atlas.vegvesen.no/x', videoEncodingStandard: 'hls', videoUrl: 'https://v/x.m3u8' } }] });
  assert.equal(no[0].view, 'E18 · towards Drammen'); assert.equal(no[0].video, 'https://v/x.m3u8');
});

test('Caltrans, DriveBC, Calgary, Singapore', () => {
  const ca = CAMERA_NETS.ca07.parse({ data: [{ cctv: { index: '12', inService: 'true', location: { locationName: 'TV123 -- I-5 : Main St', latitude: '34.05', longitude: '-118.24', route: 'I-5', nearbyPlace: 'Los Angeles', direction: 'North' },
    imageData: { static: { currentImageURL: 'https://cwwp2.dot.ca.gov/data/d7/cctv/image/x.jpg' }, streamingVideoURL: 'https://wzmedia.dot.ca.gov/D7/x.stream/playlist.m3u8' } } }] });
  assert.equal(ca[0].id, 'ca07:12'); assert.equal(ca[0].name, 'I-5 : Main St'); assert.equal(ca[0].view, 'I-5 · Los Angeles'); assert.equal(ca[0].direction, 'North');
  assert.equal(netOf(ca[0]).name, 'Caltrans district 7');
  const bc = CAMERA_NETS.bc.parse({ results: [{ id: 42, name: 'Hwy 1', caption: 'East', orientation: 'NE', location: { coordinates: [-123, 49.2] } }, { id: 43, should_appear: false, location: { coordinates: [-123, 49] } }] });
  assert.equal(bc.length, 1); assert.equal(bc[0].direction, 'northeast'); assert.equal(bc[0].image, 'https://www.drivebc.ca/images/42.jpg');
  const yyc = CAMERA_NETS.calgary.parse([{ camera_url: { url: 'http://trafficcam.calgary.ca/loc50.jpg', description: 'Deerfoot' }, point: { coordinates: [-114, 51] }, quadrant: 'NE' }]);
  assert.equal(yyc[0].image, 'https://trafficcam.calgary.ca/loc50.jpg'); assert.equal(yyc[0].id, 'yyc:loc50'); assert.equal(yyc[0].view, 'NE Calgary');
  const sg = parseSingapore({ items: [{ cameras: [{ camera_id: '1001', timestamp: '2026-10-12T10:00:00+08:00', image: 'https://images.data.gov.sg/x.jpg', location: { latitude: 1.3, longitude: 103.8 } }] }] });
  assert.equal(sg[0].fresh, true); assert.equal(sg[0].view, 'Expressway camera · 2026-10-12 10:00');
});

test('Hong Kong XML, entities and CDATA', () => {
  const xml = `<?xml version="1.0"?><image-list><image><key>H101</key><region>Hong Kong Island</region><district>Central &amp; Western</district>
    <description>Gloucester Road [H101]</description><latitude>22.28</latitude><longitude>114.17</longitude><url>https://tdcctv.data.one.gov.hk/H101.JPG</url></image>
    <image><key>X</key><latitude>0</latitude><longitude>0</longitude><url>https://x</url></image></image-list>`;
  const hk = CAMERA_NETS.hk.parse(xml);
  assert.deepEqual(hk, [{ net: 'hk', id: 'hk:H101', name: 'Gloucester Road', view: 'Central & Western, Hong Kong Island', lat: 22.28, lon: 114.17, image: 'https://tdcctv.data.one.gov.hk/H101.JPG', online: true, link: 'https://www.hkemobility.gov.hk/' }]);
  assert.equal(xmlText('<a><![CDATA[x < y]]></a>', 'a'), 'x < y');
  assert.equal(xmlText('<a>&#65;&#x42;&lt;</a>', 'a'), 'AB<');
  assert.equal(xmlText('<a>1</a>', 'b'), '');
});

test('view boxes, cache busting', () => {
  assert.equal(boxInView([51, -1, 52, 1], { s: 50, w: -2, n: 53, e: 2 }), true);
  assert.equal(boxInView([51, -1, 52, 1], { s: 50, w: 2, n: 53, e: 3 }), false);
  assert.equal(boxInView([51, -1, 52, 1], { s: 51.4, w: -0.2, n: 51.5, e: 0.1 }), true);   // the view inside the box
  assert.equal(boxInView([51, 170, 52, 179], { s: 50, w: 175, n: 53, e: 185 }), true);   // Leaflet past 180
  assert.equal(boxInView([51, -179, 52, -170], { s: 50, w: 175, n: 53, e: 185 }), true);
  assert.equal(boxInView([51, -1, 52, 1], { s: -80, w: -500, n: 80, e: 500 }), true);
  const now = 120e3 * 1000;
  assert.equal(bustUrl('https://x/a.jpg', { net: 'tfl' }, now), 'https://x/a.jpg?t=2000');
  assert.equal(bustUrl('https://x/a.jpg?k=1', { net: 'tfl' }, now), 'https://x/a.jpg?k=1&t=2000');
  assert.equal(bustUrl('https://x/a.jpg', { net: 'nyc' }, now), 'https://x/a.jpg');
  assert.equal(bustUrl('https://x/a.jpg', { net: 'sg', fresh: true }, now), 'https://x/a.jpg');
});
