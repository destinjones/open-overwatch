// The Open Overwatch MCP server, assembled: the network layer, the tools and the globe panel behind the protocol handler.
// mcp/server.mjs runs it over stdio; tests build it with their own fetch, SGP4 and clock.
import { createFeeds, SITE, VERSION } from './feeds.mjs';
import { createTools, INSTRUCTIONS } from './tools.mjs';
import { panelResource } from './panel.mjs';
import { createMcpServer } from './protocol.mjs';

export { VERSION, SITE };

/** { handle(message, { signal }) }. Options: site (links and data copies), fetchImpl, sgp4 (satellite.js or a stand-in), now, log. */
export function createOverwatchServer({ site = SITE, fetchImpl, sgp4, now = Date.now, log = () => {} } = {}) {
  const base = new URL(site).href.replace(/\/?$/, '/');
  const feeds = createFeeds({ fetchImpl, site: base });
  let lib = null;
  const load = () => (lib = lib || import('satellite.js').catch(() => { lib = null; throw new Error('satellite.js is missing: run npm install in the open-overwatch folder'); }));
  const ctx = { feeds, now, sgp4: sgp4 ? async () => sgp4 : load };
  return createMcpServer({ name: 'open-overwatch', title: 'Open Overwatch', version: VERSION, instructions: INSTRUCTIONS, tools: createTools(ctx), resources: [panelResource(base, VERSION)], log });
}
