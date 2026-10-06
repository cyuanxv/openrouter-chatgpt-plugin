export async function GET() {
  return Response.json({
    ok: true,
    service: "routerlens-openrouter-mcp",
    version: "0.3.1",
    managementKeyConfigured: Boolean(process.env.OPENROUTER_MANAGEMENT_KEY),
    authConfigured: Boolean(process.env.MCP_AUTH_TOKEN),
    tools: 8
  });
}

