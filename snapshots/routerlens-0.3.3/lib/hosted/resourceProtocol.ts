/** Static, unmounted protocol helpers for the existing mcp-handler application. */
import { generateProtectedResourceMetadata } from "mcp-handler";
import { assertTrustedOAuthPolicy, OAuthBoundaryError, type OAuthPolicy } from "./oauthBoundary";

export function createResourceProtocol(policy: OAuthPolicy) {
  assertTrustedOAuthPolicy(policy);
  const resource = new URL(policy.resource);
  const scopePattern = /^[!#-\[\]-~]+$/;
  const scopes = [...policy.requiredScopes];
  if (!scopes.length || scopes.some((scope) => typeof scope !== "string" || !scopePattern.test(scope) || /["\\]/.test(scope))) throw new OAuthBoundaryError("invalid_configuration");
  const resourceUrl = policy.resource;
  const issuer = policy.issuer;
  const metadataUrl = `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname === "/" ? "" : resource.pathname}`;
  const metadata = generateProtectedResourceMetadata({ authServerUrls: [issuer], resourceUrl, additionalMetadata: { scopes_supported: scopes, bearer_methods_supported: ["header"] } });
  const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };

  return Object.freeze({
    metadataUrl,
    metadata: () => Response.json(metadata, { headers: { ...noStore, "Access-Control-Allow-Origin": "*" } }),
    // Uses trusted configuration only, never Request/Host/X-Forwarded-* headers.
    challenge(status: 401 | 403, requiredScopes: readonly string[] = scopes) {
      if ((status !== 401 && status !== 403) || !requiredScopes.length || requiredScopes.some((scope) => !scopes.includes(scope))) throw new OAuthBoundaryError("invalid_configuration");
      const error = status === 401 ? "invalid_token" : "insufficient_scope";
      const scope = requiredScopes.join(" ");
      return Response.json({ error }, {
        status,
        headers: { ...noStore, "WWW-Authenticate": `Bearer error="${error}", resource_metadata="${metadataUrl}", scope="${scope}"` }
      });
    }
  });
}
