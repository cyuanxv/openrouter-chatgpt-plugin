import { PublicError } from "./errors";

export type RangePreset = "today" | "yesterday" | "7d" | "30d";

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function partsInZone(date: Date, timeZone: string) {
  if (!isValidTimeZone(timeZone)) throw new PublicError("INVALID_TIMEZONE");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function offsetAt(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second)
  );
  return asUtc - date.getTime();
}

export function zonedLocalToUtc(localIso: string, timeZone: string): Date {
  const naive = new Date(`${localIso}Z`);
  if (Number.isNaN(naive.getTime())) throw new PublicError("INVALID_LOCAL_TIME");

  let utcMs = naive.getTime() - offsetAt(naive, timeZone);
  const corrected = new Date(utcMs);
  utcMs = naive.getTime() - offsetAt(corrected, timeZone);
  return new Date(utcMs);
}

export function dateStringInZone(date: Date, timeZone: string): string {
  const p = partsInZone(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** First instant of a local date, including days whose midnight is skipped by DST. */
export function startOfDayUtc(dateString: string, timeZone: string): Date {
  if (!isValidTimeZone(timeZone)) throw new PublicError("INVALID_TIMEZONE");
  const nominal = Date.parse(`${dateString}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString) || !Number.isFinite(nominal) || new Date(nominal).toISOString().slice(0, 10) !== dateString) {
    throw new PublicError("INVALID_LOCAL_TIME");
  }
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const localDate = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  let low = nominal - 48 * 3_600_000;
  let high = nominal + 48 * 3_600_000;
  while (high - low > 1) {
    const middle = Math.floor((high + low) / 2);
    if (localDate(middle) < dateString) low = middle;
    else high = middle;
  }
  // A date skipped by a timezone transition has the same boundary as its next date.
  return new Date(high);
}

export function addCalendarDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function resolveCalendarDaysRange(
  days: number,
  timeZone = "UTC",
  now = new Date()
): { start: string; end: string; startDate: string; endDateExclusive: string; timeZone: string } {
  if (!Number.isInteger(days) || days < 1) throw new PublicError("INVALID_DAYS");

  const today = dateStringInZone(now, timeZone);
  const startDate = addCalendarDays(today, -(days - 1));
  const endDateExclusive = addCalendarDays(today, 1);

  return {
    start: startOfDayUtc(startDate, timeZone).toISOString(),
    end: startOfDayUtc(endDateExclusive, timeZone).toISOString(),
    startDate,
    endDateExclusive,
    timeZone
  };
}

export function resolvePresetRange(
  preset: RangePreset,
  timeZone = "UTC",
  now = new Date()
): {
  start: string;
  end: string;
  startDate: string;
  endDateExclusive: string;
  label: string;
  timeZone: string;
} {
  const today = dateStringInZone(now, timeZone);
  const tomorrow = addCalendarDays(today, 1);

  let startDate = today;
  let endDateExclusive = tomorrow;

  if (preset === "yesterday") {
    startDate = addCalendarDays(today, -1);
    endDateExclusive = today;
  } else if (preset === "7d") {
    startDate = addCalendarDays(today, -6);
  } else if (preset === "30d") {
    startDate = addCalendarDays(today, -29);
  }

  return {
    start: startOfDayUtc(startDate, timeZone).toISOString(),
    end: startOfDayUtc(endDateExclusive, timeZone).toISOString(),
    startDate,
    endDateExclusive,
    label: preset,
    timeZone
  };
}

