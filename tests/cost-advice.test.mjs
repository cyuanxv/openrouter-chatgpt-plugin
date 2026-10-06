import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildCostAdvice } = require('../.test-build/lib/costAdvice.js');
const { normalizeModel, summarizeEndpoints } = require('../.test-build/lib/modelCompare.js');
const { dollarsPerMillion, sumField, shareOf } = require('../.test-build/lib/analytics.js');

test('cost advice attaches actionable verification to observations, with no fabricated savings', () => {
  const result = buildCostAdvice({ total_usage: 8, request_count: 5, tokens_total: 1_000_000, tokens_prompt: 900_000, tokens_completion: 100_000, cache_hit_rate: 0.05 }, 10, { min_prompt_usd_per_million: 1, max_prompt_usd_per_million: 2 });
  assert.ok(result.signals.some((signal) => signal.type === 'low_cache_reuse'));
  assert.ok(result.signals.some((signal) => signal.type === 'provider_price_spread'));
  for (const signal of result.signals) {
    assert.ok(signal.next_step.length > 10);
    assert.ok(signal.verify_before_change.length > 10);
    assert.equal(signal.estimated_savings_usd, null);
    assert.equal(signal.confidence_scope, 'observed_signal_only');
  }
  assert.equal(result.estimated_savings_usd, null);
});
test('missing, invalid or out-of-range cache/token data remains unknown instead of zero', () => {
  for (const cache_hit_rate of [undefined, 'invalid', -1, 1.5]) {
    const result = buildCostAdvice({ total_usage: 1, tokens_prompt: 1_000_000, cache_hit_rate }, 1, null);
    assert.equal(result.metric_evidence.cache_hit_rate, null);
    assert.ok(!result.signals.some((signal) => signal.type === 'low_cache_reuse'));
    assert.ok([...result.missing_metrics, ...result.invalid_metrics].includes('cache_hit_rate'));
  }
});
test('inconsistent subset token counts do not produce impossible percentage advice', () => {
  const result = buildCostAdvice({ total_usage: 1, tokens_total: 100_000, tokens_prompt: 50_000, tokens_completion: 200_000, reasoning_tokens: 150_000, cached_tokens: 80_000 }, 1, null);
  for (const type of ['output_heavy', 'reasoning_heavy', 'meaningful_cache_usage']) assert.ok(!result.signals.some((signal) => signal.type === type));
  assert.ok(result.invalid_metrics.includes('tokens_completion_exceeds_denominator'));
});
test('zero listed provider price can be evidence of spread without an infinite savings estimate', () => {
  const result = buildCostAdvice({ total_usage: 1 }, 1, { min_prompt_usd_per_million: 0, max_prompt_usd_per_million: 1 });
  assert.ok(result.signals.some((signal) => signal.type === 'provider_price_spread'));
  assert.equal(result.estimated_savings_usd, null);
  assert.doesNotMatch(JSON.stringify(result), /Infinity/);
});
test('unknown per-request fees stay null and true zero fees stay zero', () => {
  assert.equal(normalizeModel({ id: 'synthetic/model', pricing: {} }).request_price, null);
  assert.equal(normalizeModel({ id: 'synthetic/model', pricing: { request: '0' } }).request_price, 0);
  assert.equal(summarizeEndpoints([{ pricing: {} }]).endpoints[0].request_price, null);
  assert.equal(summarizeEndpoints([{ pricing: { request: '0.01' } }]).endpoints[0].request_price, 0.01);
});
test('overflowing prices or totals cannot appear as valid numeric evidence', () => {
  assert.equal(dollarsPerMillion('1e308'), null);
  assert.equal(shareOf(1e308, 1e-308), null);
  assert.equal(shareOf(undefined, 1), null);
  assert.throws(() => sumField([{ total_usage: 1e308 }, { total_usage: 1e308 }], 'total_usage'));
});

test('contradictory cache telemetry does not produce opposite caching recommendations', () => {
  const result = buildCostAdvice({ total_usage: 1, tokens_prompt: 1_000_000, cached_tokens: 500_000, cache_hit_rate: 0.05 }, 1, null);
  assert.ok(result.invalid_metrics.includes('cache_metrics_inconsistent'));
  for (const type of ['low_cache_reuse', 'meaningful_cache_usage']) assert.ok(!result.signals.some((signal) => signal.type === type));
});

test('net-spend shares above 100% can reflect valid negative adjustments rather than invalid token ratios', () => {
  const result = buildCostAdvice({ total_usage: 12 }, 10, null);
  const signal = result.signals.find((item) => item.type === 'cost_concentration');
  assert.match(signal.evidence, /120\.0% of net spend/);
  assert.match(signal.evidence, /negative/);
  assert.ok(!result.invalid_metrics.includes('total_usage_exceeds_denominator'));
});

test('prompt counts exceeding total tokens suppress dependent cache advice but preserve independent spend evidence', () => {
  const result = buildCostAdvice({ total_usage: 1, tokens_total: 100_000, tokens_prompt: 1_000_000, tokens_completion: 50_000, cached_tokens: 0, cache_hit_rate: 0 }, 1, null);
  assert.ok(result.invalid_metrics.includes('tokens_prompt_exceeds_denominator'));
  assert.ok(!result.signals.some((signal) => signal.type === 'low_cache_reuse'));
  assert.ok(result.signals.some((signal) => signal.type === 'cost_concentration'));
});
test('percentage conversion overflow cannot become an observed Infinity-percent claim', () => {
  const result = buildCostAdvice({ total_usage: 1e308 }, 1, null);
  assert.ok(!result.signals.some((signal) => signal.type === 'cost_concentration'));
  assert.ok(result.invalid_metrics.includes('spend_share_percentage_overflow'));
  assert.doesNotMatch(JSON.stringify(result), /Infinity%|NaN%/);
});

test('prompt-plus-completion contradiction also suppresses dependent token advice', () => {
  const result = buildCostAdvice({ total_usage: 1, tokens_total: 1_000_000, tokens_prompt: 700_000, tokens_completion: 400_000, cache_hit_rate: 0 }, 1, null);
  assert.ok(result.invalid_metrics.includes('prompt_completion_exceed_total'));
  assert.ok(!result.signals.some((signal) => signal.type === 'low_cache_reuse'));
  assert.ok(result.signals.some((signal) => signal.type === 'cost_concentration'));
});
