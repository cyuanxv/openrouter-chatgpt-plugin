/** Provider-independent request-scoped read contract. Unwired to production. */
import type { AnalyticsQuery } from "../openrouter";
import type { AccountBinding, BindingRepository, ReadAction, TenantPrincipal } from "./oauthBoundary";
import { createOfflineOAuthBoundary, OAuthBoundaryError } from "./oauthBoundary";

const issuedCapabilities = new WeakMap<object, TenantPrincipal>();

type Boundary = Awaited<ReturnType<typeof createOfflineOAuthBoundary>>;
export type ReadCapability = Awaited<ReturnType<Boundary["authorize"]>>;
export type ReadOperation =
  | Readonly<{ kind: "credits" }>
  | Readonly<{ kind: "analytics_meta" }>
  | Readonly<{ kind: "analytics_query"; query: AnalyticsQuery }>
  | Readonly<{ kind: "key_metadata"; options: { include_disabled?: boolean; offset?: number; workspace_id?: string } }>;

export type CredentialReadGateway = {
  /**
   * Must atomically recheck active session, binding owner/state/revision/grant
   * before resolving a credential reference and issuing the exact read operation.
   * Never return a plaintext credential or fall back to a process-wide key.
   * This interface does not provide a production vault/database implementation.
   */
  executeIfCurrent(input: Readonly<{ principal: TenantPrincipal; capability: ReadCapability; operation: ReadOperation }>): Promise<unknown>;
};

export function assertGatewayAccess(input: Readonly<{
  principal: TenantPrincipal;
  capability: ReadCapability;
  binding: AccountBinding | null;
  sessionActive: boolean;
  operation: ReadOperation;
}>): void {
  const { principal, capability, binding, sessionActive, operation } = input;
  const operationAction = ({ credits: "credits:read", analytics_meta: "analytics:read", analytics_query: "analytics:read", key_metadata: "keys:read" } as const)[operation?.kind];
  if (operationAction !== capability.action || issuedCapabilities.get(capability) !== principal || sessionActive !== true || principal.expiresAt <= Date.now() / 1000 ||
      principal.issuer !== capability.issuer || principal.subject !== capability.subject ||
      (!principal.scopes.includes(capability.action) && !principal.scopes.includes("routerlens:read")) ||
      !binding || binding.id !== capability.bindingId || binding.issuer !== capability.issuer ||
      binding.subject !== capability.subject || binding.resource !== principal.resource ||
      !Array.isArray(binding.allowedClientIds) || !binding.allowedClientIds.includes(principal.clientId) ||
      binding.revision !== capability.bindingRevision ||
      binding.credentialReference !== capability.credentialReference || binding.state !== "active" ||
      !Array.isArray(binding.grants) || !binding.grants.includes(capability.action)) throw new OAuthBoundaryError("forbidden");
  // Consume synchronously at the successful check, before any asynchronous
  // credential use. A retry must obtain fresh authorization and a new capability.
  issuedCapabilities.delete(capability);
}

/** Construct once per verified request, never once globally for multiple users. */
export function createRequestScopedReadClient(
  boundary: Boundary,
  principal: TenantPrincipal,
  repository: BindingRepository,
  gateway: CredentialReadGateway
) {
  const execute = async (action: ReadAction, operation: ReadOperation) => {
    // Copy before the first await so a caller cannot change a query during auth.
    const copiedOperation = Object.freeze(structuredClone(operation));
    const capability = await boundary.authorize(principal, action, repository);
    issuedCapabilities.set(capability, principal);
    try {
      return await gateway.executeIfCurrent(Object.freeze({ principal, capability, operation: copiedOperation }));
    } catch (error) {
      if (error instanceof OAuthBoundaryError) throw error;
      throw new Error("Hosted account read failed.");
    } finally {
      issuedCapabilities.delete(capability);
    }
  };
  return Object.freeze({
    getCredits: () => execute("credits:read", { kind: "credits" }),
    getAnalyticsMeta: () => execute("analytics:read", { kind: "analytics_meta" }),
    queryAnalytics: (query: AnalyticsQuery) => execute("analytics:read", { kind: "analytics_query", query }),
    listKeys: (options: { include_disabled?: boolean; offset?: number; workspace_id?: string } = {}) => execute("keys:read", { kind: "key_metadata", options })
  });
}
