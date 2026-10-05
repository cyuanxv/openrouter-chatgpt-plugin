# Tool Contracts

## get_account_summary
Inputs: `timezone`, `include_spend_windows`.
Returns purchased credits, lifetime usage, remaining credit, and optional today/yesterday/7D/30D spend windows. Missing or malformed financial values are errors, not zero. Spend windows require untruncated upstream data.

## get_analytics_meta
Returns OpenRouter's live Analytics schema. With include_query_recipes=true, also prepares seven schema-adapted query_usage inputs for models, providers, API keys, token mix, daily spend, cache evidence and cost components. Recipes identify missing capabilities and never execute a usage query or claim actual results. Templates retain completeness, label-ID, UTC bucket, overlapping-token and cost-component cautions.

## query_usage
Inputs include metrics, up to two dimensions, up to twenty filters, optional granularity, ordering, limits, preset, timezone, or explicit UTC range. An explicit range takes precedence over a preset and must have start < end. Returned totals cover returned rows only; totals_complete is true only with explicit untruncated upstream metadata. Each query first reads live Analytics metadata and validates field/operator/granularity names, duplicate selections, filter scalar/array shape and returned sort fields. Validation errors report input paths and supported schema IDs without echoing filter values; the usage query is not executed. No requested period defaults silently: omitted preset/range resolves to seven calendar days in the requested timezone. Explicit ranges still take precedence. Live rate/format semantics and conservative aggregation checks prevent summing rates, performance or unverified metrics; metric_aggregations explains each choice. Time bucket timezone is identified separately as UTC. Empty results carry a filter/range caution.

## analyze_cost_anomalies
Queries completed UTC days with extra baseline days and flags candidates that cross both the ratio and absolute-dollar thresholds. Non-UTC daily anomaly queries are rejected until local bucket support exists. Only consecutive returned calendar days form a baseline; missing days are not assumed to be zero. The current partial day is excluded. evaluated_days and skipped_days describe baseline coverage, and insufficient history remains unknown. A zero baseline yields ratio: null with baselineZero: true.

## analyze_cost_optimization
Finds top model cost contributors and combines live token/cache metrics, catalog prices, and same-model provider price spread. Truncated or unverified completeness rejects account-wide conclusions. Each signal includes an actionable next step and verification conditions; confidence refers only to the observed signal, not guaranteed improvement. Missing/invalid token/cache metrics remain null and are identified, inconsistent ratios are not used for advice, and estimated_savings_usd remains null with an explanation. Optional catalog/provider failures preserve complete usage evidence and are labeled. Catalog prices are current default list prices, not historical billed rates. Unknown per-request prices remain null rather than zero; request_price is USD/request, while token prices are USD per million tokens.

## list_api_keys
Returns key metadata, usage counters, limits, status, expiration, and hash. No plaintext secret.

## compare_models
Returns normalized model price, context, modalities, supported parameters, and optional provider endpoint summaries.

## routerlens_status
Returns configuration metadata only. account_analytics_available is null and connectivity_verified is false because environment presence does not prove upstream connectivity. Never returns credential values.

