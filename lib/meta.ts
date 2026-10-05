export type AnalyticsMetaItem = {
  name?: string;
  display_label?: string;
  is_rate?: boolean;
  display_format?: string;
};

export type AnalyticsMeta = {
  metrics?: AnalyticsMetaItem[];
  dimensions?: AnalyticsMetaItem[];
  operators?: AnalyticsMetaItem[];
  granularities?: AnalyticsMetaItem[];
};

export function unwrapAnalyticsMeta(response: any): AnalyticsMeta {
  return (response?.data ?? response ?? {}) as AnalyticsMeta;
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
