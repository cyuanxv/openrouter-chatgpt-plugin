---
name: openrouter
description: Use OpenRouter's official MCP for live models, pricing, providers, benchmarks, generations, and documentation. Use RouterLens private analytics only when its authenticated tools are actually connected; the 0.3.1 default package temporarily excludes Analytics.
---

# OpenRouter

## Availability in 0.3.1

The default plugin temporarily connects only to the official OpenRouter MCP. Private usage analytics, cost optimization, and API-key metadata are unavailable through the default package. Remaining account credit can still be queried with the official `get-credits` tool when it is present and authorized. This is a compatibility downgrade, not a restoration of Analytics.

Before any RouterLens workflow below, verify its tools are actually present and authenticated. If they are absent, say private Analytics is unavailable and continue only with supported official capabilities. Do not call an absent `routerlens_status` tool. Do not infer private spend from public model prices. Never ask for credentials in chat or add a static bearer to a shared plugin package.

Use live OpenRouter tools whenever the request depends on current models, current prices, current providers, account usage, or account spend.

## Choose the right MCP

Use the official OpenRouter MCP for:
- model search and model details
- newest models, rankings, benchmarks, and task classifications
- provider and endpoint details
- remaining account credit through `get-credits`
- OpenRouter documentation
- generation lookup
- test inference and image generation when explicitly requested

Only when securely connected, use the RouterLens analytics MCP for:
- account balance and recent spend windows
- usage trends and arbitrary analytics breakdowns
- spend or request ranking by model, provider, API key, app, user, or workspace
- token, cache, and reasoning-token analysis
- cost anomaly detection
- cost optimization analysis
- API-key metadata and spend limits
- side-by-side live model price/context comparison

## Account workflow

For balance alone, prefer the official `get-credits` tool when available.

For "today", "yesterday", "7 days", or "30 days", or a combined RouterLens account summary when connected:
1. Use `get_account_summary`.
2. Use the user's local timezone when available.
3. State the timezone in the answer if date boundaries matter.

For a detailed breakdown:
When choosing a common analysis, `get_analytics_meta` with `include_query_recipes: true` can prepare schema-supported query_usage inputs. Use only recipes marked ready, preserve their interpretation notes, and then explicitly run the chosen query. A prepared recipe is not an executed query or a spending result.

1. Use `query_usage`.
2. Prefer `total_usage` for spend and `request_count` for calls.
3. Use at most two dimensions per query.
4. `query_usage` now checks the live schema before executing. Use `get_analytics_meta` when exploring available fields. If validation_errors are returned, correct the indicated input paths using the supported IDs and retry; do not assume the usage query ran.
5. If no period is supplied, the tool returns an explicit seven-calendar-day range. Distinguish the requested date-boundary timezone from UTC time buckets.
6. Do not sum metrics marked non-additive or aggregation_semantics_unverified. Totals cover returned rows; preserve truncation and empty-result warnings.
7. For API-key breakdowns, use the key dimension actually advertised by the live schema (currently commonly api_key_id). Returned dimension labels may be human-readable; filters can require underlying IDs or key hashes. Do not substitute a displayed key name for a hash/ID. An empty filtered result alone does not prove the account had no usage.

## Cost analysis workflow

For "what is costing the most":
1. Query the requested period by model.
2. Rank by `total_usage`.
3. If useful, repeat by provider or API key.
4. Explain the top cost drivers using token and request evidence.

For "is cost abnormal":
1. Use `analyze_cost_anomalies`.
2. Report the spike date, baseline, absolute increase, and ratio.
3. If a spike exists, use `query_usage` by model/provider/API key to attribute it.

For "how can I save money":
1. Use `analyze_cost_optimization`.
2. Prioritize same-model provider routing, caching, prompt/context size, output length, and reasoning effort.
3. Treat cross-model replacement as an eval candidate.
4. Estimate savings only when supported by live usage and price data.
5. Never claim a cheaper model has equivalent quality without an eval.
6. Use each signal's next_step and verify_before_change as an evaluation plan. Preserve missing/invalid metric warnings and catalog/provider availability. Confidence describes the observation, not guaranteed savings. A null savings estimate must not be converted into a dollar-saving promise; current list prices are not historical billing evidence.

## Model comparison workflow

For named model comparison:
1. Use official model and provider tools for live evidence. Use RouterLens `compare_models` only when that tool is securely connected.
2. Use official OpenRouter benchmark/ranking tools for quality or task-fit evidence.
3. Separate factual API data from recommendation judgment.
4. If the user provides their actual usage mix, estimate cost under each candidate model.

## API keys

`list_api_keys` is read-only and must never expose plaintext secrets.
Do not ask the user to paste API keys or Management Keys into chat.
V0.3 does not create, rotate, update, disable, or delete API keys.

## Billable actions

Official OpenRouter message/image generation can consume credits.
Use those tools only when the user explicitly asks to run a generation, test, or evaluation.

## Failure handling

If account tools fail:
1. Call `routerlens_status` only if the authenticated RouterLens tool is available; otherwise explain that the default package does not connect private Analytics.
2. Explain whether RouterLens is configured.
3. Do not reveal credential values or error payloads that could contain secrets.

