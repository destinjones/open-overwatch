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
  try { return PUBLIC_RELAY_HOSTS.includes(new URL(url).hostname) || adsbLolRelayable(url); } catch (e) { return false; }
}
/** True on the published site (the relay answers only that origin). */
export const onPublishedSite = host => host === 'destinjones.github.io';
