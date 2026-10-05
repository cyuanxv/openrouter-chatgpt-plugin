import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { z } = require('zod');
const { registerRouterLensTools } = require('../.test-build/lib/tools.js');
const tools = new Map();
registerRouterLensTools({ registerTool(name, spec, handler) { tools.set(name, { spec, handler }); } });
const invoke = (name, input = {}) => {
  const tool = tools.get(name);
  return tool.handler(z.object(tool.spec.inputSchema).parse(input));
};
function mockAccount(t, responses) {
  process.env.OPENROUTER_MANAGEMENT_KEY = 'synthetic-management-placeholder';
  t.after(() => { delete process.env.OPENROUTER_MANAGEMENT_KEY; });
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: String(url), options });
    assert.ok(responses.length, 'Unexpected upstream call');
    const response = responses.shift();
    return response instanceof Response ? response : Response.json(response);
  });
  return requests;
}
const analytics = (rows, truncated = false) => ({ data: { data: rows, metadata: { truncated } } });

test('tool registrations remain the same eight read-only operations', () => {
  assert.equal(tools.size, 8);
  for (const { spec } of tools.values()) {
    assert.equal(spec.annotations.readOnlyHint, true);
    assert.equal(spec.annotations.destructiveHint, false);
  }
});
test('account credits remain unknown when required fields are missing', async (t) => {
  mockAccount(t, [{ data: { total_credits: null, total_usage: 0 } }]);
  const result = await invoke('get_account_summary', { include_spend_windows: false });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
});
test('query_usage labels partial totals and explicit ranges accurately', async (t) => {
  const requests = mockAccount(t, [{ data: { metrics: [{ name: 'total_usage', is_rate: false, display_format: 'currency' }, { name: 'cache_hit_rate', is_rate: true, display_format: 'percent' }] } }, analytics([{ total_usage: 5, cache_hit_rate: 0.5 }], true)]);
  const time_range = { start: '2026-10-01T00:00:00Z', end: '2026-10-02T00:00:00Z' };
  const result = await invoke('query_usage', { preset: '30d', timezone: 'Asia/Shanghai', time_range, metrics: ['total_usage', 'cache_hit_rate'] });
  assert.equal(result.structuredContent.totals_complete, false);
  assert.equal(result.structuredContent.totals_scope, 'returned_rows');
  assert.deepEqual(result.structuredContent.totals, { total_usage: 5 });
  assert.equal(result.structuredContent.timezone, null);
  assert.deepEqual(JSON.parse(requests[1].options.body).time_range, time_range);
});
test('reverse time ranges fail before network access', async (t) => {
  const requests = mockAccount(t, []);
  assert.throws(() => invoke('query_usage', { time_range: { start: '2026-10-02T00:00:00Z', end: '2026-10-01T00:00:00Z' } }));
  assert.equal(requests.length, 0);
});
test('truncated optimization cannot claim account-wide spend shares', async (t) => {
  const requests = mockAccount(t, [{ data: { metrics: [{ name: 'total_usage' }] } }, analytics([{ model: 'test/model', total_usage: 5 }], true)]);
  const result = await invoke('analyze_cost_optimization');
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /incomplete analytics/);
  assert.equal(requests.length, 2);
});
test('non-UTC anomaly requests are not mislabeled as local-day results', async (t) => {
  const requests = mockAccount(t, []);
  const result = await invoke('analyze_cost_anomalies', { timezone: 'Asia/Shanghai' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /UTC day buckets/);
  assert.equal(requests.length, 0);
});
test('API-key tool returns allowlisted metadata only', async (t) => {
  mockAccount(t, [{ data: [{ name: 'Test key', hash: 'synthetic-hash', key: 'synthetic-plaintext-secret', secret: 'synthetic-secret', usage: 1 }] }]);
  const result = await invoke('list_api_keys');
  assert.equal(result.structuredContent.keys[0].name, 'Test key');
  assert.doesNotMatch(JSON.stringify(result), /synthetic-plaintext-secret|synthetic-secret/);
});

test('empty anomaly history remains unknown and excludes the current partial UTC day', async (t) => {
  mockAccount(t, [analytics([])]);
  const result = await invoke('analyze_cost_anomalies', { days: 7 });
  assert.match(result.content[0].text, /anomaly status is unknown/);
  assert.equal(result.structuredContent.current_partial_day_excluded, true);
  assert.equal(result.structuredContent.evaluated_days, 0);
  assert.equal(result.structuredContent.skipped_days, 7);
  assert.equal(result.structuredContent.analysis_range.endDateExclusive, new Date().toISOString().slice(0, 10));
});

test('malformed key-list responses cannot masquerade as an empty account', async (t) => {
  mockAccount(t, [{ data: {} }]);
  const result = await invoke('list_api_keys');
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
});
test('configured credentials do not imply verified account availability', async (t) => {
  const requests = mockAccount(t, []);
  const result = await invoke('routerlens_status');
  assert.equal(result.structuredContent.management_key_configured, true);
  assert.equal(result.structuredContent.account_analytics_available, null);
  assert.equal(result.structuredContent.connectivity_verified, false);
  assert.equal(requests.length, 0);
});

test('key rows and provided financial counters are validated rather than converted to zero', async (t) => {
  for (const row of [17, null, [], { hash: 'synthetic-key', usage: null }, { hash: 'synthetic-key', usage: 0, usage_daily: 'invalid' }]) {
    mockAccount(t, [{ data: [row] }]);
    const result = await invoke('list_api_keys');
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
    t.mock.restoreAll();
  }
});
test('optional missing key counters stay null, while real numeric zero stays zero', async (t) => {
  mockAccount(t, [{ data: [{ hash: 'synthetic-key', usage: 0, usage_daily: null, usage_weekly: 0 }] }]);
  const result = await invoke('list_api_keys');
  const key = result.structuredContent.keys[0];
  assert.equal(key.usage, 0);
  assert.equal(key.usage_daily, null);
  assert.equal(key.usage_weekly, 0);
  assert.equal(key.usage_monthly, null);
  assert.equal(key.disabled, null);
});
test('anomaly coverage counts all requested calendar dates, including absent rows', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-05T12:00:00Z'));
  mockAccount(t, [analytics(['25', '26', '27', '28'].map((day) => ({ date__day: `2026-09-${day}`, total_usage: 1 })))]);
  const result = await invoke('analyze_cost_anomalies', { days: 7, baseline_days: 3 });
  assert.equal(result.structuredContent.analysis_range.startDate, '2026-09-28');
  assert.equal(result.structuredContent.analysis_range.endDateExclusive, '2026-10-05');
  assert.equal(result.structuredContent.evaluated_days, 1);
  assert.equal(result.structuredContent.skipped_days, 6);
});

