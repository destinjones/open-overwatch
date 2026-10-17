// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Who owns the globe's details card. Several modules write #card themselves and start something with it: a 10 Hz
// close-approach HUD, rings round the Earth, a chase-camera launch replay, a highlighted re-entry corridor. Each one
// registers a stop function under the marker attribute its card carries (data-cj, data-fb...). check() runs once the
// card has changed: every owner whose card was closed (by any route: ×, Esc, a click on the globe, the phone's Layers
// button) or replaced by another card is stopped, once. DOM-free: ui.js passes whether the card shows and a test for
// whether it still holds a marker.

/** @typedef {{ own(marker: string, stop: () => void): void, check(shown: boolean, has: (marker: string) => boolean): string[], readonly size: number }} CardOwners */

/** @returns {CardOwners} */
export function cardOwners() {
  /** @type {Map<string, () => void>} */
  const owners = new Map();
  return {
    /** Register the owner of the card that carries `marker` (a second call for the same marker replaces the first). */
    own(marker, stop) { owners.set(marker, stop); },
    /** Stop and forget every owner whose card is gone; returns their markers. One stop that throws doesn't keep the rest running. */
    check(shown, has) {
      const gone = [];
      for (const [m, stop] of owners) {
        if (shown && has(m)) continue;
        owners.delete(m); gone.push(m);
        try { stop(); } catch (e) { console.warn('card owner', m, e); }
      }
      return gone;
    },
    get size() { return owners.size; },
  };
}
