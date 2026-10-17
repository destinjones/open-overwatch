// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The Open Overwatch MCP server, assembled: the network layer, the tools and the globe panel behind the protocol handler.
// mcp/server.mjs runs it over stdio; tests build it with their own fetch, SGP4 and clock.
import { createFeeds, SITE, VERSION, ToolError } from './feeds.mjs';
import { createTools, INSTRUCTIONS } from './tools.mjs';
import { panelResource } from './panel.mjs';
import { createMcpServer } from './protocol.mjs';
import { PROMPTS } from './prompts.mjs';

export { VERSION, SITE };

/**
 * { handle(message, { signal }) }. Options: site (links and data copies), fetchImpl, sgp4 (satellite.js or a stand-in), now,
 * log, importSgp4 (how satellite.js loads when sgp4 is not given); memo and shared (createFeeds': answers kept between servers, and a cache in front of the network); omit (names of
 * tools to leave out: the Worker's free plan can't afford the heaviest).
 */
export function createOverwatchServer({ site = SITE, fetchImpl, sgp4, now = Date.now, log = () => {}, importSgp4 = () => import('satellite.js'), memo, shared, omit = [] } = {}) {
  const base = new URL(site).href.replace(/\/?$/, '/');
  const feeds = createFeeds({ fetchImpl, site: base, memo, shared });
  let lib = null;
  const load = () => (lib = lib || importSgp4().catch(() => { lib = null; throw new ToolError('satellite.js is missing: run npm install in the open-overwatch folder', 'unavailable'); }));
  const ctx = { feeds, now, sgp4: sgp4 ? async () => sgp4 : load };
  return createMcpServer({ name: 'open-overwatch', title: 'Open Overwatch', version: VERSION, instructions: INSTRUCTIONS, tools: createTools(ctx).filter(t => !omit.includes(t.name)), resources: [panelResource(base, VERSION)], prompts: PROMPTS, log });
}
