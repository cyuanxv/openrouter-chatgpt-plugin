import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { validateAnalyticsQuery, metricAggregation } = require('../.test-build/lib/queryPlanning.js');
const { unwrapAnalyticsMeta } = require('../.test-build/lib/meta.js');
const meta = {
  metrics: [{ name: 'total_usage', is_rate: false, display_format: 'currency' }, { name: 'request_count', is_rate: false, display_format: 'number' }, { name: 'custom_ratio', is_rate: true, display_format: 'percent' }, { name: 'latency_custom', is_rate: false, display_format: 'latency' }, { name: 'unknown_semantics' }],
  dimensions: [{ name: 'model' }, { name: 'provider' }, { name: 'api_key_id' }],
  operators: [{ name: 'eq', value_type: 'scalar' }, { name: 'in', value_type: 'array' }, { name: 'starts_with', value_type: 'scalar' }],
  granularities: [{ name: 'day' }, { name: 'hour' }]
};

test('current schema permits supported model, provider and API-key queries without field guessing', () => {
  for (const dimension of ['model', 'provider', 'api_key_id']) assert.doesNotThrow(() => validateAnalyticsQuery({ metrics: ['total_usage', 'request_count'], dimensions: [dimension], filters: [{ field: dimension, operator: 'in', value: ['synthetic-value'] }], order_by: { field: 'total_usage', direction: 'desc' } }, meta));
  assert.doesNotThrow(() => validateAnalyticsQuery({ metrics: ['total_usage'], filters: [{ field: 'model', operator: 'starts_with', value: 'synthetic/' }], granularity: 'day', order_by: { field: 'date', direction: 'asc' } }, meta));
});
test('unknown fields return live-schema alternatives without echoing user filter values or invalid field text', () => {
  let failure;
  try { validateAnalyticsQuery({ metrics: ['synthetic_private_key_literal'], dimensions: ['api_key'], filters: [{ field: 'synthetic_private_field', operator: 'synthetic_private_operator', value: 'synthetic-sensitive-filter' }], order_by: { field: 'unknown_order', direction: 'asc' } }, meta); } catch (error) { failure = error; }
  assert.ok(failure);
  assert.doesNotMatch(JSON.stringify(failure.issues), /synthetic_private_key_literal|synthetic-sensitive-filter|synthetic_private_field|synthetic_private_operator/);
  assert.ok(failure.issues.find((issue) => issue.code === 'unknown_dimension').allowed.includes('api_key_id'));
});
test('filter values must match the operator scalar or array contract', () => {
  for (const [operator, value] of [['eq', ['synthetic']], ['in', 'synthetic'], ['in', []]]) assert.throws(() => validateAnalyticsQuery({ metrics: ['total_usage'], filters: [{ field: 'model', operator, value }] }, meta), (error) => error.issues.some((issue) => issue.code === 'invalid_filter_value'));
});
test('duplicate selections, unsupported granularity and non-returned sort fields are actionable errors', () => {
  assert.throws(() => validateAnalyticsQuery({ metrics: ['total_usage', 'total_usage'], dimensions: ['model', 'model'], granularity: 'minute', order_by: { field: 'request_count', direction: 'desc' } }, meta), (error) => {
    assert.ok(error.issues.some((issue) => issue.code === 'duplicate_field'));
    assert.ok(error.issues.some((issue) => issue.code === 'unknown_granularity'));
    assert.ok(error.issues.some((issue) => issue.code === 'invalid_order_field'));
    return true;
  });
});
test('live rate/format semantics prevent summing ratios, latency or unverified metrics', () => {
  assert.equal(metricAggregation('total_usage', meta).summed, true);
  assert.equal(metricAggregation('request_count', meta).summed, true);
  for (const metric of ['custom_ratio', 'latency_custom', 'unknown_semantics']) assert.equal(metricAggregation(metric, meta).summed, false);
});
test('malformed or duplicate live schema entries cannot be treated as a validated schema', () => {
  for (const data of [{ metrics: [{ name: true }] }, { metrics: [] }, { metrics: [{ name: 'x', is_rate: 'no' }] }, { metrics: [{ name: 'x' }, { name: 'x' }] }, { metrics: [{ name: 'x' }], operators: [{ name: 'in', value_type: 'unknown' }] }]) assert.throws(() => unwrapAnalyticsMeta({ data }));
});

test('missing live operator value semantics blocks a filtered query instead of claiming full validation', () => {
  assert.throws(() => validateAnalyticsQuery({ metrics: ['total_usage'], filters: [{ field: 'model', operator: 'eq', value: 'synthetic' }] }, { ...meta, operators: [{ name: 'eq' }] }), (error) => error.issues.some((issue) => issue.code === 'operator_schema_incomplete'));
});

test('missing or empty display formats never authorize numeric aggregation', () => {
  for (const display_format of [undefined, '']) {
    const result = metricAggregation('latency_custom', { metrics: [{ name: 'latency_custom', is_rate: false, display_format }] });
    assert.equal(result.summed, false);
    assert.equal(result.reason, 'aggregation_semantics_unverified');
  }
});
test('invalid granularity input cannot be echoed in supported sort field suggestions', () => {
  let error;
  try { validateAnalyticsQuery({ metrics: ['total_usage'], granularity: 'synthetic_sensitive_literal', order_by: { field: 'bad-order', direction: 'asc' } }, meta); } catch (failure) { error = failure; }
  assert.ok(error);
  assert.doesNotMatch(JSON.stringify(error.issues), /synthetic_sensitive_literal/);
  assert.deepEqual(error.issues.find((issue) => issue.code === 'invalid_order_field').allowed, ['total_usage']);
});
