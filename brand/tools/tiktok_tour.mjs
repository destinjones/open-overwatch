// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// tiktok_tour.mjs — a vertical phone recording for TikTok: the landing page scrolled top to bottom, then the 3D globe in
// its phone layout (Earth turning with every satellite, a dive to a city's live aircraft, then Look up: the sky above
// Greenwich through the phone). 1080x1920, 30 fps, frame_#####.jpg, then an MP4 through imageio-ffmpeg.
//   node tiktok_tour.mjs [site] [outDir]      site default: the published website; outDir default <WORK>/footage/tour
// Frame stepping as in zoom_capture.mjs: every frame sets the scroll or the clock and camera, waits for the view, then
// takes the screenshot, so the footage is smooth however long a frame takes. Privacy: the location is a fixed public
// place (Greenwich), never the machine's; CelesTrak is blocked (satellites come from the site's copy).
import { launch, sleep, WORK } from './cdp.mjs';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const SITE = (process.argv[2] || 'https://destinjones.github.io/open-overwatch/').replace(/\/?$/, '/');
const OUT = process.argv[3] || path.join(WORK, 'footage', 'tour');
const FPS = 30, W = 540, H = 960, PART = process.env.OO_PART || 'all';   // OO_PART=landing or globe records one part
const PLACE = { lat: 51.4769, lon: -0.0005 };   // Greenwich: a public place, so no one's real location is in the video
const CITY = { name: 'New York', lat: 40.7484, lon: -73.9857 };
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2, lerp = (a, b, t) => a + (b - a) * t;
const logLerp = (a, b, t) => Math.exp(lerp(Math.log(a), Math.log(b), t));
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

