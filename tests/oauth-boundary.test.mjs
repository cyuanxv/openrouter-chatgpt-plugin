import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { generateKeyPair, exportJWK, SignJWT, UnsecuredJWT } from 'jose';
const require = createRequire(import.meta.url);
const { createOfflineOAuthBoundary } = require('../.test-build/lib/hosted/oauthBoundary.js');

// Ephemeral keys exist only in this process. They never authenticate to a service,
// are not persisted, and are never printed or returned as test output.
const pair = await generateKeyPair('ES256');
const other = await generateKeyPair('ES256');
const pub = { ...await exportJWK(pair.publicKey), kid: 'synthetic-test-key', alg: 'ES256', use: 'sig' };
const policy = {
  issuer: 'https://issuer.example.test/auth/v1',
  resource: 'https://routerlens.example.test/api/mcp',
  jwksUrl: 'https://issuer.example.test/auth/v1/.well-known/jwks.json',
  allowedClientIds: ['synthetic-chatgpt-client'],
  requiredScopes: ['routerlens:read'],
  algorithms: ['ES256']
};
const keyset = { keys: [pub] };
const now = () => Math.floor(Date.now() / 1000);
async function token(overrides = {}, options = {}) {
  return new SignJWT({ iss: policy.issuer, aud: policy.resource, sub: 'user-a', exp: now() + 120, iat: now() - 1, client_id: 'synthetic-chatgpt-client', session_id: 'session-a', scope: 'routerlens:read', ...overrides })
    .setProtectedHeader({ alg: 'ES256', kid: pub.kid, ...options.header })
    .sign(options.key ?? pair.privateKey);
}
const newBoundary = () => createOfflineOAuthBoundary(policy, keyset);
const binding = () => ({ id: 'binding-a', issuer: policy.issuer, subject: 'user-a', resource: policy.resource, credentialReference: 'opaque-synthetic-reference', revision: 1, state: 'active', allowedClientIds: ['synthetic-chatgpt-client'], grants: ['credits:read', 'analytics:read', 'keys:read'] });

test('JWT verification uses signature, issuer, resource, client, expiry, not-before and required claims', async () => {
  const boundary = await newBoundary();
  const principal = await boundary.verify(await token());
  assert.equal(principal.subject, 'user-a');
  assert.equal(Object.isFrozen(principal), true);
  for (const claims of [
    { iss: 'https://other.example.test' }, { aud: 'authenticated' }, { aud: 'https://other.example.test/api/mcp' },
    { exp: now() - 1 }, { nbf: now() + 60 }, { exp: undefined }, { iat: undefined }, { iat: now() + 60 },
    { sub: '' }, { client_id: 'unapproved-client' }, { session_id: undefined }
  ]) await assert.rejects(boundary.verify(await token(claims)), (error) => error.code === 'invalid_token');
  await assert.rejects(boundary.verify(await token({}, { key: other.privateKey })), (error) => error.code === 'invalid_token');
  await assert.rejects(boundary.verify(new UnsecuredJWT({ sub: 'user-a' }).encode()), (error) => error.code === 'invalid_token');
});

test('OIDC identity scopes alone and user-editable metadata cannot authorize RouterLens data', async () => {
  const boundary = await newBoundary();
  await assert.rejects(boundary.verify(await token({ scope: 'openid email', user_metadata: { scope: 'routerlens:read', sub: 'user-b' } })), (error) => error.code === 'forbidden');
  const principal = await boundary.verify(await token({ user_metadata: { sub: 'user-b', issuer: 'other', role: 'admin' } }));
  assert.equal(principal.subject, 'user-a');
  assert.equal(principal.user_metadata, undefined);
});

test('JWKS configuration rejects unsafe sources, symmetric/private keys and weak algorithms', async () => {
  for (const jwksUrl of ['http://issuer.example.test/keys', 'https://127.0.0.1/keys', 'https://[::1]/keys', 'https://localhost/keys', 'https://service.internal/keys', 'https://attacker.example.test/keys', 'https://issuer.example.test/keys?next=private']) {
    await assert.rejects(createOfflineOAuthBoundary({ ...policy, jwksUrl }, keyset), (error) => error.code === 'invalid_configuration');
  }
  for (const algorithms of [[], ['none'], ['HS256']]) await assert.rejects(createOfflineOAuthBoundary({ ...policy, algorithms }, keyset));
  for (const keys of [[{ ...pub, d: 'synthetic-private-field' }], [{ kty: 'oct', kid: 'synthetic', k: 'synthetic-private-field' }], [pub, pub]]) {
    await assert.rejects(createOfflineOAuthBoundary(policy, { keys }), (error) => error.code === 'invalid_configuration');
  }
});

test('token-controlled JWKS/certificate URLs or embedded keys are rejected without network access', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', () => { calls++; throw new Error('Network forbidden in offline fixture'); });
  const boundary = await newBoundary();
  for (const header of [{ jku: 'http://169.254.169.254/private' }, { x5u: 'https://attacker.example.test/cert' }, { jwk: pub }]) {
    await assert.rejects(boundary.verify(await token({}, { header })), (error) => error.code === 'invalid_token');
  }
  assert.equal(calls, 0);
});

