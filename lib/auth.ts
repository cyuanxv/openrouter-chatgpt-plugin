import { createHash, timingSafeEqual } from "node:crypto";

/** Static-bearer auth for the existing private single-tenant bridge only. */
export function checkBearerAuth(request: Request, expected: string | undefined): Response | null {
  if (!expected || /\s/.test(expected)) {
    return new Response("Private MCP authentication is not configured", {
      status: 503,
      headers: { "Cache-Control": "no-store" }
    });
  }
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.length <= 8192 ? /^Bearer ([^\s]+)$/i.exec(authorization) : null;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!match || !timingSafeEqual(digest(match[1]), digest(expected))) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Bearer realm="RouterLens"',
        "Cache-Control": "no-store"
      }
    });
  }
  return null;
}
