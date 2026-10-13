// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The public relay for the published website (relay/worker.js, a Cloudflare Worker): it adds the CORS headers a few
// feeds don't send. Only feeds whose owners accept it go through it. The ADS-B networks and OpenSky refuse Cloudflare's
// servers (429 / 403 / timeouts, checked 2026-10-10), so live aircraft still need the download's local helper.
export const PUBLIC_RELAY = 'https://open-overwatch-relay.destinjones123.workers.dev/?url=';
export const PUBLIC_RELAY_HOSTS = Object.freeze(['www.nhc.noaa.gov', 'webcams.nyctmc.org', 'www.submarinecablemap.com',
  'www.drivebc.ca', 'traveler.modot.org', 'kamera.atlas.vegvesen.no', 'atmsqf.iowadot.gov', 'trafficcam.calgary.ca', 'images.data.gov.sg']);   // = relay/worker.js TTL
/** True on the published site (the relay answers only that origin). */
export const onPublishedSite = host => host === 'destinjones.github.io';
