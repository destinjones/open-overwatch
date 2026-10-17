// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The public relay for the published website (relay/worker.js, a Cloudflare Worker): it adds the CORS headers a few
// feeds don't send. Only feeds whose owners' terms allow it go through it. adsb.lol (ODbL, "available to everyone") is
// carried for the queries every visitor asks alike (core/airgrid.js: the military list, emergency squawks, area queries on
// a fixed grid), so its edge cache shares one answer among all of them. OpenSky's terms forbid passing its data on and
// need a written licence for any live service, and adsb.fi (personal use) and airplanes.live (written permission) don't
// allow it either: those stay with the download's local helper.
import { adsbLolRelayable } from './airgrid.js';

export const PUBLIC_RELAY = 'https://open-overwatch-relay.destinjones123.workers.dev/?url=';
export const PUBLIC_RELAY_HOSTS = Object.freeze(['www.nhc.noaa.gov', 'webcams.nyctmc.org', 'www.submarinecablemap.com',
  'www.drivebc.ca', 'traveler.modot.org', 'kamera.atlas.vegvesen.no', 'atmsqf.iowadot.gov', 'trafficcam.calgary.ca', 'images.data.gov.sg', 'www.ndbc.noaa.gov']);   // = relay/worker.js TTL
/** Whether the public relay carries url: a listed host, or one of the adsb.lol queries in core/airgrid.js. */
export function publicRelayable(url) {
  try { return (PUBLIC_RELAY_HOSTS.includes(new URL(url).hostname) || adsbLolRelayable(url)) && carried(url); } catch (e) { return false; }
}
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
