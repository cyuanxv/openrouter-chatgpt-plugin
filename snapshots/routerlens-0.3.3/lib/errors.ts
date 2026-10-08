const SAFE_MESSAGES = {
  MISSING_MANAGEMENT_KEY: "This capability requires a Management Key configured securely on the RouterLens server.",
  INVALID_MODEL_ID: "model_id must look like author/model-slug.",
  INVALID_LOCAL_TIME: "Invalid local datetime.",
  INVALID_TIMEZONE: "Invalid timezone. Use a supported IANA timezone name.",
  INVALID_DAYS: "days must be a positive integer.",
  INVALID_RANGE: "time_range.start must be earlier than time_range.end.",
  INVALID_RESPONSE: "OpenRouter returned an invalid or incomplete response. No account total can be inferred.",
  MISSING_SPEND_METRIC: "OpenRouter Analytics currently does not expose total_usage for this account/schema.",
  INCOMPLETE_ANALYTICS: "OpenRouter returned incomplete analytics. Narrow the range or query again before drawing account-wide conclusions.",
  UNSUPPORTED_TIME_PRECISION: "The requested time bounds do not align with the query's UTC buckets. Use hour-aligned bounds for aggregates, or explicit minute/hour granularity with matching whole-minute/whole-hour bounds. Coarse day/week/month buckets require UTC-midnight bounds; sub-minute precision is not supported.",
  EXACT_RANGE_TOO_WIDE: "Exact minute/hour analysis is limited to 31 days. Narrow the requested interval.",
  NON_ADDITIVE_EXACT_RANGE: "This non-UTC-day interval needs hourly reconstruction, but rates or other non-additive metrics cannot be summed. Use explicit hour granularity and interpret those metrics per row, or request additive metrics only.",
  LABEL_GROUP_EXACT_RANGE: "Exact aggregate grouping by returned API-key/app/user/workspace labels is ambiguous. Use explicit hour granularity, or filter by the verified ID/hash and group by model/provider instead.",
  METRIC_FILTER_EXACT_RANGE: "Metric filters cannot safely be reapplied to hourly reconstruction. Use dimension filters only, or explicit hour granularity for per-hour metric filters.",
  ANALYTICS_WARNINGS: "OpenRouter reported an analytics warning, so filter resolution or completeness may be unreliable. Verify the filter IDs and retry; no exact total is reported.",
  UNSUPPORTED_ANOMALY_TIMEZONE: "Daily anomaly detection supports UTC and Asia/Shanghai only. Other timezones, including half-hour and DST timezones, are not approximated.",
  LOCAL_ANOMALY_RANGE_TOO_WIDE: "Asia/Shanghai anomaly analysis requires days plus baseline_days to be at most 31. The default is 7 analysis days plus 7 baseline days.",
  INVALID_ANOMALY_OPTIONS: "Invalid anomaly options. Check days, baseline_days and the finite nonnegative thresholds.",
  NON_UTC_DAILY_BUCKETS: "Daily anomaly detection currently requires UTC because the upstream API returns UTC day buckets. Local-day anomaly analysis is not yet supported."
} as const;

export class PublicError extends Error {
  constructor(readonly code: keyof typeof SAFE_MESSAGES) {
    super(SAFE_MESSAGES[code]);
    this.name = "PublicError";
  }
}

export class OpenRouterError extends Error {
  constructor(readonly status: number) {
    super(`OpenRouter HTTP ${status}`);
    this.name = "OpenRouterError";
  }
}

export function publicErrorMessage(error: unknown): string {
  if (error instanceof PublicError) return SAFE_MESSAGES[error.code];
  if (error instanceof OpenRouterError) {
    if (error.status === 401 || error.status === 403) {
      return "OpenRouter rejected the configured credential. Check the server's Management Key configuration.";
    }
    if (error.status === 400) {
      return "OpenRouter could not run this request. Check the live schema, filter values, and time range; try a narrower range when needed.";
    }
    if (error.status === 429) {
      return "OpenRouter rate-limited this request. Try again shortly.";
    }
    if (error.status === 408 || error.status === 504) {
      return "OpenRouter request timed out. Try a narrower query or retry shortly.";
    }
    return `OpenRouter request failed with HTTP ${error.status}.`;
  }
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return "OpenRouter request timed out. Try a narrower query or retry shortly.";
  }
  return "Unexpected error. Please try again or contact the server operator.";
}
