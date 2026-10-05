---
name: openrouter
description: Use OpenRouter's official MCP server plus the RouterLens analytics bridge for live model discovery, pricing, providers, benchmarks, generations, documentation, account spend, usage trends, token analysis, API-key metadata, anomaly detection, and cost optimization.
---

# OpenRouter

Use live OpenRouter tools whenever the request depends on current models, current prices, current providers, account usage, or account spend.

## Choose the right MCP

Use the official OpenRouter MCP for:
- model search and model details
- newest models, rankings, benchmarks, and task classifications
- provider and endpoint details
- OpenRouter documentation
- generation lookup
- test inference and image generation when explicitly requested

Use the RouterLens analytics MCP for:
- account balance and recent spend windows
- usage trends and arbitrary analytics breakdowns
- spend or request ranking by model, provider, API key, app, user, or workspace
- token, cache, and reasoning-token analysis
- cost anomaly detection
- cost optimization analysis
- API-key metadata and spend limits
- side-by-side live model price/context comparison

## Account workflow

For "balance", "today", "yesterday", "7 days", or "30 days":
1. Use `get_account_summary`.
2. Use the user's local timezone when available.
3. State the timezone in the answer if date boundaries matter.

For a detailed breakdown:
1. Use `query_usage`.
2. Prefer `total_usage` for spend and `request_count` for calls.
3. Use at most two dimensions per query.
4. Use `get_analytics_meta` first when a metric or dimension name is uncertain.

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

## Model comparison workflow

For named model comparison:
1. Use `compare_models` for live price, context, modality, parameter, and optional endpoint evidence.
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
1. Call `routerlens_status`.
2. Explain whether RouterLens is configured.
3. Do not reveal credential values or error payloads that could contain secrets.
