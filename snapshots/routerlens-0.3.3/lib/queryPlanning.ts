import type { AnalyticsQuery } from "./openrouter";
import { type AnalyticsMeta, type AnalyticsMetaItem, namesOf } from "./meta";
import { shouldSumMetric } from "./analytics";

export type QueryIssue = {
  path: string;
  code: "unknown_metric" | "unknown_dimension" | "unknown_field" | "unknown_operator" | "unknown_granularity" | "invalid_filter_value" | "invalid_order_field" | "duplicate_field" | "operator_schema_incomplete";
  allowed?: string[];
};
export class QueryValidationError extends Error {
  constructor(readonly issues: QueryIssue[]) {
    super("The analytics query needs correction before it can run. See validation_errors for supported fields and shapes.");
    this.name = "QueryValidationError";
  }
}
const identifiers = (items: AnalyticsMetaItem[] | undefined) => [...namesOf(items)].sort();

export function validateAnalyticsQuery(query: AnalyticsQuery, meta: AnalyticsMeta): void {
  const issues: QueryIssue[] = [];
  const metrics = identifiers(meta.metrics);
  const dimensions = identifiers(meta.dimensions);
  const fields = [...metrics, ...dimensions];
  const operators = identifiers(meta.operators);
  const granularities = identifiers(meta.granularities);
  const fieldList = (values: string[], allowed: string[], category: "metric" | "dimension", path: string) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (!allowed.includes(value)) issues.push({ path: `${path}[${index}]`, code: category === "metric" ? "unknown_metric" : "unknown_dimension", allowed: allowed.slice(0, 30) });
      else if (seen.has(value)) issues.push({ path: `${path}[${index}]`, code: "duplicate_field" });
      seen.add(value);
    });
  };
  fieldList(query.metrics, metrics, "metric", "metrics");
  fieldList(query.dimensions ?? [], dimensions, "dimension", "dimensions");
  if (query.granularity && !granularities.includes(query.granularity)) issues.push({ path: "granularity", code: "unknown_granularity", allowed: granularities });
  (query.filters ?? []).forEach((filter, index) => {
    if (!fields.includes(filter.field)) issues.push({ path: `filters[${index}].field`, code: "unknown_field", allowed: fields.slice(0, 30) });
    if (!operators.includes(filter.operator)) issues.push({ path: `filters[${index}].operator`, code: "unknown_operator", allowed: operators });
    else {
      const type = meta.operators?.find((operator) => operator.name === filter.operator)?.value_type;
      if (type === undefined) issues.push({ path: `filters[${index}].operator`, code: "operator_schema_incomplete" });
      else if ((type === "array" && (!Array.isArray(filter.value) || !filter.value.length)) || (type === "scalar" && Array.isArray(filter.value))) {
        issues.push({ path: `filters[${index}].value`, code: "invalid_filter_value" });
      }
    }
  });
  if (query.order_by) {
    const dateFields = query.granularity && granularities.includes(query.granularity) ? ["date", `date__${query.granularity}`] : [];
    const returned = [...query.metrics, ...(query.dimensions ?? []), ...dateFields];
    if (!returned.includes(query.order_by.field)) issues.push({ path: "order_by.field", code: "invalid_order_field", allowed: returned.filter((field) => fields.includes(field) || dateFields.includes(field)).slice(0, 30) });
  }
  if (issues.length) throw new QueryValidationError(issues);
}

/** Only explicitly additive, numeric/currency metrics may be totaled. */
export function metricAggregation(metric: string, meta: AnalyticsMeta): { summed: boolean; reason: string } {
  const definition = meta.metrics?.find((item) => item.name === metric);
  if (!definition || definition.is_rate === undefined) return { summed: false, reason: "aggregation_semantics_unverified" };
  if (definition.is_rate || ["percent", "latency", "throughput"].includes(definition.display_format ?? "") || !shouldSumMetric(metric) || /^(?:min_|max_|mean_|median_|stddev_)/.test(metric)) return { summed: false, reason: "non_additive_metric" };
  if (!["number", "currency"].includes(definition.display_format ?? "")) return { summed: false, reason: "aggregation_semantics_unverified" };
  return { summed: true, reason: "sum_of_returned_rows" };
}
