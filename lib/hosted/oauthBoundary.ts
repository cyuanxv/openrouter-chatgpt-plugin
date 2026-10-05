/**
 * Unwired, offline-tested foundation for the existing Next.js MCP server.
 * No routes, token issuer, remote discovery, credential storage, or production
 * activation live here. The current static-bearer route is intentionally unchanged.
 */
import { isIP } from "node:net";

export type ReadAction = "credits:read" | "analytics:read" | "keys:read";
const READ_ACTIONS: readonly ReadAction[] = ["credits:read", "analytics:read", "keys:read"];

export type OAuthPolicy = Readonly<{
  issuer: string;
  resource: string;
  jwksUrl: string;
  allowedClientIds: readonly string[];
  requiredScopes: readonly string[];
  algorithms: readonly ("ES256" | "RS256")[];
}>;
export type TenantPrincipal = Readonly<{
  issuer: string;
  subject: string;
  resource: string;
  clientId: string;
  sessionId: string;
  expiresAt: number;
  scopes: readonly string[];
}>;
export type AccountBinding = Readonly<{
  id: string;
  issuer: string;
  subject: string;
  resource: string;
  credentialReference: string;
  revision: number;
  state: "active" | "revoked";
  allowedClientIds: readonly string[];
  grants: readonly ReadAction[];
}>;
export type BindingRepository = {
  // Implementations must query authoritative state for each call, without stale caches.
  isSessionActive(principal: TenantPrincipal): Promise<boolean>;
  findForOwner(owner: Readonly<{ issuer: string; subject: string }>): Promise<AccountBinding | null>;
};
export class OAuthBoundaryError extends Error {
  constructor(readonly code: "invalid_configuration" | "invalid_token" | "forbidden") {
    super(code === "invalid_configuration" ? "Hosted authentication is not safely configured." : code === "invalid_token" ? "Invalid or expired authorization." : "This account operation is not authorized.");
    this.name = "OAuthBoundaryError";
  }
}

function validHttpsUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new OAuthBoundaryError("invalid_configuration"); }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      hostname.endsWith(".") || isIP(hostname) || !hostname.includes(".") || /(?:^|\.)(?:localhost|local|internal)$/.test(hostname)) {
    throw new OAuthBoundaryError("invalid_configuration");
  }
  return url;
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
export function assertTrustedOAuthPolicy(policy: OAuthPolicy) {
  const issuer = validHttpsUrl(policy.issuer);
  validHttpsUrl(policy.resource);
  const jwks = validHttpsUrl(policy.jwksUrl);
  if (jwks.origin !== issuer.origin || !Array.isArray(policy.algorithms) || !policy.algorithms.length ||
      policy.algorithms.some((algorithm) => !["ES256", "RS256"].includes(algorithm)) ||
      !Array.isArray(policy.allowedClientIds) || !policy.allowedClientIds.length || !policy.allowedClientIds.every(nonempty) ||
      !Array.isArray(policy.requiredScopes) || !policy.requiredScopes.length ||
      !policy.requiredScopes.every((scope) => nonempty(scope) && !/\s/.test(scope))) {
    throw new OAuthBoundaryError("invalid_configuration");
  }
}

