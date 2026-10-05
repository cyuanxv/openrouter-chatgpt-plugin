# OpenRouter ChatGPT Plugin

**Analytics, Cost Optimization & MCP Tools for ChatGPT and Codex.**

An open-source OpenRouter plugin that combines OpenRouter's official MCP server with a private analytics bridge for account spend, usage analysis, model comparison, cost anomaly detection, and cost optimization.

Current version: **0.3.1 Alpha (authentication compatibility hotfix)**

> The default package temporarily includes only the official OpenRouter MCP. Private account Analytics, Cost Doctor, and key metadata are **not restored** in this release. The self-hosted bridge and its eight tools remain in source, protected by authentication. See [the authentication roadmap](docs/authentication-roadmap.md) before enabling private Analytics.

The capability list below describes the source components. Historical spend and Analytics require a separately authenticated self-hosted bridge; they are not available in the default 0.3.1 package. Remaining credit is supported by the official `get-credits` tool when connected and authorized.

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
npm ci
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

The RouterLens MCP is intentionally omitted from both default MCP manifests until supported authentication is implemented. Do not add a shared static bearer to these files, remove server authentication, or reinstall the plugin as a substitute for authentication. A private client that supports secure credential storage may connect to its own self-hosted bridge outside the shared package.

## Roadmap

### 0.3 Alpha
- Read-only analytics
- Cost Doctor
- Cost anomalies
- API-key metadata
- Model comparison

### Next
- Restore private Analytics through verified MCP-compatible OAuth, with tenant isolation and regression coverage
- Hosted multi-user OAuth flow
- Encrypted per-user OpenRouter credentials
- Secure key write actions
- Presets and routing builder
- Guardrails and workspace governance
- Optional dashboard and recurring cost reports

## License

Apache-2.0.

This is an independent open-source project and is not affiliated with or endorsed by OpenRouter.

