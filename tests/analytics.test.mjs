import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { unwrapAnalyticsRows, requiredNumber, sumField, dollarsPerMillion, requireCompleteAnalytics, detectCostAnomalies } = require('../.test-build/lib/analytics.js');

test('empty analytics is distinct from malformed analytics', () => {
  assert.deepEqual(unwrapAnalyticsRows({ data: { data: [] } }), []);
  for (const response of [null, {}, { data: {} }, { data: [null] }, { data: [[]] }]) assert.throws(() => unwrapAnalyticsRows(response));
});
test('missing financial numbers cannot silently become zero', () => {
  for (const value of [undefined, null, '', ' ', 'invalid', Infinity, false]) assert.throws(() => requiredNumber(value));
  assert.equal(requiredNumber(0), 0);
  assert.equal(requiredNumber('1.25'), 1.25);
  assert.equal(sumField([{ total_usage: 1 }, { total_usage: '0.25' }], 'total_usage'), 1.25);
  assert.throws(() => sumField([{}], 'total_usage'));
});
test('unknown prices remain unknown instead of becoming free', () => {
  for (const value of [undefined, null, '', ' ', false, -1, 'invalid']) assert.equal(dollarsPerMillion(value), null);
  assert.equal(dollarsPerMillion('0'), 0);
  assert.equal(dollarsPerMillion('0.000001'), 1);
});
test('account-wide conclusions require explicit untruncated metadata', () => {
  assert.doesNotThrow(() => requireCompleteAnalytics({ data: { metadata: { truncated: false } } }));
  for (const response of [{}, { data: { metadata: { truncated: true } } }]) assert.throws(() => requireCompleteAnalytics(response), (error) => error.code === 'INCOMPLETE_ANALYTICS');
});
test('anomaly baseline uses consecutive calendar days rather than arbitrary rows', () => {
  const rows = [{ date__day: '2026-01-01', total_usage: 1 }, { date__day: '2026-01-02', total_usage: 1 }, { date__day: '2026-01-03', total_usage: 1 }, { date__day: '2026-01-04', total_usage: 10 }];
  assert.equal(detectCostAnomalies(rows, 'total_usage', 'date__day', 3).length, 1);
  rows[3].date__day = '2026-01-10';
  assert.equal(detectCostAnomalies(rows, 'total_usage', 'date__day', 3).length, 0);
});

test('zero baselines produce explicit JSON-safe evidence', () => {
  const rows = ['01', '02', '03', '04'].map((day, index) => ({ date__day: `2026-01-${day}`, total_usage: index === 3 ? 10 : 0 }));
  const [anomaly] = detectCostAnomalies(rows, 'total_usage', 'date__day', 3);
  assert.equal(anomaly.ratio, null);
  assert.equal(anomaly.baselineZero, true);
  assert.equal(anomaly.absoluteIncrease, 10);
});
