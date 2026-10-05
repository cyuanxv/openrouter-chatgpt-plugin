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

function unauthorized() {
  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Bearer realm="RouterLens"'
    }
  });
}

async function withAuth(request: Request) {
  const expected = process.env.MCP_AUTH_TOKEN;
  if (!expected) {
    return new Response("MCP_AUTH_TOKEN is not configured", { status: 503 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${expected}`) {
    return unauthorized();
  }

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
