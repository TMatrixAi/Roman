import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { formatEasternDate } from "@/lib/timezone"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatProbability(prob: number): string {
  return `${Math.round(prob)}%`
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
