# RouterLens 0.4.0 public Worker candidate

Owner-private Sites MCP adapter and personal operations workspace. Service release 0.4.0 retains the eight reviewed analytics tools and adds twelve request, report and experiment operations. Source tool/analysis logic is reused from `cyuanxv/openrouter-chatgpt-plugin` commit `35f0c1349b28d29cd24db8272c3d3344fea99b04`; original Apache-2.0 license is retained.

Build: `npm run build`; test the built Worker with `npm test`; validate with `npm run validate`. Output is `dist/server/index.js` and `dist/.openai/hosting.json`.

The hosting dispatcher supplies trusted authenticated-user headers. Native access policy is owner-only; each tool call additionally requires a nonempty site-scoped user ID and the platform-verified owner's email. A service bypass credential does not create that identity. Protocol discovery contains no account data. Cross-origin browser tool requests are limited to the Site origin and ChatGPT.

The sole user-entered secret is `OPENROUTER_MANAGEMENT_KEY`, stored through Sites Settings → environment variables → secret. Do not send its value to the assistant or commit it. The key itself has administrative authority; this bridge exposes only GET credits, GET analytics metadata, POST analytics query, GET generation metadata, GET key metadata, and unauthenticated public model metadata. No key writes or paid model calls exist. Destinations are hardcoded OpenRouter URLs, redirects disabled, 20-second deadline and 4 MiB response limit. Missing credentials close private operations. Tools return allowlisted Key metadata and sanitize errors; this source emits no logs.

A configured flag is not a successful account test. This release reuses the existing source and authentication boundary. Source alone does not configure, reconnect or verify an account.


## Release 0.3.3: local-day anomalies

This private release is based on service 0.3.2 / Site v2 commit `bca082a848e2ff9c16e36704eab85a659f46b098`. It preserves the existing authentication, read-only API boundaries and environment. Publication status is recorded separately in the native Sites deployment receipt.

`analyze_cost_anomalies` supports only `UTC` and `Asia/Shanghai`. UTC retains its 30 analysis-day default and up to 90 analysis days. Shanghai defaults to 7 analysis days; the 7-day default baseline is unchanged. Shanghai analysis days plus baseline days must be at most 31; longer requests are rejected rather than shortened. Other timezone names, including DST and half-hour zones, are explicitly unsupported.

Shanghai makes exactly one existing read-only Analytics query through `queryExactRange`, for UTC hourly buckets bounded by local midnight. It reuses the shared completeness, range, numeric and duplicate-bucket validation before grouping by local date. The current local day and future dates are excluded. No paid generation or other API is used. The existing 20-second upstream timeout and error handling remain in force; failed calls produce an error rather than an empty or normal result.

A Shanghai day is known only with all 24 distinct explicit hourly buckets. Complete zero-valued buckets produce a known zero day; absent or partial bucket coverage produces an `unknown_days` entry and breaks the consecutive baseline. `truncated=false` proves returned-row completeness, not absent-hour zero usage. Sparse upstream responses may therefore yield unknown even when the existing aggregate tool can report observed spend. This conservative limit is intentional until the upstream API supplies independently verified absent-bucket semantics.

No model/provider dimensions are requested. Unexpected group fields, duplicate hours, out-of-range buckets, truncated/unknown completeness, malformed/underflowed cost strings and arithmetic overflow fail closed. Signed hourly adjustments are retained. A complete day with negative net spend is reported as unknown (`unsupported_negative_net`) with its original observed net amount; it breaks the baseline without discarding other days. Small representable decimal amounts are retained without rounding to cents; sums and threshold comparisons use bounded base-10 arithmetic, without arbitrary epsilon tolerances. Each daily row retains a `total_usage_decimal` string for exact comparison of the values actually received. Numeric display values remain finite JavaScript numbers; this is not a substitute for billing reconciliation.

Build and run synthetic checks with `npm ci --ignore-scripts`, `npm run build`, `npm test`, `npm run validate`. The added tests never contact the real account or run inference. Live feature acceptance is separate from these synthetic checks and must be recorded after deployment.

## Release 0.4.0: personal operations

- Request metadata listing with exact date/model/provider/key filters and explicit truncation; generation details omit prompts and response content. Generation metadata access depends on the upstream credential.
- Completed-period cost comparisons, weekly reports and daily anomaly reports. Empty or incomplete evidence remains unknown. Reports and delivery receipts persist in D1 (`DB`), with schema-only migrations in `drizzle/` copied into the deployment archive.
- Experiment plans and matched-case comparisons of quality, cost per accepted case and latency. Existing request costs and manual costs are labeled separately. This release executes no paid model calls and changes no production routing.
- Reports are generated idempotently by period. Claim delivery atomically before sending, then record the actual Telegram receipt. Failed/uncertain sends remain `unknown` and are not retried automatically. Persistently unknown daily checks are suppressed after the initial notice; normal daily checks remain silent.

Scheduled workflow: every Monday 09:00 Asia/Shanghai generate a weekly report; daily at 09:15 generate the previous day's anomaly report. For each report, check `payload.should_notify`, call `claim_report_delivery`, and send `payload.telegram_text` through the connected Telegram `default` Bot to the owner-selected `YOUR_TELEGRAM_CHAT_ALIAS` alias only when `claimed=true`. Record the returned message ID using `record_report_delivery`, then read the report back. If send outcome is uncertain, record `unknown`; never retry a potentially delivered message. Credentials belong in their existing connected services, never source or prompts. Schedules are separate cloud tasks; their existence and enabled state must be verified after deployment.

`npm run build`, `npm test`, and `npm run validate` verify the artifact and synthetic scenarios. `scripts/build.sh` delegates to the same build pipeline from any working directory. Synthetic tests do not prove live account or notification access; record production receipts separately.

This sanitized source snapshot is based on private source `7df2a2cc5bbf5b7f2af633a9d90b0baeabcf775f`. Replace identity, origin, Site project and Telegram destination placeholders before your own deployment. The historical directory name is retained. This is separate from the legacy root application.
