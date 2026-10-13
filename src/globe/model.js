// The weather models for the globe: NOAA's GFS (1°, newest complete run; every 3 h out to +120 h, +72 h on phones) with
// NOAA's WAVEWATCH III waves, and ECMWF's IFS (0.25°, CC BY 4.0) with its wave model, read straight from their files on
// AWS one field and one forecast hour at a time (core/wxload.js; fetching and decoding in core/model.worker.js, which
// thins 0.25° grids to 0.5°, 1° on phones: finer than the globe can show, and 4 MB a field).
import { PHONE } from './env.js';
import { makeModels } from '../core/wxload.js';

export const MAX_H = PHONE ? 72 : 120;
/** Every model the globe can show (forecast hours kept decoded per model: a 1° hour with every field is ~1.3 MB). */
export const Models = makeModels({ maxH: MAX_H, keep: PHONE ? 6 : 16, res: PHONE ? 1 : 0.5 });
/** GFS: the default, and the one older callers mean. */
export const Model = Models.gfs;
