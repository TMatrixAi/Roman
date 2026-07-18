/**
 * Generated for Task #12: optimizer run summary type.
 */

export interface OptimizerRunSummary {
  candidateConfigId: number;
  thresholdEvaluationId: number;
  walkForward: {
    foldsRun: number;
    foldIds: number[];
    skippedNoEligibleMatches: boolean;
    fallbackRate: number;
    warnings: string[];
  };
}
