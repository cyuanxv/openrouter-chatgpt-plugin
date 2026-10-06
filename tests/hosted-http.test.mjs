import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
const require = createRequire(import.meta.url);
// The package creates a housekeeping interval on first handler construction.
// Record only intervals created during this import and clean them up afterward.
const ownedIntervals = [];
const originalInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => { const timer = originalInterval(...args); ownedIntervals.push(timer); return timer; };
const { createRouterLensRoutes } = require('../.test-build/lib/mcpRuntime.js');
globalThis.setInterval = originalInterval;
after(() => ownedIntervals.forEach(clearInterval));
const { assertGatewayAccess } = require('../.test-build/lib/hosted/readClient.js');

// Ephemeral synthetic signing material never leaves this test process.
const pair = await generateKeyPair('ES256');
const publicKey = { ...await exportJWK(pair.publicKey), kid: 'synthetic-http-key', alg: 'ES256', use: 'sig' };
const policy = {
  issuer: 'https://issuer.example.test/auth/v1', resource: 'https://routerlens.example.test/api/mcp',
  jwksUrl: 'https://issuer.example.test/auth/v1/.well-known/jwks.json',
  allowedClientIds: ['synthetic-client'], requiredScopes: ['routerlens:read'], algorithms: ['ES256']
};
async function token(subject = 'alice', extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: policy.issuer, aud: policy.resource, sub: subject, client_id: 'synthetic-client', session_id: `session-${subject}`, scope: 'routerlens:read', iat: now - 1, exp: now + 120, ...extra })
    .setProtectedHeader({ alg: 'ES256', kid: publicKey.kid }).sign(pair.privateKey);
}
function fixture(overrides = {}) {
  const revoked = new Set();
  const bindings = new Map(['alice', 'bob'].map((subject) => [subject, { id: `binding-${subject}`, issuer: policy.issuer, subject, resource: policy.resource, credentialReference: `opaque-${subject}`, revision: 1, state: 'active', allowedClientIds: ['synthetic-client'], grants: ['credits:read', 'analytics:read', 'keys:read'] }]));
  const operations = [];
  const repository = {
    async isSessionActive(p) { return !revoked.has(p.subject) && p.sessionId === `session-${p.subject}`; },
    async findForOwner(owner) { return bindings.get(owner.subject) ?? null; }
  };
  const gateway = { async executeIfCurrent(input) {
    await Promise.resolve();
    if (overrides.beforeRead) await overrides.beforeRead(input, bindings);
    assertGatewayAccess({ ...input, binding: bindings.get(input.principal.subject), sessionActive: await repository.isSessionActive(input.principal) });
    operations.push({ subject: input.principal.subject, operation: input.operation });
    const value = input.principal.subject === 'alice' ? 20 : 60;
    switch (input.operation.kind) {
      case 'credits': return { data: { total_credits: 100, total_usage: value } };
      case 'analytics_meta': return { data: { metrics: [{ name: 'total_usage', display_format: 'currency', is_rate: false }], dimensions: [], operators: [], granularities: [] } };
      case 'analytics_query': return { data: { data: [{ total_usage: value / 10 }], metadata: { truncated: false } } };
      case 'key_metadata': return { data: [{ hash: `synthetic-hash-${input.principal.subject}`, usage: value }] };
    }
  } };
  const routes = createRouterLensRoutes({ mode: 'oauth', policy: overrides.policy ?? policy, publicJwks: { keys: [publicKey] }, repository, gateway,
    publicClient: { async listModels() { return { data: [] }; }, async getModelEndpoints() { return { data: { endpoints: [] } }; } } });
  return { routes, bindings, revoked, operations, repository };
}
async function serve(t, routes) {
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const request = new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers, ...(body.length ? { body } : {}) });
      const response = req.url.startsWith('/.well-known/') ? await routes.metadata() : req.method === 'OPTIONS' ? routes.options() : await routes.handle(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(500); res.end('Synthetic harness failed'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, init) => {
    assert.equal(new URL(url).origin, base, 'No upstream requests may leave this HTTP test');
    return originalFetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(5000) });
  });
  let id = 0;
  async function rpc(accessToken, method, params = {}, extraHeaders = {}) {
    const response = await fetch(`${base}/api/mcp`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', 'mcp-protocol-version': '2025-03-26', ...extraHeaders }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    const text = await response.text();
    const data = text.startsWith('{') ? text : text.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
    return { response, body: data ? JSON.parse(data) : null };
  }
  return { base, rpc };
}

