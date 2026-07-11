/**
 * Configurable prediction cutoff: how long before a match's scheduled start the pre-match
 * feature snapshot is frozen. Anything timestamped at or after (scheduledStart - cutoff) is
 * ineligible for that match's snapshot. Default is 30 minutes -- late enough to capture
 * same-day news (withdrawals, last-minute lineup info) without risking any in-match leakage.
 */
export type CutoffOption = "24h" | "12h" | "6h" | "1h" | "30min" | "15min";

export const CUTOFF_MINUTES: Record<CutoffOption, number> = {
  "24h": 24 * 60,
  "12h": 12 * 60,
  "6h": 6 * 60,
  "1h": 60,
  "30min": 30,
  "15min": 15,
};

export const DEFAULT_CUTOFF: CutoffOption = "30min";

export interface BackfillOptions {
  /** Inclusive, YYYY-MM-DD. */
  dateStart: string;
  /** Inclusive, YYYY-MM-DD. */
  dateStop: string;
  cutoff?: CutoffOption;
  /** Size of each provider request window, in days. Provider is known to fail on ~month-long windows. */
  chunkDays?: number;
}

export interface BackfillSummary {
  dateStart: string;
  dateStop: string;
  cutoff: CutoffOption;
  cutoffMinutes: number;
  fixturesFetched: number;
  matchesInserted: number;
  matchesSkippedDuplicate: number;
  matchesSkippedNoTerminalResult: number;
  featureRowsInserted: number;
  byTour: Record<string, number>;
  bySurface: Record<string, number>;
  earliestImportedMatchDate: string | null;
  latestImportedMatchDate: string | null;
  durationMs: number;
}
