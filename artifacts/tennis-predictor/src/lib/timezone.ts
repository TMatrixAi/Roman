/**
 * Every on-screen timestamp in this app renders in Eastern time (America/New_York), never the
 * viewer's implicit local timezone -- so two viewers in different timezones see the exact same
 * wall-clock time for the same event (a match start, a "last synced" moment, a prediction's
 * creation time, etc). All timestamps are still stored/compared in UTC everywhere else; these
 * helpers are render-time-only conversions.
 */
export const EASTERN_TIMEZONE = "America/New_York"

/** "Time TBD" when there's genuinely no confirmed timestamp -- never guessed or defaulted. */
const NO_TIMESTAMP_LABEL = "Time TBD"

/** e.g. "Jul 14, 11:10 AM ET" -- date + time together, for fixture start times. */
export function formatEasternDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return NO_TIMESTAMP_LABEL
  return (
    new Date(dateStr).toLocaleString("en-US", {
      timeZone: EASTERN_TIMEZONE,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }) + " ET"
  )
}

/** e.g. "Jul 14, 2026" -- date only, for created/scheduled/validation-range dates. */
export function formatEasternDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "Unknown"
  return new Date(dateStr).toLocaleDateString("en-US", {
    timeZone: EASTERN_TIMEZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

/** e.g. "11:10:42 AM ET" -- time only, for live "last synced/updated" style indicators. */
export function formatEasternClock(dateStr: string | null | undefined): string {
  if (!dateStr) return NO_TIMESTAMP_LABEL
  return new Date(dateStr).toLocaleTimeString("en-US", { timeZone: EASTERN_TIMEZONE }) + " ET"
}
