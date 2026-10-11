import { PublicError } from "./errors";

export type AnalyticsMetaItem = {
  name?: string;
  display_label?: string;
  is_rate?: boolean;
  display_format?: string;
  value_type?: string;
};

export type AnalyticsMeta = {
  metrics?: AnalyticsMetaItem[];
  dimensions?: AnalyticsMetaItem[];
  operators?: AnalyticsMetaItem[];
  granularities?: AnalyticsMetaItem[];
};

export function unwrapAnalyticsMeta(response: any): AnalyticsMeta {
  const data = response?.data ?? response;
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.metrics) || data.metrics.length === 0) throw new PublicError("INVALID_RESPONSE");
  for (const section of ["metrics", "dimensions", "operators", "granularities"]) {
    const items = data[section];
    if (items === undefined) continue;
    if (!Array.isArray(items) || items.some((item: any) => !item || typeof item !== "object" || typeof item.name !== "string" || !/^[a-z][a-z0-9_]{0,127}$/.test(item.name ?? "") || (item.is_rate !== undefined && typeof item.is_rate !== "boolean") || (item.value_type !== undefined && !["scalar", "array"].includes(item.value_type)) || (item.display_format !== undefined && typeof item.display_format !== "string"))) throw new PublicError("INVALID_RESPONSE");
    if (new Set(items.map((item: AnalyticsMetaItem) => item.name)).size !== items.length) throw new PublicError("INVALID_RESPONSE");
  }
  return data as AnalyticsMeta;
}

export function namesOf(items: AnalyticsMetaItem[] | undefined): Set<string> {
  return new Set(
    (items ?? [])
      .map((item) => item?.name)
      .filter((name): name is string => Boolean(name))
  );
}

export function selectSupported(requested: string[], available: Set<string>): string[] {
  return requested.filter((name) => available.has(name));
}

