# RouterLens 0.3.3 source-preservation snapshot

This directory preserves a sanitized, portable source snapshot of the reviewed RouterLens local-day anomaly candidate. It is additive: it does not replace this repository's existing Next.js application, overwrite the earlier v0.3.1 review branch, or claim that either pull request is merged.

## Release status

- The private production service remains **0.3.2**.
- The **0.3.3 candidate is not published**. Its source reports `0.3.3-candidate.1` deliberately.
- The earlier frozen private candidate passed **107 synthetic tests**, including 19 independent review tests and 240 integer-cent oracle cases, plus build and artifact validation.
- The sanitized snapshot was separately verified with its own placeholder configuration: locked offline dependency installation, build, **107/107 synthetic tests**, and artifact validation all passed with exit code 0. This establishes the snapshot's independent checkout workflow; it is not a production deployment or live-account acceptance.
- A separate formal-release retest did not establish a final result after its wait operation was cancelled. It has not been resumed here.
- This GitHub preservation change does not deploy the service, update the connected plugin, change access, generate credentials, or run paid inference.

## Included functionality

Eight read-only MCP tools cover account summary, analytics metadata/recipes, usage queries, cost anomalies, optimization evidence, API-key metadata, model comparison and configuration status.

Local-day anomalies support **UTC and Asia/Shanghai only**. Shanghai uses one complete hourly query bounded by local midnight, with a maximum of 31 days including its consecutive baseline. Current and future days are excluded. Missing hourly coverage is unknown rather than zero. Complete negative-net days are retained as unknown with the observed net amount and break the baseline. Complete explicit zero buckets remain zero. Exact decimal sums and integer cross-products decide thresholds; numeric display values do not invent precision lost upstream.

## What was deliberately removed

No real owner binding, private Site hostname or project ID, runtime environment values, credentials, account/billing exports, raw private archive, compiled deployment artifact, npm cache, delivery logs or private Git history is included. The generic source references environment variable **names** and synthetic test secrets only; their real values are absent.

`worker/index.ts`, `tests/worker.test.mjs` and `.openai/hosting.json` contain obvious `example.invalid` or `REPLACE_WITH_...` placeholders. **These files are not configured for deployment.** The worker requires a trusted platform identity dispatcher that authenticates users and overwrites identity headers before forwarding requests. Do not expose it directly while treating client-supplied identity headers as proof of ownership. Configure your own owner-only access and replace placeholders privately before considering deployment. Do not commit real Management Keys.

## Legacy reference modules

`lib/auth.ts`, `lib/mcpRuntime.ts` and `lib/hosted/` preserve earlier Next.js/OAuth adapter source as reference. The standalone Worker entry point is `worker/index.ts`; it does not import those adapters. They are not enabled, configured or integration-tested by this snapshot, and `mcp-handler` is intentionally not installed in its Worker-only package. For the Next.js adapter's original dependency set and integration context, consult the existing [v0.3.1 review branch](https://github.com/cyuanxv/openrouter-chatgpt-plugin/tree/fix/routerlens-v0.3.1-reviewed) and its package manifest. Do not assume the reference adapters are an additional runnable service here.

## Layout and offline checks

- `lib/`: analytics, decimal threshold arithmetic, precise range validation, tool definitions, and read-only clients
- `worker/`: generic Worker adapter and page with sanitized owner/origin placeholders
- `tests/`: synthetic tests; Worker tests disable real network access
- `scripts/`: build and artifact validation helpers

Requires **Node.js 22 or newer** (the locked Miniflare 4 test runtime requires it). For an independent new checkout, use `npm ci --ignore-scripts`, `npm run build`, `npm test`, and `npm run validate`. Tests never require a real Management Key or paid generation. These commands were run independently for this sanitized snapshot on 2026-10-08. All completed with exit code 0. Worker tests explicitly disable outbound network access; other tests use injected synthetic clients and do not require real account access.

License: Apache-2.0. This is independent of and not endorsed by OpenRouter.
