export type AnalyticsRow = Record<string, unknown>;

export function unwrapAnalyticsRows(response: any): AnalyticsRow[] {
  const rows = response?.data?.data ?? response?.data ?? [];
  return Array.isArray(rows) ? rows : [];
}

export function numberValue(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function sumField(rows: AnalyticsRow[], field: string): number {
  return rows.reduce((sum, row) => sum + numberValue(row[field]), 0);
}

export function rankRows(rows: AnalyticsRow[], field: string, top = 10): AnalyticsRow[] {
  return [...rows]
    .sort((a, b) => numberValue(b[field]) - numberValue(a[field]))
    .slice(0, top);
}

export function shareOf(part: unknown, whole: unknown): number | null {
  const p = numberValue(part);
  const w = numberValue(whole);
  return w > 0 ? p / w : null;
}

export type CostAnomaly = {
  date: string;
  value: number;
  baseline: number;
  ratio: number;
  absoluteIncrease: number;
};

function normalizeDate(value: unknown): string {
  return String(value ?? "").slice(0, 10);
}

export function detectCostAnomalies(
  rows: AnalyticsRow[],
  metric = "total_usage",
  dateField = "date__day",
  baselineDays = 7,
  ratioThreshold = 1.5,
  absoluteThreshold = 1,
  reportFromDate?: string
): CostAnomaly[] {
  const series = rows
    .map((row) => ({ date: normalizeDate(row[dateField]), value: numberValue(row[metric]) }))
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  const anomalies: CostAnomaly[] = [];
  for (let i = baselineDays; i < series.length; i++) {
    const window = series.slice(i - baselineDays, i);
    const baseline = window.reduce((sum, item) => sum + item.value, 0) / baselineDays;
    const current = series[i];
    if (reportFromDate && current.date < reportFromDate) continue;

    const absoluteIncrease = current.value - baseline;
    const ratio =
      baseline > 0 ? current.value / baseline : current.value > 0 ? Number.POSITIVE_INFINITY : 1;

    if (ratio >= ratioThreshold && absoluteIncrease >= absoluteThreshold) {
      anomalies.push({
        date: current.date,
        value: current.value,
        baseline,
        ratio,
        absoluteIncrease
      });
    }
  }
  return anomalies;
}

export function dollarsPerMillion(perToken: unknown): number | null {
  const n = Number(perToken);
  return Number.isFinite(n) ? n * 1_000_000 : null;
}

export function shouldSumMetric(metric: string): boolean {
  return !/(?:rate|latency|throughput)$/i.test(metric) && !/(?:^avg_|^p\d+_)/i.test(metric);
}
