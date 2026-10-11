import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Independent offline review. All responses are synthetic; no credentials,
// network requests, account identifiers, or production configuration are used.
async function moduleFrom(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { queryAnomalyDays, resolveAnomalyRanges } = await moduleFrom('lib/costAnomalyDays.ts');
const { analyzeCostSeries } = await moduleFrom('lib/analytics.ts');
const { registerRouterLensTools } = await moduleFrom('lib/tools.ts');
const NOW = new Date('2026-10-08T11:00:00Z');
const input = { timezone: 'Asia/Shanghai', days: 1, baseline_days: 3, ratio_threshold: 3, absolute_threshold_usd: 0.2 };
const reply = rows => ({ data: { data: rows, metadata: { row_count: rows.length, truncated: false } } });
const errorCode = expected => error => error.code === expected;
function hours(query, valueForHour = () => 0) {
  const start = Date.parse(query.time_range.start);
  return Array.from({ length: (Date.parse(query.time_range.end) - start) / 3_600_000 }, (_, index) => ({
    date__hour: new Date(start + index * 3_600_000).toISOString(),
    total_usage: valueForHour(index, Math.floor(index / 24), index % 24)
  }));
}
function dailyRows(values) {
  return values.map((value, index) => ({ date__day: `2026-10-${String(index + 1).padStart(2, '0')}`, total_usage: value }));
}
function analyze(result, options = input) {
  return analyzeCostSeries(result.rows, 'total_usage', 'date__day', options.baseline_days,
    options.ratio_threshold, options.absolute_threshold_usd, result.targetRange.startDate, result.targetRange.endDateExclusive);
}
function handlersWith(queryAnalytics) {
  const handlers = {};
  const unexpected = async () => { throw new Error('unexpected auxiliary call'); };
  registerRouterLensTools({ registerTool(name, definition, handler) { handlers[name] = handler; } }, {
    queryAnalytics, getCredits: unexpected, getAnalyticsMeta: unexpected, listKeys: unexpected,
    listModels: unexpected, getModelEndpoints: unexpected,
    status: () => ({ management_key_configured: false, mode: 'synthetic' })
  });
  return handlers;
}

test('independent local-day review: inclusive ordinary decimal thresholds cannot be rounded into normal', async () => {
  const result = await queryAnomalyDays(input, async query => reply(hours(query, (_, day, hour) => hour === 0 ? (day === 3 ? '0.30' : '0.10') : '0')), NOW);
  const analysis = analyze(result);
  assert.equal(analysis.evaluatedDays, 1);
  assert.equal(analysis.anomalies.length, 1, '$0.30 versus $0.10 has ratio 3 and increase $0.20');
  assert.equal(analysis.anomalies[0].baselineZero, false);
});

test('independent local-day review: amounts materially below a decimal threshold remain normal', async () => {
  const result = await queryAnomalyDays(input, async query => reply(hours(query, (_, day, hour) => hour === 0 ? (day === 3 ? '0.29999999' : '0.10') : '0')), NOW);
  assert.deepEqual(analyze(result).anomalies, []);
});

test('independent local-day review: positive-baseline ratio overflow fails closed', () => {
  assert.throws(() => analyzeCostSeries(dailyRows([1e-300, 1e-300, 1e-300, 1e20]),
    'total_usage', 'date__day', 3, 1.5, 1, '2026-10-04', '2026-10-05'), errorCode('INVALID_RESPONSE'));
});

test('independent local-day review: arithmetic ratio overflow reaches the tool as an error', async () => {
  let calls = 0;
  const handlers = handlersWith(async query => {
    calls++;
    return reply(hours(query, (_, day, hour) => hour === 0 ? (day === 3 ? 1e20 : 1e-300) : 0));
  });
  const result = await handlers.analyze_cost_anomalies({ ...input, ratio_threshold: 1.5, absolute_threshold_usd: 1 });
  assert.equal(calls, 1);
  assert.equal(result.isError, true, 'numeric overflow must not return a successful anomaly');
});

for (const timezone of ['UTC', 'Asia/Shanghai']) {
  test(`independent local-day review: empty nested warnings do not mask root warnings (${timezone})`, async () => {
    const response = reply([]);
    response.data.warnings = [];
    response.warnings = ['synthetic unresolved filter warning'];
    await assert.rejects(queryAnomalyDays({ ...input, timezone }, async () => response, NOW),
      error => error.code === 'ANALYTICS_WARNINGS' && !error.message.includes('synthetic unresolved'));
  });
}

test('independent local-day review: nonzero baseline mean cannot silently underflow to explicit zero', () => {
  assert.throws(() => analyzeCostSeries(dailyRows([Number.MIN_VALUE, 0, 0, 1]),
    'total_usage', 'date__day', 3, 1.5, 1, '2026-10-04', '2026-10-05'), errorCode('INVALID_RESPONSE'));
});

test('independent local-day review: signed baseline cancellation retains its representable residual', () => {
  const result = analyzeCostSeries(dailyRows([1e16, 1, -1e16, 1]),
    'total_usage', 'date__day', 3, 1.5, 0, '2026-10-04', '2026-10-05');
  assert.equal(result.anomalies.length, 1);
  assert.equal(result.anomalies[0].baselineZero, false, '(1e16 + 1 - 1e16) / 3 is positive');
  assert.equal(result.anomalies[0].baseline, 1 / 3);
});

test('independent local-day review: zero baseline remains an intentionally unbounded ratio', () => {
  const result = analyzeCostSeries(dailyRows([0, 0, 0, 1]),
    'total_usage', 'date__day', 3, 10, 1, '2026-10-04', '2026-10-05');
  assert.equal(result.anomalies.length, 1);
  assert.equal(result.anomalies[0].ratio, null);
  assert.equal(result.anomalies[0].baselineZero, true);
});

test('independent local-day review: leap-year month crossing has exactly four local days', async () => {
  const now = new Date('2024-03-02T01:00:00Z');
  const range = resolveAnomalyRanges(input, now);
  assert.equal(range.queryRange.start, '2024-02-26T16:00:00.000Z');
  assert.equal(range.queryRange.end, '2024-03-01T16:00:00.000Z');
  const result = await queryAnomalyDays(input, async query => reply(hours(query).reverse()), now);
  assert.deepEqual(result.rows.map(row => row.date__day), ['2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01']);
  assert.equal(result.unknownDays.length, 0);
});

test('independent local-day review: UTC midnight does not split a Shanghai calendar day', async () => {
  const result = await queryAnomalyDays(input, async query => reply(hours(query, index => index === 7 || index === 8 ? 1 : 0).reverse()), NOW);
  assert.deepEqual(result.rows.map(row => row.total_usage), [2, 0, 0, 0]);
});

test('independent local-day review: baseline recovers only after three subsequent complete days', async () => {
  const options = { ...input, days: 5, ratio_threshold: 1.5, absolute_threshold_usd: 1 };
  const result = await queryAnomalyDays(options, async query => reply(hours(query).filter((_, index) => index !== 2 * 24 + 12)), NOW);
  const analysis = analyze(result, options);
  assert.equal(result.unknownDays.length, 1);
  assert.equal(analysis.evaluatedDays, 2);
  assert.equal(analysis.skippedDays, 3);
});

test('independent local-day review: malformed cost is rejected even on an incomplete unknown day', async () => {
  await assert.rejects(queryAnomalyDays(input, async query => reply(hours(query, index => index === 0 ? '1e-999' : 0).slice(0, 23)), NOW), errorCode('INVALID_RESPONSE'));
});

test('independent local-day review: local hourly signed cancellation retains a residual', async () => {
  const values = [1e16, 1, -1e16];
  const result = await queryAnomalyDays(input, async query => reply(hours(query, (_, __, hour) => values[hour] ?? 0)), NOW);
  assert.deepEqual(result.rows.map(row => row.total_usage), [1, 1, 1, 1]);
});

for (const timezone of ['UTC', 'Asia/Shanghai']) {
  test(`independent local-day review: refund days stay visible as unknown without discarding later analysis (${timezone})`, async () => {
    const options = { ...input, timezone, days: 5, ratio_threshold: 1.5, absolute_threshold_usd: 1 };
    const values = [1, 1, -0.5, 1, 1, 1, 10, 1];
    const result = await queryAnomalyDays(options, async query => reply(timezone === 'Asia/Shanghai'
      ? hours(query, (_, day, hour) => hour === 0 ? values[day] : 0)
      : values.map((value, index) => ({
          date__day: new Date(Date.parse(query.time_range.start) + index * 86_400_000).toISOString().slice(0, 10), total_usage: value
        }))), NOW);
    assert.equal(result.unknownDays.length, 1);
    assert.equal(result.unknownDays[0].reason, 'unsupported_negative_net');
    assert.equal(result.unknownDays[0].observed_net_usage, -0.5);
    assert.equal(result.unknownDays[0].observed_buckets, timezone === 'Asia/Shanghai' ? 24 : 1);
    const analysis = analyze(result, options);
    assert.equal(analysis.evaluatedDays, 2);
    assert.equal(analysis.skippedDays, 3);
    assert.equal(analysis.anomalies.length, 1);
    assert.equal(analysis.anomalies[0].value, 10);
    assert.equal(analysis.anomalies[0].baseline, 1);
  });
}

for (const timezone of ['UTC', 'Asia/Shanghai']) {
  test(`independent local-day review: raw decimal digits survive daily aggregation before threshold decisions (${timezone})`, async () => {
    const options = { ...input, timezone };
    const values = ['0.100000000000000001', '0.100000000000000001', '0.100000000000000001', '0.30'];
    const result = await queryAnomalyDays(options, async query => reply(timezone === 'Asia/Shanghai'
      ? hours(query, (_, day, hour) => hour === 0 ? values[day] : '0')
      : values.map((value, index) => ({
          date__day: new Date(Date.parse(query.time_range.start) + index * 86_400_000).toISOString().slice(0, 10), total_usage: value
        }))), NOW);
    assert.equal(result.rows[0].total_usage, 0.1, 'display may round to a finite JS number');
    assert.equal(result.rows[0].total_usage_decimal, '100000000000000001e-18');
    assert.equal(analyze(result, options).anomalies.length, 0, 'true baseline is above $0.10, so neither inclusive boundary is met');
  });
}

test('independent local-day review: 240 deterministic money cases agree with an integer-cents oracle', () => {
  let seed = 981723;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let index = 0; index < 240; index++) {
    const cents = [next() % 10000 + 1, next() % 10000 + 1, next() % 10000 + 1, next() % 100000];
    const absoluteCents = next() % 10000;
    const [ratioNumerator, ratioDenominator] = [[3, 2], [2, 1], [3, 1], [10, 1]][index % 4];
    const sum = BigInt(cents[0] + cents[1] + cents[2]);
    const scaledCurrent = BigInt(cents[3]) * 3n;
    const expected = scaledCurrent * BigInt(ratioDenominator) >= sum * BigInt(ratioNumerator)
      && scaledCurrent - sum >= BigInt(absoluteCents) * 3n;
    const rows = dailyRows(cents.map(value => value / 100)).map((row, day) => ({ ...row, total_usage_decimal: `${cents[day]}e-2` }));
    const result = analyzeCostSeries(rows, 'total_usage', 'date__day', 3,
      ratioNumerator / ratioDenominator, absoluteCents / 100, '2026-10-04', '2026-10-05');
    assert.equal(result.anomalies.length === 1, expected, `integer oracle case ${index}`);
    assert.equal(result.evaluatedDays, 1);
  }
});
