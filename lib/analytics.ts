import { PublicError } from "./errors";

export type AnalyticsRow = Record<string, unknown>;

export function unwrapAnalyticsRows(response: any): AnalyticsRow[] {
  const rows = response?.data?.data ?? response?.data;
  if (!Array.isArray(rows) || rows.some((row) => row === null || typeof row !== "object" || Array.isArray(row))) {
    throw new PublicError("INVALID_RESPONSE");
  }
  return rows;
}

export function requiredNumber(value: unknown): number {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && value.trim() === "")) {
    throw new PublicError("INVALID_RESPONSE");
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw new PublicError("INVALID_RESPONSE");
  return n;
}

export function analyticsMetadata(response: any): Record<string, unknown> | null {
  const metadata = response?.data?.metadata ?? response?.metadata;
  return metadata !== null && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : null;
}

export function requireCompleteAnalytics(response: any): void {
  if (analyticsMetadata(response)?.truncated !== false) throw new PublicError("INCOMPLETE_ANALYTICS");
}

export function numberValue(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function sumField(rows: AnalyticsRow[], field: string): number {
  return rows.reduce((sum, row) => requiredNumber(sum + requiredNumber(row[field])), 0);
}

export function rankRows(rows: AnalyticsRow[], field: string, top = 10): AnalyticsRow[] {
  return [...rows]
    .sort((a, b) => numberValue(b[field]) - numberValue(a[field]))
    .slice(0, top);
}

export function shareOf(part: unknown, whole: unknown): number | null {
  try {
    const p = requiredNumber(part);
    const w = requiredNumber(whole);
    const ratio = w > 0 ? p / w : null;
    return ratio !== null && Number.isFinite(ratio) ? ratio : null;
  } catch { return null; }
}

export type CostAnomaly = {
  date: string;
  value: number;
  baseline: number;
  ratio: number | null;
  baselineZero: boolean;
  absoluteIncrease: number;
};

function normalizeDate(value: unknown): string {
  return String(value ?? "").slice(0, 10);
}

export function analyzeCostSeries(
  rows: AnalyticsRow[],
  metric = "total_usage",
  dateField = "date__day",
  baselineDays = 7,
  ratioThreshold = 1.5,
  absoluteThreshold = 1,
  reportFromDate?: string,
  reportEndDateExclusive?: string
): { anomalies: CostAnomaly[]; evaluatedDays: number; skippedDays: number } {
  const series = rows
    .map((row) => ({ date: normalizeDate(row[dateField]), value: requiredNumber(row[metric]) }))
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && Number.isFinite(Date.parse(`${x.date}T00:00:00Z`)) && new Date(`${x.date}T00:00:00Z`).toISOString().slice(0, 10) === x.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  const anomalies: CostAnomaly[] = [];
  let evaluatedDays = 0;
  const expectedDays = reportFromDate && reportEndDateExclusive
    ? (Date.parse(`${reportEndDateExclusive}T00:00:00Z`) - Date.parse(`${reportFromDate}T00:00:00Z`)) / 86_400_000
    : null;
  if (expectedDays !== null && (!Number.isInteger(expectedDays) || expectedDays < 1)) throw new PublicError("INVALID_RANGE");
  const reportableDays = expectedDays ?? new Set(series.filter((item) => !reportFromDate || item.date >= reportFromDate).map((item) => item.date)).size;
  const evaluatedDates = new Set<string>();
  for (let i = baselineDays; i < series.length; i++) {
    const window = series.slice(i - baselineDays, i);
    const consecutive = [...window, series[i]].every((item, index, all) =>
      index === 0 || Date.parse(`${item.date}T00:00:00Z`) - Date.parse(`${all[index - 1].date}T00:00:00Z`) === 86_400_000
    );
    if (!consecutive) continue;
    const baseline = window.reduce((sum, item) => sum + item.value, 0) / baselineDays;
    const current = series[i];
    if (reportFromDate && current.date < reportFromDate) continue;
    if (reportEndDateExclusive && current.date >= reportEndDateExclusive) continue;
    if (evaluatedDates.has(current.date)) continue;
    evaluatedDates.add(current.date);
    evaluatedDays++;

    const absoluteIncrease = current.value - baseline;
    const ratio =
      baseline > 0 ? current.value / baseline : current.value > 0 ? Number.POSITIVE_INFINITY : 1;

    if (ratio >= ratioThreshold && absoluteIncrease >= absoluteThreshold) {
      anomalies.push({
        date: current.date,
        value: current.value,
        baseline,
        ratio: Number.isFinite(ratio) ? ratio : null,
        baselineZero: baseline === 0,
        absoluteIncrease
      });
    }
  }
  return { anomalies, evaluatedDays, skippedDays: reportableDays - evaluatedDays };
}

export function detectCostAnomalies(
  rows: AnalyticsRow[], metric = "total_usage", dateField = "date__day", baselineDays = 7,
  ratioThreshold = 1.5, absoluteThreshold = 1, reportFromDate?: string
): CostAnomaly[] {
  return analyzeCostSeries(rows, metric, dateField, baselineDays, ratioThreshold, absoluteThreshold, reportFromDate).anomalies;
}

export function nonnegativePrice(value: unknown): number | null {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && value.trim() === "")) return null;
  if (typeof value === "string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const n = Number(value);
  if (typeof value === "string" && n === 0 && /[1-9]/.test(value.trim().split(/e/i)[0])) return null;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function dollarsPerMillion(perToken: unknown): number | null {
  const n = nonnegativePrice(perToken);
  if (n === null) return null;
  const converted = n * 1_000_000;
  return Number.isFinite(converted) ? converted : null;
}

export function shouldSumMetric(metric: string): boolean {
  return !/(?:rate|latency|throughput)$/i.test(metric) && !/(?:^avg_|^p\d+_)/i.test(metric);
}

