# HTTP authentication integration candidate

The existing Next `/api/mcp` route now delegates to one transport factory. The same factory runs verified JWT authentication, a request-scoped tenant client and the existing eight tool callbacks in loopback HTTP integration tests. This is an engineering candidate, not an enabled hosted OAuth release.

## Complete request path exercised

Synthetic ES256 access token → issuer/audience/client/session/scope checks → authoritative session and account binding → per-action single-use capability → gateway revision/revocation check → existing account-summary or yesterday-query callback → JSON-RPC HTTP result.

The test gateway returns only synthetic account data. Concurrent users cannot supply another subject via tool arguments. There is no shared Management Key fallback or bearer passthrough. Successful private MCP responses use `Cache-Control: no-store`. Public model functions are supplied separately from private account reads. After authentication, POST bodies are bounded to 256 KiB and five seconds, decoded as UTF-8 and checked before entering the transport library. Iterative validation rejects depths over 64 and non-finite numbers before transport reserialization. The installed SDK's JSON-RPC schema validates single messages or nonempty batches of up to 100 messages; its legacy 2025-03-26 batching remains supported. Malformed JSON returns a sanitized 400 parse error; invalid message structure also returns 400. Unsupported media, oversized bodies and unsupported methods receive 415, 413 and 405 respectively. The validated bytes are replayed through a fresh request stream.

## Deployment behavior

- Unset `MCP_AUTH_MODE` or `single-tenant` retains the existing static-bearer bridge
- Any other value, including `oauth`, returns HTTP 503 until an explicit reviewed provider/storage adapter is supplied
- The Next protected-resource metadata route returns 404 for the static bridge and 503 for an unconfigured hosted deployment
- A constructed hosted router publishes only its trusted issuer/resource metadata; forwarded request headers cannot select them
- No token issuer, consent flow, client registration, remote JWKS fetcher or production credential store is added

Production-build smoke verifies the existing static bridge and that setting the OAuth flag cannot use the static bearer as a fallback. Loopback HTTP tests exercise real MCP initialize/list/call messages, synthetic yesterday spending, concurrent tenant separation and revocation before account access.

## Decisions and adapters still required

The deployed reviewed source is commit `41fd6a55314cc644a3c95c76c5f2064c7a02cfda`. This candidate must be reviewed separately before any further deployment. The new Vercel service has no real authentication or upstream credentials configured.

A real hosted release needs a selected identity project, a fixed MCP resource URL, actual host-compatible consent/PKCE/client integration, trusted signing-key rotation, and a transactional credential adapter. Selecting a provider does not itself authorize registering persistent OAuth clients, writing credentials, or changing deployment protection.

Supabase remains a candidate rather than a selected provider. Its standard OIDC scopes are not RouterLens account permissions. If selected, its signed audience/permission claims and per-client user consent must be designed and verified explicitly; accepting `openid` as Analytics permission is not a valid shortcut.