test('account summary contract runs credits and all four complete calendar windows', async (t) => {
  const requests = mockAccount(t, [{ data: { total_credits: 100, total_usage: 12.5 } }, ...[1, 2, 7, 30].map((total_usage) => analytics([{ total_usage }]))]);
  const result = await invoke('get_account_summary', { timezone: 'Asia/Shanghai' });
  assert.equal(result.structuredContent.remaining_credits, 87.5);
  assert.deepEqual(Object.keys(result.structuredContent.spend_windows), ['today', 'yesterday', '7d', '30d']);
  assert.equal(result.structuredContent.spend_windows['30d'].usd, 30);
  assert.equal(requests.length, 5);
  for (const request of requests.slice(1)) {
    assert.equal(new URL(request.url).pathname, '/api/v1/analytics/query');
    const range = JSON.parse(request.options.body).time_range;
    assert.ok(Date.parse(range.start) < Date.parse(range.end));
  }
});
test('analytics schema contract returns the live synthetic upstream schema', async (t) => {
  const schema = { metrics: [{ name: 'total_usage' }], dimensions: [{ name: 'model' }] };
  mockAccount(t, [{ data: schema }]);
  const result = await invoke('get_analytics_meta');
  assert.deepEqual(result.structuredContent, schema);
});
test('Cost Doctor combines complete synthetic spend, model prices and provider evidence', async (t) => {
  const metricNames = ['total_usage', 'request_count', 'tokens_total', 'tokens_prompt', 'tokens_completion', 'cache_hit_rate'];
  mockAccount(t, [
    { data: { metrics: metricNames.map((name) => ({ name })) } },
    analytics([{ model: 'test/model-a', total_usage: 8, request_count: 10, tokens_total: 1_000_000, tokens_prompt: 900_000, tokens_completion: 100_000, cache_hit_rate: 0.05 }, { model: 'test/model-b', total_usage: 2, request_count: 5, tokens_total: 500, tokens_prompt: 400, tokens_completion: 100, cache_hit_rate: 0.5 }]),
    { data: [{ id: 'test/model-a', name: 'A', pricing: { prompt: '0.000001', completion: '0.000002' } }, { id: 'test/model-b', name: 'B', pricing: { prompt: '0.000003', completion: '0.000004' } }] },
    { data: { endpoints: [{ provider_name: 'Provider A', pricing: { prompt: '0.000001', completion: '0.000002' } }, { provider_name: 'Provider B', pricing: { prompt: '0.000002', completion: '0.000003' } }] } },
    { data: { endpoints: [] } }
  ]);
  const result = await invoke('analyze_cost_optimization');
  assert.equal(result.structuredContent.total_usage, 10);
  assert.equal(result.structuredContent.contributors.length, 2);
  const first = result.structuredContent.contributors[0];
  assert.equal(first.spend_share, 0.8);
  assert.equal(first.catalog.prompt_usd_per_million, 1);
  assert.equal(first.catalog.cached_prompt_usd_per_million, null);
  assert.ok(first.optimization_signals.some((signal) => signal.type === 'provider_price_spread'));
  assert.ok(first.optimization_signals.some((signal) => signal.type === 'low_cache_reuse'));
});
test('model comparison contract preserves unknown models and missing prices', async (t) => {
  mockAccount(t, [{ data: [{ id: 'test/model-a', name: 'A', context_length: 128_000, pricing: { prompt: '0.000001', completion: null } }] }, { data: { endpoints: [{ provider_name: 'Provider A', pricing: { prompt: '0.000001', completion: null } }] } }]);
  const result = await invoke('compare_models', { model_ids: ['test/model-a', 'test/unknown'], include_endpoints: true });
  assert.equal(result.structuredContent.models[0].prompt_usd_per_million, 1);
  assert.equal(result.structuredContent.models[0].completion_usd_per_million, null);
  assert.equal(result.structuredContent.models[0].provider_summary.min_completion_usd_per_million, null);
  assert.deepEqual(result.structuredContent.models[1], { id: 'test/unknown', found: false });
});
test('complete synthetic anomaly data evaluates exactly the requested seven closed days', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-05T12:00:00Z'));
  const start = Date.parse('2026-09-25T00:00:00Z');
  mockAccount(t, [analytics(Array.from({ length: 10 }, (_, index) => ({ date__day: new Date(start + index * 86_400_000).toISOString(), total_usage: index === 9 ? 10 : 1 })))]);
  const result = await invoke('analyze_cost_anomalies', { days: 7, baseline_days: 3 });
  assert.equal(result.structuredContent.evaluated_days, 7);
  assert.equal(result.structuredContent.skipped_days, 0);
  assert.equal(result.structuredContent.anomalies.length, 1);
  assert.equal(result.structuredContent.anomalies[0].date, '2026-10-04');
});

