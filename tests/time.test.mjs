import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { resolvePresetRange, isValidTimeZone } = require('../.test-build/lib/time.js');

test('calendar windows use user-local day boundaries', () => {
  const range = resolvePresetRange('yesterday', 'Asia/Shanghai', new Date('2026-10-05T20:00:00Z'));
  assert.equal(range.start, '2026-10-04T16:00:00.000Z');
  assert.equal(range.end, '2026-10-05T16:00:00.000Z');
});
test('US daylight-saving days preserve their actual duration', () => {
  const spring = resolvePresetRange('today', 'America/New_York', new Date('2026-03-08T16:00:00Z'));
  const fall = resolvePresetRange('today', 'America/New_York', new Date('2026-11-01T16:00:00Z'));
  assert.equal(Date.parse(spring.end) - Date.parse(spring.start), 23 * 3_600_000);
  assert.equal(Date.parse(fall.end) - Date.parse(fall.start), 25 * 3_600_000);
});
test('invalid timezone yields a safe validation error', () => {
  assert.equal(isValidTimeZone('invalid/timezone'), false);
  assert.throws(() => resolvePresetRange('today', 'invalid/timezone'), (error) => error.code === 'INVALID_TIMEZONE');
});

test('DST that skips local midnight starts at the first valid instant of the date', () => {
  const range = resolvePresetRange('today', 'America/Sao_Paulo', new Date('2018-11-04T15:00:00Z'));
  assert.equal(range.start, '2018-11-04T03:00:00.000Z');
  assert.equal(range.end, '2018-11-05T02:00:00.000Z');
});
