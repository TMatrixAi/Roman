/**
 * Generated for Task #12: threshold evaluation types.
 */

export type ThresholdClassification = "Deploy" | "Continue shadow" | "Needs more data" | "Reject" | "Investigate";

export interface ThresholdEvalEntry {
  tierId: string;
  tierLabel: string;
  currentValue: number | string;
  candidateValue: number | string;
  isWidening: boolean;
  affectedN: number;
  currentAccuracy: number | null;
  candidateAccuracy: number | null;
  currentLogLoss: number | null;
  candidateLogLoss: number | null;
  accuracyDelta: number | null;
  logLossDelta: number | null;
  classification: ThresholdClassification;
  note: string;
}

export interface ThresholdEvaluationRun {
  id: number;
  totalGraded: number;
  thresholds: ThresholdEvalEntry[];
  createdAt: string;
}
