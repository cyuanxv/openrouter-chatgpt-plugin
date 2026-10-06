import { requiredNumber } from "./analytics";
import { PublicError } from "./errors";

const optionalNumber = (value: unknown) => value == null ? null : requiredNumber(value);
function optionalString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new PublicError("INVALID_RESPONSE");
  return value;
}
function optionalBoolean(value: unknown): boolean | null {
  if (value == null) return null;
  if (typeof value !== "boolean") throw new PublicError("INVALID_RESPONSE");
  return value;
}

export function normalizeKeyMetadata(value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new PublicError("INVALID_RESPONSE");
  const key = value as Record<string, unknown>;
  if (typeof key.hash !== "string" || key.hash.length === 0) throw new PublicError("INVALID_RESPONSE");
  return {
    hash: key.hash,
    name: optionalString(key.name ?? key.label),
    disabled: optionalBoolean(key.disabled),
    limit: optionalNumber(key.limit),
    limit_remaining: optionalNumber(key.limit_remaining),
    limit_reset: optionalString(key.limit_reset),
    expires_at: optionalString(key.expires_at),
    usage: requiredNumber(key.usage),
    usage_daily: optionalNumber(key.usage_daily),
    usage_weekly: optionalNumber(key.usage_weekly),
    usage_monthly: optionalNumber(key.usage_monthly),
    byok_usage: optionalNumber(key.byok_usage),
    include_byok_in_limit: optionalBoolean(key.include_byok_in_limit),
    workspace_id: optionalString(key.workspace_id)
  };
}