test('principal ownership cannot be changed through tool input or wrong repository rows', async () => {
  const boundary = await newBoundary();
  const principal = await boundary.verify(await token());
  let queriedOwner;
  const repository = { isSessionActive: async () => true, findForOwner: async (owner) => { queriedOwner = owner; return binding(); } };
  const grant = await boundary.authorize(principal, 'analytics:read', repository);
  assert.deepEqual(queriedOwner, { issuer: policy.issuer, subject: 'user-a' });
  assert.equal(grant.subject, 'user-a');
  assert.equal(grant.bindingRevision, 1);
  assert.doesNotMatch(JSON.stringify(grant), /accessToken|Authorization|Bearer/);
  await assert.rejects(boundary.authorize({ ...principal, subject: 'user-b' }, 'analytics:read', repository), (error) => error.code === 'invalid_token');
  for (const changes of [{ subject: 'user-b' }, { issuer: 'https://other.example.test' }, { resource: 'https://other.example.test/api/mcp' }, { allowedClientIds: [] }, { grants: [] }, { state: 'revoked' }, { revision: 0 }]) {
    await assert.rejects(boundary.authorize(principal, 'analytics:read', { ...repository, findForOwner: async () => ({ ...binding(), ...changes }) }), (error) => error.code === 'forbidden');
  }
  await assert.rejects(boundary.authorize(principal, 'keys:write', repository), (error) => error.code === 'forbidden');
});

test('each action rechecks current session and binding revocation instead of caching grants', async () => {
  const boundary = await newBoundary();
  const principal = await boundary.verify(await token());
  let sessionActive = true;
  let current = binding();
  let reads = 0;
  const repository = { isSessionActive: async () => sessionActive, findForOwner: async () => { reads++; return current; } };
  await boundary.authorize(principal, 'credits:read', repository);
  current = { ...current, revision: 2, state: 'revoked' };
  await assert.rejects(boundary.authorize(principal, 'credits:read', repository), (error) => error.code === 'forbidden');
  assert.equal(reads, 2);
  current = { ...current, state: 'active' };
  sessionActive = false;
  await assert.rejects(boundary.authorize(principal, 'credits:read', repository), (error) => error.code === 'forbidden');
});

test('expired principals and repository failures fail closed without diagnostic leaks', async (t) => {
  const boundary = await newBoundary();
  const principal = await boundary.verify(await token());
  const repository = { isSessionActive: async () => { throw new Error('synthetic-private-diagnostic'); }, findForOwner: async () => binding() };
  await assert.rejects(boundary.authorize(principal, 'credits:read', repository), (error) => error.code === 'forbidden' && !error.message.includes('synthetic-private-diagnostic'));
  t.mock.method(Date, 'now', () => (principal.expiresAt + 1) * 1000);
  await assert.rejects(boundary.authorize(principal, 'credits:read', repository), (error) => error.code === 'invalid_token');
});

test('default plugin manifests do not activate private hosted Analytics', () => {
  for (const name of ['mcp.json', '.mcp.json']) {
    const config = JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
    assert.deepEqual(Object.keys(config.mcpServers), ['openrouter']);
  }
});

test('malformed session activity responses cannot become authorization', async () => {
  const boundary = await newBoundary();
  const principal = await boundary.verify(await token());
  for (const value of [undefined, null, 'false', {}, 1]) {
    await assert.rejects(boundary.authorize(principal, 'credits:read', { isSessionActive: async () => value, findForOwner: async () => binding() }), (error) => error.code === 'forbidden');
  }
});

test('token action scopes and binding grants are intersected for every read', async () => {
  const boundary = await createOfflineOAuthBoundary({ ...policy, requiredScopes: ['credits:read'] }, keyset);
  const principal = await boundary.verify(await token({ scope: 'credits:read' }));
  const repository = { isSessionActive: async () => true, findForOwner: async () => binding() };
  assert.equal((await boundary.authorize(principal, 'credits:read', repository)).action, 'credits:read');
  for (const action of ['analytics:read', 'keys:read']) {
    await assert.rejects(boundary.authorize(principal, action, repository), (error) => error.code === 'forbidden');
  }
  assert.ok(Object.isFrozen(principal.scopes));
});
test('an OIDC prerequisite cannot expand authority even with a fully permissive account binding', async () => {
  const boundary = await createOfflineOAuthBoundary({ ...policy, requiredScopes: ['openid'] }, keyset);
  const principal = await boundary.verify(await token({ scope: 'openid' }));
  const repository = { isSessionActive: async () => true, findForOwner: async () => binding() };
  for (const action of ['credits:read', 'analytics:read', 'keys:read']) {
    await assert.rejects(boundary.authorize(principal, action, repository), (error) => error.code === 'forbidden');
  }
});
test('trailing-dot local and private hostname variants cannot bypass URL checks', async () => {
  for (const hostname of ['localhost.', 'service.internal.', 'service.local.', 'issuer.example.test.']) {
    await assert.rejects(createOfflineOAuthBoundary({ ...policy, issuer: `https://${hostname}/auth/v1`, jwksUrl: `https://${hostname}/keys` }, keyset), (error) => error.code === 'invalid_configuration');
  }
});
