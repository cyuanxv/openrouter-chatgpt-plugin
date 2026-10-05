export type RangePreset = "today" | "yesterday" | "7d" | "30d";

function partsInZone(date: Date, timeZone: string) {
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
  if (Number.isNaN(naive.getTime())) throw new Error(`Invalid local datetime: ${localIso}`);

  let utcMs = naive.getTime() - offsetAt(naive, timeZone);
  const corrected = new Date(utcMs);
  utcMs = naive.getTime() - offsetAt(corrected, timeZone);
  return new Date(utcMs);
}

export function dateStringInZone(date: Date, timeZone: string): string {
  const p = partsInZone(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
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
  if (!Number.isInteger(days) || days < 1) throw new Error("days must be a positive integer");

  const today = dateStringInZone(now, timeZone);
  const startDate = addCalendarDays(today, -(days - 1));
  const endDateExclusive = addCalendarDays(today, 1);

  return {
    start: zonedLocalToUtc(`${startDate}T00:00:00`, timeZone).toISOString(),
    end: zonedLocalToUtc(`${endDateExclusive}T00:00:00`, timeZone).toISOString(),
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
    start: zonedLocalToUtc(`${startDate}T00:00:00`, timeZone).toISOString(),
    end: zonedLocalToUtc(`${endDateExclusive}T00:00:00`, timeZone).toISOString(),
    startDate,
    endDateExclusive,
    label: preset,
    timeZone
  };
}
