import { nonnegativePrice } from "./analytics";

export type TextWorkload = {
  requests: number;
  prompt_tokens_per_request: number;
  completion_tokens_per_request: number;
  cached_prompt_tokens_per_request?: number;
};

/** Hypothetical text-token arithmetic only; never submits a generation. */
export function estimateTextWorkload(model: Record<string, unknown>, workload: TextWorkload) {
  const cached = workload.cached_prompt_tokens_per_request ?? 0;
  const quantities = [workload.requests, workload.prompt_tokens_per_request, workload.completion_tokens_per_request, cached];
  const assumptions = [
    "Every request is assumed to have the supplied token counts; averages do not prove all real requests fit.",
    "Prompt tokens include cached prompt tokens. Completion tokens must include billable reasoning tokens.",
    "Current default catalog prices are assumed constant; conditional/context/time tiers are not applied.",
    "Media, tools, cache writes, taxes, platform fees and other unmodeled charges are excluded.",
    "This is a hypothetical pricing scenario, not a billing quote, measured savings or a quality-equivalence claim."
  ];
  const base = { currency: "USD", basis: "hypothetical_text_workload_at_current_default_catalog_rates", assumptions, generation_executed: false, billing_quote: false };
  if (!quantities.every((value) => Number.isSafeInteger(value) && value >= 0) || workload.requests < 1 || cached > workload.prompt_tokens_per_request) return { ...base, status: "unavailable", issues: ["invalid_workload"], estimated_total_usd: null };
  const context = nonnegativePrice(model.context_length);
  const completionLimit = nonnegativePrice(model.max_completion_tokens);
  const requestTokens = workload.prompt_tokens_per_request + workload.completion_tokens_per_request;
  const inputModalities = Array.isArray(model.input_modalities) ? model.input_modalities : [];
  const outputModalities = Array.isArray(model.output_modalities) ? model.output_modalities : [];
  const eligibilityIssues = [
    ...(inputModalities.length && !inputModalities.includes("text") ? ["text_input_not_supported"] : []),
    ...(outputModalities.length && !outputModalities.includes("text") ? ["text_output_not_supported"] : []),
    ...(context !== null && requestTokens > context ? ["context_limit_exceeded"] : []),
    ...(completionLimit !== null && workload.completion_tokens_per_request > completionLimit ? ["completion_limit_exceeded"] : [])
  ];
  if (eligibilityIssues.length) return { ...base, status: "unavailable", issues: eligibilityIssues, estimated_total_usd: null };
  const issues: string[] = [];
  const component = (quantity: number, price: unknown, divisor: number, name: string): number | null => {
    if (quantity === 0) return 0;
    const rate = nonnegativePrice(price);
    if (rate === null) { issues.push(`missing_price:${name}`); return null; }
    const cost = quantity * (rate / divisor);
    if (!Number.isFinite(cost)) { issues.push("arithmetic_overflow"); return null; }
    if (rate > 0 && cost === 0) { issues.push("arithmetic_underflow"); return null; }
    return cost;
  };
  const perRequest = {
    uncached_prompt: component(workload.prompt_tokens_per_request - cached, model.prompt_usd_per_million, 1_000_000, "prompt"),
    cached_prompt: component(cached, model.cached_prompt_usd_per_million, 1_000_000, "cache_read"),
    completion: component(workload.completion_tokens_per_request, model.completion_usd_per_million, 1_000_000, "completion"),
    request_fee: component(1, model.request_price, 1, "request")
  };
  let total: number | null = null;
  if (!issues.length) {
    const perRequestTotal = Object.values(perRequest).reduce<number>((sum, value) => sum + (value ?? 0), 0);
    const cost = perRequestTotal * workload.requests;
    if (Number.isFinite(cost)) total = cost;
    else issues.push("arithmetic_overflow");
  }
  return { ...base, status: issues.length ? "unavailable" : "estimated", issues, workload: { ...workload, cached_prompt_tokens_per_request: cached }, per_request_components_usd: perRequest, estimated_total_usd: total, context_limit_checked: context !== null, completion_limit_checked: completionLimit !== null, text_modalities_checked: inputModalities.includes("text") && outputModalities.includes("text") };
}
