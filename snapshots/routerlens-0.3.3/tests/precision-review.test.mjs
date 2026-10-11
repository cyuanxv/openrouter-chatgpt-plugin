import { build } from 'esbuild';
import assert from 'node:assert/strict';
import test from 'node:test';
const bundled = await build({ entryPoints: ['lib/exactRange.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { queryExactRange, validateRangePrecision } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const range = { start: '2026-10-06T16:00:00Z', end: '2026-10-07T16:00:00Z' };
const query = { metrics: ['total_usage', 'request_count'], dimensions: ['model', 'provider'], time_range: range };
const additive = metric => ['total_usage', 'request_count'].includes(metric);
const response = rows => ({ data: { data: rows, metadata: { truncated: false, row_count: rows.length } } });

test('independent review: two-dimension identity, signed arithmetic and exact group limit', async () => {
  const result = await queryExactRange({ ...query, limit: 2, group_limit: 1, order_by: { field: 'total_usage', direction: 'desc' } }, async input => {
    assert.equal(input.granularity, 'hour');
    assert.equal(input.group_limit, 10000);
    assert.equal(input.order_by, undefined);
    return response([
      { date__hour: '2026-10-06 16:00:00', model: 'a|b', provider: 'c', total_usage: 1, request_count: '2' },
      { date__hour: '2026-10-06 17:00:00', model: 'a|b', provider: 'c', total_usage: -0.25, request_count: '1' },
      { date__hour: '2026-10-06 16:00:00', model: 'a', provider: 'b|c', total_usage: 2, request_count: '3' }
    ]);
  }, additive);
  assert.deepEqual(result.data.data, [
    { model: 'a', provider: 'b|c', total_usage: 2, request_count: 3 },
    { model: 'a|b', provider: 'c', total_usage: 0.75, request_count: 3 }
  ]);
  assert.equal(result.data.metadata.truncated, false);
});

test('independent review: coarse UTC partial-calendar windows preserve upstream query', async () => {
  for (const granularity of ['day', 'week', 'month']) {
    const input = { metrics: ['total_usage'], granularity, time_range: { start: '2026-10-02T00:00:00Z', end: '2026-10-07T00:00:00Z' } };
    const expected = response([]);
    assert.equal(await queryExactRange(input, async actual => { assert.deepEqual(actual, input); return expected; }, additive), expected);
  }
});

test('independent review: 31-day exact threshold', () => {
  validateRangePrecision({ metrics: ['total_usage'], time_range: { start: '2026-09-01T16:00:00Z', end: '2026-10-02T16:00:00Z' } });
  assert.throws(() => validateRangePrecision({ metrics: ['total_usage'], time_range: { start: '2026-09-01T16:00:00Z', end: '2026-10-02T17:00:00Z' } }), error => error.code === 'EXACT_RANGE_TOO_WIDE');
});

test('independent review: malformed dimensions and noncanonical buckets fail closed', async () => {
  for (const row of [
    { date__hour: '2026-10-06 16:00:00', model: 'x', total_usage: 1, request_count: 1 },
    { date__hour: '2026-10-06 16:00:00', model: 'x', provider: [], total_usage: 1, request_count: 1 },
    { date__hour: '2026-10-06T16:00:00+00:00', model: 'x', provider: 'y', total_usage: 1, request_count: 1 }
  ]) await assert.rejects(queryExactRange(query, async () => response([row]), additive), error => error.code === 'INVALID_RESPONSE');
});

test('independent review: numeric overflow never emits an exact total', async () => {
  await assert.rejects(queryExactRange(query, async () => response([
    { date__hour: '2026-10-06 16:00:00', model: 'x', provider: 'y', total_usage: Number.MAX_VALUE, request_count: 1 },
    { date__hour: '2026-10-06 17:00:00', model: 'x', provider: 'y', total_usage: Number.MAX_VALUE, request_count: 1 }
  ]), additive), error => error.code === 'INVALID_RESPONSE');
});

test('independent review: warning and label gates run before aggregation', async () => {
  for (const dimension of ['api_key_id', 'app', 'user', 'workspace']) {
    await assert.rejects(queryExactRange({ ...query, dimensions: [dimension] }, async () => { throw new Error('must not fetch'); }, additive), error => error.code === 'LABEL_GROUP_EXACT_RANGE');
  }
  await assert.rejects(queryExactRange(query, async () => ({ ...response([]), warnings: ['synthetic-private-detail'] }), additive), error => error.code === 'ANALYTICS_WARNINGS' && !error.message.includes('synthetic-private-detail'));
});
