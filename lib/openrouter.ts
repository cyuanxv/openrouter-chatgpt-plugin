import { OpenRouterError, PublicError } from "./errors";

const BASE_URL = "https://openrouter.ai/api/v1";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  management?: boolean;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
};

function getCredential(management: boolean): string | undefined {
  return management
    ? process.env.OPENROUTER_MANAGEMENT_KEY
    : undefined;
}

export function hasManagementKey(): boolean {
  return Boolean(process.env.OPENROUTER_MANAGEMENT_KEY);
}

export async function openRouterRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const management = options.management ?? false;
  const credential = getCredential(management);

  if (management && !credential) {
    throw new PublicError("MISSING_MANAGEMENT_KEY");
  }

  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (credential) headers.Authorization = `Bearer ${credential}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(20_000)
  });

  if (!response.ok) {
    // Never retain or return upstream error bodies, which may contain private diagnostics.
    throw new OpenRouterError(response.status);
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new PublicError("INVALID_RESPONSE");
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new PublicError("INVALID_RESPONSE");
  }

  return parsed as T;
}

export type AnalyticsQuery = {
  metrics: string[];
  dimensions?: string[];
  filters?: Array<{
    field: string;
    operator: string;
    value: unknown;
    include_unset?: boolean;
  }>;
  granularity?: string;
  group_limit?: number;
  limit?: number;
  order_by?: { field: string; direction: "asc" | "desc" };
  time_range?: { start: string; end: string };
};

export async function getAnalyticsMeta() {
  return openRouterRequest<any>("/analytics/meta", { management: true });
}

export async function queryAnalytics(query: AnalyticsQuery) {
  return openRouterRequest<any>("/analytics/query", {
    method: "POST",
    management: true,
    body: query
  });
}

export async function getCredits() {
  return openRouterRequest<any>("/credits", { management: true });
}

export async function listKeys(
  input: {
    include_disabled?: boolean;
    offset?: number;
    workspace_id?: string;
  } = {}
) {
  return openRouterRequest<any>("/keys", {
    management: true,
    query: input
  });
}

export async function listModels(
  input: Record<string, string | number | boolean | undefined> = {}
) {
  return openRouterRequest<any>("/models", { query: input });
}

export async function getModelEndpoints(modelId: string) {
  const [author, ...slugParts] = modelId.split("/");
  if (!author || slugParts.length === 0) {
    throw new PublicError("INVALID_MODEL_ID");
  }

  const slug = slugParts.join("/");
  return openRouterRequest<any>(
    `/models/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/endpoints`
  );
}

