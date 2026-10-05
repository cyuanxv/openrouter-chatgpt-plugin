# Tool Contracts

## get_account_summary
Inputs: `timezone`, `include_spend_windows`.
Returns purchased credits, lifetime usage, remaining credit, and optional today/yesterday/7D/30D spend windows.

## get_analytics_meta
Returns OpenRouter's live Analytics schema.

## query_usage
Inputs include metrics, up to two dimensions, up to twenty filters, optional granularity, ordering, limits, preset, timezone, or explicit UTC range.

## analyze_cost_anomalies
Queries daily spend with extra baseline days and flags candidates that cross both the ratio and absolute-dollar thresholds.

## analyze_cost_optimization
Finds top model cost contributors and combines live token/cache metrics, catalog prices, and same-model provider price spread.

## list_api_keys
Returns key metadata, usage counters, limits, status, expiration, and hash. No plaintext secret.

## compare_models
Returns normalized model price, context, modalities, supported parameters, and optional provider endpoint summaries.

## routerlens_status
Returns configuration booleans only. Never returns credential values.
