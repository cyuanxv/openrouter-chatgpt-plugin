# RouterLens 0.3.4 analytics-integrity candidate

Public candidate based on the sanitized 0.3.3 source snapshot at commit `5cb60f63a390ec48d007807dd1361228a5c2a00f`. The historical `snapshots/routerlens-0.3.3` directory is retained on this isolated development branch to keep the patch reviewable. The repository root application is not the candidate build target.

## Release status

- This public snapshot reports **0.3.4-candidate.1** and retains sanitized deployment placeholders. The historical package version `0.1.1` is an internal package identifier, not the service version.
- The private service reports **0.3.4**. Sites version 4 deployed successfully on 2026-10-09 from source `355e6bbf293c628b5f97a2eaf02ef593d0b3faea`.
- On 2026-10-11, a read-only comparison against public candidate `56eddac4e2362ea355f590922126b4b8cbf68428` found 38 private source files and the same 38 public files plus `PUBLIC-SNAPSHOT-MANIFEST.json`. Of those 38 files, 31 were byte-identical, including `lib/analytics.ts`, `lib/exactRange.ts` and the integrity regression tests. The remaining differences were identity placeholders, the service version string, documentation, ignore rules and the legacy shell build entrypoint. No private-only source file was missing from the public snapshot. The compiled production artifact was not independently downloaded and compared.
- All eight read-only RouterLens tools were exercised successfully in the same audit, including truncated-result handling, UTC/Shanghai anomaly behavior and the 31-day Shanghai range bound. No paid model inference was run. This verifies selected live behavior separately from the source comparison and synthetic tests.
- The original candidate passed **126/126 synthetic tests**, build and artifact validation on 2026-10-08 with reused locked dependencies. See the maintenance validation below for the fresh-checkout result.
- This public maintenance update does not merge branches, update the installed plugin or deploy the private service.

## Canonical build entrypoint

`npm run build` runs `scripts/build.mjs`, which bundles `worker/index.ts`. The shell entrypoint `bash scripts/build.sh` delegates to that same builder and resolves the project directory before running, so it can be invoked from another working directory.

The audited private deployment source still contains an obsolete `scripts/build.sh` that copies an absent `worker/index.js`. No tracked build configuration references that old script; its documented npm build uses the correct `build.mjs`. This public candidate already used the correct shell delegate before this maintenance update. The private script remains unchanged until a separately authorized private-source update; do not copy it back into this candidate.

## Fixed data-integrity gap

UTC-day-aligned queries previously bypassed row-count consistency validation. A response with one returned row and `metadata: { truncated: false, row_count: 2 }` could be accepted as complete, while hourly reconstruction already rejected this contradiction. This affected usage totals, account spend windows and optimization evidence.

Contract source (checked 2026-10-08): OpenRouter's [official Analytics Query reference, Response Fields](https://github.com/OpenRouterTeam/skills/blob/main/skills/openrouter-analytics-query/SKILL.md#response-fields) defines `data.metadata.row_count` as "Number of rows returned" and `truncated` as whether results were capped at the limit. Therefore a valid partial response retains `row_count === returned rows`; this field is not a pre-limit matching-total count. The candidate tests both a valid partial response and a contradictory partial response. The [official endpoint reference](https://openrouter.ai/docs/api/api-reference/beta-analytics/query-analytics) additionally documents the query limit and nested response envelope.

A shared envelope validator now runs before every exact-range query returns and before every completeness assertion. It validates row shape, metadata shape, optional truncation type, and optional nonnegative safe-integer row counts against returned rows. Matching numeric-string row counts remain supported. Invalid evidence returns a sanitized error before totals, ranking, or optional provider lookups.

Missing metadata or null/missing truncation still means unknown. Explicit truncation remains partial. An empty result does not establish account-wide zero usage. This patch does not add retries, pagination, credentials, tools, or inferred time-bucket coverage. It does not claim that a count match alone proves upstream completeness.

The 19 new tests cover nested/flat envelopes, contradictory and invalid counts, malformed metadata, zero rows, complete/partial/unknown distinctions, and regression paths through usage, spend-window and optimization tools. The previous 107 tests still pass.

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

Requires **Node.js 22 or newer** (the locked Miniflare 4 test runtime requires it). For an independent new checkout, use `npm ci --ignore-scripts`, `npm run build`, `npm test`, and `npm run validate`. Tests never require a real Management Key or paid generation. Maintenance validation on 2026-10-11 passed on Node.js 22.22.2: fresh `npm ci --ignore-scripts --no-audit --no-fund`, `npm run build`, **126/126 synthetic tests**, and `npm run validate`. Invoking `bash snapshots/routerlens-0.3.3/scripts/build.sh` from the repository root produced byte-identical Worker and hosting-manifest outputs to the npm build. Worker tests explicitly disable outbound network access; other tests use injected synthetic clients and do not require real account access.

License: Apache-2.0. This is independent of and not endorsed by OpenRouter.
