# Architecture

## Components

### OpenRouter official MCP
Used for public/current OpenRouter capabilities:
- model discovery and details
- provider endpoints
- rankings and benchmarks
- generation lookup
- documentation
- explicit test generations

### RouterLens MCP
Used for private account capabilities:
- credits
- Analytics API
- API-key metadata
- anomaly detection
- cost optimization
- normalized model comparison

## Data flow

```text
User prompt
  -> OpenRouter skill
  -> choose official MCP or RouterLens MCP
  -> fetch live data
  -> deterministic aggregation where possible
  -> ChatGPT/Codex explains the result
```

## Analytics design

`query_usage` is the generic analytics primitive. Higher-level tools build on the same underlying API instead of creating one endpoint for every date window or dimension.

RouterLens follows OpenRouter Analytics constraints:
- up to 2 dimensions per query
- up to 20 filters
- up to 10,000 rows
- supported metrics/dimensions discovered from `/analytics/meta`

## Cost Doctor

Cost optimization is evidence-first:
1. find top cost contributors
2. inspect token/cache structure
3. inspect same-model provider price spread
4. recommend low-risk optimizations first
5. treat cross-model replacement as an eval candidate
