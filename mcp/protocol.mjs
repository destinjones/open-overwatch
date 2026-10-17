// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The Model Context Protocol over JSON-RPC 2.0, by hand (no SDK, so the package has one small dependency): initialize, ping,
// tools/list and tools/call, resources/list and resources/read (the globe panel), prompts. Transport-free (no Node
// built-ins, so it runs on a Worker too): stdio is mcp/stdio.mjs, Streamable HTTP mcp/http.mjs.
// Arguments are checked against each tool's schema before it runs; failures reach the model as tool errors it can act on.
import { ToolError } from './feeds.mjs';

/** Protocol revisions this server speaks, newest first. */
export const PROTOCOL_VERSIONS = Object.freeze(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']);
const E = { PARSE: -32700, REQUEST: -32600, METHOD: -32601, PARAMS: -32602, INTERNAL: -32603, RESOURCE: -32002 };
const rpcError = (code, message) => Object.assign(new Error(message), { rpc: code });
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Check (and gently coerce: "3" -> 3, "true" -> true) arguments against the JSON Schema subset the tools use. Returns
 * the cleaned arguments or throws ToolError('invalid_arguments') naming the first problem.
 */
export function checkArgs(schema, args) {
  const a = args == null ? {} : args;
  if (!isObj(a)) throw new ToolError('Arguments must be an object', 'invalid_arguments');
  const props = schema.properties || {}, out = {};
  for (const k of Object.keys(a)) if (!props[k] && schema.additionalProperties === false) throw new ToolError(`Unknown argument "${k}"`, 'invalid_arguments');
  for (const r of schema.required || []) if (a[r] == null) throw new ToolError(`"${r}" is required`, 'invalid_arguments');
  for (const [k, p] of Object.entries(props)) {
    let v = a[k];
    if (v == null) continue;
    out[k] = v = value(k, p, v);
  }
  return out;
}
function value(k, p, v) {
  const bad = why => { throw new ToolError(`"${k}" ${why}`, 'invalid_arguments'); };
  if (p.type === 'number' || p.type === 'integer') {
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v)) v = +v;
    if (typeof v !== 'number' || !Number.isFinite(v)) bad('must be a number');
    if (p.type === 'integer' && !Number.isInteger(v)) v = Math.round(v);
    if (p.minimum != null && v < p.minimum) bad(`must be at least ${p.minimum}`);
    if (p.maximum != null && v > p.maximum) bad(`must be at most ${p.maximum}`);
  } else if (p.type === 'boolean') {
    if (v === 'true' || v === 'false') v = v === 'true';
    if (typeof v !== 'boolean') bad('must be true or false');
  } else if (p.type === 'string') {
    if (typeof v === 'number') v = String(v);
    if (typeof v !== 'string') bad('must be text');
    if (p.maxLength != null && v.length > p.maxLength) bad(`must be at most ${p.maxLength} characters`);
    if (p.enum && !p.enum.includes(v)) bad(`must be one of: ${p.enum.join(', ')}`);
    if (p.pattern && !new RegExp(p.pattern).test(v)) bad('is not in the expected form');
  } else if (p.type === 'array') {
    if (typeof v === 'string') v = v.split(',').map(s => s.trim()).filter(Boolean);
    if (!Array.isArray(v)) bad('must be a list');
    if (p.maxItems != null && v.length > p.maxItems) bad(`must have at most ${p.maxItems} items`);
    v = v.map((x, i) => value(`${k}[${i}]`, p.items || {}, x));
  }
  return v;
}

