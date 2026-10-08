import { analyticsMetadata, requiredNumber, requireCompleteAnalytics, unwrapAnalyticsRows } from "./analytics";
import { decimalCost, decimalCostNumber, sumDecimalCosts } from "./decimalCost";
import { PublicError } from "./errors";
import { parseExactHour, queryExactRange, validateExactHourlyRows } from "./exactRange";
import type { AnalyticsQuery } from "./openrouter";
import { addCalendarDays, dateStringInZone, startOfDayUtc } from "./time";

const HOUR = 3_600_000;
type Range = { start: string; end: string; startDate: string; endDateExclusive: string; timeZone: string };
export type AnomalyOptions = { timezone: string; days?: number; baseline_days: number; ratio_threshold: number; absolute_threshold_usd: number };

function calendarRange(startDate: string, endDateExclusive: string, timeZone: string): Range {
  return { start: startOfDayUtc(startDate, timeZone).toISOString(), end: startOfDayUtc(endDateExclusive, timeZone).toISOString(), startDate, endDateExclusive, timeZone };
}

/** Only supported calendar semantics are accepted; never relabel UTC buckets. */
export function resolveAnomalyRanges(input: AnomalyOptions, now = new Date()) {
  if (input.timezone !== "UTC" && input.timezone !== "Asia/Shanghai") throw new PublicError("UNSUPPORTED_ANOMALY_TIMEZONE");
  const days = input.days ?? (input.timezone === "UTC" ? 30 : 7);
  if (!Number.isInteger(days) || days < 1 || days > 90 || !Number.isInteger(input.baseline_days) || input.baseline_days < 3 || input.baseline_days > 30 ||
      !Number.isFinite(input.ratio_threshold) || input.ratio_threshold < 1 || input.ratio_threshold > 10 ||
      !Number.isFinite(input.absolute_threshold_usd) || input.absolute_threshold_usd < 0 || !Number.isFinite(now.getTime())) throw new PublicError("INVALID_ANOMALY_OPTIONS");
  if (input.timezone === "Asia/Shanghai" && days + input.baseline_days > 31) throw new PublicError("LOCAL_ANOMALY_RANGE_TOO_WIDE");
  const endDate = dateStringInZone(now, input.timezone);
  const startDate = addCalendarDays(endDate, -days);
  return { days, targetRange: calendarRange(startDate, endDate, input.timezone), queryRange: calendarRange(addCalendarDays(startDate, -input.baseline_days), endDate, input.timezone) };
}

export async function queryAnomalyDays(input: AnomalyOptions, run: (query: AnalyticsQuery) => Promise<any>, now = new Date()) {
  const ranges = resolveAnomalyRanges(input, now);
  const { queryRange } = ranges;
  const local = input.timezone === "Asia/Shanghai";
  const query: AnalyticsQuery = {
    metrics: ["total_usage"], granularity: local ? "hour" : "day",
    time_range: { start: queryRange.start, end: queryRange.end },
    limit: local ? 10_000 : ranges.days + input.baseline_days + 10,
    ...(local ? { group_limit: 10_000 } : {})
  };
  // Exactly one upstream read. Its existing request timeout/error policy applies.
  const response = await queryExactRange(query, run, metric => metric === "total_usage");
  requireCompleteAnalytics(response);
  const raw = local ? validateExactHourlyRows(query, response) : unwrapAnalyticsRows(response);
  const metadata = analyticsMetadata(response)!;
  if (metadata.row_count !== undefined && requiredNumber(metadata.row_count) !== raw.length) throw new PublicError("INVALID_RESPONSE");
  const byDate = new Map<string, unknown[]>();
  const seenDays = new Set<string>();
  for (const row of raw) {
    // The query has no dimensions. Unexpected model/provider splits cannot be
    // mistaken for account-wide hourly coverage or summed twice.
    const bucket = local ? "date__hour" : "date__day";
    if (Object.keys(row).some(key => key !== bucket && key !== "total_usage")) throw new PublicError("INVALID_RESPONSE");
    let date: string;
    if (local) date = dateStringInZone(new Date(parseExactHour(row.date__hour)), input.timezone);
    else {
      const value = row.date__day;
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:[ T]00:00:00(?:\.000)?Z?)?$/.test(value)) throw new PublicError("INVALID_RESPONSE");
      date = value.slice(0, 10);
      const stamp = Date.parse(`${date}T00:00:00Z`);
      if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== date || seenDays.has(date)) throw new PublicError("INVALID_RESPONSE");
      seenDays.add(date);
    }
    if (date < queryRange.startDate || date >= queryRange.endDateExclusive) throw new PublicError("INVALID_RESPONSE");
    const values = byDate.get(date) ?? [];
    decimalCost(row.total_usage);
    values.push(row.total_usage);
    byDate.set(date, values);
  }
  const rows: Array<{ date__day: string; total_usage: number; total_usage_decimal: string }> = [];
  const unknownDays: Array<{ date: string; reason: string; observed_buckets: number; expected_buckets: number; observed_net_usage?: number }> = [];
  for (let date = queryRange.startDate; date < queryRange.endDateExclusive; date = addCalendarDays(date, 1)) {
    const values = byDate.get(date) ?? [];
    const expected = local ? (startOfDayUtc(addCalendarDays(date, 1), input.timezone).getTime() - startOfDayUtc(date, input.timezone).getTime()) / HOUR : 1;
    // Shanghai is the only local zone supported in this release. Historical
    // non-24-hour calendar behavior is rejected rather than approximated.
    if (local && expected !== 24) throw new PublicError("UNSUPPORTED_ANOMALY_TIMEZONE");
    if (values.length === expected) {
      const exact = sumDecimalCosts(values);
      const total = decimalCostNumber(exact);
      if (total < 0) unknownDays.push({ date, reason: "unsupported_negative_net", observed_buckets: values.length, expected_buckets: expected, observed_net_usage: total });
      else rows.push({ date__day: date, total_usage: total, total_usage_decimal: `${exact.coefficient}e-${exact.scale}` });
    } else unknownDays.push({ date, reason: "missing_bucket_coverage", observed_buckets: values.length, expected_buckets: expected });
  }
  return { ...ranges, rows, unknownDays, aggregationMethod: local ? "sum_verified_24_hour_local_days" : "upstream_utc_day_buckets", upstreamRows: raw.length };
}
