import { createMcpHandler } from "mcp-handler";
import { JSONRPCMessageSchema } from "@modelcontextprotocol/sdk/types.js";
import { checkBearerAuth } from "./auth";
import { registerRouterLensTools, type RouterLensToolClient } from "./tools";
import { createOfflineOAuthBoundary, OAuthBoundaryError, type OAuthPolicy, type BindingRepository } from "./hosted/oauthBoundary";
import { createRequestScopedReadClient, type CredentialReadGateway } from "./hosted/readClient";
import { createResourceProtocol } from "./hosted/resourceProtocol";

type RouterConfig =
  | { mode: "single-tenant"; getBearer: () => string | undefined }
  | { mode: "unconfigured" }
  | { mode: "oauth"; policy: OAuthPolicy; publicJwks: { keys: Array<Record<string, unknown>> }; repository: BindingRepository; gateway: CredentialReadGateway; publicClient: Pick<RouterLensToolClient, "listModels" | "getModelEndpoints"> };

const unavailable = () => Response.json({ error: "authentication_not_configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
const privateResponse = (response: Response) => {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
const inputError = (status: number, code: number, message: string) => Response.json(
  { jsonrpc: "2.0", id: null, error: { code, message } },
  { status, headers: { "Cache-Control": "no-store" } }
);
function isBoundedMcpMessage(value: unknown): boolean {
  // JSON.parse accepts extreme nesting and numeric overflow; the transport's
  // subsequent JSON.stringify must never receive either. This walk is iterative.
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 1 }];
  while (pending.length) {
    const item = pending.pop()!;
    if (item.depth > 64 || (typeof item.value === "number" && !Number.isFinite(item.value))) return false;
    if (item.value && typeof item.value === "object") {
      for (const child of Object.values(item.value)) pending.push({ value: child, depth: item.depth + 1 });
    }
  }
  // Preserve the installed transport's JSON-RPC variants and legacy batch
  // support, rather than inventing a narrower request-only message grammar.
  const messages = Array.isArray(value) ? value : [value];
  return messages.length > 0 && messages.length <= 100 && messages.every((message) => JSONRPCMessageSchema.safeParse(message).success);
}

/** mcp-handler parses JSON before its internal error guard. Validate a bounded
 * copy first, then give the handler a fresh stream rather than a consumed body. */
async function prepareMcpRequest(request: Request): Promise<Request | Response> {
  if (request.method !== "POST") return request;
  const rejectUnread = (status: number, message: string) => {
    void request.body?.cancel().catch(() => {});
    return inputError(status, -32600, message);
  };
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return rejectUnread(415, "Content-Type must be application/json.");
  const limit = 256 * 1024;
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > limit) return rejectUnread(413, "Request body is too large.");
  if (!request.body) return inputError(400, -32700, "Parse error.");
  const reader = request.body.getReader();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let stop: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    stop = () => reject(new Error("interrupted"));
    timeout = setTimeout(stop, 5000);
    request.signal.addEventListener("abort", stop, { once: true });
    if (request.signal.aborted) stop();
  });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), interrupted]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) return inputError(413, -32600, "Request body is too large.");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { return inputError(400, -32700, "Parse error."); }
    if (!isBoundedMcpMessage(parsed)) return inputError(400, -32600, "Invalid or excessively nested MCP request.");
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    return new Request(request.url, { method: request.method, headers, body: bytes, signal: request.signal });
  } catch {
    return inputError(408, -32600, "Request body could not be read.");
  } finally {
    if (timeout) clearTimeout(timeout);
    if (stop) request.signal.removeEventListener("abort", stop);
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* Cancellation may still be settling. */ }
  }
}
const handlerFor = (client?: RouterLensToolClient) => createMcpHandler(
  (server) => registerRouterLensTools(server, client), {},
  { basePath: "/api", maxDuration: 60, verboseLogs: false, disableSse: true }
);

/** One HTTP entry point for the private bridge and an explicitly supplied hosted
 * adapter. Does not create an issuer, remote JWKS loader or credential store. */
export function createRouterLensRoutes(config: RouterConfig) {
  const singleTenantHandler = config.mode === "single-tenant" ? handlerFor() : null;
  const ready = config.mode === "oauth" ? (async () => {
    if (new URL(config.policy.resource).pathname !== "/api/mcp") throw new OAuthBoundaryError("invalid_configuration");
    const protocol = createResourceProtocol(config.policy);
    const boundary = await createOfflineOAuthBoundary(config.policy, config.publicJwks);
    return { protocol, boundary };
  })().catch(() => null) : Promise.resolve(null);

  return Object.freeze({
    async metadata() {
      if (config.mode === "single-tenant") return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
      const context = await ready;
      return context ? context.protocol.metadata() : unavailable();
    },
    options() {
      return new Response(null, { status: 204, headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS"
      } });
    },
    async handle(request: Request): Promise<Response> {
      if (!["GET", "POST", "DELETE"].includes(request.method)) {
        const response = inputError(405, -32600, "Method not allowed.");
        response.headers.set("Allow", "GET, POST, DELETE, OPTIONS");
        return response;
      }
      if (config.mode === "unconfigured") return unavailable();
      if (config.mode === "single-tenant") {
        const failure = checkBearerAuth(request, config.getBearer());
        if (failure) return failure;
        const prepared = await prepareMcpRequest(request);
        return prepared instanceof Response ? prepared : privateResponse(await singleTenantHandler!(prepared));
      }
      const context = await ready;
      if (!context) return unavailable();
      const authorization = request.headers.get("authorization") ?? "";
      const match = authorization.length <= 16_392 ? /^Bearer ([^\s]+)$/i.exec(authorization) : null;
      if (!match) return context.protocol.challenge(401);
      try {
        const principal = await context.boundary.verify(match[1]);
        if (await config.repository.isSessionActive(principal) !== true) return context.protocol.challenge(403);
        const prepared = await prepareMcpRequest(request);
        if (prepared instanceof Response) return prepared;
        const account = createRequestScopedReadClient(context.boundary, principal, config.repository, config.gateway);
        const client: RouterLensToolClient = {
          ...account,
          listModels: config.publicClient.listModels,
          getModelEndpoints: config.publicClient.getModelEndpoints,
          status: () => ({ management_key_configured: null, mode: "hosted-request-scoped", authentication_verified: true })
        };
        // Only this verified request's client is captured; no global principal,
        // shared management-key fallback or bearer passthrough is used.
        return privateResponse(await handlerFor(client)(prepared));
      } catch (error) {
        if (error instanceof OAuthBoundaryError) return error.code === "invalid_configuration" ? unavailable() : context.protocol.challenge(error.code === "invalid_token" ? 401 : 403);
        return Response.json({ error: "request_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
      }
    }
  });
}

/** Hosted activation requires a reviewed provider/storage adapter. Merely
 * setting an environment flag never falls back to the shared account key. */
const mode = process.env.MCP_AUTH_MODE;
export const serverRoutes = createRouterLensRoutes(mode === undefined || mode === "single-tenant"
  ? { mode: "single-tenant", getBearer: () => process.env.MCP_AUTH_TOKEN }
  : { mode: "unconfigured" });
