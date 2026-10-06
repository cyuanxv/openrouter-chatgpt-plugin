import { serverRoutes } from "../../../lib/mcpRuntime";

export const runtime = "nodejs";
export const maxDuration = 60;

export const OPTIONS = serverRoutes.options;
export const GET = serverRoutes.handle;
export const HEAD = serverRoutes.handle;
export const POST = serverRoutes.handle;
export const DELETE = serverRoutes.handle;
