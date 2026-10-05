import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { checkBearerAuth } = require('../.test-build/lib/auth.js');
const expected = 'unit-test-token-not-a-real-credential';
const request = (authorization) => new Request('https://example.invalid/api/mcp', { headers: authorization ? { authorization } : {} });

test('missing configuration fails closed', async () => {
  for (const value of [undefined, '', ' ']) assert.equal(checkBearerAuth(request(), value).status, 503);
});
test('missing or incorrect bearer never reaches tools', async () => {
  for (const value of [undefined, 'Basic abc', 'Bearer wrong', 'Bearer a b', `Bearer ${expected}extra`]) {
    const result = checkBearerAuth(request(value), expected);
    assert.equal(result.status, 401);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(await result.text(), /unit-test-token/);
  }
});
test('only the configured bearer passes, scheme comparison is case-insensitive', () => {
  assert.equal(checkBearerAuth(request(`Bearer ${expected}`), expected), null);
  assert.equal(checkBearerAuth(request(`bearer ${expected}`), expected), null);
});