test('query preflight provides the actual API-key dimension and never executes an invalid usage query', async (t) => {
  const requests = mockAccount(t, [{ data: { metrics: [{ name: 'total_usage', is_rate: false, display_format: 'currency' }], dimensions: [{ name: 'api_key_id' }], operators: [], granularities: [{ name: 'day' }] } }]);
  const result = await invoke('query_usage', { dimensions: ['api_key'] });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.query_executed, false);
  assert.deepEqual(result.structuredContent.validation_errors[0].allowed, ['api_key_id']);
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).pathname, '/api/v1/analytics/meta');
});
test('schema-aware API-key breakdown defaults to an explicit seven-calendar-day range', async (t) => {
  const requests = mockAccount(t, [{ data: { metrics: [{ name: 'total_usage', is_rate: false, display_format: 'currency' }, { name: 'custom_ratio', is_rate: true, display_format: 'percent' }], dimensions: [{ name: 'api_key_id' }], operators: [{ name: 'in', value_type: 'array' }], granularities: [{ name: 'day' }] } }, analytics([{ api_key_id: 'Synthetic key label', total_usage: 3, custom_ratio: 0.5 }])]);
  const result = await invoke('query_usage', { dimensions: ['api_key_id'], metrics: ['total_usage', 'custom_ratio'], granularity: 'day', order_by: { field: 'total_usage', direction: 'desc' } });
  assert.equal(result.structuredContent.schema_validated, true);
  assert.equal(result.structuredContent.timezone, 'UTC');
  assert.equal(result.structuredContent.time_bucket_timezone, 'UTC');
  assert.equal(Date.parse(result.structuredContent.range.end) - Date.parse(result.structuredContent.range.start), 7 * 86_400_000);
  assert.deepEqual(result.structuredContent.totals, { total_usage: 3 });
  assert.equal(result.structuredContent.metric_aggregations.custom_ratio.reason, 'non_additive_metric');
  assert.equal(requests.length, 2);
});