/** The tool as MCP lists it. */
function describe(t) {
  return { name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
    annotations: { title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    ...(t.ui ? { _meta: { ui: { resourceUri: t.ui.resourceUri }, 'ui/resourceUri': t.ui.resourceUri } } : {}) };   // the flat key: hosts from before the spec settled
}

/**
 * tools: [{ name, title, description, inputSchema, ui?, run(args, { signal }) -> { text, data, images? } }] (images: [{ data
 * (base64), mimeType }], sent as image content after the text); prompts: [{ name, title, description, arguments: [{ name,
 * description, required }], render(args) -> text }] (one user message each); resources: [{ uri, name,
 * title, description, mimeType, text, _meta }]. handle(message, { signal }) resolves to the response, or null for notifications.
 * @param {{ name: string, title?: string, version: string, instructions?: string, tools: any[], resources?: any[], prompts?: readonly any[], log?: (line: string) => void }} opts
 */
export function createMcpServer({ name, title, version, instructions, tools, resources = [], prompts = [], log = () => {} }) {
  const byName = new Map(tools.map(t => [t.name, t])), byUri = new Map(resources.map(r => [r.uri, r]));
  const methods = {
    initialize(p) {
      const asked = p && p.protocolVersion;
      return { protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false }, ...(resources.length ? { resources: { listChanged: false } } : {}), ...(prompts.length ? { prompts: { listChanged: false } } : {}) },
        serverInfo: { name, title, version }, ...(instructions ? { instructions } : {}) };
    },
    ping: () => ({}),
    'tools/list': () => ({ tools: tools.map(describe) }),
    'resources/list': () => ({ resources: resources.map(({ text, ...r }) => r) }),
    'resources/templates/list': () => ({ resourceTemplates: [] }),
    'prompts/list': () => ({ prompts: prompts.map(({ render, ...p }) => p) }),
    'prompts/get'(p) {
      const pr = prompts.find(x => x.name === (p && p.name));
      if (!pr) throw rpcError(E.PARAMS, `Unknown prompt: ${p && p.name}`);
      const args = isObj(p.arguments) ? p.arguments : {};
      for (const a of pr.arguments || []) {
        const v = args[a.name];
        if (v != null && (typeof v !== 'string' || v.length > 200)) throw rpcError(E.PARAMS, `"${a.name}" must be text of at most 200 characters`);
        if (a.required && !(typeof v === 'string' && v.trim())) throw rpcError(E.PARAMS, `"${a.name}" is required`);
      }
      return { description: pr.description, messages: [{ role: 'user', content: { type: 'text', text: pr.render(args) } }] };
    },
    'resources/read'(p) {
      const r = byUri.get(p && p.uri); if (!r) throw rpcError(E.RESOURCE, `Unknown resource: ${p && p.uri}`);
      return { contents: [{ uri: r.uri, mimeType: r.mimeType, text: r.text, ...(r._meta ? { _meta: r._meta } : {}) }] };
    },
    async 'tools/call'(p, { signal }) {
      const t = p && typeof p.name === 'string' ? byName.get(p.name) : null;
      if (!t) throw rpcError(E.PARAMS, `Unknown tool: ${p && p.name}`);
      const t0 = Date.now();
      try {
        const out = await t.run(checkArgs(t.inputSchema, p.arguments), { signal });
        log(`${t.name} ${Date.now() - t0} ms`);
        const images = (out.images || []).map(i => ({ type: 'image', data: i.data, mimeType: i.mimeType }));
        return { content: [{ type: 'text', text: out.text }, ...images], structuredContent: out.data, isError: false };
      } catch (e) {
        if (signal && signal.aborted) throw e;
        const known = e instanceof ToolError;
        log(`${t.name} failed after ${Date.now() - t0} ms: ${known ? e.message : (e && e.stack) || e}`);
        return { content: [{ type: 'text', text: known ? e.message : 'Something went wrong answering that; try again in a minute.' }], structuredContent: { error: known ? e.code : 'unavailable' }, isError: true };
      }
    },
  };
  return {
    /** @param {any} m @param {{ signal?: AbortSignal }} [opts] */
    async handle(m, { signal } = {}) {
      if (!isObj(m) || m.jsonrpc !== '2.0') return { jsonrpc: '2.0', id: (isObj(m) && m.id) ?? null, error: { code: E.REQUEST, message: 'Invalid JSON-RPC message' } };
      if (typeof m.method !== 'string') return null;   // a response to us: this server sends no requests
      if (m.id === undefined || m.id === null) return null;   // a notification (initialized, cancelled is handled by the transport)
      const fn = Object.hasOwn(methods, m.method) ? methods[m.method] : null;
      if (!fn) return { jsonrpc: '2.0', id: m.id, error: { code: E.METHOD, message: `Unknown method: ${m.method}` } };
      if (m.params !== undefined && !isObj(m.params)) return { jsonrpc: '2.0', id: m.id, error: { code: E.PARAMS, message: 'params must be an object' } };
      try { return { jsonrpc: '2.0', id: m.id, result: await fn(m.params, { signal }) }; }
      catch (e) { return { jsonrpc: '2.0', id: m.id, error: { code: e.rpc || E.INTERNAL, message: e.rpc ? e.message : 'Internal error' } }; }
    },
  };
}
