export class OpenRouterError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
    this.body = body;
  }
}

export function publicErrorMessage(error: unknown): string {
  if (error instanceof OpenRouterError) {
    if (error.status === 401 || error.status === 403) {
      return "OpenRouter rejected the configured credential. Check OPENROUTER_MANAGEMENT_KEY.";
    }
    if (error.status === 429) {
      return "OpenRouter rate-limited this request. Try again shortly.";
    }
    return `OpenRouter request failed with HTTP ${error.status}.`;
  }
  if (error instanceof Error) return error.message;
  return "Unexpected error.";
}
