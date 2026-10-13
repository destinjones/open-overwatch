// Traffic camera networks (src/core/cams.js): every network's parser on a canned answer in its agency's own shape, the
// XML reader for Hong Kong, which networks cover a point, the nearest cameras, and picture sniffing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAM_NETS, CALTRANS, xmlRecords, camNetsNear, camsNear, camCoverage, netOf, imageType } from '../src/core/cams.js';

const SAMPLES = {
  tfl: [{ id: 'JamCams_00001.07450', commonName: 'Piccadilly Circus', lat: 51.5098, lon: -0.1342, additionalProperties: [{ key: 'available', value: 'true' }, { key: 'imageUrl', value: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.07450.jpg' },
    { key: 'videoUrl', value: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.07450.mp4' }, { key: 'view', value: 'Piccadilly Circus' }] }, { id: 'x', commonName: 'no position' }],
  nyc: [{ id: '8a6b', name: 'Central Park West @ 86 St', latitude: 40.785302, longitude: -73.969353, area: 'Manhattan', isOnline: 'true', imageUrl: 'https://webcams.nyctmc.org/api/cameras/8a6b/image' },
    { id: 'off', name: 'Off', latitude: '40.7', longitude: '-74.0', isOnline: 'false', imageUrl: 'http://insecure.example/x.jpg' }],
  finland: { features: [{ geometry: { coordinates: [24.88, 60.16] }, properties: { id: 'C01503', name: 'kt51_Helsinki_Ruoholahti', collectionStatus: 'GATHERING', presets: [{ id: 'C0150301', inCollection: true }, { id: 'C0150302', inCollection: false }] } },
    { geometry: { coordinates: [25, 61] }, properties: { id: 'C0', name: 'empty', presets: [] } }] },
  deldot: { videoCameras: [{ id: 'DE1', title: 'SR 1 @ Rehoboth', county: 'Sussex', lat: 38.7, lon: -75.1, status: 'Active', enabled: true, urls: { m3u8s: 'https://video.deldot.gov/live/DE1.m3u8' } }, { id: 'DE2', title: 'no video', lat: 39, lon: -75.5, urls: {} }] },
  iowa: { features: [{ attributes: { COMMON_ID: 'IA1', Desc_: 'RWIS - I-80 Des Moines', ImageURL: 'https://atms.iowadot.gov/x.jpg', VideoURL: '', Route: 'I-80', Type: 'RWIS', latitude: 41.6, longitude: -93.6 } }] },
  missouri: [{ location: 'I-70 at Stadium', x: -92.3, y: 38.95, html: 'https://sfs.example/live/MO123/playlist.m3u8' }, { location: 'bad', x: 'a', y: 1, html: 'https://x' }],
  norway: { features: [{ geometry: { coordinates: [10.75, 59.91] }, properties: { cameraId: '3000123', description: 'Oslo Bygdøy allé', roadNumber: 'Rv162', orientationDescription: 'Sentrum', stillImageUrl: 'https://webkamera.atlas.vegvesen.no/public/kamera?id=3000123',
    videoEncodingStandard: 'hls', videoUrl: 'https://stream.example/n.m3u8', 'status.stillImageAvailability': 'Available' } }] },
  bc: [{ id: 42, name: 'Hwy 1 at Lions Gate', caption: 'Looking north', orientation: 'N', location: { coordinates: [-123.13, 49.31] }, is_on: true, marked_stale: false }, { id: 43, name: 'hidden', should_appear: false, location: { coordinates: [-123, 49] } }],
  calgary: [{ camera_location: 'Deerfoot Trail & 17 Ave SE', quadrant: 'SE', camera_url: { url: 'http://trafficcam.calgary.ca/loc12.jpg' }, point: { coordinates: [-114.02, 51.03] } }],
  hk: `<?xml version="1.0" encoding="UTF-8"?>\n<image-list>\n\t<image>\n\t\t<key>H429F</key>\n\t\t<region>Hong Kong Island</region>\n\t\t<district>Southern</district>\n\t\t<description>Aberdeen Praya Road near Fish Market [H429F]</description>\n\t\t<latitude>22.24845</latitude>\n\t\t<longitude>114.1505</longitude>\n\t\t<url>https://tdcctv.data.one.gov.hk/H429F.JPG</url>\n\t</image>\n\t<image><key>X</key><description>Tom &amp; Jerry Rd</description><latitude>0</latitude><longitude>0</longitude><url>https://x/X.JPG</url></image>\n</image-list>`,
  sg: { items: [{ cameras: [{ camera_id: '1701', image: 'https://images.data.gov.sg/api/traffic-images/2026/10/abc.jpg', location: { latitude: 1.2799, longitude: 103.8715 } }] }] },
  ca04: { data: [{ cctv: { index: '7', inService: 'true', location: { locationName: 'TV307 -- I-80 : Bay Bridge Toll', latitude: '37.8247', longitude: '-122.3142', route: 'I-80', nearbyPlace: 'Oakland', direction: 'West' },
    imageData: { static: { currentImageURL: 'https://cwwp2.dot.ca.gov/data/d4/cctv/image/tv307.jpg' } } } }] },
};

test('cams: every network parses its own feed into cameras with https pictures', () => {
  const tfl = CAM_NETS.tfl.parse(SAMPLES.tfl);
  assert.equal(tfl.length, 1); assert.deepEqual([tfl[0].id, tfl[0].name, tfl[0].online], ['tfl:JamCams_00001.07450', 'Piccadilly Circus', true]); assert.match(tfl[0].video, /\.mp4$/);
  const nyc = CAM_NETS.nyc.parse(SAMPLES.nyc);
  assert.deepEqual(nyc.map(c => [c.id, c.online, c.image]), [['nyc:8a6b', true, 'https://webcams.nyctmc.org/api/cameras/8a6b/image'], ['nyc:off', false, '']], 'http pictures are dropped');
  const fi = CAM_NETS.finland.parse(SAMPLES.finland);
  assert.deepEqual(fi.map(c => [c.name, c.image]), [['kt51 Helsinki Ruoholahti', 'https://weathercam.digitraffic.fi/C0150301.jpg']]);
  const de = CAM_NETS.deldot.parse(SAMPLES.deldot);
  assert.deepEqual(de.map(c => [c.id, c.image, c.view]), [['de:DE1', '', 'Sussex County']]); assert.match(de[0].video, /\.m3u8$/);
  const ia = CAM_NETS.iowa.parse(SAMPLES.iowa);
  assert.deepEqual([ia[0].name, ia[0].view, ia[0].cors], ['I-80 Des Moines', 'I-80 · weather station', false]);
  assert.deepEqual(CAM_NETS.missouri.parse(SAMPLES.missouri).map(c => c.id), ['mo:MO123']);
  const no = CAM_NETS.norway.parse(SAMPLES.norway);
  assert.deepEqual([no[0].view, no[0].online, !!no[0].video], ['Rv162 · towards Sentrum', true, true]);
  const bc = CAM_NETS.bc.parse(SAMPLES.bc);
  assert.deepEqual(bc.map(c => [c.id, c.direction, c.image]), [['bc:42', 'north', 'https://www.drivebc.ca/images/42.jpg']]);
  assert.equal(CAM_NETS.calgary.parse(SAMPLES.calgary)[0].image, 'https://trafficcam.calgary.ca/loc12.jpg', 'http upgraded');
  const hk = CAM_NETS.hk.parse(SAMPLES.hk);
  assert.deepEqual(hk.map(c => [c.id, c.name, c.view]), [['hk:H429F', 'Aberdeen Praya Road near Fish Market', 'Southern, Hong Kong Island']], 'a camera at 0,0 is dropped');
  assert.equal(CAM_NETS.sg.parse(SAMPLES.sg)[0].fresh, true);
  const ca = CAM_NETS.ca04.parse(SAMPLES.ca04);
  assert.deepEqual([ca[0].id, ca[0].name, ca[0].view, ca[0].direction], ['ca04:7', 'I-80 : Bay Bridge Toll', 'I-80 · Oakland', 'West']);
  for (const n of Object.values(CAM_NETS)) assert.equal(n.parse(n.as === 'text' ? '' : null).length, 0, n.name);   // an empty answer is no cameras, not a crash
});

test('cams: Hong Kong\'s XML is read without a DOM, entities decoded', () => {
  const r = xmlRecords(SAMPLES.hk, 'image', ['key', 'description', 'url', 'missing']);
  assert.equal(r.length, 2); assert.equal(r[1].description, 'Tom & Jerry Rd'); assert.equal(r[0].missing, '');
  assert.deepEqual(xmlRecords('<a><b><![CDATA[x < y]]></b></a>', 'a', ['b']), [{ b: 'x < y' }]);
});

test('cams: which networks cover a point, the nearest cameras, and whose a camera is', () => {
  assert.deepEqual(camNetsNear(51.507, -0.128), ['tfl']);
  assert.deepEqual(camNetsNear(48.86, 2.35, 50), [], 'Paris: none');
  assert.ok(camNetsNear(37.8, -122.4).includes('ca04'));
  assert.deepEqual(camNetsNear(51.9, -0.6, 0), [], 'just outside London');
  assert.deepEqual(camNetsNear(51.9, -0.6, 30), ['tfl'], 'within reach of its box');
  assert.equal(Object.keys(CALTRANS).length, 12); assert.ok(camCoverage().includes('Caltrans') && !camCoverage().some(n => /district/.test(n)));
  const list = [{ id: 'a', lat: 51.5, lon: -0.12 }, { id: 'b', lat: 51.51, lon: -0.12 }, { id: 'c', lat: 52, lon: 0 }];
  const near = camsNear(list, 51.5, -0.12, 5);
  assert.deepEqual(near.map(c => c.id), ['a', 'b']); assert.ok(Math.abs(near[1].km - 1.11) < 0.01);
  assert.equal(netOf({ net: 'caltrans', id: 'ca04:7' }).name, 'Caltrans district 4'); assert.equal(netOf({ net: 'tfl', id: 'tfl:1' }).name, 'TfL JamCams');
});

test('cams: pictures are recognised by their bytes, not their label', () => {
  const pad = a => Uint8Array.from([...a, ...new Array(12).fill(0)]);
  assert.equal(imageType(pad([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(imageType(pad([0x89, 0x50, 0x4e, 0x47])), 'image/png');
  assert.equal(imageType(pad([0x47, 0x49, 0x46, 0x38])), 'image/gif');
  assert.equal(imageType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), 'image/webp');
  assert.equal(imageType(new TextEncoder().encode('<html>not a picture</html>')), null);
  assert.equal(imageType(new Uint8Array(3)), null);
});
