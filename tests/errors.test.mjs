import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { publicErrorMessage, OpenRouterError } = require('../.test-build/lib/errors.js');

test('unknown error messages are never exposed to MCP callers', () => {
  const privateDetail = 'synthetic-private-diagnostic-do-not-echo';
  assert.equal(publicErrorMessage(new Error(privateDetail)), 'Unexpected error. Please try again or contact the server operator.');
  assert.equal(publicErrorMessage(privateDetail), 'Unexpected error. Please try again or contact the server operator.');
});

test('upstream failure payloads are not retained or returned', () => {
  const error = new OpenRouterError(401);
  assert.equal(error.body, undefined);
  assert.doesNotMatch(publicErrorMessage(error), /synthetic-private-detail|internal/);
});