test('real HTTP exposes trusted OAuth metadata and rejects missing, invalid and insufficient tokens', async (t) => {
  const f = fixture(); const { base, rpc } = await serve(t, f.routes);
  const metadata = await fetch(`${base}/.well-known/oauth-protected-resource/api/mcp`, { headers: { 'x-forwarded-host': 'attacker.example.test' } });
  assert.deepEqual((await metadata.json()).authorization_servers, [policy.issuer]);
  const missing = await fetch(`${base}/api/mcp`);
  assert.equal(missing.status, 401);
  assert.match(missing.headers.get('www-authenticate'), /https:\/\/routerlens\.example\.test\/\.well-known\/oauth-protected-resource\/api\/mcp/);
  for (const value of ['invalid', await token('alice', { aud: 'authenticated' }), await token('alice', { exp: 1 })]) assert.equal((await rpc(value, 'tools/list')).response.status, 401);
  assert.equal((await rpc(await token('alice', { scope: 'openid' }), 'tools/list')).response.status, 403);
  assert.equal(f.operations.length, 0);
});

test('HTTP initialize and account/yesterday tools use the verified tenant client', async (t) => {
  const f = fixture(); const { rpc } = await serve(t, f.routes); const accessToken = await token();
  const initialized = await rpc(accessToken, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'synthetic-test', version: '0' } });
  assert.equal(initialized.response.status, 200);
  assert.equal((await rpc(accessToken, 'tools/list')).body.result.tools.length, 8);
  const account = await rpc(accessToken, 'tools/call', { name: 'get_account_summary', arguments: { timezone: 'Asia/Shanghai', include_spend_windows: true } });
  assert.equal(account.response.headers.get('cache-control'), 'no-store');
  assert.equal(account.body.result.structuredContent.remaining_credits, 80);
  assert.equal(account.body.result.structuredContent.spend_windows.yesterday.usd, 2);
  const query = await rpc(accessToken, 'tools/call', { name: 'query_usage', arguments: { preset: 'yesterday', timezone: 'Asia/Shanghai' } });
  assert.equal(query.body.result.structuredContent.totals.total_usage, 2);
  assert.equal(query.body.result.structuredContent.totals_complete, true);
  assert.ok(f.operations.every((read) => read.subject === 'alice'));
  assert.doesNotMatch(JSON.stringify(account.body), /opaque-alice|session-alice/);
});

test('concurrent HTTP users cannot select another account or use a global Management Key', async (t) => {
  process.env.OPENROUTER_MANAGEMENT_KEY = 'synthetic-global-key-must-not-be-used';
  t.after(() => { delete process.env.OPENROUTER_MANAGEMENT_KEY; });
  const f = fixture(); const { rpc } = await serve(t, f.routes);
  const [a, b] = await Promise.all([token('alice'), token('bob')]);
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => rpc(i % 2 ? b : a, 'tools/call', { name: 'get_account_summary', arguments: { include_spend_windows: false, user_id: i % 2 ? 'alice' : 'bob' } })));
  results.forEach((result, i) => assert.equal(result.body.result.structuredContent.remaining_credits, i % 2 ? 40 : 80));
  assert.equal(f.operations.length, 20);
  const status = await rpc(a, 'tools/call', { name: 'routerlens_status', arguments: {} });
  assert.equal(status.body.result.structuredContent.management_key_configured, null);
  assert.equal(status.body.result.structuredContent.mode, 'hosted-request-scoped');
});

test('HTTP rechecks session, action scope, binding ownership and revocation before account reads', async (t) => {
  const f = fixture({ policy: { ...policy, requiredScopes: ['credits:read'] } });
  const { rpc } = await serve(t, f.routes); const a = await token('alice', { scope: 'credits:read' });
  assert.equal((await rpc(a, 'tools/call', { name: 'list_api_keys', arguments: {} })).body.result.isError, true);
  assert.equal(f.operations.length, 0);
  f.bindings.set('alice', f.bindings.get('bob'));
  assert.equal((await rpc(a, 'tools/call', { name: 'get_account_summary', arguments: { include_spend_windows: false } })).body.result.isError, true);
  assert.equal(f.operations.length, 0);
  f.revoked.add('alice');
  assert.equal((await rpc(a, 'tools/list')).response.status, 403);
});

