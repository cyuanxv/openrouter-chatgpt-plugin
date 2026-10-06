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