/** The key set must be supplied by trusted server configuration, never a token or tool argument. */
export async function createOfflineOAuthBoundary(policyInput: OAuthPolicy, trustedPublicJwks: { keys: Array<Record<string, unknown>> }) {
  assertTrustedOAuthPolicy(policyInput);
  const policy = structuredClone(policyInput);
  const keyset = structuredClone(trustedPublicJwks);
  if (!Array.isArray(keyset.keys) || keyset.keys.length === 0) throw new OAuthBoundaryError("invalid_configuration");
  const kids = new Set<string>();
  for (const key of keyset.keys) {
    if (!key || typeof key !== "object" || !["RSA", "EC"].includes(String(key.kty)) ||
        !nonempty(key.kid) || kids.has(key.kid) ||
        ["d", "p", "q", "dp", "dq", "qi", "oth", "k"].some((field) => field in key) ||
        (key.use !== undefined && key.use !== "sig") ||
        (key.key_ops !== undefined && (!Array.isArray(key.key_ops) || key.key_ops.some((op) => op !== "verify")))) {
      throw new OAuthBoundaryError("invalid_configuration");
    }
    kids.add(key.kid);
  }
  const { jwtVerify, createLocalJWKSet } = await import("jose");
  const resolveKey = createLocalJWKSet(keyset);
  const principals = new WeakSet<object>();
  const assertCurrent = (principal: TenantPrincipal) => {
    if (!principal || !principals.has(principal) || principal.expiresAt <= Date.now() / 1000) throw new OAuthBoundaryError("invalid_token");
  };

  return Object.freeze({
    async verify(accessToken: string): Promise<TenantPrincipal> {
      try {
        if (!nonempty(accessToken) || accessToken.length > 16_384) throw new Error("invalid");
        const { payload, protectedHeader } = await jwtVerify(accessToken, resolveKey, {
          issuer: policy.issuer,
          audience: policy.resource,
          algorithms: [...policy.algorithms],
          requiredClaims: ["iss", "aud", "sub", "exp", "iat", "client_id"],
          clockTolerance: 0
        });
        // No caller-controlled JWKS URL, embedded key, or certificate URL is ever used.
        if (protectedHeader.jku !== undefined || protectedHeader.x5u !== undefined || protectedHeader.jwk !== undefined) throw new Error("invalid");
        const clientId = payload.client_id;
        const sessionId = payload.session_id ?? payload.sid;
        const scopes = typeof payload.scope === "string" ? payload.scope.split(/\s+/) : [];
        if (!nonempty(payload.sub) || !nonempty(clientId) || !policy.allowedClientIds.includes(clientId) ||
            !nonempty(sessionId) ||
            typeof payload.exp !== "number" || typeof payload.iat !== "number" || payload.iat > Date.now() / 1000) throw new Error("invalid");
        if (!policy.requiredScopes.every((scope) => scopes.includes(scope))) throw new OAuthBoundaryError("forbidden");
        const principal = Object.freeze({ issuer: policy.issuer, subject: payload.sub, resource: policy.resource, clientId, sessionId, expiresAt: payload.exp, scopes: Object.freeze([...new Set(scopes.filter(Boolean))]) });
        principals.add(principal);
        return principal;
      } catch (error) {
        if (error instanceof OAuthBoundaryError) throw error;
        // Never echo a JWT, claims, signature errors, or provider diagnostics.
        throw new OAuthBoundaryError("invalid_token");
      }
    },

    async authorize(principal: TenantPrincipal, action: ReadAction, repository: BindingRepository) {
      assertCurrent(principal);
      if (!READ_ACTIONS.includes(action)) throw new OAuthBoundaryError("forbidden");
      // Configuration scopes are authentication prerequisites, not an authority
      // to expand grants. This explicit umbrella covers only READ_ACTIONS.
      if (!principal.scopes.includes(action) && !principal.scopes.includes("routerlens:read")) {
        throw new OAuthBoundaryError("forbidden");
      }
      let binding: AccountBinding | null;
      try {
        if (await repository.isSessionActive(principal) !== true) throw new Error("revoked");
        binding = await repository.findForOwner({ issuer: principal.issuer, subject: principal.subject });
      } catch {
        throw new OAuthBoundaryError("forbidden");
      }
      assertCurrent(principal);
      if (!binding || binding.issuer !== principal.issuer || binding.subject !== principal.subject ||
          binding.resource !== principal.resource || binding.state !== "active" ||
          !Array.isArray(binding.allowedClientIds) || !binding.allowedClientIds.includes(principal.clientId) ||
          !Array.isArray(binding.grants) || !binding.grants.includes(action) ||
          !nonempty(binding.id) || !nonempty(binding.credentialReference) ||
          !Number.isSafeInteger(binding.revision) || binding.revision < 1) {
        throw new OAuthBoundaryError("forbidden");
      }
      // Internal capability descriptor only. The credential adapter must recheck
      // this revision atomically before use; no plaintext credential is returned.
      return Object.freeze({ bindingId: binding.id, credentialReference: binding.credentialReference, bindingRevision: binding.revision, issuer: principal.issuer, subject: principal.subject, action });
    }
  });
}
