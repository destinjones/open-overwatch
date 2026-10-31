// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Shared mutable state and late-bound hooks, so feature modules don't import the UI (which imports them).
import { latch } from '../core/slices.js';
export const state = {
  selected: null,        // the object whose card is open
  lookingAtMoon: false,  // the Moon preset parks the camera with lookAt; any other move must release it
};
export const hooks = {
  reselect: () => {},         // re-render the card for an object (after follow starts/stops)
  updateStats: () => {},
  applyVisibility: () => {},
  clearPresets: () => {},
};
/** Opens once the globe is showing and the browser has had an idle moment after it (main.js). Layers that are on by
 *  default wait for it, so their downloads and thousands of points come after the first picture, not in the boot. */
export const settled = latch();
