/**
 * VoteChain Timezone & Date Formatting Utilities
 *
 * Enforces Indian Standard Time (IST, Asia/Kolkata, UTC+05:30) consistently across
 * the entire application for all election-related timestamps, scheduling displays,
 * voter portals, observer monitors, and audit trails.
 *
 * Invariant:
 * - Timestamps in the database are stored in UTC (standard ISO-8601).
 * - Timestamps displayed to administrators, voters, and observers are rendered in IST.
 * - Form input timestamps in datetime-local are interpreted as IST and converted to UTC.
 */

export const TIMEZONE_IST = "Asia/Kolkata";
export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // +05:30 in milliseconds

/**
 * Formats a Date, ISO string, or timestamp into human-readable Indian Standard Time (IST).
 * Output example: "15 Oct 2026, 09:00 IST"
 */
export function formatDateTimeIST(
  value: Date | string | number | null | undefined,
  options?: {
    includeSeconds?: boolean;
    dateOnly?: boolean;
    timeOnly?: boolean;
  }
): string {
  if (!value) return "N/A";
  const date = typeof value === "string" || typeof value === "number" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "Invalid date";

  if (options?.dateOnly) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: TIMEZONE_IST,
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date);
  }

  if (options?.timeOnly) {
    const timeFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: TIMEZONE_IST,
      hour: "2-digit",
      minute: "2-digit",
      second: options.includeSeconds ? "2-digit" : undefined,
      hour12: false,
    });
    return `${timeFormatter.format(date)} IST`;
  }

  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE_IST,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: options?.includeSeconds ? "2-digit" : undefined,
    hour12: false,
  });

  return `${formatter.format(date)} IST`;
}

/**
 * Formats time-only in IST.
 * Output example: "09:30:15 IST"
 */
export function formatTimeIST(
  value: Date | string | number | null | undefined,
  includeSeconds = true
): string {
  return formatDateTimeIST(value, { timeOnly: true, includeSeconds });
}

/**
 * Formats date-only in IST.
 * Output example: "15 Oct 2026"
 */
export function formatDateIST(value: Date | string | number | null | undefined): string {
  return formatDateTimeIST(value, { dateOnly: true });
}

/**
 * Interprets a datetime-local input string ("YYYY-MM-DDTHH:mm") as Indian Standard Time (IST)
 * and returns the corresponding Date object (which represents the exact instant in UTC).
 *
 * If the string already contains a timezone offset or Z, standard parsing is preserved.
 */
export function parseDatetimeLocalAsIST(value: string | Date | null | undefined): Date {
  if (!value) return new Date(NaN);
  if (value instanceof Date) return value;

  const trimmed = String(value).trim();
  if (!trimmed) return new Date(NaN);

  // If string matches "YYYY-MM-DDTHH:mm" or "YYYY-MM-DDTHH:mm:ss" without offset
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    const seconds = trimmed.length === 16 ? ":00" : "";
    return new Date(`${trimmed}${seconds}+05:30`);
  }

  return new Date(trimmed);
}

/**
 * Converts a Date object or UTC timestamp into an input-ready string for HTML <input type="datetime-local">
 * formatted in Indian Standard Time (IST).
 * Output example: "2026-10-15T09:00"
 */
export function toDatetimeLocalIST(value: Date | string | number | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" || typeof value === "number" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE_IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${getPart("year")}-${getPart("month")}-${getPart("day")}T${getPart("hour")}:${getPart("minute")}`;
}
