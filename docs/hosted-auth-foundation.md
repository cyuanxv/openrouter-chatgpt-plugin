# Unwired hosted authentication foundation

This is a source-only, offline-tested foundation for the existing Next.js / mcp-handler / Vercel application. It is not an OAuth server, production middleware, hosted login flow, credential vault, or enabled Analytics connection. No HTTP routes import this module. The current private endpoint still uses fail-closed static-bearer authentication, and the default plugin still excludes the private Analytics server.

## Implemented boundary

`lib/hosted/oauthBoundary.ts` uses the established `jose` verifier already present transitively in the application, now declared as an exact direct dependency. It accepts a trusted, public-only JWKS supplied by server configuration. It performs no discovery or network requests.

Verification requires an allowlisted asymmetric algorithm, valid signature, exact configured issuer, intended resource audience, nonempty subject, approved client ID, expiry, issued-at time, and a session identifier. Not-before is verified when present. Required configuration scopes are checked at verification. Every action must additionally intersect the verified token scopes with the active account-binding grant: its exact read scope, or the explicitly defined `routerlens:read` umbrella covering only credits/analytics/key-metadata reads. Changing required configuration scopes to `openid` or one read scope cannot grant other actions. User-editable metadata is never an authorization source. Symmetric/private JWKs, duplicated key IDs, caller-controlled `jku`/`x5u`/embedded `jwk`, missing claims, and unsafe source URL shapes fail closed.

The resulting frozen principal is recognized only by the verifier instance that created it. Copying or changing its fields cannot create an authorized principal.

Each read action rechecks an authoritative session callback and account-binding lookup. The binding must match issuer, subject, resource, approved client, active state, and a read-only grant. No principal supplied by a tool input, process-wide Management Key, stale binding cache, or user metadata is a fallback. Missing state, errors, expired principals, or revoked bindings deny access.

The returned descriptor contains only an opaque credential reference and binding revision for a future server-side adapter. It does not return or decrypt an upstream credential. That adapter must atomically check the revision again before credential use. Revocation after an authorization decision and before the upstream request remains an integration concern; this module does not claim to cancel in-flight work.

## JWKS and network boundary

The offline module cannot perform SSRF: it does not fetch URLs. The declared JWKS URL must be HTTPS, without embedded credentials/query/fragment, on the configured issuer origin, and cannot be an IP, local hostname, or trailing-dot hostname. Token-supplied key locations are rejected, never followed.

This URL validation is not a production DNS-rebinding defense. Before adding a remote JWKS loader, implement pinned trusted issuer discovery, strict destination allowlists, DNS/IP validation, redirect rejection, timeout/size limits, safe key rotation, and bounded public-key caching. Do not allow request fields, tool arguments, JWT headers, or user metadata to select the issuer/JWKS source. The module deliberately exposes no remote loader until that integration is approved and verified.

## Fit with the proposed provider

The original plan suggested Supabase OAuth 2.1; the user has not selected or provisioned it for this project. Retain Next.js and Vercel. A managed issuer should own login, consent, authorization-code/PKCE exchange, refresh and revocation; do not build another token-issuance service here.

Supabase's documented default audience is `authenticated`, and its standard OIDC scopes describe identity access rather than RouterLens data permissions. Those defaults alone are intentionally insufficient for this boundary. A Supabase adapter would need a resource-bound audience and approved application grants/consent, verified session status, and tenant-isolated credential storage. Custom Access Token Hooks can customize claims, but claiming scopes is not a substitute for genuine user consent. Do not enable the production route until that behavior is tested with the intended MCP host.

## Required decisions before activation

1. Select the managed OAuth issuer/project and stable public MCP resource URL. Recommendation: preserve the existing Next.js/Vercel service and evaluate the previously proposed Supabase Auth rather than changing frameworks.
2. Approve the exact MCP clients, supported resource scopes, consent text, and credential-retention/disconnect design.
3. Approve provider provisioning, any persistent access, and deployment separately through the normal secure flow. No real issuer, keys, client registration, tokens, database, or permission changes have been configured by this source patch.

## Remaining implementation gates

- Provider adapter with actual PKCE, discovery, redirect and consent behavior
- Protected-resource metadata and appropriate 401/403 challenges using the existing mcp-handler support
- Trusted remote JWKS retrieval, rotation, and live session invalidation
- Per-user encrypted credential storage with tenant policies and atomic revision checks
- Request-scoped tools that use the verified user's credential and never fall back to the current global Management Key
- Hosted login/cancel/expiry/reconnect/disconnect and two-user isolation tests
- Explicit approval, review, deployment and authenticated host acceptance before restoring Analytics in the plugin

## Validation

Tests generate ephemeral signing keys and synthetic JWTs in memory only, never logging or persisting them. They cover signature/issuer/audience/client/expiry/not-before, missing claims, weak algorithms, malicious key-source headers, unsafe source URLs, scope confusion, forged principals, cross-tenant rows, revoked sessions/bindings, stale-grant avoidance, error sanitization, and the unchanged production/default-plugin gates. No actual account credentials or paid model requests are used.

## Primary references, checked 2026-10-05

- [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [jose JWT verification](https://github.com/panva/jose/blob/main/docs/jwt/verify/functions/jwtVerify.md)
- [Supabase OAuth MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication)
- [Supabase token security and tenant policies](https://supabase.com/docs/guides/auth/oauth-server/token-security)
- [Supabase changelog](https://supabase.com/changelog)

The current Supabase changelog deprecates framework adapters, not the core middleware. No deprecated adapter or new framework is added here.
