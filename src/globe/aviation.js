// Aviation on the globe, in one import for main.js: what a plane is and where it is going (acinfo.js, aircard.js), its
// trail (trails.js) and route (routeline.js), the weather it is flying through (cockpitwx.js), and airports with their boards (airports.js),
// METAR/TAF and category dots (fieldwx.js) and the runways they have been using (fieldwatch.js).
import { AcInfo } from './acinfo.js';
import { Trails } from './trails.js';
import { CockpitWx } from './cockpitwx.js';
import { Airports } from './airports.js';
import { RouteLine } from './routeline.js';
import { LandWatch } from './landwatch.js';
import { TowerView } from './towerview.js';
import { FieldWx } from './fieldwx.js';
import { FieldWatch } from './fieldwatch.js';
import './aircard.js';

export { Airports };
export const Aviation = { AcInfo, Trails, CockpitWx, Airports, RouteLine, LandWatch, TowerView, FieldWx, FieldWatch };