test('schema discovery can prepare common analysis recipes without querying usage', async (t) => {
  const requests = mockAccount(t, [{ data: { metrics: [{ name: 'total_usage', is_rate: false, display_format: 'currency' }], dimensions: [{ name: 'api_key_id' }], operators: [], granularities: [] } }]);
  const result = await invoke('get_analytics_meta', { include_query_recipes: true });
  const recipe = result.structuredContent.query_recipes.find((item) => item.id === 'top_api_keys');
  assert.equal(recipe.status, 'ready');
  assert.deepEqual(recipe.parameters.dimensions, ['api_key_id']);
  assert.equal(recipe.query_executed, false);
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).pathname, '/api/v1/analytics/meta');
});

test('Cost Doctor preserves complete usage analysis when optional public catalog lookup fails', async (t) => {
  mockAccount(t, [{ data: { metrics: [{ name: 'total_usage' }, { name: 'tokens_prompt' }, { name: 'cache_hit_rate' }] } }, analytics([{ model: 'synthetic/model', total_usage: 4, tokens_prompt: 600_000, cache_hit_rate: 'invalid' }]), new Response('synthetic-private-upstream-diagnostic', { status: 503 })]);
  const result = await invoke('analyze_cost_optimization', { include_provider_evidence: false });
  assert.equal(result.structuredContent.catalog_available, false);
  assert.equal(result.structuredContent.total_usage, 4);
  const contributor = result.structuredContent.contributors[0];
  assert.equal(contributor.cache_hit_rate, null);
  assert.equal(contributor.catalog, null);
  assert.equal(contributor.provider_evidence_status, 'not_requested');
  assert.equal(contributor.optimization_advice.estimated_savings_usd, null);
  assert.ok(contributor.optimization_advice.invalid_metrics.includes('cache_hit_rate'));
  assert.ok(!contributor.optimization_signals.some((signal) => signal.type === 'low_cache_reuse'));
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private-upstream-diagnostic|"invalid"/);
});
