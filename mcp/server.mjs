#!/usr/bin/env node
// Open Overwatch for Claude (and any MCP client): ask about the live Earth and get answers from public open data, each with
// a link that opens the 3D globe on it; hosts with MCP Apps (Claude Desktop) show the globe right in the conversation.
// No account, no keys, no local web server: it reads the public feeds and the website's own data copies.
//
//   npx -y open-overwatch-mcp            (once published to npm)
//   node mcp/server.mjs                  (from a checkout, after npm install)
//   --site <url>   where links point and the data copies come from (default: the website; a local copy for testing)
//
// Speaks MCP over stdio. Diagnostics go to stderr, one line per call (the tool and its time; never the arguments).
import { createOverwatchServer, SITE, VERSION } from './index.mjs';
import { serveStdio } from './protocol.mjs';

const HELP = `open-overwatch-mcp ${VERSION}: an MCP server (stdio) for the live Earth.
  --site <url>   the Open Overwatch site to link to and read data copies from (default ${SITE})
  --version      print the version
  --help         this text
Setup for Claude Desktop, Claude Code and other clients: https://github.com/destinjones/open-overwatch/blob/main/mcp/README.md`;

try {
  const argv = process.argv.slice(2), o = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--site' && argv[i + 1]) o.site = argv[++i];
    else if (argv[i] === '--version' || argv[i] === '-v') o.version = true;
    else if (argv[i] === '--help' || argv[i] === '-h') o.help = true;
    else throw new Error(`Unknown argument: ${argv[i]} (try --help)`);
  }
  if (o.version || o.help) console.log(o.version ? VERSION : HELP);
  else {
    const site = o.site || process.env.OO_SITE || SITE;
    if (!/^https?:\/\/[^\s]+$/.test(site)) throw new Error('--site must be an http(s) address');
    console.error(`open-overwatch-mcp ${VERSION} · links to ${site}`);
    await serveStdio(createOverwatchServer({ site, log: line => console.error(`· ${line}`) }));
  }
} catch (e) {
  console.error(e.message); process.exitCode = 1;
}
