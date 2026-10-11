import { requireCompleteAnalytics, unwrapAnalyticsRows, requiredNumber, type AnalyticsRow } from './analytics';
import { compareDecimalCost, decimalCost, sumDecimalCosts } from './decimalCost';
import { parseExactHour } from './exactRange';
import type { AnalyticsQuery } from './openrouter';
import { PublicError } from './errors';
const HOUR = 3600000, DAY = 24 * HOUR;
const equal = (a: unknown, b: unknown) => compareDecimalCost(decimalCost(a), decimalCost(b)) === 0;
function count(value: unknown) { const n = requiredNumber(value); if (!Number.isSafeInteger(n) || n < 0) throw new PublicError('INVALID_RESPONSE'); return n; }
function checked(response: any, query: AnalyticsQuery) {
  requireCompleteAnalytics(response);
  if (response?.warnings?.length || response?.data?.warnings?.length) throw new PublicError('ANALYTICS_WARNINGS');
  const rows = unwrapAnalyticsRows(response), result = new Map<number, AnalyticsRow>();
  if (rows.length >= 10000) throw new PublicError('INCOMPLETE_ANALYTICS');
  const bucket = `${query.metrics[0] === 'total_request_count' ? 'created_at' : 'date'}__${query.granularity}`;
  for (const row of rows) {
    if (Object.keys(row).some(k => k !== bucket && !query.metrics.includes(k))) throw new PublicError('INVALID_RESPONSE');
    const value = row[bucket];
    const stamp = query.granularity === 'hour' ? parseExactHour(value) :
      typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00Z`) : NaN;
    if (!Number.isFinite(stamp) || (query.granularity === 'day' && new Date(stamp).toISOString().slice(0,10) !== value) ||
        stamp < Date.parse(query.time_range!.start) || stamp >= Date.parse(query.time_range!.end) || result.has(stamp)) throw new PublicError('INVALID_RESPONSE');
    for (const metric of query.metrics) {
      if (metric === 'total_usage') { if (decimalCost(row[metric]).coefficient < 0n) throw new PublicError('INVALID_RESPONSE'); }
      else count(row[metric]);
    }
    result.set(stamp, row);
  }
  return result;
}

/** Reconcile independent UTC day controls before classifying absent hours as zero.
 * Cost/request timestamps and all-request creation timestamps are distinct: each
 * family is reconciled separately, never joined as if their hourly counts match.
 */
export async function reconcileSparseHours(raw: AnalyticsRow[], start: string, end: string, run: (q: AnalyticsQuery) => Promise<any>, now: Date) {
  const first = Math.floor(Date.parse(start) / DAY) * DAY, last = Math.ceil(Date.parse(end) / DAY) * DAY;
  const original = new Map(raw.map(r => [parseExactHour(r.date__hour), r]));
  const verified: number[] = [], zeroHours: number[] = [], rejected: Array<{date: string; reason: string}> = [];
  let queryCount = 0;
  for (let chunk = first; chunk < last; chunk += 31 * DAY) {
    const chunkEnd = Math.min(chunk + 31 * DAY, last);
    try {
      const maps: Map<number, AnalyticsRow>[] = [];
      for (const metrics of [['total_usage', 'request_count'], ['total_request_count']]) {
        for (const granularity of ['hour', 'day']) {
          const query: AnalyticsQuery = { metrics, granularity, time_range: {start: new Date(chunk).toISOString(), end: new Date(chunkEnd).toISOString()}, limit: 10000, group_limit: 10000 };
          queryCount++;
          maps.push(checked(await run(query), query));
        }
      }
      const [costHours, costDays, requestHours, requestDays] = maps;
      for (let day = chunk; day < chunkEnd; day += DAY) {
        let reason = day + DAY > now.getTime() ? 'incomplete_utc_control_day' : '';
        const costDay = costDays.get(day), requestDay = requestDays.get(day);
        const hours = Array.from({length:24}, (_,i) => day + i * HOUR);
        if (!reason && (!costDay || !requestDay)) reason = 'missing_daily_control';
        if (!reason) {
          const costs = hours.flatMap(h => costHours.has(h) ? [costHours.get(h)!] : []);
          const requests = hours.flatMap(h => requestHours.has(h) ? [requestHours.get(h)!] : []);
          if (compareDecimalCost(sumDecimalCosts(costs.map(r => r.total_usage)), decimalCost(costDay!.total_usage)) !== 0 ||
              count(costs.reduce((n,r) => n + count(r.request_count), 0)) !== count(costDay!.request_count) ||
              count(requests.reduce((n,r) => n + count(r.total_request_count), 0)) !== count(requestDay!.total_request_count)) reason = 'daily_control_mismatch';
          // A second read must also agree with the original exact-range read.
          if (!reason && hours.some(h => h >= Date.parse(start) && h < Date.parse(end) &&
              (original.has(h) !== costHours.has(h) || (original.has(h) && !equal(original.get(h)!.total_usage, costHours.get(h)!.total_usage))))) reason = 'hourly_snapshot_mismatch';
        }
        if (reason) { rejected.push({date: new Date(day).toISOString().slice(0,10), reason}); continue; }
        verified.push(day);
        for (const hour of hours) {
          if (hour >= Date.parse(start) && hour < Date.parse(end) && !original.has(hour) &&
              !costHours.has(hour) && (!requestHours.has(hour) || count(requestHours.get(hour)!.total_request_count) === 0)) zeroHours.push(hour);
        }
      }
    } catch {
      for (let day = chunk; day < chunkEnd; day += DAY) rejected.push({date:new Date(day).toISOString().slice(0,10), reason:'unavailable_or_invalid_control'});
    }
  }
  return { rows: [...raw, ...zeroHours.map(h => ({date__hour:new Date(h).toISOString(), total_usage:0}))], queryCount,
    evidence: { method:'independent_utc_day_cost_and_request_controls', verified_utc_days:verified.map(d => new Date(d).toISOString().slice(0,10)), reconciled_zero_hours:zeroHours.length, rejected_utc_days:rejected } };
}
