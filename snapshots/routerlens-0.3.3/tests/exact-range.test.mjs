import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function moduleFrom(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { queryExactRange, validateRangePrecision } = await moduleFrom('lib/exactRange.ts');
const { resolvePresetRange } = await moduleFrom('lib/time.ts');
const { registerRouterLensTools } = await moduleFrom('lib/tools.ts');
const range = { start: '2026-10-06T16:00:00Z', end: '2026-10-07T16:00:00Z' };
const query = { metrics: ['total_usage', 'request_count'], time_range: range };
const additive = field => ['total_usage', 'request_count', 'tokens_prompt', 'cached_tokens', 'tokens_total', 'usage_data'].includes(field);
const reply = (rows, metadata = {}) => ({ data: { data: rows, metadata: { row_count: rows.length, truncated: false, ...metadata } } });
const hour = (date, total, count, extra = {}) => ({ date__hour: date, total_usage: total, request_count: String(count), ...extra });
const expectedError = code => error => error.code === code;

test('Beijing aggregate reads complete hours instead of default daily rollups', async () => {
  let calls = 0;
  const result = await queryExactRange(query, async input => {
    calls++;
    assert.equal(input.granularity, 'hour');
    assert.equal(input.limit, 10000);
    assert.equal(input.group_limit, 10000);
    assert.equal(input.order_by, undefined);
    assert.deepEqual(input.time_range, range);
    return reply([hour('2026-10-06 16:00:00', 0.15, 2), hour('2026-10-07T15:00:00.000Z', 0.25, 3)]);
  }, additive);
  assert.equal(calls, 1);
  assert.deepEqual(result.data.data, [{ total_usage: 0.4, request_count: 5 }]);
  assert.equal(result.data.metadata.aggregation_method, 'sum_complete_hourly_rows');
  assert.equal(result.data.metadata.truncated, false);
});

test('key filter stays exact; rank and limit run only after complete model aggregation', async () => {
  const filters = [{ field: 'api_key_id', operator: 'eq', value: 'synthetic-verified-hash' }];
  const result = await queryExactRange({ ...query, dimensions: ['model'], filters, limit: 1, group_limit: 1, order_by: { field: 'total_usage', direction: 'desc' } }, async input => {
    assert.deepEqual(input.filters, filters);
    assert.equal(input.group_limit, 10000);
    return reply([
      hour('2026-10-06 16:00:00', 0.6, 2, { model: 'test/a' }),
      hour('2026-10-06 17:00:00', 0.6, 2, { model: 'test/a' }),
      hour('2026-10-06 16:00:00', 1, 3, { model: 'test/b' })
    ]);
  }, additive);
  assert.deepEqual(result.data.data, [{ model: 'test/a', total_usage: 1.2, request_count: 4 }]);
  assert.equal(result.data.metadata.truncated, true);
  assert.equal(result.data.metadata.upstream_row_count, 3);
});

test('UTC-day aggregates and explicitly aligned hourly/minute rows retain upstream semantics', async () => {
  for (const input of [
    { ...query, time_range: { start: '2026-10-06T00:00:00Z', end: '2026-10-07T00:00:00Z' } },
    { ...query, granularity: 'hour' },
    { ...query, granularity: 'minute', time_range: { start: '2026-10-06T16:15:00Z', end: '2026-10-06T16:16:00Z' } }
  ]) {
    const response = reply([]);
    assert.equal(await queryExactRange(input, async received => { assert.deepEqual(received, input); return response; }, additive), response);
  }
});

for (const [name, metadata] of [['truncated', { truncated: true }], ['unknown', { truncated: null }], ['contradictory count', { row_count: 2 }]]) {
  test(`never infers complete total from ${name} upstream metadata`, async () => {
    await assert.rejects(queryExactRange(query, async () => reply([hour('2026-10-06 16:00:00', 1, 1)], metadata), additive), expectedError(name === 'contradictory count' ? 'INVALID_RESPONSE' : 'INCOMPLETE_ANALYTICS'));
  });
}
test('missing completeness and row-cap saturation fail without guessed pagination', async () => {
  let calls = 0;
  await assert.rejects(queryExactRange(query, async () => ({ data: { data: [], metadata: {} } }), additive), expectedError('INCOMPLETE_ANALYTICS'));
  await assert.rejects(queryExactRange(query, async () => { calls++; return reply(Array(10000).fill(hour('2026-10-06 16:00:00', 1, 1))); }, additive), expectedError('INCOMPLETE_ANALYTICS'));
  assert.equal(calls, 1);
});

for (const [name, input, code] of [
  ['half-hour aggregate', { ...query, time_range: { ...range, start: '2026-10-06T16:30:00Z' } }, 'UNSUPPORTED_TIME_PRECISION'],
  ['fractional second', { ...query, time_range: { ...range, start: '2026-10-06T16:00:00.001Z' } }, 'UNSUPPORTED_TIME_PRECISION'],
  ['minute sub-second', { ...query, granularity: 'minute', time_range: { ...range, start: '2026-10-06T16:00:01Z' } }, 'UNSUPPORTED_TIME_PRECISION'],
  ['coarse local-day buckets', { ...query, granularity: 'day' }, 'UNSUPPORTED_TIME_PRECISION'],
  ['over 31 days', { ...query, time_range: { start: '2026-09-01T16:00:00Z', end: range.end } }, 'EXACT_RANGE_TOO_WIDE'],
  ['reversed interval', { ...query, time_range: { start: range.end, end: range.start } }, 'INVALID_RANGE'],
  ['invalid timestamp', { ...query, time_range: { ...range, start: 'invalid' } }, 'INVALID_RANGE']
]) test(`${name} fails before upstream`, async () => {
  let calls = 0;
  await assert.rejects(queryExactRange(input, async () => { calls++; return reply([]); }, additive), expectedError(code));
  assert.equal(calls, 0);
});

test('rates, label-resolved grouping and metric filters cannot silently change grain', async () => {
  for (const [input, code] of [
    [{ ...query, metrics: ['total_usage', 'cache_hit_rate'] }, 'NON_ADDITIVE_EXACT_RANGE'],
    [{ ...query, dimensions: ['api_key_id'] }, 'LABEL_GROUP_EXACT_RANGE'],
    [{ ...query, filters: [{ field: 'total_usage', operator: 'gt', value: 1 }] }, 'METRIC_FILTER_EXACT_RANGE'],
    [{ ...query, filters: [{ field: 'avg_latency', operator: 'gt', value: 1 }] }, 'METRIC_FILTER_EXACT_RANGE']
  ]) {
    let calls = 0;
    await assert.rejects(queryExactRange(input, async () => { calls++; return reply([]); }, additive, field => additive(field) || field === 'avg_latency'), expectedError(code));
    assert.equal(calls, 0);
  }
});

for (const [name, rows] of [
  ['missing bucket', [{ total_usage: 1, request_count: 1 }]],
  ['before start', [hour('2026-10-06 15:00:00', 1, 1)]],
  ['end boundary excluded', [hour('2026-10-07 16:00:00', 1, 1)]],
  ['invalid calendar day', [hour('2026-02-30 16:00:00', 1, 1)]],
  ['duplicated bucket', [hour('2026-10-06 16:00:00', 1, 1), hour('2026-10-06 16:00:00', 1, 1)]],
  ['missing metric', [{ date__hour: '2026-10-06 16:00:00', total_usage: 1 }]],
  ['invalid metric', [hour('2026-10-06 16:00:00', '', 1)]]
]) test(`rejects ${name} response`, async () => {
  await assert.rejects(queryExactRange(query, async () => reply(rows), additive), expectedError('INVALID_RESPONSE'));
});

test('negative adjustments and numeric strings remain valid; empty data stays empty', async () => {
  const result = await queryExactRange(query, async () => reply([hour('2026-10-06 16:00:00', '-0.25', 0), hour('2026-10-06 17:00:00', '1.25', 1)]), additive);
  assert.equal(result.data.data[0].total_usage, 1);
  assert.deepEqual((await queryExactRange(query, async () => reply([]), additive)).data.data, []);
});

test('upstream filter warnings fail safely for both direct and reconstructed queries', async () => {
  for (const input of [query, { ...query, granularity: 'hour' }]) {
    await assert.rejects(queryExactRange(input, async () => ({ data: { ...reply([]).data, warnings: ['secret-diagnostic-must-not-escape'] } }), additive), error => error.code === 'ANALYTICS_WARNINGS' && !error.message.includes('secret-diagnostic'));
  }
});

test('Beijing midnight and DST ranges have exact calendar boundaries', () => {
  const now = new Date('2026-10-07T17:00:00Z');
  const yesterday = resolvePresetRange('yesterday', 'Asia/Shanghai', now);
  assert.equal(yesterday.start, '2026-10-06T16:00:00.000Z');
  assert.equal(yesterday.end, '2026-10-07T16:00:00.000Z');
  for (const [instant, hours] of [['2026-03-09T12:00:00Z', 23], ['2026-11-02T12:00:00Z', 25]]) {
    const dst = resolvePresetRange('yesterday', 'America/New_York', new Date(instant));
    assert.equal((Date.parse(dst.end) - Date.parse(dst.start)) / 3600000, hours);
    validateRangePrecision({ metrics: ['total_usage'], time_range: dst });
  }
});

const schema = { metrics: [
  { name: 'total_usage', is_rate: false, display_format: 'currency' },
  { name: 'request_count', is_rate: false, display_format: 'number' },
  { name: 'tokens_prompt', is_rate: false, display_format: 'number' },
  { name: 'cached_tokens', is_rate: false, display_format: 'number' },
  { name: 'cache_hit_rate', is_rate: true, display_format: 'percent' }
], dimensions: [{ name: 'model' }, { name: 'api_key_id' }], operators: [{ name: 'eq', value_type: 'scalar' }], granularities: [{ name: 'hour' }, { name: 'day' }, { name: 'minute' }] };
function toolsWith(queryAnalytics) {
  const handlers = {};
  registerRouterLensTools({ registerTool(name, definition, handler) { handlers[name] = handler; } }, {
    getCredits: async () => ({ data: { total_credits: 100, total_usage: 10 } }),
    getAnalyticsMeta: async () => ({ data: schema }), queryAnalytics,
    listModels: async () => ({ data: [] }), listKeys: async () => ({ data: [] }),
    getModelEndpoints: async () => ({ data: { endpoints: [] } }), status: () => ({ management_key_configured: true, mode: 'synthetic' })
  });
  return handlers;
}

test('account summary fixes all four Beijing windows and marks incomplete periods', async () => {
  const calls = [];
  const tools = toolsWith(async input => {
    calls.push(input);
    assert.equal(input.granularity, 'hour');
    return reply([{ date__hour: input.time_range.start, total_usage: 1.25 }]);
  });
  const response = await tools.get_account_summary({ timezone: 'Asia/Shanghai', include_spend_windows: true });
  assert.equal(response.isError, undefined);
  assert.equal(calls.length, 4);
  assert.equal(response.structuredContent.spend_windows.yesterday.period_complete, true);
  assert.equal(response.structuredContent.spend_windows.today.period_complete, false);
  for (const window of Object.values(response.structuredContent.spend_windows)) {
    assert.equal(window.usd, 1.25);
    assert.equal(window.aggregation_method, 'sum_complete_hourly_rows');
  }
});

test('query_usage keeps scoped cost separate from account totals', async () => {
  const tools = toolsWith(async () => reply([hour('2026-10-06 16:00:00', 0.5, 2, { model: 'test/a' })]));
  const result = await tools.query_usage({ ...query, timezone: 'Asia/Shanghai', dimensions: ['model'], filters: [{ field: 'api_key_id', operator: 'eq', value: 'synthetic-hash' }] });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.filter_scope, 'filtered_subset');
  assert.equal(result.structuredContent.totals.total_usage, 0.5);
  assert.equal(result.structuredContent.totals_complete, true);
});

test('optimization preserves additive cost evidence and never averages hourly cache rates', async () => {
  const tools = toolsWith(async input => {
    assert.equal(input.granularity, 'hour');
    assert.ok(!input.metrics.includes('cache_hit_rate'));
    return reply([{ date__hour: input.time_range.start, model: 'test/a', total_usage: 0.5, request_count: 2, tokens_prompt: 1000, cached_tokens: 100 }]);
  });
  const result = await tools.analyze_cost_optimization({ preset: '7d', timezone: 'Asia/Shanghai', top_models: 3, include_provider_evidence: false });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.total_usage, 0.5);
  assert.deepEqual(result.structuredContent.metrics_omitted_for_time_precision, ['cache_hit_rate']);
  assert.ok(result.structuredContent.contributors[0].optimization_advice.missing_metrics.includes('cache_hit_rate'));
});
