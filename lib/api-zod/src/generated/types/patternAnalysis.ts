/**
 * Generated for Task #12: correct-vs-incorrect pattern analysis types.
 */

export type EvidenceStrength = "Strong" | "Moderate" | "Weak" | "Insufficient";

export interface PatternSegment {
  dimension: string;
  value: string;
  n: number;
  correct: number;
  accuracy: number | null;
  logLoss: number | null;
  brier: number | null;
  ece: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  evidenceStrength: EvidenceStrength;
}

export interface PatternAnalysisRun {
  id: number;
  totalAnalyzed: number;
  segments: PatternSegment[];
  runKindsIncluded: string[];
  createdAt: string;
}
