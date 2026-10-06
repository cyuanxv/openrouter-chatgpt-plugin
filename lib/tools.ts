import { z } from "zod";
import {
  analyticsMetadata,
  analyzeCostSeries,
  requireCompleteAnalytics,
  requiredNumber,
  rankRows,
  shareOf,
  sumField,
  unwrapAnalyticsRows
} from "./analytics";
import { PublicError, publicErrorMessage } from "./errors";
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
import { estimateTextWorkload } from "./workloadEstimate";
import { buildCostAdvice } from "./costAdvice";
import { buildQueryRecipes } from "./queryRecipes";
import { metricAggregation, QueryValidationError, validateAnalyticsQuery } from "./queryPlanning";
import { normalizeKeyMetadata } from "./keyMetadata";
import { normalizeModel, summarizeEndpoints } from "./modelCompare";
import {
  isValidTimeZone,
  resolveCalendarDaysRange,
  resolvePresetRange,
  type RangePreset
} from "./time";

const TIMEZONE = z.string().refine(isValidTimeZone, "Use a supported IANA timezone name.").default("UTC");

const FILTER_VALUE = z.union([
  z.string(),
  z.number(),
  z.array(z.union([z.string(), z.number()]))
]);

function toolError(error: unknown) {
  if (error instanceof QueryValidationError) return {
    isError: true,
    structuredContent: { validation_errors: error.issues, query_executed: false },
    content: [{ type: "text" as const, text: error.message }]
  };
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

async function spendForPreset(preset: RangePreset, timezone: string, query: typeof queryAnalytics) {
  const range = resolvePresetRange(preset, timezone);
  const response = await query({
    metrics: ["total_usage"],
    time_range: { start: range.start, end: range.end },
    limit: 100
  });
  requireCompleteAnalytics(response);
  const rows = unwrapAnalyticsRows(response);
  return {
    preset,
    start: range.start,
    end: range.end,
    usd: sumField(rows, "total_usage")
  };
}

export type RouterLensToolClient = Pick<typeof import("./openrouter"), "getAnalyticsMeta" | "getCredits" | "getModelEndpoints" | "listKeys" | "listModels" | "queryAnalytics"> & {
  status: () => { management_key_configured: boolean | null; mode: string; authentication_verified?: boolean };
};
const singleTenantClient: RouterLensToolClient = {
  getAnalyticsMeta, getCredits, getModelEndpoints, listKeys, listModels, queryAnalytics,
  status: () => ({ management_key_configured: hasManagementKey(), mode: "self-hosted-single-tenant-alpha" })
};

export function registerRouterLensTools(server: any, client: RouterLensToolClient = singleTenantClient) {
  const { getAnalyticsMeta, getCredits, getModelEndpoints, listKeys, listModels, queryAnalytics } = client;
  server.registerTool(
    "get_account_summary",
    {
      title: "Get OpenRouter account summary",
      description:
        "Get OpenRouter remaining credit plus today, yesterday, 7-day and 30-day spend. Use for balance or recent account-spend questions. Requires the configured Management Key.",
      inputSchema: {
        timezone: TIMEZONE,
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
        const totalCredits = requiredNumber(credits?.total_credits);
        const lifetimeUsage = requiredNumber(credits?.total_usage);

        const result: Record<string, unknown> = {
          timezone,
          total_credits: totalCredits,
          lifetime_usage: lifetimeUsage,
          remaining_credits: totalCredits - lifetimeUsage
        };

        if (include_spend_windows) {
          const windows = await Promise.all(
            (["today", "yesterday", "7d", "30d"] as RangePreset[]).map((preset) =>
              spendForPreset(preset, timezone, queryAnalytics)
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
        "Get the live OpenRouter Analytics schema and optional ready-to-run query recipes for spend, API keys, providers and token analysis. Recipes never execute automatically.",
      inputSchema: { include_query_recipes: z.boolean().default(false) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false
      }
    },
    async ({ include_query_recipes }: { include_query_recipes: boolean }) => {
      try {
        const response = await getAnalyticsMeta();
        const data = unwrapAnalyticsMeta(response);
        return textResult("Returned the current OpenRouter Analytics schema.", {
          ...data,
          ...(include_query_recipes ? { query_recipes: buildQueryRecipes(data) } : {})
        });
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
        preset: z.enum(["today", "yesterday", "7d", "30d"]).default("7d"),
        timezone: TIMEZONE,
        metrics: z.array(z.string().min(1).max(128)).min(1).max(20).default(["total_usage"]),
        dimensions: z.array(z.string().min(1).max(128)).max(2).optional(),
        granularity: z.string().min(1).max(128).optional(),
        filters: z
          .array(
            z.object({
              field: z.string().min(1).max(128),
              operator: z.string().min(1).max(128),
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
          .refine((range) => Date.parse(range.start) < Date.parse(range.end), "time_range.start must be earlier than time_range.end.")
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
        if (input.time_range && Date.parse(input.time_range.start) >= Date.parse(input.time_range.end)) {
          throw new PublicError("INVALID_RANGE");
        }
        const presetRange = input.preset && !input.time_range
          ? resolvePresetRange(input.preset, input.timezone)
          : undefined;

        const range =
          input.time_range ??
          (presetRange
            ? { start: presetRange.start, end: presetRange.end }
            : undefined);

        const query = {
          metrics: input.metrics,
          dimensions: input.dimensions,
          granularity: input.granularity,
          filters: input.filters,
          limit: input.limit,
          group_limit: input.group_limit,
          order_by: input.order_by,
          time_range: range
        };
        const schema = unwrapAnalyticsMeta(await getAnalyticsMeta());
        validateAnalyticsQuery(query, schema);
        const response = await queryAnalytics(query);
        const rows = unwrapAnalyticsRows(response);
        const aggregations = Object.fromEntries(input.metrics.map((metric: string) => [metric, metricAggregation(metric, schema)]));
        const summedMetrics = input.metrics.filter((metric: string) => aggregations[metric].summed);
        const totals = Object.fromEntries(summedMetrics.map((metric: string) => [metric, sumField(rows, metric)]));

        const result = {
          range: range ?? null,
          timezone: presetRange ? input.timezone : null,
          metrics: input.metrics,
          dimensions: input.dimensions ?? [],
          granularity: input.granularity ?? null,
          totals,
          totals_scope: "returned_rows",
          totals_complete: analyticsMetadata(response)?.truncated === false,
          truncated: analyticsMetadata(response)?.truncated ?? null,
          metric_aggregations: aggregations,
          rate_and_performance_metrics_are_not_summed: input.metrics.filter(
            (metric: string) => !aggregations[metric].summed
          ),
          schema_validated: true,
          warnings: rows.length === 0 ? ["No matching rows were returned. Check filters and the time range before drawing an account-wide no-usage conclusion."] : [],
          time_bucket_timezone: input.granularity ? "UTC" : null,
          rows,
          metadata: analyticsMetadata(response)
        };

        return textResult(
          `OpenRouter Analytics returned ${rows.length} row(s). Totals cover returned rows${result.totals_complete ? "" : "; completeness is unverified or the result was truncated"}.`,
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
        "Detect spend spikes over completed UTC days against a consecutive-day rolling baseline. Incomplete current-day and non-UTC daily analysis are not supported.",
      inputSchema: {
        days: z.number().int().min(1).max(90).default(30),
        timezone: TIMEZONE,
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
        if (input.timezone !== "UTC") throw new PublicError("NON_UTC_DAILY_BUCKETS");
        const previousDay = new Date(Date.now() - 86_400_000);
        const targetRange = resolveCalendarDaysRange(input.days, "UTC", previousDay);
        const queryRange = resolveCalendarDaysRange(
          input.days + input.baseline_days,
          "UTC",
          previousDay
        );

        const response = await queryAnalytics({
          metrics: ["total_usage"],
          granularity: "day",
          time_range: { start: queryRange.start, end: queryRange.end },
          limit: Math.min(10_000, input.days + input.baseline_days + 10)
        });

        requireCompleteAnalytics(response);
        const rows = unwrapAnalyticsRows(response);
        const analysis = analyzeCostSeries(
          rows,
          "total_usage",
          "date__day",
          input.baseline_days,
          input.ratio_threshold,
          input.absolute_threshold_usd,
          targetRange.startDate,
          targetRange.endDateExclusive
        );

        const { anomalies } = analysis;
        const series = rows.filter(
          (row) => String(row.date__day ?? "").slice(0, 10) >= targetRange.startDate
        );

        return textResult(
          anomalies.length
            ? `Detected ${anomalies.length} cost anomaly candidate(s).`
            : analysis.evaluatedDays
              ? "No cost anomaly candidates crossed the configured thresholds among days with complete consecutive baselines."
              : "No complete consecutive-day baseline was available; anomaly status is unknown.",
          {
            timezone: input.timezone,
            time_bucket_timezone: "UTC",
            baseline_policy: "consecutive returned UTC days; missing buckets are not assumed to be zero",
            evaluated_days: analysis.evaluatedDays,
            skipped_days: analysis.skippedDays,
            current_partial_day_excluded: true,
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
        "Analyze top OpenRouter cost contributors using live usage, token/cache metrics and optional current catalog/provider prices. Return observed signals, actionable verification steps and data-quality gaps. Savings are not invented or automatically estimated.",
      inputSchema: {
        preset: z.enum(["7d", "30d"]).default("30d"),
        timezone: TIMEZONE,
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
          throw new PublicError("MISSING_SPEND_METRIC");
        }

        const usageResponse = await queryAnalytics({
          metrics,
          dimensions: ["model"],
          time_range: range,
          limit: 500,
          order_by: { field: "total_usage", direction: "desc" }
        });

        requireCompleteAnalytics(usageResponse);
        const allRows = unwrapAnalyticsRows(usageResponse);
        const rows = rankRows(allRows, "total_usage", input.top_models);
        const totalUsage = sumField(allRows, "total_usage");

        let catalog: any[] = [];
        let catalogAvailable = false;
        try {
          const modelsResponse = await listModels();
          if (Array.isArray(modelsResponse?.data)) {
            catalog = modelsResponse.data.filter((model: any) => model && typeof model === "object" && typeof model.id === "string" && model.id);
            catalogAvailable = catalog.length === modelsResponse.data.length;
          }
        } catch { /* Preserve verified usage evidence when optional public pricing is unavailable. */ }
        const byId = new Map(catalog.map((model: any) => [model.id, normalizeModel(model)]));

        const contributors = await Promise.all(
          rows.map(async (row) => {
            if (typeof row.model !== "string" || !row.model) throw new PublicError("INVALID_RESPONSE");
            const modelId = row.model;
            let providerEvidence: any = null;
            let providerEvidenceStatus = input.include_provider_evidence ? "unavailable" : "not_requested";

            if (input.include_provider_evidence && modelId.includes("/")) {
              try {
                const endpointsResponse = await getModelEndpoints(modelId);
                if (Array.isArray(endpointsResponse?.data?.endpoints)) {
                  providerEvidence = summarizeEndpoints(endpointsResponse.data.endpoints);
                  providerEvidenceStatus = !providerEvidence.count ? "no_listed_endpoints" : providerEvidence.min_prompt_usd_per_million === null && providerEvidence.min_completion_usd_per_million === null ? "no_pricing_data" : "available";
                }
              } catch {
                providerEvidence = null;
              }
            }

            const advice = buildCostAdvice(row, totalUsage, providerEvidence);
            const safeRow = Object.fromEntries(metrics.map((metric) => {
              if (metric in advice.metric_evidence) return [metric, advice.metric_evidence[metric]];
              try { return [metric, requiredNumber(row[metric])]; } catch {
                (row[metric] == null ? advice.missing_metrics : advice.invalid_metrics).push(metric);
                return [metric, null];
              }
            }));
            const { signals, ...adviceSummary } = advice;
            return {
              ...safeRow,
              model: modelId,
              spend_share: shareOf(row.total_usage, totalUsage),
              catalog: byId.get(modelId) ?? null,
              provider_evidence: providerEvidence,
              provider_evidence_status: providerEvidenceStatus,
              optimization_signals: signals,
              optimization_advice: adviceSummary
            };
          })
        );

        return textResult(
          `Prepared cost-optimization evidence for the top ${contributors.length} model cost contributor(s).${catalogAvailable ? "" : " Current catalog pricing could not be fully verified; usage evidence is preserved."} Savings have not been estimated.`,
          {
            range,
            timezone: input.timezone,
            metrics_used: metrics,
            catalog_available: catalogAvailable,
            pricing_basis: "current_default_list_prices_not_historical_billed_cost",
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
        if (!Array.isArray(response?.data)) throw new PublicError("INVALID_RESPONSE");
        const rawKeys = response.data;

        const keys = rawKeys.map(normalizeKeyMetadata);

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
        "Compare OpenRouter model IDs using live catalog prices, context and optional provider evidence. If the user supplies a text-token workload, calculate an explicitly hypothetical cost scenario without running a generation. Missing prices or known context/modality violations prevent an estimate. Use official tools for quality evidence.",
      inputSchema: {
        model_ids: z.array(z.string().min(3)).min(2).max(8),
        include_endpoints: z.boolean().default(false),
        workload: z.object({
          requests: z.number().int().min(1).max(1_000_000_000).describe("User-supplied assumed request count; no requests will be executed."),
          prompt_tokens_per_request: z.number().int().min(0).max(1_000_000_000).describe("Total assumed prompt tokens per request, including the cached portion."),
          completion_tokens_per_request: z.number().int().min(0).max(1_000_000_000).describe("All assumed billable completion tokens, including reasoning where billed as completion."),
          cached_prompt_tokens_per_request: z.number().int().min(0).max(1_000_000_000).default(0).describe("Assumed cached subset of prompt tokens; cache eligibility is not verified.")
        }).refine((value) => value.cached_prompt_tokens_per_request <= value.prompt_tokens_per_request, "Cached prompt tokens must be part of prompt tokens.").optional()
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

            if (input.workload) normalized.workload_estimate = estimateTextWorkload(normalized, input.workload);

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
          { models, ...(input.workload ? { workload_estimation: "Hypothetical text-token scenario only; no generation was run and no actual savings or quality equivalence is claimed." } : {}) }
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
    async () => {
      const status = client.status();
      return textResult(
        status.authentication_verified
          ? "RouterLens request identity is verified; account binding and upstream access are checked when an account tool runs."
          : status.management_key_configured
            ? "RouterLens Management Key is configured; upstream access has not been verified."
            : "RouterLens is running, but account analytics needs OPENROUTER_MANAGEMENT_KEY.",
        {
          ...status,
          account_analytics_available: null,
          connectivity_verified: false,
          version: "0.3.1"
        }
      );
    }
  );
}
