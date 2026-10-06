# RouterLens acceptance gates

Status: source changes and offline checks; not a published release or a restored private Analytics connection.

## Original MVP scenarios

The original product plan requires ten natural-language scenarios before Alpha acceptance. The current evidence does not yet meet that live-host bar.

| Scenario | Source/offline evidence | Live acceptance still required |
| --- | --- | --- |
| Remaining balance | Credit arithmetic fixture; official get-credits is documented | Authenticated host request, correct account |
| Yesterday's spend | Calendar-window fixture including timezone/DST boundaries | Complete live usage in the user's timezone |
| Seven-day cost analysis | Generic query and spend-window contracts | Live schema discovery, completeness and explanation |
| Top 30-day model spend | Complete Cost Doctor model ranking/share fixture | Real period/model totals and evidence |
| Highest-spend API key | Key metadata validation; generic query primitive | Discover actual key dimension and reconcile totals |
| Where tokens went | Token/cache query and optimization fixtures | Live metric availability and breakdown |
| Abnormal costs | Closed UTC days, gaps, zero baseline, truncation fixtures | Authorized live series; local-day anomaly support remains deferred |
| Savings opportunities | Same-model provider spread/cache evidence fixture | Actual usage/prices; no unsupported quality or savings claims |
| Cheap Vision model with context over 200K | Official model/provider workflow retained | Live official model search with those constraints |
| Analyze a generation ID | Official generation workflow retained | A user-selected authorized generation; no new billable generation needed |

All eight RouterLens callbacks are covered through input parsing, synthetic upstream responses, and result/error formatting. This does not count as ten natural-language host scenarios passing.

## Completed source checks

- npm test: unit, security, tenant/scope/revocation, concurrency, protocol-helper and all eight tool-callback contracts
- npm run typecheck and npm run build
- npm run test:transport: isolated production-build loopback server; missing/wrong Bearer 401, initialize, eight read-only tools, safe status, and missing auth configuration 503
- Portable manifest identity/version/interface and default MCP allowlist checks
- Package builder checks six contained regular files, exact archive content, and no credential headers or server artifacts

The transport smoke uses a clean synthetic environment, blocks non-loopback fetch calls and all redirects, and cleans up its owned child even if startup times out and SIGTERM is ignored. It exercises no private OpenRouter API or billable inference. It proves the existing static-bearer HTTP/MCP wrapper, not hosted OAuth.

## Blocking live release gates

- Review and release decisions beyond the existing [draft source PR](https://github.com/cyuanxv/openrouter-chatgpt-plugin/pull/1). Reviewed source through commit 41fd6a5 has been deployed to a new credential-free Vercel service; it rejects private MCP requests with 503 until authentication is configured
- Explicit release/deployment authorization and confirmation of the intended plugin's current release
- Selected OAuth issuer/project, fixed MCP resource URL, approved clients and application scopes
- Real consent/PKCE/discovery/session integration. The next HTTP integration candidate exercises protected-resource responses, JWT checks and tenant-scoped tool calls with synthetic data, but is not enabled with a real provider
- Tenant-isolated encrypted credential storage and disconnect/delete-credential behavior
- A production transactional credential adapter with revision checks and no global-key fallback
- Remote JWKS trust/rotation/SSRF protections and real host acceptance

Until these pass, the default 0.3.1 package is a compatibility downgrade. Private historical spend, Cost Doctor and key metadata are not restored. The offline hosted modules are not reachable from production routes.

## Remain out of this MVP repair

API-key writes, preset/guardrail/workspace management, default routing changes, automated reports/alerts, new dashboards, and billable model/media generation remain outside this repair. Keep the existing Apache-2.0 license and independent-project disclosure.
