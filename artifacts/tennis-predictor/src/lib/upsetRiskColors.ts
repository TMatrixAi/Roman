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
 * LOW      → green (strong readable green background/text)
 * MODERATE → yellow/amber (dark text on yellow background)
 * HIGH     → orange (dark/high-contrast text on orange background)
 * EXTREME  → cherry-red (white text on red background)
 */
export const UPSET_RISK_BADGE_CLASS: Record<string, string> = {
  LOW: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700",
  MODERATE: "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-900 dark:text-yellow-200 border border-yellow-300 dark:border-yellow-700",
  HIGH: "bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-200 border border-orange-300 dark:border-orange-700",
  EXTREME: "bg-red-600 dark:bg-red-700 text-white border border-red-700 dark:border-red-800",
}

/** Solid color dot, for use in tables and compact rows. */
export const UPSET_RISK_DOT_CLASS: Record<string, string> = {
  LOW: "bg-emerald-500",
  MODERATE: "bg-yellow-500",
  HIGH: "bg-orange-500",
  EXTREME: "bg-red-600",
}

/** Text-only color, for large numeric/label displays. */
export const UPSET_RISK_TEXT_CLASS: Record<string, string> = {
  LOW: "text-emerald-600 dark:text-emerald-400",
  MODERATE: "text-yellow-600 dark:text-yellow-400",
  HIGH: "text-orange-600 dark:text-orange-400",
  EXTREME: "text-red-600 dark:text-red-400",
}

/**
 * Full mobile-safe Upset Risk badge component class string.
 * Designed for mobile screens (320px-430px widths) with full label text always visible.
 * Wrapper container must have: max-w-full, box-sizing: border-box
 */
export function upsetRiskBadgeClasses(tier: string): string {
  return [
    UPSET_RISK_BADGE_CLASS[tier] ?? "bg-muted text-muted-foreground border border-border",
    "inline-block text-center",
    "font-mono font-bold text-xs sm:text-sm",
    "tracking-widest uppercase leading-snug",
    "px-2.5 py-1.5 rounded-md",
    // Mobile-safe constraints: never truncate, wrap if needed, max two lines
    "max-w-full box-border whitespace-normal break-words",
    "min-h-[2.25rem] sm:min-h-[2rem] flex items-center justify-center",
  ].join(" ")
}
