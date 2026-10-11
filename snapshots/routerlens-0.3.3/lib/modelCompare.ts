import { dollarsPerMillion, nonnegativePrice } from "./analytics";

export function normalizeModel(model: any) {
  return {
    id: model.id,
    name: model.name,
    created: model.created,
    context_length: model.context_length,
    knowledge_cutoff: model.knowledge_cutoff ?? null,
    input_modalities: model.architecture?.input_modalities ?? [],
    output_modalities: model.architecture?.output_modalities ?? [],
    supported_parameters: model.supported_parameters ?? [],
    prompt_usd_per_million: dollarsPerMillion(model.pricing?.prompt),
    completion_usd_per_million: dollarsPerMillion(model.pricing?.completion),
    cached_prompt_usd_per_million: dollarsPerMillion(
      model.pricing?.input_cache_read ?? model.pricing?.prompt_cache_hit
    ),
    request_price: nonnegativePrice(model.pricing?.request),
    max_completion_tokens: model.top_provider?.max_completion_tokens ?? null
  };
}

export function summarizeEndpoints(endpoints: any[]) {
  const normalized = (Array.isArray(endpoints) ? endpoints : []).map((endpoint) => ({
    name: endpoint?.name ?? null,
    provider_name: endpoint?.provider_name ?? endpoint?.provider?.name ?? null,
    prompt_usd_per_million: dollarsPerMillion(endpoint?.pricing?.prompt),
    completion_usd_per_million: dollarsPerMillion(endpoint?.pricing?.completion),
    cache_read_usd_per_million: dollarsPerMillion(
      endpoint?.pricing?.input_cache_read ?? endpoint?.pricing?.prompt_cache_hit
    ),
    request_price: nonnegativePrice(endpoint?.pricing?.request),
    context_length: endpoint?.context_length ?? null,
    max_completion_tokens: endpoint?.max_completion_tokens ?? null,
    supports_implicit_caching: endpoint?.supports_implicit_caching ?? null,
    latency_p50: endpoint?.latency_last_30m?.p50 ?? null,
    throughput_p50: endpoint?.throughput_last_30m?.p50 ?? null,
    uptime_1d: endpoint?.uptime_last_1d ?? null,
    status: endpoint?.status ?? null
  }));

  const promptPrices = normalized
    .map((endpoint) => endpoint.prompt_usd_per_million)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  const completionPrices = normalized
    .map((endpoint) => endpoint.completion_usd_per_million)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return {
    count: normalized.length,
    min_prompt_usd_per_million: promptPrices.length ? Math.min(...promptPrices) : null,
    max_prompt_usd_per_million: promptPrices.length ? Math.max(...promptPrices) : null,
    min_completion_usd_per_million: completionPrices.length
      ? Math.min(...completionPrices)
      : null,
    max_completion_usd_per_million: completionPrices.length
      ? Math.max(...completionPrices)
      : null,
    endpoints: normalized
  };
}

