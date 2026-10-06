# Operations and release runbook

This is an unreleased source runbook. No step below grants permission to push, publish a plugin, deploy, provision a provider, change credentials, or alter access.

## Before an authorized release

1. Compare the current upstream commit with the reviewed patch baseline. Stop on conflicts or unexpected concurrent changes; do not force-push.
2. Re-run tests, typecheck, production build, transport smoke, package validation and targeted review on the exact final source.
3. Keep plugin identity, account/workspace scope, author, license, hosting identity and audience unchanged. Verify the latest plugin release before any guarded update.
4. Confirm the specific release/deployment target and required permission/secret changes. Never solve a 401 by weakening authentication or embedding a static bearer in a shared package.
5. Distinguish a default-package compatibility downgrade from restoring private Analytics. Hosted-only source must remain unwired until its live gates pass.

## Interpret signals correctly

- Public health `ok: true` indicates service liveness. Credential configuration booleans do not prove upstream access.
- HTTP 401 from the private MCP without a valid bearer is expected. Do not disable the auth gate.
- HTTP 503 indicates missing server-side authentication configuration. Keep the endpoint closed while the operator fixes secure configuration.
- MCP tool `isError: true` can arrive in a successful HTTP response. Inspect the MCP result, not HTTP status alone.
- Upstream authorization errors, rate limits, timeouts, malformed data and truncated analytics must produce explicit safe failure/incompleteness. Never turn unavailable data into a zero balance or no-usage conclusion.
- Daily anomalies currently use completed UTC days. The skipped-day count covers the requested calendar interval, including missing rows; a missing baseline is unknown.

## Safe evidence and rollback

Record source/release IDs, status codes, tool names, pass/fail counts and sanitized error categories. Do not retain bearer values, JWTs, Management Keys, raw upstream error bodies or private account payloads in issue/build logs.

For an authorized rollback, select a previously reviewed release and verify the same auth protections remain in place. Keep the private endpoint closed if safe auth cannot be established. Do not uninstall/reinstall or move to a different account/environment as an automatic recovery step.

## Hosted release requirements

Before enabling hosted OAuth, verify login/consent cancellation, PKCE exchange, issuer/resource/client/scope validation, key rotation, expiry, reconnect, two-user isolation, credential disconnect/deletion and revocation races in the intended host. The current in-process gateway guard is not a substitute for a transactional production credential store.

Community conduct/reporting contact details require maintainer confirmation before public release. The existing security policy already forbids posting secrets or private account data in public issues; do not invent a reporting email or promise a response SLA.
