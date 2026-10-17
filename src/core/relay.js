// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The public relay for the published website (relay/worker.js, a Cloudflare Worker): it adds the CORS headers a few
// feeds don't send. Only feeds whose owners' terms allow it go through it. Aircraft don't: adsb.lol answers Cloudflare's
// servers with 429, OpenSky's terms forbid passing its data on and need a written licence for any live service, and
// adsb.fi (personal use) and airplanes.live (written permission) don't allow it either: those stay with the download's
// local helper, which asks them from the visitor's own address.
export const PUBLIC_RELAY = 'https://open-overwatch-relay.destinjones123.workers.dev/?url=';
export const PUBLIC_RELAY_HOSTS = Object.freeze(['www.nhc.noaa.gov', 'webcams.nyctmc.org', 'www.submarinecablemap.com',
  'www.drivebc.ca', 'traveler.modot.org', 'kamera.atlas.vegvesen.no', 'atmsqf.iowadot.gov', 'trafficcam.calgary.ca', 'images.data.gov.sg', 'www.ndbc.noaa.gov',
  'www.tsunami.gov']);   // = relay/worker.js TTL (test/relayhosts.test.mjs checks)
/** Whether the public relay carries url's host (and hasn't refused it in this visit). */
export function publicRelayable(url) {
  try { return PUBLIC_RELAY_HOSTS.includes(new URL(url).hostname) && carried(url); } catch (e) { return false; }
}
/** The public relay's URL for a feed, in the one form it accepts (the normalised URL, encoded): any other spelling of
 *  the same feed would be a separate entry in its shared cache, so the Worker answers those with a 400. */
export const relayUrl = url => PUBLIC_RELAY + encodeURIComponent(new URL(url).href);
/** Whether a relay answer is the Worker refusing the host (its own 403 text), not the feed itself refusing (an OpenSky or FIRMS 403). */
export const relayRefused = (status, body) => status === 403 && /host not on the relay allowlist/.test(String(body || ''));
// hosts the deployed Worker refused in this visit (it can lag behind the list above: a rollback, a redeploy not done yet).
// Kept in memory only, so the next visit asks again and a redeploy heals by itself.
const refused = new Set();
/** Note that the deployed relay refused this host: the page stops asking it for the rest of the visit. */
export function markNotCarried(host) { refused.add(String(host || '')); }
/** False once the deployed relay has refused url's host in this visit. */
export function carried(url) { try { return !refused.has(new URL(url).hostname); } catch (e) { return false; } }
/** True on the published site (the relay answers only that origin). */
export const onPublishedSite = host => host === 'destinjones.github.io';
