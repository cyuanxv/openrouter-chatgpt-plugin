import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { estimateTextWorkload } = require('../.test-build/lib/workloadEstimate.js');
const model = { prompt_usd_per_million: 1, completion_usd_per_million: 2, cached_prompt_usd_per_million: 0.25, request_price: 0.001, context_length: 100_000, max_completion_tokens: 10_000 };
const workload = { requests: 1000, prompt_tokens_per_request: 1000, completion_tokens_per_request: 500, cached_prompt_tokens_per_request: 400 };

test('workload arithmetic separates uncached/cached tokens, output and per-request fees without double-counting', () => {
  const result = estimateTextWorkload(model, workload);
  assert.equal(result.status, 'estimated');
  assert.ok(Math.abs(result.estimated_total_usd - 2.7) < 1e-10);
  assert.ok(Math.abs(result.per_request_components_usd.uncached_prompt - 0.0006) < 1e-12);
  assert.equal(result.generation_executed, false);
  assert.equal(result.billing_quote, false);
  assert.match(result.assumptions.join(' '), /not a billing quote/);
});
test('missing prices remain unavailable and cannot masquerade as free components', () => {
  for (const field of ['prompt_usd_per_million', 'completion_usd_per_million', 'cached_prompt_usd_per_million', 'request_price']) {
    const result = estimateTextWorkload({ ...model, [field]: null }, workload);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.estimated_total_usd, null);
    assert.ok(result.issues.some((issue) => issue.startsWith('missing_price:')));
  }
});
test('no cache tokens need no cache-read price, while explicit zero prices stay zero', () => {
  const result = estimateTextWorkload({ ...model, cached_prompt_usd_per_million: null, request_price: 0 }, { ...workload, cached_prompt_tokens_per_request: 0 });
  assert.equal(result.status, 'estimated');
  assert.equal(result.per_request_components_usd.cached_prompt, 0);
  assert.equal(result.per_request_components_usd.request_fee, 0);
});
test('known context or output limit violations block an estimate for that request shape', () => {
  for (const narrowed of [{ context_length: 1000 }, { max_completion_tokens: 100 }]) {
    const result = estimateTextWorkload({ ...model, ...narrowed }, workload);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.estimated_total_usd, null);
  }
});
test('invalid quantities and arithmetic overflow never produce a numeric estimate', () => {
  for (const modified of [{ requests: 0 }, { requests: Infinity }, { prompt_tokens_per_request: -1 }, { cached_prompt_tokens_per_request: 1001 }]) {
    assert.equal(estimateTextWorkload(model, { ...workload, ...modified }).status, 'unavailable');
  }
  const result = estimateTextWorkload({ ...model, request_price: 1e308 }, workload);
  assert.equal(result.estimated_total_usd, null);
  assert.ok(result.issues.includes('arithmetic_overflow'));
});

test('known non-text models do not receive a free text-workload estimate from zero token prices', () => {
  for (const modalities of [{ input_modalities: ['image'] }, { output_modalities: ['image'] }]) {
    const result = estimateTextWorkload({ ...model, ...modalities, prompt_usd_per_million: 0, completion_usd_per_million: 0, request_price: 0 }, workload);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.estimated_total_usd, null);
  }
});
test('underflowed or nondecimal list prices are not mistaken for genuine zero', () => {
  for (const price of ['1e-999', '0x10']) {
    const result = estimateTextWorkload({ ...model, request_price: price }, workload);
    assert.equal(result.estimated_total_usd, null);
  }
  const result = estimateTextWorkload({ ...model, prompt_usd_per_million: Number.MIN_VALUE }, { ...workload, cached_prompt_tokens_per_request: 0 });
  assert.equal(result.estimated_total_usd, null);
  assert.ok(result.issues.includes('arithmetic_underflow'));
});