await rm(OUT, { recursive: true, force: true }); await mkdir(OUT, { recursive: true });
const b = await launch({ windowSize: [W, H], args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
let n = 0;
try {
  const p = await b.newPage();
  for (const d of ['Page', 'Runtime', 'Network']) await p.send(d + '.enable');
  await p.send('Network.setBlockedURLs', { urls: ['*celestrak.org*', '*celestrak.com*', '*ipapi.co*'] });
  p.on('Runtime.exceptionThrown', e => console.log('EXCEPTION', (e.exceptionDetails.exception?.description || e.exceptionDetails.text).slice(0, 300)));
  await p.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await p.send('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'Android' });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {   // a fixed public place instead of the machine's location
    const pos = { coords: { latitude: ${PLACE.lat}, longitude: ${PLACE.lon}, accuracy: 20, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() };
    const g = { getCurrentPosition: ok => setTimeout(() => ok(pos), 50), watchPosition: ok => (setTimeout(() => ok(pos), 50), 1), clearWatch: () => {} };
    Object.defineProperty(navigator, 'geolocation', { get: () => g, configurable: true });
  })()` });
  const shot = async () => {
    const s = await p.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
    await writeFile(path.join(OUT, `frame_${String(++n).padStart(5, '0')}.jpg`), Buffer.from(s.data, 'base64'));
    if (n % 60 === 0) console.log('frame', n);
  };
  const frames = k => p.eval(`new Promise(r => { let i = 0; const f = () => ++i >= ${k} ? r() : requestAnimationFrame(f); requestAnimationFrame(f); })`);
  const go = async url => { const loaded = p.waitFor('Page.loadEventFired', { timeoutMs: 120000 }); await p.send('Page.navigate', { url }); await loaded; };

  // ---- 1: the landing page, top to bottom (hold 1.5 s, scroll 24 s, hold 1 s)
  if (PART !== 'globe') {
  await go(SITE);
  await p.eval('document.fonts.ready'); await sleep(4000);
  const total = await p.eval('Math.max(0, document.documentElement.scrollHeight - innerHeight)');
  console.log('landing page scroll height', total);
  const videoStep = t => p.eval(`for (const v of document.querySelectorAll('video')) { try { v.pause(); if (v.duration > 0) v.currentTime = ${t} % v.duration; } catch (e) {} }`);
  const F1 = 24 * FPS;
  for (let i = 0; i < 45; i++) { await videoStep(i / FPS); await frames(2); await shot(); }
  for (let i = 0; i < F1; i++) {
    const y = Math.round(total * ease(i / (F1 - 1)));
    await p.eval(`window.scrollTo(0, ${y})`); await videoStep((45 + i) / FPS);
    await frames(2); await sleep(25); await shot();
  }
  for (let i = 0; i < 30; i++) { await frames(2); await shot(); }
  }

  // ---- 2: the 3D globe in its phone layout (live aircraft need the download version's relay: record it from serve.js)
  if (PART !== 'landing') {
  await go(SITE + 'globe.html?hints=0');   // no first-visit gesture card over the footage
  await p.poll(`!document.querySelector('#boot') || document.querySelector('#boot').classList.contains('out')`, { timeoutMs: 90000 });
  await sleep(18000);   // satellites, aircraft
  for (const f of ['opensky', 'military']) if (!(await p.eval(`OO3D.Air.map.size`) > 500))   // the timed loads may have failed: ask again and say why
    console.log(f, await p.eval(`OO3D.Air.${f}().then(() => 'ok ' + OO3D.Air.map.size, e => 'failed: ' + (e && e.message))`, { timeoutMs: 90000 }));
  await p.poll(`OO3D.Air.map.size > 500`, { timeoutMs: 60000 }).catch(() => console.log('few aircraft:', 'still under 500'));
  console.log('globe ready', JSON.stringify(await p.eval(`({ sats: OO3D.Sats.list.length, air: OO3D.Air.map.size, dock: !!document.querySelector('#mdock, .mdock, #dock') })`)));
  await p.eval(`(() => { window.__T0 = OO3D.time.jd(); OO3D.time.setJd(window.__T0, 0); })()`);
  const settle = maxMs => p.eval(`new Promise(r => { const t0 = performance.now(); const f = () => (OO3D.viewer.scene.globe.tilesLoaded && performance.now() - t0 > 50) || performance.now() - t0 > ${maxMs} ? r() : requestAnimationFrame(f); f(); })`);
  const cam = (lon, lat, h, pitch, heading = 0) => `OO3D.viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(${lon}, ${lat}, ${h}), orientation: { heading: Cesium.Math.toRadians(${heading}), pitch: Cesium.Math.toRadians(${pitch}), roll: 0 } })`;
  let sec = 0;
  const tick = () => p.eval(`OO3D.time.setJd(window.__T0 + ${(sec += 1 / FPS) * 20 / 86400}, 0)`);   // 20x time: the satellites visibly move
  // 2a: Earth turning, every satellite (7 s)
  const F2 = 7 * FPS;
  for (let i = 0; i < F2; i++) {
    const u = i / (F2 - 1);
    await tick(); await p.eval(cam(lerp(-10, CITY.lon + 12, ease(u)), lerp(25, CITY.lat - 8, ease(u)), 2.4e7, -90));
    await settle(i < 30 ? 2500 : 700); await shot();
  }
  // 2b: the dive to the city's live aircraft (7 s)
  const F3 = 7 * FPS;
  for (let i = 0; i < F3; i++) {
    const u = ease(i / (F3 - 1)), h = logLerp(2.4e7, 6e4, u), pitch = lerp(-90, -35, Math.max(0, (u - 0.55) / 0.45));
    const back = pitch > -89 ? (h / Math.tan(-pitch * Math.PI / 180)) / 111e3 : 0;
    await tick(); await p.eval(cam(lerp(CITY.lon + 12, CITY.lon, Math.min(1, u * 1.2)), lerp(CITY.lat - 8, CITY.lat, Math.min(1, u * 1.2)) - back, h, pitch));
    await settle(900); await shot();
  }
  for (let i = 0; i < 2 * FPS; i++) { await tick(); await p.eval(cam(CITY.lon, CITY.lat - (6e4 / Math.tan(35 * Math.PI / 180)) / 111e3, 6e4, -35, i * 0.25)); await settle(700); await shot(); }
  // 2c: Look up: the sky above Greenwich through the phone (real time while it opens, then a slow sweep, 9 s)
  await p.eval(`OO3D.LookUp.enter()`);
  await p.poll(`OO3D.LookUp.active`, { timeoutMs: 20000 });
  await p.eval(`OO3D.time.goLive && OO3D.time.goLive()`).catch(() => {});
  for (let i = 0; i < 20; i++) { await sleep(60); await shot(); }
  const F4 = 9 * FPS;
  for (let i = 0; i < F4; i++) {
    const u = ease(i / (F4 - 1));
    await p.eval(`(() => { const S = OO3D.LookUp.state; S.sensor = false; S.heading = ${lerp(100, 250, u)}; S.pitch = ${lerp(12, 48, Math.sin(u * Math.PI / 2))}; })()`);
    await frames(3); await shot();
  }
  for (let i = 0; i < FPS; i++) { await frames(2); await shot(); }
  }
  console.log('done', n, 'frames ->', OUT);
} finally { await b.close(); }

// ---- encode
let ffmpeg = '';
try { ffmpeg = spawnSync('python', ['-c', 'import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())'], { encoding: 'utf8' }).stdout.trim(); } catch (e) { }
if (ffmpeg) {
  const mp4 = path.join(OUT, '..', 'open-overwatch-tour.mp4');
  const r = spawnSync(ffmpeg, ['-y', '-framerate', String(FPS), '-i', path.join(OUT, 'frame_%05d.jpg'), '-vf', 'scale=1080:1920:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
  console.log(r.status === 0 ? 'video -> ' + mp4 : 'ffmpeg failed');
} else console.log('no ffmpeg (pip install imageio-ffmpeg); frames are in', OUT);
