// page_check.mjs — open any page of the site in headless Edge, run steps, save screenshots and report every script error.
//   node page_check.mjs <url> <out_prefix> <width>x<height> "<js>" [settleSeconds] ["<js2>" settle2 ...]
// Like globe_shot.mjs, but for the 2D map too, and it prints console errors, uncaught exceptions and failed module loads
// (exit code 1 if there were any). CelesTrak and the aircraft networks are blocked, as in every automated run.
import { launch, sleep } from './cdp.mjs';
import { writeFile } from 'node:fs/promises';

const [url, out, size, ...steps] = process.argv.slice(2);
const [W, H] = (size || '1400x900').split('x').map(Number);
const b = await launch({ windowSize: [W, H], args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const p = await b.newPage();
  await p.send('Page.enable'); await p.send('Runtime.enable'); await p.send('Log.enable'); await p.send('Network.enable');
  await p.send('Network.setBlockedURLs', { urls: ['*celestrak.org*', '*opensky-network.org*', '*adsb.lol*', '*adsb.fi*', '*airplanes.live*', '*adsb.one*'] });
  p.on('Runtime.exceptionThrown', e => errors.push('exception: ' + (e.exceptionDetails.exception?.description || e.exceptionDetails.text).split('\n').slice(0, 3).join(' | ')));
  p.on('Runtime.consoleAPICalled', e => { if (e.type === 'error') errors.push('console.error: ' + e.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300)); });
  p.on('Log.entryAdded', e => { if (e.entry.level === 'error' && !/blocked|ERR_BLOCKED/i.test(e.entry.text)) errors.push('log: ' + e.entry.text.slice(0, 200) + (e.entry.url ? ' ' + e.entry.url : '')); });
  await p.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 700 });
  const loaded = p.waitFor('Page.loadEventFired', { timeoutMs: 60000 });
  await p.send('Page.navigate', { url });
  await loaded;
  await sleep(5000);
  for (let i = 0; i < steps.length; i += 2) {
    const js = steps[i], settle = +(steps[i + 1] || 5);
    const r = await p.eval(`(async () => { ${js} })()`, { timeoutMs: 120000 });
    if (r !== undefined) console.log('step', i / 2, JSON.stringify(r));
    await sleep(settle * 1000);
    const shot = await p.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(`${out}_${i / 2}.png`, Buffer.from(shot.data, 'base64'));
    console.log('wrote', `${out}_${i / 2}.png`);
  }
} finally { await b.close(); }
console.log(errors.length ? `${errors.length} error(s):\n` + errors.join('\n') : 'no script errors');
process.exitCode = errors.length ? 1 : 0;
