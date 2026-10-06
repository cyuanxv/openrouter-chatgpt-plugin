# Restore authenticated private Analytics

Status: design and acceptance gates, not a deployed OAuth implementation.

## Immediate 0.3.1 compatibility downgrade

The default portable and compatibility packages include only the official OpenRouter MCP. This prevents a connection attempt to the private static-bearer Analytics endpoint without supported credentials. Existing self-hosted server authentication remains fail-closed. Removing the endpoint does not restore historical usage, cost analysis, or private key metadata. Official model/provider tools and the official `get-credits` tool remain available when authenticated.

Do not uninstall/reinstall to work around authentication. Do not place a static bearer or Management Key in a plugin manifest, issue, chat, log, or repository. Do not disable the endpoint's authentication.

## Delivery order

1. Keep a reproducible source patch and package regression suite; release only after review and explicit publication authorization.
2. Harden sanitized errors, analytics completeness, timezone boundaries, and offline tool regressions before restoring access.
3. Implement MCP resource-server authentication with an established OAuth provider. Supabase was discussed but is not selected or provisioned by this patch.
4. Replace the shared process-wide Management Key path with a per-user credential provider for hosted multi-user operation. Never make the existing single-tenant bridge public merely by adding OAuth.
5. Verify hosted login, tenant isolation, disconnect, expiry, reconnect, and account-summary/query/anomaly/optimization contracts in an authorized test environment.
6. Reintroduce Analytics to the default package only after an end-to-end authenticated host test succeeds. Recheck versions, metadata, and regression suite at that point.

## Authentication acceptance gates

The MCP resource server must advertise its authorization server via protected-resource metadata, use a scoped Bearer challenge, and verify token signature, issuer, intended audience/resource, expiry, and required scope on every request. Authorization code flows use PKCE. Treat OpenRouter's upstream Management Key and the client-facing MCP access token as separate credentials: never pass a client token through to OpenRouter.

An established authorization server must own consent, token issuance, client support, revocation, and refresh semantics. Its registration/discovery capabilities must be tested with the actual ChatGPT host. Merely returning an OAuth-looking header is not a secure or complete login flow.

After verification, derive the user identity from trusted claims. Do not accept a tool-supplied user ID as the tenant boundary. Fetch only that user's encrypted upstream credential through a server-side provider; keep decryption and HTTP use out of tool results. Disconnect must prevent subsequent credential access. Raw credential values and private usage must not appear in routine logs.

## Required tests before restoring Analytics

- Missing, invalid, expired, wrong-issuer, wrong-audience, or insufficient-scope tokens cannot call tools
- Discovery, PKCE, exact redirect handling, cancelled consent, expiry, and reconnect work in the intended host
- User A cannot obtain User B's balance, usage, key metadata, or credential
- Public model lookups receive no Management Key
- Upstream authorization/timeout/invalid payload failures expose only safe diagnostics
- Truncated analytics is identified as incomplete; partial rows are not presented as full account totals
- User timezone boundaries and DST behavior are tested; UTC time buckets are never relabeled as local-day totals
- No key-writing, default routing changes, paid inference, or expanded permissions are introduced

## Deployment gate

Reviewed source through commit 41fd6a5 is in draft PR #1 and has been deployed to a new credential-free Vercel service. It fails closed for private MCP requests. The subsequent [HTTP integration candidate](http-auth-integration.md) needs separate review before deployment. No OAuth client, production credential store or private Analytics connection has been created. Provider setup, persistent access, plugin publication and further deployment still require their applicable authorization and acceptance checks.

## Primary references (checked 2026-10-05)

- [OpenRouter official MCP tools and authentication](https://openrouter.ai/docs/guides/overview/mcp-server)
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [OpenRouter Analytics API overview](https://openrouter.ai/blog/announcements/activity-dashboard/)

These references describe protocol requirements. They do not demonstrate that RouterLens has implemented them.
