import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function moduleFrom(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { queryAnomalyDays, resolveAnomalyRanges } = await moduleFrom('lib/costAnomalyDays.ts');
const { analyzeCostSeries } = await moduleFrom('lib/analytics.ts');
const { registerRouterLensTools } = await moduleFrom('lib/tools.ts');
const NOW = new Date('2026-10-08T11:00:00Z');
const base = { timezone: 'Asia/Shanghai', days: 2, baseline_days: 3, ratio_threshold: 1.5, absolute_threshold_usd: 1 };
const reply = (rows, metadata = {}) => ({ data: { data: rows, metadata: { row_count: rows.length, truncated: false, ...metadata } } });
const err = code => error => error.code === code;
function hours(input, perDay = () => 1) {
  return Array.from({ length: (Date.parse(input.time_range.end) - Date.parse(input.time_range.start)) / 3600000 }, (_, i) => ({
    date__hour: new Date(Date.parse(input.time_range.start) + i * 3600000).toISOString(), total_usage: i % 24 === 0 ? perDay(Math.floor(i / 24), i % 24) : 0
  }));
}
const analyze = result => analyzeCostSeries(result.rows, 'total_usage', 'date__day', 3, 1.5, 1, result.targetRange.startDate, result.targetRange.endDateExclusive);

test('Shanghai uses one exact hourly query and local date boundaries, never relabeled UTC days', async () => {
  let calls = 0;
  const result = await queryAnomalyDays(base, async input => {
    calls++;
    assert.equal(input.granularity, 'hour');
    assert.deepEqual(input.metrics, ['total_usage']);
    assert.equal(input.dimensions, undefined);
    assert.equal(input.limit, 10000);
    assert.deepEqual(input.time_range, { start: '2026-10-02T16:00:00.000Z', end: '2026-10-07T16:00:00.000Z' });
    return reply(hours(input, day => day === 3 ? 10 : 1));
  }, NOW);
  assert.equal(calls, 1);
  assert.deepEqual(result.rows.map(r => r.date__day), ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']);
  assert.equal(result.rows[3].total_usage, 10);
  assert.deepEqual(result.unknownDays, []);
  const a = analyze(result);
  assert.equal(a.evaluatedDays, 2);
  assert.equal(a.anomalies[0].date, '2026-10-06');
  assert.equal(a.anomalies[0].baseline, 1);
  assert.equal(a.anomalies[0].absoluteIncrease, 9);
});

test('midnight excludes the current calendar day before and at the boundary', () => {
  const before = resolveAnomalyRanges(base, new Date('2026-10-08T15:59:59.999Z'));
  const after = resolveAnomalyRanges(base, new Date('2026-10-08T16:00:00.000Z'));
  assert.equal(before.queryRange.end, '2026-10-07T16:00:00.000Z');
  assert.equal(after.queryRange.end, '2026-10-08T16:00:00.000Z');
});

test('Shanghai defaults to 7 + 7 days while UTC keeps 30 + 7', () => {
  const local = resolveAnomalyRanges({ ...base, days: undefined, baseline_days: 7 }, NOW);
  const utc = resolveAnomalyRanges({ ...base, timezone: 'UTC', days: undefined, baseline_days: 7 }, NOW);
  assert.equal(local.days, 7);
  assert.equal(utc.days, 30);
});

for (const [zone, instant] of [['Asia/Kolkata', NOW], ['Asia/Kathmandu', NOW], ['America/New_York', new Date('2026-03-09T12:00:00Z')], ['America/New_York', new Date('2026-11-02T12:00:00Z')], ['Australia/Lord_Howe', NOW], ['Etc/UTC', NOW]]) {
  test(`unsupported timezone ${zone} at ${instant.toISOString()} fails before upstream`, async () => {
    let calls = 0;
    await assert.rejects(queryAnomalyDays({ ...base, timezone: zone }, async () => { calls++; return reply([]); }, instant), err('UNSUPPORTED_ANOMALY_TIMEZONE'));
    assert.equal(calls, 0);
  });
}

test('31 days including baseline accepted, 32 rejected before the only upstream call', async () => {
  const result = await queryAnomalyDays({ ...base, days: 28 }, async q => reply(hours(q)), NOW);
  assert.equal(result.rows.length, 31);
  assert.equal(result.upstreamRows, 744);
  let calls = 0;
  await assert.rejects(queryAnomalyDays({ ...base, days: 29 }, async () => { calls++; return reply([]); }, NOW), err('LOCAL_ANOMALY_RANGE_TOO_WIDE'));
  assert.equal(calls, 0);
});

test('explicit full zero coverage is zero, no rows are unknown, sparse days are unknown', async () => {
  const zero = await queryAnomalyDays(base, async q => reply(hours(q, () => 0)), NOW);
  assert.equal(zero.rows.length, 5);
  assert.equal(zero.rows[0].total_usage, 0);
  assert.equal(analyze(zero).evaluatedDays, 2);
  const none = await queryAnomalyDays(base, async () => reply([]), NOW);
  assert.deepEqual(none.rows, []);
  assert.equal(none.unknownDays.length, 5);
  assert.equal(analyze(none).evaluatedDays, 0);
  assert.equal(analyze(none).skippedDays, 2);
  const sparse = await queryAnomalyDays(base, async q => reply(hours(q).filter((_, i) => i % 24 !== 9)), NOW);
  assert.deepEqual(sparse.rows, []);
  assert.equal(sparse.unknownDays[0].observed_buckets, 23);
});

test('missing baseline day is not backfilled or skipped to form a non-consecutive baseline', async () => {
  const result = await queryAnomalyDays(base, async q => reply(hours(q, d => d >= 3 ? 10 : 1).filter((_, i) => i !== 25)), NOW);
  assert.equal(result.unknownDays[0].date, '2026-10-04');
  assert.equal(analyze(result).evaluatedDays, 0);
  assert.equal(analyze(result).skippedDays, 2);
});

test('missing target day is unknown without hiding the next complete day', async () => {
  const result = await queryAnomalyDays(base, async q => reply(hours(q).filter((_, i) => i < 96 || i !== 100)), NOW);
  assert.equal(analyze(result).evaluatedDays, 1);
  assert.equal(analyze(result).skippedDays, 1);
});

for (const [label, mutation, code] of [
  ['duplicate normalized hours', rows => [...rows, { ...rows[0], date__hour: rows[0].date__hour.replace('T', ' ').replace('.000Z', '') }], 'INVALID_RESPONSE'],
  ['out-of-range prior hour', rows => [{ ...rows[0], date__hour: '2026-10-02T15:00:00Z' }, ...rows.slice(1)], 'INVALID_RESPONSE'],
  ['current-day boundary', rows => [{ ...rows[0], date__hour: '2026-10-07T16:00:00Z' }, ...rows.slice(1)], 'INVALID_RESPONSE'],
  ['future hour', rows => [{ ...rows[0], date__hour: '2026-10-09T16:00:00Z' }, ...rows.slice(1)], 'INVALID_RESPONSE'],
  ['half-hour bucket', rows => [{ ...rows[0], date__hour: '2026-10-02T16:30:00Z' }, ...rows.slice(1)], 'INVALID_RESPONSE'],
  ['missing metric', rows => [{ date__hour: rows[0].date__hour }, ...rows.slice(1)], 'INVALID_RESPONSE'],
  ['underflow cost', rows => [{ ...rows[0], total_usage: '1e-999' }, ...rows.slice(1)], 'INVALID_RESPONSE'],
  ['hexadecimal cost', rows => [{ ...rows[0], total_usage: '0x01' }, ...rows.slice(1)], 'INVALID_RESPONSE'],
  ['NaN metric', rows => [{ ...rows[0], total_usage: 'NaN' }, ...rows.slice(1)], 'INVALID_RESPONSE'],
  ['unexpected model grouping', rows => [{ ...rows[0], model: 'test/a' }, ...rows.slice(1)], 'INVALID_RESPONSE'],
  ['numeric sum overflow', rows => rows.map(r => ({ ...r, total_usage: 1e308 })), 'INVALID_RESPONSE']
]) test(`${label} is rejected without false anomaly conclusions`, async () => {
  await assert.rejects(queryAnomalyDays(base, async q => reply(mutation(hours(q))), NOW), err(code));
});

for (const [label, metadata, code] of [['truncated', { truncated: true }, 'INCOMPLETE_ANALYTICS'], ['unknown truncation', { truncated: null }, 'INCOMPLETE_ANALYTICS'], ['wrong row count', { row_count: 1 }, 'INVALID_RESPONSE']]) {
  test(`${label} fails closed`, async () => {
    await assert.rejects(queryAnomalyDays(base, async q => reply(hours(q), metadata), NOW), err(code));
  });
}

test('missing metadata and upstream warnings fail closed; error contents do not leak', async () => {
  await assert.rejects(queryAnomalyDays(base, async q => ({ data: { data: hours(q) } }), NOW), err('INCOMPLETE_ANALYTICS'));
  await assert.rejects(queryAnomalyDays(base, async q => ({ ...reply(hours(q)), warnings: ['private diagnostic'] }), NOW), e => e.code === 'ANALYTICS_WARNINGS' && !e.message.includes('private diagnostic'));
});

test('tiny decimal spend and signed adjustments are not rounded away', async () => {
  const result = await queryAnomalyDays(base, async q => reply(hours(q).map((r, i) => ({ ...r, total_usage: i % 24 === 0 ? '0.000000001' : i % 24 === 1 ? '-0.0000000001' : '0' }))), NOW);
  for (const row of result.rows) assert.ok(Math.abs(row.total_usage - 9e-10) < 1e-24);
});

test('upstream rejection is not retried or converted into no anomaly', async () => {
  let calls = 0;
  await assert.rejects(queryAnomalyDays(base, async () => { calls++; throw new Error('timeout'); }, NOW), /timeout/);
  assert.equal(calls, 1);
});

test('UTC retains a single daily query, 90 day range and explicit zero/missing semantics', async () => {
  let calls = 0;
  const result = await queryAnomalyDays({ ...base, timezone: 'UTC', days: 90, baseline_days: 30 }, async q => {
    calls++;
    assert.equal(q.granularity, 'day');
    return reply([{ date__day: '2026-10-07', total_usage: 0 }]);
  }, NOW);
  assert.equal(calls, 1);
  assert.deepEqual(result.rows, [{ date__day: '2026-10-07', total_usage: 0, total_usage_decimal: '0e-0' }]);
  assert.equal(result.unknownDays.length, 119);
  assert.equal(result.queryRange.end, '2026-10-08T00:00:00.000Z');
});

test('UTC duplicate and current-day daily rows fail closed', async () => {
  for (const rows of [[{ date__day: '2026-10-07', total_usage: 1 }, { date__day: '2026-10-07', total_usage: 1 }], [{ date__day: '2026-10-08', total_usage: 1 }]]) {
    await assert.rejects(queryAnomalyDays({ ...base, timezone: 'UTC' }, async () => reply(rows), NOW), err('INVALID_RESPONSE'));
  }
});

test('baseline arithmetic overflow cannot produce a false normal conclusion', () => {
  assert.throws(() => analyzeCostSeries([1, 2, 3, 4].map(day => ({ date__day: `2026-10-0${day}`, total_usage: 1e308 })), 'total_usage', 'date__day', 3), err('INVALID_RESPONSE'));
});

test('tool integration reports local timezone, coverage, unknown and a single query', async () => {
  const handlers = {};
  let calls = 0;
  registerRouterLensTools({ registerTool(name, definition, handler) { handlers[name] = handler; } }, {
    queryAnalytics: async q => { calls++; return reply(hours(q, () => 0)); },
    getCredits: async () => { throw new Error('unexpected'); }, getAnalyticsMeta: async () => { throw new Error('unexpected'); },
    listKeys: async () => { throw new Error('unexpected'); }, listModels: async () => { throw new Error('unexpected'); },
    getModelEndpoints: async () => { throw new Error('unexpected'); }, status: () => ({ management_key_configured: false, mode: 'synthetic' })
  });
  const result = await handlers.analyze_cost_anomalies(base);
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.time_bucket_timezone, 'Asia/Shanghai');
  assert.equal(result.structuredContent.upstream_bucket_timezone, 'UTC');
  assert.equal(result.structuredContent.upstream_query_count, 1);
  assert.equal(result.structuredContent.evaluated_days, 2);
  assert.deepEqual(result.structuredContent.unknown_days, []);
  assert.equal(calls, 1);
});

for (const timezone of ['UTC', 'Asia/Shanghai']) {
  for (const [amount, count] of [['0.29999999999999999999', 0], ['3e-1', 1], ['0.30000000000000000001', 1]]) {
    test(`${timezone}: exact threshold boundary ${amount} uses received decimal evidence`, async () => {
      const options = { ...base, timezone, days: 1, ratio_threshold: 3, absolute_threshold_usd: 0.2 };
      const result = await queryAnomalyDays(options, async q => timezone === 'UTC'
        ? reply([0, 1, 2, 3].map(i => ({ date__day: new Date(Date.parse(q.time_range.start) + i * 86400000).toISOString().slice(0, 10), total_usage: i === 3 ? amount : '1e-1' })))
        : reply(hours(q).map((r, i) => ({ ...r, total_usage: i % 24 === 0 ? (i >= 72 ? amount : '1e-1') : '0' }))), NOW);
      const a = analyzeCostSeries(result.rows, 'total_usage', 'date__day', 3, 3, 0.2, result.targetRange.startDate, result.targetRange.endDateExclusive);
      assert.equal(a.anomalies.length, count);
      if (count) { assert.equal(a.anomalies[0].baseline, 0.1); assert.equal(a.anomalies[0].absoluteIncrease, 0.2); }
    });
  }
  test(`${timezone}: negative net day is unknown and other eligible days still analyze`, async () => {
    const options = { ...base, timezone, days: 2 };
    const result = await queryAnomalyDays(options, async q => timezone === 'UTC'
      ? reply([1, 1, 1, 10, -2].map((total_usage, i) => ({ date__day: new Date(Date.parse(q.time_range.start) + i * 86400000).toISOString().slice(0, 10), total_usage })))
      : reply(hours(q, d => [1, 1, 1, 10, -2][d])), NOW);
    assert.equal(result.unknownDays.length, 1);
    assert.equal(result.unknownDays[0].reason, 'unsupported_negative_net');
    assert.equal(result.unknownDays[0].observed_net_usage, -2);
    assert.equal(analyze(result).evaluatedDays, 1);
    assert.equal(analyze(result).anomalies.length, 1);
  });
}

for (const bad of [{ ratio_threshold: -1 }, { ratio_threshold: Infinity }, { absolute_threshold_usd: -0.01 }, { absolute_threshold_usd: NaN }, { baseline_days: 0 }, { days: 1.5 }]) {
  test(`invalid options ${Object.keys(bad)[0]}=${String(Object.values(bad)[0])} fail before upstream`, async () => {
    let calls = 0;
    await assert.rejects(queryAnomalyDays({ ...base, ...bad }, async () => { calls++; return reply([]); }, NOW), err('INVALID_ANOMALY_OPTIONS'));
    assert.equal(calls, 0);
  });
}
