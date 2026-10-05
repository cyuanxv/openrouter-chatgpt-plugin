import { checkBearerAuth } from "../../../lib/auth";
import { createMcpHandler } from "mcp-handler";
import { registerRouterLensTools } from "../../../lib/tools";

export const runtime = "nodejs";
export const maxDuration = 60;

const handler = createMcpHandler(
  (server) => {
    registerRouterLensTools(server);
  },
  {},
  {
    basePath: "/api",
    maxDuration: 60,
    verboseLogs: false
  }
);

async function withAuth(request: Request) {
  const failure = checkBearerAuth(request, process.env.MCP_AUTH_TOKEN);
  if (failure) return failure;
  return handler(request);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS"
    }
  });
}

export { withAuth as GET, withAuth as POST, withAuth as DELETE };

