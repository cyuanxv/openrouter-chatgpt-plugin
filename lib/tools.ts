import { z } from "zod";
import {
  detectCostAnomalies,
  numberValue,
  rankRows,
  shareOf,
  shouldSumMetric,
  sumField,
  unwrapAnalyticsRows
} from "./analytics";
import { publicErrorMessage } from "./errors";
import { namesOf, selectSupported, unwrapAnalyticsMeta } from "./meta";
import {
  getAnalyticsMeta,
  getCredits,
  getModelEndpoints,
  hasManagementKey,
  listKeys,
  listModels,
  queryAnalytics
} from "./openrouter";
import { normalizeModel, summarizeEndpoints } from "./modelCompare";
import {
  resolveCalendarDaysRange,
  resolvePresetRange,
  type RangePreset
} from "./time";

const FILTER_VALUE = z.union([
  z.string(),
  z.number(),
  z.array(z.union([z.string(), z.number()]))
]);

function toolError(error: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: publicErrorMessage(error) }]
  };
}

function textResult(text: string, structuredContent?: Record<string, unknown>) {
  return {
    ...(structuredContent ? { structuredContent } : {}),
    content: [{ type: "text" as const, text }]
  };
}

async function spendForPreset(preset: RangePreset, timezone: string) {
  const range = resolvePresetRange(preset, timezone);
  const response = await queryAnalytics({
    metrics: ["total_usage"],
    time_range: { start: range.start, end: range.end },
    limit: 100
  });
  const rows = unwrapAnalyticsRows(response);
  return {
    preset,
    start: range.start,
    end: range.end,
    usd: sumField(rows, "total_usage")
  };
}

function buildOptimizationSignals(
  row: Record<string, unknown>,
  totalUsage: number,
  endpointSummary: any
) {
  const total = numberValue(row.tokens_total);
  const prompt = numberValue(row.tokens_prompt);
  const completion = numberValue(row.tokens_completion);
  const reasoning = numberValue(row.reasoning_tokens);
  const cached = numberValue(row.cached_tokens);
  const usage = numberValue(row.total_usage);
  const cacheHitRate =
    row.cache_hit_rate == null ? null : numberValue(row.cache_hit_rate);

  const signals: Array<{
    type: string;
    confidence: "high" | "medium";
    evidence: string;
  }> = [];

  const usageShare = shareOf(usage, totalUsage);
  if (usageShare != null && usageShare >= 0.4) {
    signals.push({
      type: "cost_concentration",
      confidence: "high",
      evidence: `This model represents ${(usageShare * 100).toFixed(1)}% of spend in the selected period.`
    });
  }

  if (prompt >= 500_000 && cacheHitRate != null && cacheHitRate < 0.1) {
    signals.push({
      type: "low_cache_reuse",
      confidence: "medium",
      evidence: `Prompt volume is ${Math.round(prompt).toLocaleString()} tokens and cache hit rate is ${(cacheHitRate * 100).toFixed(1)}%.`
    });
  }

  const completionShare = shareOf(completion, total);
  if (completionShare != null && completionShare >= 0.55 && completion >= 100_000) {
    signals.push({
      type: "output_heavy",
      confidence: "medium",
      evidence: `Completion tokens are ${(completionShare * 100).toFixed(1)}% of total tokens.`
    });
  }

  const reasoningShare = shareOf(reasoning, total);
  if (reasoningShare != null && reasoningShare >= 0.25 && reasoning >= 50_000) {
    signals.push({
      type: "reasoning_heavy",
      confidence: "medium",
      evidence: `Reasoning tokens are ${(reasoningShare * 100).toFixed(1)}% of total tokens.`
    });
  }

  const cachedShare = shareOf(cached, prompt);
  if (cachedShare != null && cachedShare >= 0.25) {
    signals.push({
      type: "meaningful_cache_usage",
      confidence: "high",
      evidence: `Cached tokens are ${(cachedShare * 100).toFixed(1)}% of prompt tokens. Preserve cache-friendly prompt structure before changing routing.`
    });
  }

  const minInput = endpointSummary?.min_prompt_usd_per_million;
  const maxInput = endpointSummary?.max_prompt_usd_per_million;
  const minOutput = endpointSummary?.min_completion_usd_per_million;
  const maxOutput = endpointSummary?.max_completion_usd_per_million;

  const providerSpread =
    (typeof minInput === "number" &&
      minInput > 0 &&
      typeof maxInput === "number" &&
      maxInput / minInput >= 1.15) ||
    (typeof minOutput === "number" &&
      minOutput > 0 &&
      typeof maxOutput === "number" &&
      maxOutput / minOutput >= 1.15);

  if (providerSpread) {
    signals.push({
      type: "provider_price_spread",
      confidence: "high",
      evidence:
        "Live endpoints for this same model show a material provider price spread. Review routing or :floor before evaluating a model replacement."
    });
  }

  return signals;
}

