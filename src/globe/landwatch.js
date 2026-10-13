// "Tell me when it lands": watch a plane from its card and get a notification (or a toast, where notifications are
// blocked) when it is on final, when it touches down and where, or when the feeds lose it low down (receivers often
// can't hear a plane on the ground, so a lost signal near a field usually means it has landed). Needs fresh fixes,
// so it is for the download version (adsb.lol through the local helper) and military planes (the 60-s feed); while it
// watches, trails.js polls the plane every 20 s like any pinned one. Watching lasts while the page is open.
import { toast } from './env.js';
import { Air, airClass } from './aircraft.js';
import { Alerts } from './alerts.js';
import { Trails } from './trails.js';
import { Airports } from './airports.js';
import { flightPhase } from '../core/phase.js';

const LOST_MS = 10 * 60e3;

export const LandWatch = {
  map: new Map(),   // hex -> { name, final: bool, since }
  has(r) { return this.map.has(r.hex); },
  async toggle(r) {
    if (this.map.delete(r.hex)) { Trails.pin(r, false); toast(`Stopped watching ${r.flight || r.hex}`, 2500); return false; }
    if (r.ground) { toast('It is on the ground already', 2500); return false; }
    this.map.set(r.hex, { name: (r.flight || r.hex).trim(), final: false, since: Date.now() });
    Trails.pin(r, true);   // keeps it polled and its trail drawn
    await Airports.load();
    const ok = await Alerts.permission();
    toast(`Watching ${(r.flight || r.hex).trim()}: ${ok ? 'a notification' : 'a message here'} when it lands. Keep this tab open.`, 4500);
    return true;
  },
  tell(title, body, tag) { Alerts.now(title, body, tag); },
  check() {
    const now = Date.now();
    for (const [hex, w] of this.map) {
      const r = Air.map.get(hex);
      if (!r) { this.tell(`${w.name}: lost`, 'The feeds stopped sending it (out of receiver range, or landed where none can hear it).', 'land-' + hex); this.map.delete(hex); continue; }
      const ap = Airports.index.list.length ? Airports.index.nearest(r.lat, r.lon, 60) : null, apName = ap ? `${ap.name}${ap.iata ? ' (' + ap.iata + ')' : ''}` : '';
      if (r.ground) {
        this.tell(`${w.name} has landed`, apName ? `On the ground at ${apName}.` : 'On the ground.', 'land-' + hex);
        this.map.delete(hex); continue;
      }
      if (now - r.ts > LOST_MS) {
        const low = (r.alt || 0) < 1500 && ap && ap.km < 30;
        this.tell(low ? `${w.name} has probably landed` : `${w.name}: no signal`, low ? `Last heard low near ${apName}, ${Math.round((now - r.ts) / 60e3)} min ago.` : `Nothing heard for ${Math.round((now - r.ts) / 60e3)} min.`, 'land-' + hex);
        this.map.delete(hex); continue;
      }
      if (!w.final && ap) {
        const ph = flightPhase({ ...r, cls: airClass(r).cls }, ap);
        if (ph.phase === 'final') { w.final = true; this.tell(`${w.name} is on final`, `Landing at ${apName} in a few minutes.`, 'final-' + hex); }
      }
    }
  },
};
setInterval(() => { if (LandWatch.map.size) LandWatch.check(); }, 10e3);
