# Unwired request and protocol contracts

These source helpers extend the existing Next.js/mcp-handler design. They add no route, OAuth provider, database, credential, or deployment. The static-bearer production route and official-only default plugin package remain unchanged.

## Request-scoped account reads

`createRequestScopedReadClient` is constructed per verified principal. Each of its four upstream primitives (credits, analytics metadata, analytics query, key metadata) obtains a fresh action-specific authorization from the OAuth boundary. There are no arbitrary URLs/methods, key writes, billable generation calls, network implementation, or process-wide credential fallback.

Inputs are cloned before asynchronous authorization, so changing a caller's query afterward cannot alter an in-flight operation. Two concurrent users retain separate principals and references. No shared mutable global credential is used.

The gateway receives a temporary internal capability and an opaque credential reference. Only a capability minted by this client and associated with its exact principal and matching read operation can pass `assertGatewayAccess`. A successful assertion synchronously consumes it before any asynchronous credential use. Copied, handcrafted, serialized, concurrently reused, or replayed descriptors are not accepted; retrying requires fresh authorization. This is an in-process guard, not a cross-service credential or bearer token.

## Check again at credential use

The future `executeIfCurrent` adapter must read authoritative session and binding state and atomically recheck it before resolving a credential and issuing its permitted read. `assertGatewayAccess` checks active session, token expiry and scope, owner/issuer/resource/client, current binding revision and credential reference, active state, and the matching read grant. A revision change, disconnect, ownership mismatch, or client revocation blocks the operation.

No production transaction/vault adapter is provided yet. Calling the assertion outside a transaction does not remove a database race. The synthetic gateway tests perform the check and mocked read as one synchronous decision. A real adapter must preserve that property using its storage system, and establish how disconnect affects already in-flight upstream calls. It must also keep all plaintext credentials out of results and diagnostics.

## Resource metadata and challenges

`createResourceProtocol` uses the existing mcp-handler metadata generator. It prepares RFC 9728 resource metadata for a trusted configured resource and issuer, header-only Bearer authentication, and configured supported scopes. It creates standard 401/403 challenges with the exact metadata URL and explicit scopes. Incoming Host/forwarding headers are not inputs. Unsafe URLs, malformed/header-injection scopes, empty challenges, and unsupported challenge scopes are rejected.

This does not mount a well-known endpoint or enable OAuth. The final adapter must select meaningful application read scopes, serve discovery at the advertised path, and demonstrate discovery, consent/PKCE, token validation, scope escalation/denial, and reconnect in the real MCP host. Identity-only OIDC scopes are never sufficient for RouterLens account authorization.

## Synthetic tool contracts

The regression suite now exercises all eight tool callbacks from parsed input through mocked OpenRouter responses and formatted results, including complete credits/spend windows, schema metadata, partial usage totals, Cost Doctor provider evidence, completed-day anomaly coverage, key-metadata allowlisting, model comparison, and truthful status. This is callback/API-contract testing, not a live ChatGPT session, MCP HTTP transport test, or private account integration test.

All fixtures are synthetic. No real OpenRouter request, model generation, production credential, or remote state change is involved.