export function registerRouterLensTools(server: any) {
  server.registerTool(
    "get_account_summary",
    {
      title: "Get OpenRouter account summary",
      description:
        "Get OpenRouter remaining credit plus today, yesterday, 7-day and 30-day spend. Use for balance or recent account-spend questions. Requires the configured Management Key.",
      inputSchema: {
        timezone: z.string().default("UTC"),
        include_spend_windows: z.boolean().default(true)
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false
      }
    },
    async ({
      timezone,
      include_spend_windows
    }: {
      timezone: string;
      include_spend_windows: boolean;
    }) => {
      try {
        const creditsResponse = await getCredits();
        const credits = creditsResponse?.data ?? creditsResponse;
        const totalCredits = numberValue(credits?.total_credits);
        const lifetimeUsage = numberValue(credits?.total_usage);

        const result: Record<string, unknown> = {
          timezone,
          total_credits: totalCredits,
          lifetime_usage: lifetimeUsage,
          remaining_credits: totalCredits - lifetimeUsage
        };

        if (include_spend_windows) {
          const windows = await Promise.all(
            (["today", "yesterday", "7d", "30d"] as RangePreset[]).map((preset) =>
              spendForPreset(preset, timezone)
            )
          );
          result.spend_windows = Object.fromEntries(
            windows.map((window) => [window.preset, window])
          );
        }

        return textResult(
          `OpenRouter remaining credit: $${Number(result.remaining_credits).toFixed(4)}.`,
          result
        );
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "get_analytics_meta",
    {
      title: "Get OpenRouter Analytics schema",
      description:
        "Get the live OpenRouter Analytics metrics, dimensions, operators and granularities. Use before an unfamiliar analytics query.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false
      }
    },
    async () => {
      try {
        const response = await getAnalyticsMeta();
        const data = response?.data ?? response;
        return textResult("Returned the current OpenRouter Analytics schema.", data);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "query_usage",
    {
      title: "Query OpenRouter usage analytics",
      description:
        "Query OpenRouter spend, requests, tokens, cache, model, provider, API key, workspace, app, agent or time trends. Supports common time presets and advanced Analytics API fields.",
      inputSchema: {
        preset: z.enum(["today", "yesterday", "7d", "30d"]).optional(),
        timezone: z.string().default("UTC"),
        metrics: z.array(z.string()).min(1).max(20).default(["total_usage"]),
        dimensions: z.array(z.string()).max(2).optional(),
        granularity: z.enum(["minute", "hour", "day", "week", "month"]).optional(),
        filters: z
          .array(
            z.object({
              field: z.string(),
              operator: z.enum([
                "eq",
                "neq",
                "gt",
                "gte",
                "lt",
                "lte",
                "in",
                "not_in"
              ]),
              value: FILTER_VALUE,
              include_unset: z.boolean().optional()
            })
          )
          .max(20)
          .optional(),
        limit: z.number().int().min(1).max(10_000).optional(),
        group_limit: z.number().int().min(1).max(10_000).optional(),
        order_by: z
          .object({
            field: z.string(),
            direction: z.enum(["asc", "desc"])
          })
          .optional(),
        time_range: z
          .object({
            start: z.string().datetime(),
            end: z.string().datetime()
          })
          .optional()
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false
      }
    },
    async (input: any) => {
      try {
        const presetRange = input.preset
          ? resolvePresetRange(input.preset, input.timezone)
          : undefined;

        const range =
          input.time_range ??
          (presetRange
            ? { start: presetRange.start, end: presetRange.end }
            : undefined);

        const response = await queryAnalytics({
          metrics: input.metrics,
          dimensions: input.dimensions,
          granularity: input.granularity,
          filters: input.filters,
          limit: input.limit,
          group_limit: input.group_limit,
          order_by: input.order_by,
          time_range: range
        });

        const rows = unwrapAnalyticsRows(response);
        const summedMetrics = input.metrics.filter(shouldSumMetric);
        const totals = Object.fromEntries(
          summedMetrics.map((metric: string) => [metric, sumField(rows, metric)])
        );

        const result = {
          range: range ?? null,
          timezone: input.preset ? input.timezone : null,
          metrics: input.metrics,
          dimensions: input.dimensions ?? [],
          granularity: input.granularity ?? null,
          totals,
          rate_and_performance_metrics_are_not_summed: input.metrics.filter(
            (metric: string) => !shouldSumMetric(metric)
          ),
          rows,
          metadata: response?.data?.metadata ?? response?.metadata ?? null
        };

        return textResult(
          `OpenRouter Analytics returned ${rows.length} row(s).`,
          result
        );
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "analyze_cost_anomalies",
    {
      title: "Detect OpenRouter cost anomalies",
      description:
        "Detect daily OpenRouter spend spikes against a rolling baseline. Use for questions about unexpected or abnormal cost increases.",
      inputSchema: {
        days: z.number().int().min(1).max(90).default(30),
        timezone: z.string().default("UTC"),
        baseline_days: z.number().int().min(3).max(30).default(7),
        ratio_threshold: z.number().min(1).max(10).default(1.5),
        absolute_threshold_usd: z.number().min(0).default(1)
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false
      }
    },
    async (input: any) => {
      try {
        const targetRange = resolveCalendarDaysRange(input.days, input.timezone);
        const queryRange = resolveCalendarDaysRange(
          input.days + input.baseline_days,
          input.timezone
        );

        const response = await queryAnalytics({
          metrics: ["total_usage"],
          granularity: "day",
          time_range: { start: queryRange.start, end: queryRange.end },
          limit: Math.min(10_000, input.days + input.baseline_days + 10)
        });

        const rows = unwrapAnalyticsRows(response);
        const anomalies = detectCostAnomalies(
          rows,
          "total_usage",
          "date__day",
          input.baseline_days,
          input.ratio_threshold,
          input.absolute_threshold_usd,
          targetRange.startDate
        );

        const series = rows.filter(
          (row) => String(row.date__day ?? "").slice(0, 10) >= targetRange.startDate
        );

        return textResult(
          anomalies.length
            ? `Detected ${anomalies.length} cost anomaly candidate(s).`
            : "No cost anomaly candidates crossed the configured thresholds.",
          {
            timezone: input.timezone,
            analysis_range: targetRange,
            baseline_days: input.baseline_days,
            ratio_threshold: input.ratio_threshold,
            absolute_threshold_usd: input.absolute_threshold_usd,
            anomalies,
            series
          }
        );
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "analyze_cost_optimization",
    {
      title: "Analyze OpenRouter cost optimization opportunities",
      description:
        "Analyze top OpenRouter cost contributors using live usage, token/cache metrics, model catalog prices and same-model provider price spread. Returns evidence and optimization candidates.",
      inputSchema: {
        preset: z.enum(["7d", "30d"]).default("30d"),
        timezone: z.string().default("UTC"),
        top_models: z.number().int().min(1).max(10).default(5),
        include_provider_evidence: z.boolean().default(true)
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true
      }
    },
    async (input: any) => {
      try {
        const rangeData = resolvePresetRange(input.preset, input.timezone);
        const range = { start: rangeData.start, end: rangeData.end };

        const metaResponse = await getAnalyticsMeta();
        const meta = unwrapAnalyticsMeta(metaResponse);
        const availableMetrics = namesOf(meta.metrics);

        const metrics = selectSupported(
          [
            "total_usage",
            "request_count",
            "tokens_total",
            "tokens_prompt",
            "tokens_completion",
            "reasoning_tokens",
            "cached_tokens",
            "cache_hit_rate",
            "usage_upstream",
            "usage_cache",
            "usage_data"
          ],
          availableMetrics
        );

        if (!metrics.includes("total_usage")) {
          throw new Error(
            "OpenRouter Analytics currently does not expose total_usage for this account/schema."
          );
        }

        const usageResponse = await queryAnalytics({
          metrics,
          dimensions: ["model"],
          time_range: range,
          limit: 500,
          order_by: { field: "total_usage", direction: "desc" }
        });

        const allRows = unwrapAnalyticsRows(usageResponse);
        const rows = rankRows(allRows, "total_usage", input.top_models);
        const totalUsage = sumField(allRows, "total_usage");

        const modelsResponse = await listModels();
        const catalog = modelsResponse?.data ?? [];
        const byId = new Map(
          catalog.map((model: any) => [model.id, normalizeModel(model)])
        );

        const contributors = await Promise.all(
          rows.map(async (row) => {
            const modelId = String(row.model ?? "");
            let providerEvidence: any = null;

            if (input.include_provider_evidence && modelId.includes("/")) {
              try {
                const endpointsResponse = await getModelEndpoints(modelId);
                providerEvidence = summarizeEndpoints(
                  endpointsResponse?.data?.endpoints ?? []
                );
              } catch {
                providerEvidence = null;
              }
            }

            return {
              ...row,
              spend_share: shareOf(row.total_usage, totalUsage),
              catalog: byId.get(modelId) ?? null,
              provider_evidence: providerEvidence,
              optimization_signals: buildOptimizationSignals(
                row,
                totalUsage,
                providerEvidence
              )
            };
          })
        );

        return textResult(
          `Prepared cost-optimization evidence for the top ${contributors.length} model cost contributor(s).`,
          {
            range,
            timezone: input.timezone,
            metrics_used: metrics,
            total_usage: totalUsage,
            top_contributors_usage: sumField(rows, "total_usage"),
            contributors,
            recommendation_policy: [
              "Prioritize same-model routing/provider, cache, prompt/context, completion and reasoning-effort optimizations first.",
              "Treat task segmentation to cheaper models as a lower-risk experiment when simpler workloads can be isolated.",
              "Treat cross-model replacement as an eval candidate. Validate representative prompts and cost per completed task before production migration."
            ]
          }
        );
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "list_api_keys",
    {
      title: "List OpenRouter API keys",
      description:
        "List API key metadata, limits and usage counters. Plaintext secrets are never returned.",
      inputSchema: {
        include_disabled: z.boolean().default(true),
        offset: z.number().int().min(0).default(0),
        workspace_id: z.string().uuid().optional()
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false
      }
    },
    async (input: any) => {
      try {
        const response = await listKeys(input);
        const rawKeys = Array.isArray(response?.data) ? response.data : [];

        const keys = rawKeys.map((key: any) => ({
          hash: key.hash,
          name: key.name ?? key.label ?? null,
          disabled: Boolean(key.disabled),
          limit: key.limit ?? null,
          limit_remaining: key.limit_remaining ?? null,
          limit_reset: key.limit_reset ?? null,
          expires_at: key.expires_at ?? null,
          usage: numberValue(key.usage),
          usage_daily: numberValue(key.usage_daily),
          usage_weekly: numberValue(key.usage_weekly),
          usage_monthly: numberValue(key.usage_monthly),
          byok_usage: numberValue(key.byok_usage),
          include_byok_in_limit: Boolean(key.include_byok_in_limit),
          workspace_id: key.workspace_id ?? null
        }));

        return textResult(
          `Found ${keys.length} OpenRouter API key(s). Plaintext secrets are never returned.`,
          {
            offset: input.offset,
            keys
          }
        );
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "compare_models",
    {
      title: "Compare OpenRouter models",
      description:
        "Compare specific OpenRouter model IDs using live prices, context windows, modalities, supported parameters and optional provider endpoint details. Use the official OpenRouter MCP for benchmark/ranking evidence.",
      inputSchema: {
        model_ids: z.array(z.string().min(3)).min(2).max(8),
        include_endpoints: z.boolean().default(false)
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true
      }
    },
    async (input: any) => {
      try {
        const response = await listModels();
        const catalog = response?.data ?? [];
        const byId = new Map(catalog.map((model: any) => [model.id, model]));

        const models = await Promise.all(
          input.model_ids.map(async (id: string) => {
            const raw = byId.get(id);
            if (!raw) return { id, found: false };

            const normalized: Record<string, unknown> = {
              found: true,
              ...normalizeModel(raw)
            };

            if (input.include_endpoints) {
              const endpoints = await getModelEndpoints(id);
              normalized.provider_summary = summarizeEndpoints(
                endpoints?.data?.endpoints ?? []
              );
            }

            return normalized;
          })
        );

        return textResult(
          `Compared ${models.filter((model: any) => model.found).length} of ${input.model_ids.length} requested model(s).`,
          { models }
        );
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "routerlens_status",
    {
      title: "Check RouterLens configuration",
      description:
        "Check whether the private RouterLens/OpenRouter analytics bridge is configured. Does not expose credentials.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false
      }
    },
    async () =>
      textResult(
        hasManagementKey()
          ? "RouterLens Management Key is configured."
          : "RouterLens is running, but account analytics needs OPENROUTER_MANAGEMENT_KEY.",
        {
          management_key_configured: hasManagementKey(),
          account_analytics_available: hasManagementKey(),
          mode: "self-hosted-single-tenant-alpha",
          version: "0.3.0"
        }
      )
  );
}
