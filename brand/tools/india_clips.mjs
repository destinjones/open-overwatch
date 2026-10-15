// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// india_clips.mjs — the India landing page's phone clips (india/index.html) and the footage for the India ad
// (promo_india.py): four short vertical recordings of the 3D globe in its phone layout, frame-stepped like tiktok_tour.mjs.
//   india_sats   the Earth turning to India, every satellite drawn, the clock at 20x (India's GSAT, INSAT and NavIC
//                satellites are in the geostationary ring over the Indian Ocean)
//   delhi_dive   from orbit down to Delhi
//   airq         air quality (PM2.5, CAMS via Open-Meteo) over the Indo-Gangetic plain
//   lookup       Look up: the sky above India Gate through the phone
// 540x960 CSS px at 2x (1080x1920 frames), 30 fps, frame_#####.jpg in <outDir>/<clip>/; then
// brand/india/clips/<clip>.mp4 (540x960, small) and <clip>.jpg (the poster) through imageio-ffmpeg.
//   node brand/tools/india_clips.mjs [site] [outDir]      site default: the published website (it has the satellite copy)
//   OO_CLIPS=airq,lookup records only those; OO_ENCODE_ONLY=1 only encodes the frames already recorded.
// Aircraft stay off: the website has no live planes, so the clips don't show any. Privacy: the location is a fixed public
// place (India Gate, New Delhi), never the machine's; CelesTrak is blocked (satellites come from the site's copy).
import { launch, sleep, WORK } from './cdp.mjs';
import { mkdir, writeFile, rm, readdir, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = (process.argv[2] || 'https://destinjones.github.io/open-overwatch/').replace(/\/?$/, '/');
const OUT = process.argv[3] || path.join(WORK, 'footage', 'india');
const CLIPS_DIR = path.join(ROOT, 'brand', 'india', 'clips');
const ONLY = new Set((process.env.OO_CLIPS || 'india_sats,delhi_dive,airq,lookup').split(','));
const FPS = 30, W = 540, H = 960;
const GATE = { lat: 28.6129, lon: 77.2295 };   // India Gate, New Delhi: a public place
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2, lerp = (a, b, t) => a + (b - a) * t;
const logLerp = (a, b, t) => Math.exp(lerp(Math.log(a), Math.log(b), t));
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

await mkdir(OUT, { recursive: true });
const made = [];
// the globe's "Military aircraft is unavailable" toast (the website has no aircraft feed) rises over the end of the air
// quality clip: it ends before
const KEEP = { airq: 135 };
if (process.env.OO_ENCODE_ONLY) made.push(...ONLY);
else {
const b = await launch({ windowSize: [W, H], args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
try {
  const p = await b.newPage();
  for (const d of ['Page', 'Runtime', 'Network']) await p.send(d + '.enable');
  await p.send('Network.setBlockedURLs', { urls: ['*celestrak.org*', '*celestrak.com*', '*ipapi.co*', '*adsb.lol*', '*opensky-network.org*'] });
  p.on('Runtime.exceptionThrown', e => console.log('EXCEPTION', (e.exceptionDetails.exception?.description || e.exceptionDetails.text).slice(0, 300)));
  await p.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await p.send('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'Android' });
  await p.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Kolkata' });   // times on screen in IST, as an Indian phone shows them
  await p.send('Emulation.setLocaleOverride', { locale: 'en-IN' });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {   // a fixed public place instead of the machine's location
    const pos = { coords: { latitude: ${GATE.lat}, longitude: ${GATE.lon}, accuracy: 20, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() };
    const g = { getCurrentPosition: ok => setTimeout(() => ok(pos), 50), watchPosition: ok => (setTimeout(() => ok(pos), 50), 1), clearWatch: () => {} };
    Object.defineProperty(navigator, 'geolocation', { get: () => g, configurable: true });
  })()` });
  let dir = '', n = 0;
  const clip = async name => { dir = path.join(OUT, name); n = 0; await rm(dir, { recursive: true, force: true }); await mkdir(dir, { recursive: true }); made.push(name); console.log('clip', name); };
  const shot = async () => {
    const s = await p.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
    await writeFile(path.join(dir, `frame_${String(++n).padStart(5, '0')}.jpg`), Buffer.from(s.data, 'base64'));
  };
  const frames = k => p.eval(`new Promise(r => { let i = 0; const f = () => ++i >= ${k} ? r() : requestAnimationFrame(f); requestAnimationFrame(f); })`);
  const settle = maxMs => p.eval(`new Promise(r => { const t0 = performance.now(); const f = () => (OO3D.viewer.scene.globe.tilesLoaded && performance.now() - t0 > 50) || performance.now() - t0 > ${maxMs} ? r() : requestAnimationFrame(f); f(); })`);
  const cam = (lon, lat, h, pitch, heading = 0) => `OO3D.viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(${lon}, ${lat}, ${h}), orientation: { heading: Cesium.Math.toRadians(${heading}), pitch: Cesium.Math.toRadians(${pitch}), roll: 0 } })`;

  // the globe over India with the satellite layers on and aircraft off (the link format: docs/LINK_FORMAT.md)
  const loaded = p.waitFor('Page.loadEventFired', { timeoutMs: 120000 });
  await p.send('Page.navigate', { url: SITE + 'globe.html?hints=0#c=78,21,36000000,0,-90&a=stations,visual,active,geo,launches&x=air,mil' });
  await loaded;
  await p.poll(`!document.querySelector('#boot') || document.querySelector('#boot').classList.contains('out')`, { timeoutMs: 90000 });
  await p.poll(`OO3D.Sats.list.length > 5000`, { timeoutMs: 90000 }).catch(() => console.log('satellites: fewer than 5,000 loaded'));
  await sleep(8000);
  console.log('globe ready', JSON.stringify(await p.eval(`({ sats: OO3D.Sats.list.length, air: OO3D.Air.map.size, live: OO3D.time.live })`)));
  await p.eval(`(() => { window.__T0 = OO3D.time.jd(); OO3D.time.setJd(window.__T0, 0); })()`);
  let sec = 0;
  const tick = (x = 20) => p.eval(`OO3D.time.setJd(window.__T0 + ${(sec += 1 / FPS) * x / 86400}, 0)`);

  // 1: the Earth turns to India, every satellite drawn (5 s), at 13:00 IST today so India is in daylight
  if (ONLY.has('india_sats')) {
    const noon = new Date(); noon.setUTCHours(7, 30, 0, 0); if (noon > Date.now()) noon.setUTCDate(noon.getUTCDate() - 1);
    await p.eval(`(() => { window.__T0 = ${noon.getTime() / 864e5 + 2440587.5}; OO3D.time.setJd(window.__T0, 0); })()`); sec = 0;
    const F = 5 * FPS;
    // a quick pass along the path first: the Earth's textures switch level on the way in and the new one takes a few
    // frames to appear (an all-ocean Earth for 1/6 s); afterwards they are loaded
    for (let i = 0; i < F; i += 6) { const u = ease(i / (F - 1)); await p.eval(cam(lerp(30, 79, u), lerp(8, 20, u), logLerp(4.4e7, 2.9e7, u), -90)); await settle(1500); await sleep(400); }
    await p.eval(cam(30, 8, 4.4e7, -90)); await settle(4000); await sleep(3000);   // back at the start, its textures in place
    await clip('india_sats');
    for (let i = 0; i < F; i++) {
      const u = ease(i / (F - 1));
      await tick(); await p.eval(cam(lerp(30, 79, u), lerp(8, 20, u), logLerp(4.4e7, 2.9e7, u), -90));
      await settle(4000); await shot();   // long enough for the imagery to come back after a level change (a 700 ms cap left a blue, landless Earth)
    }
  }
  // 2: from orbit down to Delhi (5.5 s)
  if (ONLY.has('delhi_dive')) {
    await clip('delhi_dive');
    const F = 5 * FPS, end = { h: 9e4, pitch: -38 };
    const backDeg = (h, pitch) => pitch > -89 ? (h / Math.tan(-pitch * Math.PI / 180)) / 111e3 : 0;
    await p.eval(`(() => { if (OO3D.time.goLive) OO3D.time.goLive(); window.__T0 = OO3D.time.jd(); OO3D.time.setJd(window.__T0, 0); })()`); sec = 0;
    for (let i = 0; i < F; i++) {
      const u = ease(i / (F - 1)), h = logLerp(2.9e7, end.h, u), pitch = lerp(-90, end.pitch, Math.max(0, (u - 0.5) / 0.5));
      const k = Math.min(1, u * 1.25);
      await tick(1); await p.eval(cam(lerp(79, GATE.lon, k), lerp(20, GATE.lat, k) - backDeg(h, pitch), h, pitch));
      await settle(1200); await shot();
    }
    for (let i = 0; i < FPS / 2; i++) { await tick(1); await p.eval(cam(GATE.lon, GATE.lat - backDeg(end.h, end.pitch), end.h, end.pitch, i * 0.3)); await settle(800); await shot(); }
  }
  // 3: air quality over the Indo-Gangetic plain: wait for the PM2.5 points, then a slow drift (5 s)
  if (ONLY.has('airq')) {
    await p.eval(`OO3D.time.goLive && OO3D.time.goLive()`).catch(() => {});
    // straight-ish down over the plain, Delhi (top left) to Patna (right): the grid stays the same while the camera barely moves,
    // so every point comes from the cache and none pops in mid-clip
    const view = (h, hd) => cam(81.2, 26.8 - (h / Math.tan(80 * Math.PI / 180)) / 111e3, h, -80, hd);
    await p.eval(`location.hash = '#c=81.2,24.3,1600000,0,-80&a=airq&x=air,mil,active'`);
    await sleep(4000); await p.eval(view(1.6e6, 0));
    const count = () => p.eval(`+(document.querySelector('#n-airq')?.textContent || '0').replace(/[^0-9]/g, '')`);
    for (let k = 0, last = -1; k < 40; k++) { await sleep(2000); const c = await count(); if (c > 20 && c === last) break; last = c; }
    await sleep(2000);
    console.log('airq points', await count());
    await clip('airq');
    const F = 5 * FPS;
    // a little in, the grid point nearest Delhi is tapped: its card says what the model has there now
    const tapDelhi = `(() => { let best = null, bd = 1e9; const walk = c => { for (let i = 0; i < c.length; i++) { const x = c.get(i);
      if (x instanceof Cesium.PointPrimitiveCollection) { for (let j = 0; j < x.length; j++) { const o = x.get(j).id; if (o && o.kind === 'airq') { const d = (o.lat - 28.61) ** 2 + (o.lon - 77.23) ** 2; if (d < bd) { bd = d; best = o; } } } }
      else if (x && typeof x.get === 'function' && typeof x.length === 'number') walk(x); } };
      walk(OO3D.viewer.scene.primitives); if (best) OO3D.select(best); return best && [best.lat, best.lon, Math.round(best.usAqi)]; })()`;
    for (let i = 0; i < F; i++) {
      if (i === 36) console.log('tapped', JSON.stringify(await p.eval(tapDelhi)));
      const u = ease(i / (F - 1)); await p.eval(view(lerp(1.6e6, 1.48e6, u), lerp(0, 3, u))); await settle(600); await shot();
    }
  }
  // 4: Look up from India Gate (5 s)
  if (ONLY.has('lookup')) {
    await p.eval(`OO3D.LookUp.enter()`);
    await p.poll(`OO3D.LookUp.active`, { timeoutMs: 20000 });
    await p.eval(`OO3D.time.goLive && OO3D.time.goLive()`).catch(() => {});
    await sleep(2500);
    await clip('lookup');
    const F = 5 * FPS;
    for (let i = 0; i < F; i++) {
      const u = ease(i / (F - 1));
      await p.eval(`(() => { const S = OO3D.LookUp.state; S.sensor = false; S.heading = ${lerp(70, 200, u)}; S.pitch = ${lerp(14, 46, Math.sin(u * Math.PI / 2))}; })()`);
      await frames(3); await shot();
    }
  }
} finally { await b.close(); }
}

// ---- encode: the page's small clip and poster per recording
let ffmpeg = '';
try { ffmpeg = spawnSync('python', ['-c', 'import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())'], { encoding: 'utf8' }).stdout.trim(); } catch (e) { }
if (!ffmpeg) { console.log('no ffmpeg (pip install imageio-ffmpeg); frames are in', OUT); process.exit(0); }
await mkdir(CLIPS_DIR, { recursive: true });
for (const name of made) {
  const src = path.join(OUT, name), files = (await readdir(src)).filter(f => f.endsWith('.jpg')).sort();
  const mp4 = path.join(CLIPS_DIR, name + '.mp4'), jpg = path.join(CLIPS_DIR, name + '.jpg');
  const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(src, 'frame_%05d.jpg'), '-frames:v', String(KEEP[name] || files.length), '-vf', 'scale=540:960:flags=lanczos:out_range=tv',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-an', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
  // the poster is the first frame, so the still and the start of the clip match
  spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', path.join(src, files[0]), '-vf', 'scale=540:960:flags=lanczos', '-q:v', '5', jpg], { stdio: 'inherit' });
  console.log(r.status === 0 ? `${name}: ${KEEP[name] || files.length} frames -> ${mp4}` : `${name}: ffmpeg failed`);
}
