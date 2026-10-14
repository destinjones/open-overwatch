// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// traffic_cameras: the public traffic cameras near a place (the networks the globe and the 2D map show, src/core/cameras.js),
// nearest first, with the latest still from the nearest few sent as pictures the model can look at. Live-video-only
// cameras (Delaware, Missouri) are listed with their stream link. Lists are kept 10 minutes, pictures 30 seconds.
import { CAMERA_NETS as CAM_NETS, camNetsNear, camsNear, camCoverage, netOf, imageType } from '../src/core/cameras.js';
import { estimatePose } from '../src/core/campose.js';
import { compass } from '../src/core/passes.js';
import { ToolError } from './feeds.mjs';
import { rep, lineFor } from '../src/core/liveprov.js';
import { areaProps, resolveArea, frame, globeUrl } from './place.mjs';
import { iso, r2, km, plural, areaData, limitProp, take, base64 } from './words.mjs';

const MAX_PICTURE = 1.5e6;   // bytes: a camera still is 20-300 KB; anything bigger is not one

export function camerasTool(ctx) {
  const { feeds } = ctx, site = feeds.siteBase;
  /** One network's cameras (its list cached 10 min; Singapore's a minute: its picture addresses change every capture). */
  async function load(id, signal) {
    const n = CAM_NETS[id], ttl = id === 'sg' ? 60e3 : 10 * 60e3;
    const d = await (n.xml ? feeds.text : feeds.json)(n.url, { ttl, timeout: 60e3, signal });
    return n.parse(d);
  }
  /** The camera's latest still as MCP image content, or null (no still, or the agency did not send a picture). */
  async function picture(cam, signal) {
    if (!cam.image) return null;
    const got = await feeds.bytes(cam.image, { ttl: 30e3, timeout: 15e3, maxBytes: MAX_PICTURE, headers: { Accept: 'image/*' }, signal }).catch(() => null);
    const type = got && imageType(got.bytes);
    return type ? { data: base64(got.bytes), mimeType: type } : null;
  }

  return {
    name: 'traffic_cameras',
    title: 'Traffic cameras near a place',
    description: `Public traffic cameras near a place, nearest first, from the agencies' own open feeds (${camCoverage().join(', ')}): name, road and view, distance, a guess at which way it faces, and its latest picture as an image for the nearest few (or its live video stream link). Its link opens the globe's camera layer there, where a camera's picture can be projected into the 3D city.`,
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        ...areaProps('to look (default 5 km, at most 100)'),
        pictures: { type: 'integer', minimum: 0, maximum: 4, description: 'How many of the nearest cameras to send the latest picture of (default 1, 0 for none).' },
        limit: limitProp(8, 30),
      },
    },
    async run(a, { signal }) {
      const area = await resolveArea(a, feeds, { need: true, pointKm: 5, signal });
      const radius = Math.min(100, a.radius_km ?? (area.kind === 'point' ? 5 : Math.min(area.radiusKm, 25)));
      const ids = camNetsNear(area.lat, area.lon, radius);
      if (!ids.length) throw new ToolError(`No public camera network this server reads covers ${area.label}. Cameras: ${camCoverage().join(', ')}.`, 'not_found');
      const lists = await Promise.all(ids.map(id => load(id, signal).then(l => l, e => ({ failed: id, why: e.message }))));
      const failed = lists.filter(l => l.failed), cams = lists.filter(l => Array.isArray(l)).flat();
      if (!cams.length && failed.length) throw new ToolError(`The camera list${failed.length > 1 ? 's' : ''} for ${area.label} did not load (${failed.map(f => CAM_NETS[f.failed].name).join(', ')}): ${failed[0].why}`, 'unavailable');
      const seen = new Set(), near = camsNear(cams.filter(c => !seen.has(c.id) && seen.add(c.id)), area.lat, area.lon, radius);
      const shown = take(near, a.limit || 8), want = Math.min(a.pictures ?? 1, shown.length);
      const pics = [];
      for (const c of shown) {   // the nearest ones that have a picture right now
        if (pics.length >= want) break;
        if (c.online === false || !c.image) continue;
        const p = await picture(c, signal);
        if (p) pics.push({ cam: c, ...p });
      }
      const rows = shown.map(c => {
        const pose = estimatePose(c), net = netOf(c), pic = pics.find(p => p.cam === c);
        return { provenance: lineFor('cameras', [rep('cameras', { name: net ? net.name : String(c.net || 'camera network'), dataAt: c.t || null })]), id: c.id, name: String(c.name || 'Camera'), network: net ? net.name : c.net, view: c.view || null, lat: +c.lat.toFixed(5), lon: +c.lon.toFixed(5), distance_km: r2(c.km),
          facing_guess: pose && pose.source === 'words' ? `${compass(pose.heading)} (from its name)` : null, online: c.online !== false,
          picture: c.image || null, picture_attached: !!pic, video: c.video || null, live_video: /\.m3u8(\?|$)/i.test(c.video || ''), source_page: c.link || null, credit: net ? net.credit : null };
      });
      const url = globeUrl(site, { camera: frame(area.lat, area.lon, Math.max(0.6, Math.min(radius, 8)), { tilt: 50 }), on: ['cams'] });
      const head = near.length ? `${plural(near.length, 'traffic camera')} within ${km(radius)} of ${area.label}${near.length > shown.length ? `; the nearest ${shown.length}:` : ':'}`
        : `No traffic cameras within ${km(radius)} of ${area.label}${ids.length ? ` (the nearest network here: ${CAM_NETS[ids[0]].name}; try a larger radius_km)` : ''}.`;
      const lines = rows.map(r => `${r.name}${r.view ? ` (${r.view})` : ''} · ${r.network} · ${km(r.distance_km)} away${r.facing_guess ? ` · faces ${r.facing_guess}` : ''}${r.online ? '' : ' · offline'}${r.picture_attached ? ' · latest picture attached' : r.live_video ? ` · live video ${r.video}` : r.picture ? ` · picture ${r.picture}` : ''}`);
      const notes = [failed.length ? `(${failed.map(f => CAM_NETS[f.failed].name).join(', ')} did not answer just now.)` : '', pics.length ? `The picture${pics.length > 1 ? 's are' : ' is'} the agency's latest still, as of ${iso(ctx.now())}.` : '',
        rows.some(r => r.facing_guess) ? 'Feeds do not say which way a camera points: "faces" is a guess from its name.' : ''].filter(Boolean);
      return { text: [head, ...lines, ...notes, `Cameras on the globe (click one to project its picture into 3D): ${url}`].join('\n'),
        data: { total: near.length, radius_km: radius, cameras: rows, area: areaData(area), networks: ids.map(id => CAM_NETS[id].name), url, source: [...new Set(rows.map(r => r.credit).filter(Boolean))].join('; ') || 'Public traffic camera feeds' },
        images: pics.map(p => ({ data: p.data, mimeType: p.mimeType })) };
    },
  };
}
