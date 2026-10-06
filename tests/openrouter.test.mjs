import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { listModels, getModelEndpoints, getCredits, queryAnalytics } = require('../.test-build/lib/openrouter.js');
const { publicErrorMessage } = require('../.test-build/lib/errors.js');

test('public metadata receives no upstream credential; private requests stay authenticated', async (t) => {
  process.env.OPENROUTER_MANAGEMENT_KEY = 'synthetic-management-placeholder';
  process.env.OPENROUTER_API_KEY = 'synthetic-api-placeholder';
  t.after(() => { delete process.env.OPENROUTER_MANAGEMENT_KEY; delete process.env.OPENROUTER_API_KEY; });
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: String(url), options });
    return Response.json({ data: [] });
  });
  await listModels();
  await getModelEndpoints('test/model');
  await getCredits();
  await queryAnalytics({ metrics: ['total_usage'] });
  assert.equal(requests[0].options.headers.Authorization, undefined);
  assert.equal(requests[1].options.headers.Authorization, undefined);
  for (const entry of requests.slice(2)) assert.equal(entry.options.headers.Authorization, 'Bearer synthetic-management-placeholder');
  for (const entry of requests) {
    assert.equal(entry.options.redirect, 'error');
    assert.ok(entry.options.signal instanceof AbortSignal);
    assert.equal(new URL(entry.url).origin, 'https://openrouter.ai');
  }
});

test('private requests with no configured key fail before network access', async (t) => {
  delete process.env.OPENROUTER_MANAGEMENT_KEY;
  t.mock.method(globalThis, 'fetch', () => { throw new Error('network must not run'); });
  await assert.rejects(getCredits(), (error) => error.code === 'MISSING_MANAGEMENT_KEY');
});

test('upstream error bodies are not read, retained, or echoed', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 500, json() { throw new Error('body must not be read'); }, text() { throw new Error('body must not be read'); } }));
  await assert.rejects(listModels(), (error) => {
    assert.equal(error.body, undefined);
    assert.equal(publicErrorMessage(error), 'OpenRouter request failed with HTTP 500.');
    return true;
  });
});

test('malformed success payloads cannot turn into zero spend', async (t) => {
  for (const body of ['not-json', 'null', '"a string"']) {
    t.mock.method(globalThis, 'fetch', async () => new Response(body, { status: 200 }));
    await assert.rejects(listModels(), (error) => error.code === 'INVALID_RESPONSE');
    t.mock.restoreAll();
  }
});
