import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
const require = createRequire(import.meta.url);
const { createOfflineOAuthBoundary } = require('../.test-build/lib/hosted/oauthBoundary.js');
const { createRequestScopedReadClient, assertGatewayAccess } = require('../.test-build/lib/hosted/readClient.js');
const pair = await generateKeyPair('ES256');
const publicKey = { ...await exportJWK(pair.publicKey), kid: 'synthetic-request-key', alg: 'ES256' };
const policy = { issuer: 'https://issuer.example.test', resource: 'https://mcp.example.test/api/mcp', jwksUrl: 'https://issuer.example.test/keys', allowedClientIds: ['test-client'], requiredScopes: ['routerlens:read'], algorithms: ['ES256'] };
async function fixture() {
  const boundary = await createOfflineOAuthBoundary(policy, { keys: [publicKey] });
  const principals = {};
  const bindings = {};
  for (const subject of ['a', 'b']) {
    const token = await new SignJWT({ iss: policy.issuer, aud: policy.resource, sub: subject, exp: Math.floor(Date.now() / 1000) + 120, iat: Math.floor(Date.now() / 1000) - 1, client_id: 'test-client', session_id: `session-${subject}`, scope: 'routerlens:read' }).setProtectedHeader({ alg: 'ES256', kid: publicKey.kid }).sign(pair.privateKey);
    principals[subject] = await boundary.verify(token);
    bindings[subject] = { id: `binding-${subject}`, issuer: policy.issuer, resource: policy.resource, subject, revision: 1, credentialReference: `opaque-${subject}`, state: 'active', allowedClientIds: ['test-client'], grants: ['credits:read', 'analytics:read', 'keys:read'] };
  }
  const repository = { isSessionActive: async () => true, findForOwner: async ({ subject }) => bindings[subject] };
  return { boundary, principals, bindings, repository };
}

test('interleaved requests remain bound to their own verified user with no shared credential state', async () => {
  const { boundary, principals, bindings, repository } = await fixture();
  const seen = [];
  const gateway = { executeIfCurrent: async (input) => {
    await new Promise((resolve) => setTimeout(resolve, input.principal.subject === 'a' ? 8 : 1));
    assertGatewayAccess({ ...input, binding: bindings[input.principal.subject], sessionActive: true });
    seen.push([input.principal.subject, input.capability.credentialReference, input.operation.kind]);
    return { owner: input.principal.subject };
  } };
  const a = createRequestScopedReadClient(boundary, principals.a, repository, gateway);
  const b = createRequestScopedReadClient(boundary, principals.b, repository, gateway);
  const results = await Promise.all([a.getCredits(), b.queryAnalytics({ metrics: ['total_usage'] }), a.listKeys(), b.getAnalyticsMeta()]);
  assert.deepEqual(results.map((value) => value.owner), ['a', 'b', 'a', 'b']);
  assert.ok(seen.every(([subject, reference]) => reference === `opaque-${subject}`));
  assert.deepEqual(Object.keys(a).sort(), ['getAnalyticsMeta', 'getCredits', 'listKeys', 'queryAnalytics']);
});

test('revocation or credential rotation after authorization is rejected at the gateway-use boundary', async () => {
  for (const update of [{ state: 'revoked' }, { revision: 2 }, { credentialReference: 'rotated' }, { allowedClientIds: [] }, { resource: 'https://other.example.test/api/mcp' }]) {
    const { boundary, principals, bindings, repository } = await fixture();
    let issuedRead = false;
    const gateway = { executeIfCurrent: async (input) => {
      bindings.a = { ...bindings.a, ...update };
      assertGatewayAccess({ ...input, binding: bindings.a, sessionActive: true });
      issuedRead = true;
    } };
    const client = createRequestScopedReadClient(boundary, principals.a, repository, gateway);
    await assert.rejects(client.getCredits(), (error) => error.code === 'forbidden');
    assert.equal(issuedRead, false);
  }
});

test('query input is snapshotted before asynchronous authentication and never mutates across users', async () => {
  const { boundary, principals, repository } = await fixture();
  const query = { metrics: ['total_usage'], filters: [{ field: 'model', operator: 'eq', value: 'model-a' }] };
  let seen;
  const client = createRequestScopedReadClient(boundary, principals.a, repository, { executeIfCurrent: async ({ operation }) => { seen = operation.query; return {}; } });
  const pending = client.queryAnalytics(query);
  query.filters[0].value = 'model-b';
  await pending;
  assert.equal(seen.filters[0].value, 'model-a');
});

test('gateway implementation errors cannot echo credential diagnostics', async () => {
  const { boundary, principals, repository } = await fixture();
  const client = createRequestScopedReadClient(boundary, principals.a, repository, { executeIfCurrent: async () => { throw new Error('synthetic-private-diagnostic'); } });
  await assert.rejects(client.getCredits(), (error) => error.message === 'Hosted account read failed.');
});

test('request-scoped client contains no implicit environment-key fallback or live network implementation', () => {
  const source = readFileSync(new URL('../lib/hosted/readClient.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /process\.env|OPENROUTER_MANAGEMENT_KEY|fetch\(/);
});

test('handcrafted, copied, or already-completed gateway capabilities cannot be replayed', async () => {
  const { boundary, principals, bindings, repository } = await fixture();
  let completed;
  const client = createRequestScopedReadClient(boundary, principals.a, repository, { executeIfCurrent: async (input) => {
    completed = { ...input, binding: bindings.a, sessionActive: true };
    assert.throws(() => assertGatewayAccess({ ...completed, capability: { ...input.capability } }), (error) => error.code === 'forbidden');
    assert.doesNotThrow(() => assertGatewayAccess(completed));
    return {};
  } });
  await client.getCredits();
  assert.throws(() => assertGatewayAccess(completed), (error) => error.code === 'forbidden');
});

test('a successful gateway check consumes its capability before an in-flight asynchronous gap', async () => {
  const { boundary, principals, bindings, repository } = await fixture();
  let reads = 0;
  const client = createRequestScopedReadClient(boundary, principals.a, repository, { executeIfCurrent: async (input) => {
    const check = { ...input, binding: bindings.a, sessionActive: true };
    assertGatewayAccess(check);
    reads++;
    await Promise.resolve();
    assert.throws(() => assertGatewayAccess(check), (error) => error.code === 'forbidden');
    return {};
  } });
  await client.getCredits();
  assert.equal(reads, 1);
});
test('two concurrent uses of one capability yield exactly one successful check', async () => {
  const { boundary, principals, bindings, repository } = await fixture();
  const client = createRequestScopedReadClient(boundary, principals.a, repository, { executeIfCurrent: async (input) => {
    const check = { ...input, binding: bindings.a, sessionActive: true };
    const results = await Promise.allSettled([Promise.resolve().then(() => assertGatewayAccess(check)), Promise.resolve().then(() => assertGatewayAccess(check))]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const [failure] = results.filter((result) => result.status === 'rejected');
    assert.equal(failure.reason.code, 'forbidden');
    return {};
  } });
  await client.getCredits();
});
test('the requested upstream operation must match the capability action', async () => {
  const { boundary, principals, bindings, repository } = await fixture();
  const client = createRequestScopedReadClient(boundary, principals.a, repository, { executeIfCurrent: async (input) => {
    const check = { ...input, binding: bindings.a, sessionActive: true };
    assert.throws(() => assertGatewayAccess({ ...check, operation: { kind: 'key_metadata', options: {} } }), (error) => error.code === 'forbidden');
    assert.doesNotThrow(() => assertGatewayAccess(check));
    return {};
  } });
  await client.getCredits();
});
