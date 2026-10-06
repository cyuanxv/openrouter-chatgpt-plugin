import { requiredNumber } from "./analytics";

const ACTIONS = {
  cost_concentration: ["Inspect representative high-cost requests and workload categories for this model.", "Confirm the costly requests are representative before changing a model or workflow."],
  low_cache_reuse: ["Check whether repeated prompt prefixes can use this model/provider's cache support.", "Confirm cache eligibility and repeated prefixes; a low observed hit rate alone does not prove savings."],
  output_heavy: ["Evaluate task-specific output length/format constraints on representative samples.", "Verify answer completeness and task success before applying tighter limits."],
  reasoning_heavy: ["Evaluate supported reasoning-effort settings for the actual workload.", "Compare task success and cost per completed task; do not assume less reasoning preserves quality."],
  meaningful_cache_usage: ["Preserve working cache behavior when comparing providers or changing prompt structure.", "Check cache pricing/support before a routing change so savings are not offset by cache loss."],
  provider_price_spread: ["Compare eligible same-model providers using the observed token mix and required latency/privacy constraints.", "Verify eligibility, availability, cache/request fees and workload behavior before any routing change."]
} as const;

type SignalType = keyof typeof ACTIONS;
export function buildCostAdvice(row: Record<string, unknown>, totalUsage: number, endpoints: any) {
  const missingMetrics: string[] = [];
  const invalidMetrics: string[] = [];
  const evidence: Record<string, number | null> = {};
  const optional = (name: string, rate = false): number | null => {
    const value = row[name];
    if (value == null) { missingMetrics.push(name); return evidence[name] = null; }
    try {
      const number = requiredNumber(value);
      if (number < 0 || (rate && number > 1)) throw new Error("invalid");
      return evidence[name] = number;
    } catch { invalidMetrics.push(name); return evidence[name] = null; }
  };
  const usage = requiredNumber(row.total_usage);
  evidence.total_usage = usage;
  optional("request_count");
  const total = optional("tokens_total");
  const prompt = optional("tokens_prompt");
  const completion = optional("tokens_completion");
  const reasoning = optional("reasoning_tokens");
  const cached = optional("cached_tokens");
  const cacheHitRate = optional("cache_hit_rate", true);
  const signals: Array<{
    type: SignalType; confidence: "high" | "medium"; evidence: string;
    next_step: string; verify_before_change: string; estimated_savings_usd: null; confidence_scope: "observed_signal_only";
  }> = [];
  const add = (type: SignalType, confidence: "high" | "medium", text: string) => signals.push({ type, confidence, evidence: text, next_step: ACTIONS[type][0], verify_before_change: ACTIONS[type][1], estimated_savings_usd: null, confidence_scope: "observed_signal_only" });
  const share = (part: number | null, whole: number | null, field: string) => {
    if (part === null || whole === null) return null;
    if (part > whole) { invalidMetrics.push(`${field}_exceeds_denominator`); return null; }
    return whole > 0 ? part / whole : null;
  };
  // Spend is a net monetary amount; another model's adjustment can legitimately
  // make one contributor exceed 100%, unlike a subset-token ratio.
  const usageShare = Number.isFinite(totalUsage) && totalUsage > 0 ? usage / totalUsage : null;
  const usagePercentage = usageShare !== null && Number.isFinite(usageShare * 100) ? usageShare * 100 : null;
  if (usageShare !== null && usagePercentage === null) invalidMetrics.push("spend_share_percentage_overflow");
  if (usageShare !== null && usagePercentage !== null && usageShare >= 0.4) add("cost_concentration", "high", `This model represents ${usagePercentage.toFixed(1)}% of net spend in the selected complete dataset.${usageShare > 1 ? " Shares can exceed 100% when other recorded contributions are negative." : ""}`);
  const promptConsistent = !(prompt !== null && total !== null && prompt > total);
  if (!promptConsistent) invalidMetrics.push("tokens_prompt_exceeds_denominator");
  const promptCompletionConsistent = !(prompt !== null && completion !== null && total !== null && prompt + completion > total);
  if (!promptCompletionConsistent) invalidMetrics.push("prompt_completion_exceed_total");
  const totalConsistent = promptConsistent && promptCompletionConsistent;
  const cachedShare = share(cached, prompt, "cached_tokens");
  const cacheMetricsConsistent = !(cached !== null && prompt !== null && cached > prompt) && !(cachedShare !== null && cacheHitRate !== null && Math.abs(cachedShare - cacheHitRate) > 0.01);
  if (!cacheMetricsConsistent) invalidMetrics.push("cache_metrics_inconsistent");
  const cacheConsistent = totalConsistent && cacheMetricsConsistent;
  if (cacheConsistent && prompt !== null && prompt >= 500_000 && cacheHitRate !== null && cacheHitRate < 0.1) add("low_cache_reuse", "medium", `Observed prompt volume is ${Math.round(prompt).toLocaleString("en-US")} tokens and cache hit rate is ${(cacheHitRate * 100).toFixed(1)}%.`);
  const completionShare = share(completion, total, "tokens_completion");
  if (totalConsistent && completionShare !== null && completionShare >= 0.55 && completion !== null && completion >= 100_000) add("output_heavy", "medium", `Completion tokens are ${(completionShare * 100).toFixed(1)}% of total tokens.`);
  const reasoningShare = share(reasoning, total, "reasoning_tokens");
  if (totalConsistent && reasoningShare !== null && reasoningShare >= 0.25 && reasoning !== null && reasoning >= 50_000) add("reasoning_heavy", "medium", `Reasoning tokens are ${(reasoningShare * 100).toFixed(1)}% of total tokens.`);
  if (cacheConsistent && cachedShare !== null && cachedShare >= 0.25) add("meaningful_cache_usage", "high", `Cached tokens are ${(cachedShare * 100).toFixed(1)}% of prompt tokens.`);
  const hasSpread = (min: unknown, max: unknown) => typeof min === "number" && Number.isFinite(min) && min >= 0 && typeof max === "number" && Number.isFinite(max) && max > min && (min === 0 || max / min >= 1.15);
  if (hasSpread(endpoints?.min_prompt_usd_per_million, endpoints?.max_prompt_usd_per_million) || hasSpread(endpoints?.min_completion_usd_per_million, endpoints?.max_completion_usd_per_million)) add("provider_price_spread", "high", "Current listed endpoints for this same model show a provider price spread; this is not a measured savings amount.");
  return {
    signals,
    metric_evidence: evidence,
    missing_metrics: missingMetrics,
    invalid_metrics: invalidMetrics,
    estimated_savings_usd: null,
    savings_not_estimated_reason: "Usage totals and current list prices do not establish the actual provider mix, cache eligibility, pricing tiers, extra fees, or task-quality effect of a change."
  };
}
