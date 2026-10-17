// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// A satellite's Earth-fixed velocity from the inertial one SGP4 already returns, so a position and a velocity cost one
// propagation instead of two (the views used to difference two positions a second apart). TEME to pseudo Earth-fixed
// is a turn by GMST about z (satellite.js eciToEcf, no polar motion), and that frame turns with the Earth, so
// v_ecf = R(gmst) v_eci - omega x r_ecf. eciVelToEcf is self-contained: the satellite workers inline it with toString().

/** Earth's rotation rate, rad/s (sidereal). */
export const EARTH_RATE = 7.2921159e-5;

/** Earth-fixed velocity (km/s) from the Earth-fixed position rEcf (km), the inertial velocity vEci (km/s) and GMST (rad). */
export function eciVelToEcf(rEcf, vEci, gmst, out = {}) {
  const w = 7.2921159e-5, c = Math.cos(gmst), s = Math.sin(gmst);   // EARTH_RATE, written out: the workers get only this function's text
  out.x = vEci.x * c + vEci.y * s + w * rEcf.y;
  out.y = -vEci.x * s + vEci.y * c - w * rEcf.x;
  out.z = vEci.z;
  return out;
}
