import { analyticsMetadata, validateAnalyticsEnvelope, requiredNumber, requireCompleteAnalytics, unwrapAnalyticsRows } from "./analytics";
import { PublicError } from "./errors";
import type { AnalyticsQuery } from "./openrouter";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MAX_ROWS = 10_000;
// These dimensions are returned as labels, so two distinct IDs can share a label.
const LABEL_DIMENSIONS = new Set(["api_key_id", "app", "user", "workspace"]);

function rangeNumbers(query: AnalyticsQuery): [number, number] | null {
  if (!query.time_range) return null;
  const start = Date.parse(query.time_range.start), end = Date.parse(query.time_range.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new PublicError("INVALID_RANGE");
  return [start, end];
}

export function needsHourlyReconstruction(query: AnalyticsQuery): boolean {
  const range = rangeNumbers(query);
  return !query.granularity && range !== null && range.some(value => value % DAY !== 0);
}

/** Fail closed rather than let a rollup silently widen a requested interval. */
export function validateRangePrecision(query: AnalyticsQuery): void {
  const range = rangeNumbers(query);
  if (!range) return;
  const [start, end] = range;
  const unit = query.granularity === "minute" ? 60_000
    : query.granularity === "hour" || needsHourlyReconstruction(query) ? HOUR : DAY;
  if (range.some(value => value % unit !== 0)) throw new PublicError("UNSUPPORTED_TIME_PRECISION");
  if ((query.granularity === "minute" || query.granularity === "hour" || needsHourlyReconstruction(query)) && end - start > 31 * DAY) {
    throw new PublicError("EXACT_RANGE_TOO_WIDE");
  }
}

export function parseExactHour(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:00:00(?:\.000)?Z?$/.test(value)) throw new PublicError("INVALID_RESPONSE");
  const normalized = value.replace(" ", "T").replace(/Z?$/, "Z");
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 19) !== normalized.slice(0, 19)) throw new PublicError("INVALID_RESPONSE");
  return parsed;
}

/** Validate raw complete hourly responses without filling absent buckets. */
export function validateExactHourlyRows(query: AnalyticsQuery, response: any) {
  if (query.granularity !== "hour" || !query.time_range) throw new PublicError("INVALID_RANGE");
  validateRangePrecision(query);
  if ((response?.data?.warnings?.length || response?.warnings?.length)) throw new PublicError("ANALYTICS_WARNINGS");
  requireCompleteAnalytics(response);
  const rows = unwrapAnalyticsRows(response);
  if (rows.length >= MAX_ROWS) throw new PublicError("INCOMPLETE_ANALYTICS");
  const metadata = analyticsMetadata(response)!;
  if (metadata.row_count !== undefined && requiredNumber(metadata.row_count) !== rows.length) throw new PublicError("INVALID_RESPONSE");
  const [start, end] = rangeNumbers(query)!;
  const dimensions = query.dimensions ?? [];
  const seen = new Set<string>();
  for (const row of rows) {
    const hour = parseExactHour(row.date__hour);
    if (hour < start || hour >= end) throw new PublicError("INVALID_RESPONSE");
    const values = dimensions.map(dimension => {
      if (!Object.hasOwn(row, dimension) || (row[dimension] !== null && !["string", "number", "boolean"].includes(typeof row[dimension]))) throw new PublicError("INVALID_RESPONSE");
      return row[dimension];
    });
    const identity = JSON.stringify([hour, ...values]);
    if (seen.has(identity)) throw new PublicError("INVALID_RESPONSE");
    seen.add(identity);
    for (const metric of query.metrics) requiredNumber(row[metric]);
  }
  return rows;
}

/**
 * The live aggregate endpoint can round timestamp bounds to UTC dates. For
 * non-day-aligned ranges, retrieve all hourly rows and only sum known additive
 * metrics. Never paginate by an invented cursor or rank an incomplete sample.
 */
export async function queryExactRange(
  query: AnalyticsQuery,
  run: (query: AnalyticsQuery) => Promise<any>,
  isAdditive: (metric: string) => boolean,
  isMetric: (field: string) => boolean = isAdditive
): Promise<any> {
  validateRangePrecision(query);
  const checkedRun = async (input: AnalyticsQuery) => {
    const response = await run(input);
    // Do not hide unresolved-key/filter warnings or echo upstream diagnostics.
    if ((response?.data?.warnings?.length || response?.warnings?.length)) throw new PublicError("ANALYTICS_WARNINGS");
    validateAnalyticsEnvelope(response);
    return response;
  };
  if (!needsHourlyReconstruction(query)) return checkedRun(query);
  if (query.metrics.some(metric => !isAdditive(metric))) throw new PublicError("NON_ADDITIVE_EXACT_RANGE");
  if ((query.dimensions ?? []).some(dimension => LABEL_DIMENSIONS.has(dimension))) throw new PublicError("LABEL_GROUP_EXACT_RANGE");
  // Metric filters can be applied at the wrong grain after introducing hours.
  if ((query.filters ?? []).some(filter => isMetric(filter.field))) throw new PublicError("METRIC_FILTER_EXACT_RANGE");
  const hourlyQuery = { ...query, granularity: "hour", limit: MAX_ROWS, group_limit: MAX_ROWS, order_by: undefined };
  const upstream = await checkedRun(hourlyQuery);
  const raw = validateExactHourlyRows(hourlyQuery, upstream);
  const upstreamMetadata = analyticsMetadata(upstream)!;
  const dimensions = query.dimensions ?? [];
  const groups = new Map<string, Record<string, unknown>>();
  for (const row of raw) {
    const values = dimensions.map(dimension => row[dimension]);
    const groupKey = JSON.stringify(values);
    const group = groups.get(groupKey) ?? Object.fromEntries([...dimensions.map((dimension, i) => [dimension, values[i]]), ...query.metrics.map(metric => [metric, 0])]);
    for (const metric of query.metrics) group[metric] = requiredNumber(requiredNumber(group[metric]) + requiredNumber(row[metric]));
    groups.set(groupKey, group);
  }
  let rows = [...groups.values()];
  if (query.order_by) {
    const { field, direction } = query.order_by;
    const factor = direction === "asc" ? 1 : -1;
    rows.sort((a, b) => factor * (query.metrics.includes(field)
      ? requiredNumber(a[field]) - requiredNumber(b[field])
      : String(a[field] ?? "").localeCompare(String(b[field] ?? ""))));
  }
  const limit = query.limit ?? 1000;
  const truncated = rows.length > limit;
  rows = rows.slice(0, limit);
  return { data: { data: rows, metadata: {
    ...upstreamMetadata, row_count: rows.length, truncated,
    time_range_precision: "hour", aggregation_method: "sum_complete_hourly_rows",
    upstream_row_count: raw.length, upstream_truncated: false
  } } };
}
