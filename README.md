# OpenRouter ChatGPT Plugin

**Analytics, Cost Optimization & MCP Tools for ChatGPT and Codex.**

An open-source OpenRouter plugin that combines OpenRouter's official MCP server with a private analytics bridge for account spend, usage analysis, model comparison, cost anomaly detection, and cost optimization.

Current version: **0.3.0 Alpha**

## Reviewed source snapshot

A standalone [RouterLens 0.3.3 source snapshot](snapshots/routerlens-0.3.3/README.md) preserves the reviewed local-calendar anomaly work with sanitized placeholders and its own install/build/test workflow. The private production service remains 0.3.2; this additive source-preservation change does not publish 0.3.3, replace the root application, or merge the earlier [v0.3.1 review PR](https://github.com/cyuanxv/openrouter-chatgpt-plugin/pull/1).

## What it does

### Account
- Remaining OpenRouter credit
- Today / yesterday / 7-day / 30-day spend
- Usage trends

### Models
- Live model search through OpenRouter's official MCP
- Latest models
- Pricing and context windows
- Provider endpoints
- Side-by-side model comparison
- Benchmark/ranking evidence through OpenRouter's official MCP

### Analytics
- Spend by model
- Requests by model
- Spend by provider
- Spend by API key
- Token/cache/reasoning-token analysis
- Cost anomaly detection
- Cost optimization evidence

### Developer
- Generation inspection through OpenRouter's official MCP
- OpenRouter docs search
- API-key metadata and limits
- Live Analytics schema discovery

## Architecture

```text
ChatGPT / Codex
      |
      +----------------------+
      |                      |
OpenRouter official MCP   RouterLens MCP
      |                      |
Models / Providers        Credits / Analytics
Benchmarks / Docs         Cost Doctor / Key metadata
Generations / Tests       Model comparison
      |                      |
      +---------- OpenRouter-+
```

The official MCP handles capabilities OpenRouter already exposes well. RouterLens adds the private account-analysis layer.

## Why two MCP servers?

Duplicating OpenRouter's official model and generation tools would create unnecessary maintenance. RouterLens focuses on the missing workflow layer:

- account analytics
- cost attribution
- cost anomalies
- cost optimization
- API-key usage visibility
- normalized model/provider comparisons

## RouterLens tools

| Tool | Purpose |
| --- | --- |
| `get_account_summary` | Balance and today/yesterday/7D/30D spend |
| `get_analytics_meta` | Live Analytics API schema |
| `query_usage` | Generic spend/request/token breakdowns |
| `analyze_cost_anomalies` | Rolling-baseline spend spike detection |
| `analyze_cost_optimization` | Evidence-backed optimization opportunities |
| `list_api_keys` | Read-only key metadata, limits, usage |
| `compare_models` | Live price/context/provider comparison |
| `routerlens_status` | Configuration diagnostics |

## Self-hosting

Requirements:

- Node.js 20+
- Vercel or another Next.js-compatible host
- OpenRouter Management API Key

Environment variables:

```bash
OPENROUTER_MANAGEMENT_KEY=
MCP_AUTH_TOKEN=
```

Install and build:

```bash
npm install
npm run check
```

Run locally:

```bash
npm run dev
```

Endpoints:

- MCP: `/api/mcp`
- Health: `/api/health`

## Security

- Management Keys are read from server environment variables.
- Secrets are never returned by MCP tools.
- API-key listing only exposes metadata and hashes returned by OpenRouter.
- V0.3 contains no key create/update/delete tools.
- The self-hosted MCP endpoint is protected by `MCP_AUTH_TOKEN`.
- Account data is queried from OpenRouter on demand and is not persisted by RouterLens.

See [SECURITY.md](./SECURITY.md) and [docs/security.md](./docs/security.md).

## Plugin package

The repository contains the portable ChatGPT/Codex plugin files:

- `plugin.json`
- `mcp.json`
- `.mcp.json`
- `.codex-plugin/plugin.json`
- `skills/openrouter/SKILL.md`

The plugin connects to:

1. OpenRouter official MCP: `https://mcp.openrouter.ai/mcp`
2. RouterLens analytics MCP: your self-hosted endpoint

## Roadmap

### 0.3 Alpha
- Read-only analytics
- Cost Doctor
- Cost anomalies
- API-key metadata
- Model comparison

### Next
- Hosted multi-user OAuth flow
- Encrypted per-user OpenRouter credentials
- Secure key write actions
- Presets and routing builder
- Guardrails and workspace governance
- Optional dashboard and recurring cost reports

## License

Apache-2.0.

This is an independent open-source project and is not affiliated with or endorsed by OpenRouter.

