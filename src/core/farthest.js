// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// "Farthest from home" on the Tonight card (src/globe/tonight.js): the spacecraft farthest from Earth now and how long
// their radio signals take. Worked out in core/farthest.worker.js, so the 1.9 MB of data/solar/spacecraft.json is
// parsed off the main thread (a 432 ms task on a phone when the card opened); farthestCraft runs on the page only if
// the worker can't.
import { craftAt } from './sky.js';
import { earthPosition } from './planets.js';
import { jdFromMs } from './time.js';

/** Last contact with craft that still have a published track but have fallen silent. */
export const SILENT = { 'Pioneer 10': 2003, 'Pioneer 11': 1995 };
const AU_KM = 149597870.7, LIGHT_S_PER_AU = 499.004784;

/** The `limit` spacecraft farthest from Earth at time `now` (ms): [{ name, au, text }], farthest first. all: spacecraft.json. */
export function farthestCraft(all, now, limit = 4) {
  const jd = jdFromMs(now), E = earthPosition(jd);
  return all.map(c => {
    const p = craftAt(c, jd); if (!p) return null;
    const au = Math.hypot(p.x - E.x, p.y - E.y, p.z - E.z), mm = Math.round(au * LIGHT_S_PER_AU / 60), h = Math.floor(mm / 60), m = mm % 60, km = au * AU_KM;
    const took = `${h ? h + ' h ' : ''}${m} min`;
    return { name: c.name, au, text: `${c.name}: ${km > 1e9 ? (km / 1e9).toFixed(1) + ' billion' : Math.round(km / 1e6) + ' million'} km away (${au.toFixed(au < 10 ? 2 : 0)} AU). ${SILENT[c.name] ? `Silent since ${SILENT[c.name]}; a signal from there would take ${took}.` : `Its radio signal takes ${took} to reach us.`}` };
  }).filter(Boolean).sort((a, b) => b.au - a.au).slice(0, limit);
}
