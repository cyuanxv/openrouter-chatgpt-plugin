import { type AnalyticsMeta, namesOf } from "./meta";
import { metricAggregation } from "./queryPlanning";

type Recipe = {
  id: string;
  question: string;
  status: "ready" | "unavailable";
  query_executed: false;
  parameters?: Record<string, unknown>;
  missing_fields?: string[];
  interpretation: string[];
};

/** Prepare query_usage inputs from discovered fields; never execute or invent data. */
export function buildQueryRecipes(meta: AnalyticsMeta): Recipe[] {
  const metrics = namesOf(meta.metrics);
  const dimensions = namesOf(meta.dimensions);
  const granularities = namesOf(meta.granularities);
  const recipes: Recipe[] = [];
  const add = (id: string, question: string, requiredMetrics: string[], requiredDimensions: string[], options: { preset: "7d" | "30d"; granularity?: string; limit?: number; optionalMetrics?: string[]; requireAnyMetrics?: string[]; ordered?: boolean; notes?: string[] }) => {
    const missing = [...requiredMetrics.filter((name) => !metrics.has(name)), ...(options.requireAnyMetrics && !options.requireAnyMetrics.some((name) => metrics.has(name)) ? [`one_of:${options.requireAnyMetrics.join("|")}`] : []), ...requiredDimensions.filter((name) => !dimensions.has(name)), ...(options.granularity && !granularities.has(options.granularity) ? [`granularity:${options.granularity}`] : [])];
    const base: Recipe = { id, question, status: missing.length ? "unavailable" : "ready", query_executed: false, interpretation: options.notes ?? [] };
    if (missing.length) base.missing_fields = missing;
    else {
      const selected = [...requiredMetrics, ...(options.optionalMetrics ?? []).filter((name) => metrics.has(name) && !requiredMetrics.includes(name))];
      base.parameters = { preset: options.preset, metrics: selected, ...(requiredDimensions.length ? { dimensions: requiredDimensions } : {}), ...(options.granularity ? { granularity: options.granularity } : {}), ...(options.limit ? { limit: options.limit } : {}), ...(options.ordered ? { order_by: { field: requiredMetrics[0], direction: "desc" } } : {}) };
      if (selected.some((metric) => !metricAggregation(metric, meta).summed)) base.interpretation.push("Keep rates/performance or unverified aggregations per row; do not add them together.");
      base.interpretation.push("Check returned completeness/truncation before calling a ranking or total account-wide.");
    }
    recipes.push(base);
  };
  add("top_models", "Which models account for the most spend over 30 days?", ["total_usage"], ["model"], { preset: "30d", limit: 1000, optionalMetrics: ["request_count", "tokens_total"], ordered: true });
  add("top_providers", "Which providers account for the most spend over 7 days?", ["total_usage"], ["provider"], { preset: "7d", limit: 1000, optionalMetrics: ["request_count"], ordered: true });
  add("top_api_keys", "Which API keys account for the most spend over 30 days?", ["total_usage"], ["api_key_id"], { preset: "30d", limit: 1000, optionalMetrics: ["request_count", "tokens_total"], ordered: true, notes: ["Returned key labels are not necessarily valid filter IDs. Resolve the permitted ID/hash rather than filtering by the displayed name."] });
  add("token_breakdown", "Where are prompt and completion tokens going?", ["tokens_prompt", "tokens_completion"], ["model"], { preset: "7d", limit: 1000, optionalMetrics: ["tokens_total", "cached_tokens", "reasoning_tokens"], notes: ["Cached and reasoning tokens may be subsets of other token categories; do not add overlapping categories into a new total."] });
  add("daily_spend", "How has daily spend changed over 7 days?", ["total_usage"], [], { preset: "7d", granularity: "day", limit: 1000, optionalMetrics: ["request_count"], notes: ["Day buckets are UTC. A local-date range does not change their timezone."] });
  add("cache_evidence", "Which high-spend models have low cache reuse?", ["total_usage", "cache_hit_rate"], ["model"], { preset: "30d", limit: 1000, optionalMetrics: ["tokens_prompt", "cached_tokens"], ordered: true, notes: ["Low cache reuse alone does not prove that the workload is cacheable or quantify savings."] });
  add("cost_components", "What recorded cost components explain spend?", ["total_usage"], [], { preset: "7d", optionalMetrics: ["credits_usage", "byok_usage", "byok_fees", "usage_upstream", "usage_cache", "usage_data"], requireAnyMetrics: ["credits_usage", "byok_usage", "byok_fees", "usage_upstream", "usage_cache", "usage_data"], notes: ["Cost components can overlap, and data-logging adjustments can be negative. Do not add them blindly or invent missing components."] });
  return recipes;
}
