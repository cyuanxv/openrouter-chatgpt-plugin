import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { stopOwnedChild, waitUntilReady } from './smoke-lifecycle.mjs';
const cwd = fileURLToPath(new URL('..', import.meta.url));
for (const filename of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  assert.equal(existsSync(join(cwd, filename)), false, 'Run this isolated smoke from a clean checkout without real environment files');
}
const reserve = createServer();
await new Promise((resolve, reject) => reserve.once('error', reject).listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const base = `http://127.0.0.1:${port}`;
const token = 'synthetic-smoke-only-not-a-real-credential';
async function start(configured) {
  const env = { PATH: process.env.PATH, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', NODE_OPTIONS: `--require=${JSON.stringify(fileURLToPath(new URL('./smoke-deny-upstream.cjs', import.meta.url)))}`, OPENROUTER_MANAGEMENT_KEY: 'synthetic-smoke-only-placeholder' };
  if (configured) env.MCP_AUTH_TOKEN = token;
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  // Do not surface raw server diagnostics; the environment is synthetic anyway.
  child.stdout.resume();
  child.stderr.resume();
  return waitUntilReady(child, async () => {
    const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
    return response.ok;
  });
}

function parseRpc(text) {
  if (text.startsWith('{')) return JSON.parse(text);
  const line = text.split('\n').find((line) => line.startsWith('data: '));
  assert.ok(line, 'Expected a JSON-RPC SSE data message');
  return JSON.parse(line.slice(6));
}
async function rpc(id, method, params, session) {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-03-26' };
  if (session) headers['mcp-session-id'] = session;
  const response = await fetch(`${base}/api/mcp`, { method: 'POST', headers, signal: AbortSignal.timeout(5000), body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
  const text = await response.text();
  assert.equal(response.status, 200, `RPC ${method} failed`);
  const body = parseRpc(text);
  assert.equal(body.error, undefined, JSON.stringify(body.error));
  return { body, session: response.headers.get('mcp-session-id') };
}
let child;
try {
  child = await start(true);
  for (const headers of [{}, { authorization: 'Bearer wrong' }]) {
    const response = await fetch(`${base}/api/mcp`, { headers, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate'), /Bearer/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const initialized = await rpc(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'routerlens-offline-smoke', version: '0.0.0' } });
  assert.equal(initialized.body.result.protocolVersion, '2025-03-26');
  const listed = await rpc(2, 'tools/list', {}, initialized.session);
  assert.equal(listed.body.result.tools.length, 8);
  assert.ok(listed.body.result.tools.every((tool) => tool.annotations.readOnlyHint === true));
  const status = await rpc(3, 'tools/call', { name: 'routerlens_status', arguments: {} }, initialized.session);
  assert.equal(status.body.result.structuredContent.management_key_configured, true);
  assert.equal(status.body.result.structuredContent.connectivity_verified, false);
  assert.equal(status.body.result.structuredContent.version, '0.3.1');
  assert.doesNotMatch(JSON.stringify(status.body), /synthetic-smoke-only/);
  console.log('PASS: production-build HTTP auth 401, MCP initialize, eight read-only tools, safe status');
} finally { if (child) await stopOwnedChild(child); }
child = undefined;
try {
  child = await start(false);
  const response = await fetch(`${base}/api/mcp`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  console.log('PASS: missing authentication configuration fails closed with HTTP 503');
} finally { if (child) await stopOwnedChild(child); }