test('revocation between authorization and gateway dispatch prevents HTTP data disclosure', async (t) => {
  const f = fixture({ beforeRead(input, bindings) { const binding = bindings.get(input.principal.subject); bindings.set(input.principal.subject, { ...binding, revision: binding.revision + 1, state: 'revoked' }); } });
  const { rpc } = await serve(t, f.routes);
  const result = await rpc(await token(), 'tools/call', { name: 'get_account_summary', arguments: { include_spend_windows: false } });
  assert.equal(result.body.result.isError, true);
  assert.equal(result.body.result.structuredContent, undefined);
  assert.equal(f.operations.length, 0);
});

test('unconfigured hosted mode has no static bearer or discovery fallback', async (t) => {
  const routes = createRouterLensRoutes({ mode: 'unconfigured' }); const { base } = await serve(t, routes);
  for (const path of ['/api/mcp', '/.well-known/oauth-protected-resource/api/mcp']) {
    const response = await fetch(base + path, { headers: { authorization: 'Bearer synthetic-static-value' } });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

for (const mode of ['single-tenant', 'oauth']) test(`${mode} HTTP bounds malformed bodies and unsupported methods without upstream calls or rejected promises`, async (t) => {
  const f = fixture();
  const staticToken = 'synthetic-http-static-bearer';
  const routes = mode === 'oauth' ? f.routes : createRouterLensRoutes({ mode, getBearer: () => staticToken });
  const { base } = await serve(t, routes);
  const authorization = `Bearer ${mode === 'oauth' ? await token() : staticToken}`;
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.off('unhandledRejection', onUnhandled));
  const legacyBatch = await fetch(`${base}/api/mcp`, { method: 'POST', headers: { authorization, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-03-26' }, body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 2, method: 'ping' }]) });
  assert.equal(legacyBatch.status, 200);
  const batchText = await legacyBatch.text();
  const batchResults = batchText.split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)));
  assert.deepEqual(batchResults.map((value) => value.id).sort(), [1, 2]);
  assert.ok(batchResults.every((value) => value.result && !value.error));
  for (const message of [{ jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 17, result: {} }]) {
    const response = await fetch(`${base}/api/mcp`, { method: 'POST', headers: { authorization, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-03-26' }, body: JSON.stringify(message) });
    assert.equal(response.status, 202);
    assert.equal(await response.text(), '');
  }
  for (const body of ['{', '', '{"jsonrpc":']) {
    const response = await fetch(`${base}/api/mcp`, { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } });
  }
  const deepArray = '['.repeat(20000) + '0' + ']'.repeat(20000);
  for (const body of [
    `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":${deepArray}}`,
    `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"nested":${deepArray}}}`,
    '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"value":1e999}}',
    '{"jsonrpc":"2.0","id":null,"method":"tools/list"}',
    'null', '[]', '{"jsonrpc":"2.0","method":17}', '{"jsonrpc":"2.0","method":"tools/list","params":[]}',
    JSON.stringify(Array.from({ length: 101 }, (_, id) => ({ jsonrpc: '2.0', id, method: 'ping' })))
  ]) {
    const response = await fetch(`${base}/api/mcp`, { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).error.code, -32600);
  }
  const oversized = await fetch(`${base}/api/mcp`, { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify({ text: '☃'.repeat(90000) }) });
  assert.equal(oversized.status, 413);
  const chunkedBody = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ text: '☃'.repeat(90000) }))); controller.close(); } });
  const chunked = await fetch(`${base}/api/mcp`, { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: chunkedBody, duplex: 'half' });
  assert.equal(chunked.status, 413, 'The byte limit also applies without Content-Length');
  const wrongType = await fetch(`${base}/api/mcp`, { method: 'POST', headers: { authorization, 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(wrongType.status, 415);
  const head = await fetch(`${base}/api/mcp`, { method: 'HEAD', headers: { authorization } });
  assert.equal(head.status, 405);
  assert.equal(head.headers.get('cache-control'), 'no-store');
  let cancelled = false;
  const stalled = new ReadableStream({ cancel() { cancelled = true; } });
  const interrupted = await routes.handle(new Request(`${base}/api/mcp`, { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: stalled, duplex: 'half', signal: AbortSignal.abort() }));
  assert.equal(interrupted.status, 408);
  assert.equal(cancelled, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(unhandled.length, 0);
  assert.equal(f.operations.length, 0);
});
