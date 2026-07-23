/**
 * Single source of truth for Upset Risk display across the entire app.
 * All pages must import from here — never hardcode risk colors inline.
 */

export type UpsetRiskTier = "LOW" | "MODERATE" | "HIGH" | "EXTREME"

/** Full badge label — must fit on mobile (wraps to two lines if needed, never truncated). */
export const UPSET_RISK_LABEL: Record<string, string> = {
  LOW: "LOW UPSET RISK",
  MODERATE: "MODERATE UPSET RISK",
  HIGH: "HIGH UPSET RISK",
  EXTREME: "EXTREME UPSET RISK",
}

/** Short label for compact table cells. */
export const UPSET_RISK_SHORT: Record<string, string> = {
  LOW: "Low",
  MODERATE: "Moderate",
  HIGH: "High",
  EXTREME: "Extreme",
}

/**
 * Tailwind classes for a bordered pill/badge.
 * Always use `box-sizing: border-box` and `max-w-full` on the container.
 *
 * LOW      → green
 * MODERATE → yellow (dark text on yellow bg)
 * HIGH     → orange (dark/contrast text)
 * EXTREME  → cherry-red with white text
 */
export const UPSET_RISK_BADGE_CLASS: Record<string, string> = {
  LOW: "bg-primary/10 text-primary border border-primary/30",
  MODERATE: "bg-warning/15 text-warning border border-warning/35",
  HIGH: "bg-warning/20 text-warning border border-warning/45",
  EXTREME: "bg-red-600/20 text-red-700 dark:text-red-400 border border-red-600/40",
}

/** Solid color dot, for use in tables and compact rows. */
export const UPSET_RISK_DOT_CLASS: Record<string, string> = {
  LOW: "bg-primary",
  MODERATE: "bg-warning",
  HIGH: "bg-warning",
  EXTREME: "bg-red-600",
}

/** Text-only color, for large numeric/label displays. */
export const UPSET_RISK_TEXT_CLASS: Record<string, string> = {
  LOW: "text-primary",
  MODERATE: "text-warning",
  HIGH: "text-warning",
  EXTREME: "text-red-600 dark:text-red-400",
}

/**
 * Full mobile-safe Upset Risk badge component class string.
 * Combine with a container that has `max-w-full box-border` and allows wrapping.
 */
export function upsetRiskBadgeClasses(tier: string): string {
  return [
    UPSET_RISK_BADGE_CLASS[tier] ?? "bg-muted text-muted-foreground border border-border",
    "inline-flex items-center justify-center text-center",
    "font-mono font-bold text-[10px] sm:text-[11px]",
    "tracking-widest uppercase leading-tight",
    "px-2 py-1 rounded-md",
    "max-w-full box-border whitespace-normal break-words",
  ].join(" ")
}
