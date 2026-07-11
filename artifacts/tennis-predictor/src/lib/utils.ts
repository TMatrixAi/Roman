import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatProbability(prob: number): string {
  return `${Math.round(prob)}%`
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return "Unknown"
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

export function formatQualityLabel(quality: number): string {
  if (quality >= 80) return "Excellent"
  if (quality >= 60) return "Strong"
  if (quality >= 40) return "Acceptable"
  if (quality >= 20) return "Limited"
  return "Poor"
}
