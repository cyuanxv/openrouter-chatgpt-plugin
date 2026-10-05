import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const guard = require.resolve('../scripts/smoke-deny-upstream.cjs');

function install(t, upstream) {
  const original = globalThis.fetch;
  globalThis.fetch = upstream;
  delete require.cache[guard];
  require(guard);
  t.after(() => { globalThis.fetch = original; delete require.cache[guard]; });
}

test('loopback redirects cannot escape the isolated smoke process', async (t) => {
  let dispatchedExternal = false;
  install(t, async (_input, options) => {
    // Simulate a loopback 302 to an external URL without any actual network I/O.
    if (options?.redirect === 'error') throw new TypeError('Redirect rejected');
    dispatchedExternal = true;
    return new Response('unexpected external dispatch');
  });
  await assert.rejects(fetch('http://127.0.0.1:1234/redirect', { redirect: 'follow' }), /Redirect rejected/);
  assert.equal(dispatchedExternal, false);
});
test('Request objects cannot override redirect protection', async (t) => {
  let redirect;
  install(t, async (_input, options) => { redirect = options.redirect; return new Response('ok'); });
  const request = new Request('http://127.0.0.1:1234/test', { redirect: 'follow' });
  await fetch(request);
  assert.equal(redirect, 'error');
});
test('initial non-loopback destinations are rejected before the transport runs', async (t) => {
  let calls = 0;
  install(t, async () => { calls++; return new Response('unexpected'); });
  for (const url of ['https://upstream.example.test', 'http://169.254.169.254', 'http://192.168.1.1']) {
    assert.throws(() => fetch(url), /External fetch disabled/);
  }
  assert.equal(calls, 0);
});
