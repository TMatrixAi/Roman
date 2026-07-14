import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { formatEasternDate } from "@/lib/timezone"
import { formatPercentage, type Percentage } from "@/lib/percentage"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Takes the branded `Percentage` type (see `@/lib/percentage`), not a plain `number` -- callers
 * must explicitly assert the field's scale via `asPercentage`/`fractionToPercentage` at the call
 * site before formatting. This is what would have caught the WIN PROB (ELO) double-scaling bug:
 * a value already on the 0-100 scale can't silently be passed through a stray `* 100`.
 */
export function formatProbability(prob: Percentage): string {
  return formatPercentage(prob, 0)
}

/** Renders in Eastern time -- see `@/lib/timezone` for why every on-screen date/time does. */
export function formatDate(dateStr: string): string {
  return formatEasternDate(dateStr)
}

export function formatQualityLabel(quality: number): string {
  if (quality >= 80) return "Excellent"
  if (quality >= 60) return "Strong"
  if (quality >= 40) return "Acceptable"
  if (quality >= 20) return "Limited"
  return "Poor"
}
