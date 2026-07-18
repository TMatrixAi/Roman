/**
 * Sprint Stage 2: Build versioned improvement candidates.
 *
 * This file inserts all candidate_configs rows for the three tracks defined in
 * docs/recent-form-specialists-serve-return-validation.md (Stage 1 audit).
 *
 * Tracks:
 *   1. Recent Form variants B–G (parameter-delta candidates against the production baseline A)
 *   2. Specialist model segment candidates (one per specialist_models row)
 *   3. Serve & Return variants A–I (all stored as Needs More Data per Stage 1 findings)
 *
 * Safety invariants:
 *   - All rows are inserted with status = "pending" (never "promoted" or "active")
 *   - No production code (dataQuality.ts, index.ts, recentForm.ts, serveReturn.ts) is modified
 *   - No walk-forward is triggered — specialist_models is already populated from a prior
 *     training-mode run (see §4.2 of the Stage 1 audit)
 */

import { db, candidateConfigsTable, specialistModelsTable } from "@workspace/db";
import { logger } from "../../lib/logger";

// ─── Production baseline constants (from current dataQuality.ts) ──────────────
const PROD_ENSEMBLE_WEIGHT = {
  surfaceElo: 1.5,
  serveReturn: 1.5,
  recentForm: 1.3,
  fatigue: 0.4,
  headToHead: 0.4,
  availability: 0.4,
  matchLoadRecovery: 0.3,
} as const;

const PROD_CONFIDENCE_SHRINK = {
  serveReturn: 0.45,
  recentForm: 0.35,
} as const;

// Stage 1 audit baseline metrics (Recent Form standalone — n=22,689 test predictions)
// Source: docs/recent-form-specialists-serve-return-validation.md §2.1
const RF_BASELINE_METRICS = {
  module: "recentForm",
  source: "Stage 1 audit — docs/recent-form-specialists-serve-return-validation.md §2.1",
  n: 22689,
  standaloneAccuracy: 60.32,
  logLoss: 0.684,
  brierScore: 0.2454,
  ece: 0.0854,
  avgEdgeFromFifty: 1.77,
  predictionsWithinTwoPpOfFifty: 66.6,
  ensembleGeneralAccuracy: 64.5,
  byTour: {
    ATP: { n: 1727, accuracy: 58.02, ci95: [55.7, 60.3] },
    WTA: { n: 1642, accuracy: 59.87, ci95: [57.5, 62.2] },
    Challenger: { n: 5736, accuracy: 58.63, ci95: [57.4, 59.9] },
    ITF: { n: 13317, accuracy: 61.57, ci95: [60.7, 62.4] },
  },
  bySurface: {
    Hard: { n: 12801, accuracy: 60.38 },
    Clay: { n: 8299, accuracy: 60.62 },
    IndoorHard: { n: 1532, accuracy: 57.96 },
    Grass: { n: 57, accuracy: 64.91, note: "n=57; wide CI, not reliable" },
  },
};

// Stage 1 audit baseline metrics (S&R — n=22,689 test predictions)
// Source: docs/recent-form-specialists-serve-return-validation.md §5
const SR_BASELINE_METRICS = {
  module: "serveReturn",
  source: "Stage 1 audit — docs/recent-form-specialists-serve-return-validation.md §5",
  n: 22689,
  proxyPathAccuracy: 64.42,
  realStatsPathAccuracy: 58.86,
  finding: "Gap fully explained by tournament-level confound (87% proxy path is ITF). Within same tour+level, paths perform similarly. No miscalibration requiring correction.",
  partialCorrelationWithOutcome: 0.19,
  eloPartialCorrelation: 0.16,
  eceByTour: { ITF: 0.0314, WTA: 0.0306, ATP: 0.0233, Challenger: 0.0180 },
};

// Active calibration model snapshot (id=82, from current DB)
const CALIBRATION_SNAPSHOT = {
  id: 82,
  method: "isotonic",
  validationSampleSize: 23023,
  isotonicHoldoutLogLoss: 0.63765,
  plattHoldoutLogLoss: 0.63802,
  holdoutSampleSize: 4605,
};

// ─── Track 1: Recent Form candidates B–G ────────────────────────────────────

/**
 * Six parameter-variant candidates for Recent Form defined in Stage 1 §2.5.
 * None modifies the live prediction path — these are stored as configuration
 * proposals for Stage 3 evaluation.
 */
async function insertRecentFormCandidates(): Promise<number[]> {
  const now = new Date().toISOString().slice(0, 10);
  const baseCalibration = CALIBRATION_SNAPSHOT;

  const candidates = [
    {
      name: `RF-B — Plain win-rate (${now})`,
      notes:
        "Recent Form Candidate B: Replace opponent-adjusted performance delta and S&R blend with a plain win-rate fraction (wins/10). Removes all quality adjustments. Tests whether algorithmic complexity adds net value vs. simple win/loss counting. Expected direction: lower accuracy on ITF (ranking-gap exploitation drops) but potentially cleaner signal on tour-level. Stage 1 audit found no evidence this dominates A; included to measure the complexity cost.",
      weightDiff: { recentForm: { from: PROD_ENSEMBLE_WEIGHT.recentForm, to: PROD_ENSEMBLE_WEIGHT.recentForm } },
      proposedConfig: {
        variant: "B",
        track: "recentForm",
        description: "Plain win-rate (wins/10, no opponent adjustment, no S&R blend, no tour shrink)",
        parameterDelta: {
          opponentAdjustment: { from: "enabled (performanceDelta)", to: "disabled (plain win/loss)" },
          serveReturnBlend: { from: "SERVE_RETURN_BLEND_WEIGHT=0.25", to: "0 (disabled)" },
          tourCredibilityShrink: { from: "TOUR_CREDIBILITY_FLOOR=0.35", to: "1.0 (disabled, no shrink)" },
          ensembleWeight: { from: PROD_ENSEMBLE_WEIGHT.recentForm, to: PROD_ENSEMBLE_WEIGHT.recentForm },
          confidenceShrink: { from: PROD_CONFIDENCE_SHRINK.recentForm, to: PROD_CONFIDENCE_SHRINK.recentForm },
        },
        hypothesis:
          "Tests if opponent-adjusted form score complexity adds value. A simpler count should score lower on tour-level (where form quality matters) but may reduce overfit on thin-sample players.",
        baselineA: RF_BASELINE_METRICS,
        baseProductionConfig: { calibration: baseCalibration, ensembleWeights: PROD_ENSEMBLE_WEIGHT, confidenceShrink: PROD_CONFIDENCE_SHRINK },
        status: "defined",
        stage1Finding: "Candidate defined in §2.5. No evidence from audit that it dominates A. Included for ablation baseline.",
      },
      holdoutMetrics: {
        baseCalibrationMethod: baseCalibration.method,
        baseIsotonicHoldoutLogLoss: baseCalibration.isotonicHoldoutLogLoss,
        basePlattHoldoutLogLoss: baseCalibration.plattHoldoutLogLoss,
        baseHoldoutSampleSize: baseCalibration.holdoutSampleSize,
        variantMetrics: "pending Stage 3 walk-forward evaluation",
      },
      validationMetrics: {
        baselineStandaloneAccuracy: RF_BASELINE_METRICS.standaloneAccuracy,
        baselineN: RF_BASELINE_METRICS.n,
        variantMetrics: "pending Stage 3 walk-forward evaluation",
        foldsRun: 0,
        stage: "candidate_defined",
      },
      acceptanceChecksPassed: false,
      acceptanceChecks: [
        { check: "stage3_evaluation_complete", passed: false, detail: "Walk-forward comparison against Candidate A not yet run (Stage 3)" },
        { check: "no_regression_vs_baseline", passed: false, detail: "Pending Stage 3 metrics" },
        { check: "sample_size_adequate", passed: true, detail: `Baseline n=${RF_BASELINE_METRICS.n} (adequate for comparison)` },
      ],
    },
    {
      name: `RF-C — Opponent-adjusted only, no S&R blend (${now})`,
      notes:
        "Recent Form Candidate C: Keep opponent-adjusted performance delta and tour-credibility shrink; remove the 25% S&R quality blend (SERVE_RETURN_BLEND_WEIGHT=0). Tests whether the S&R blend improves or degrades the form signal in isolation. The blend was added to reward clean wins over messy wins, but it may be partially double-counting S&R's ensemble vote.",
      weightDiff: { recentForm: { from: PROD_ENSEMBLE_WEIGHT.recentForm, to: PROD_ENSEMBLE_WEIGHT.recentForm } },
      proposedConfig: {
        variant: "C",
        track: "recentForm",
        description: "Opponent-adjusted only: performance delta without S&R blend; keeps tour-credibility shrink and recency decay",
        parameterDelta: {
          opponentAdjustment: { from: "enabled", to: "enabled (unchanged)" },
          serveReturnBlend: { from: "SERVE_RETURN_BLEND_WEIGHT=0.25", to: "0.0 (disabled)" },
          tourCredibilityShrink: { from: "TOUR_CREDIBILITY_FLOOR=0.35", to: "0.35 (unchanged)" },
          ensembleWeight: { from: PROD_ENSEMBLE_WEIGHT.recentForm, to: PROD_ENSEMBLE_WEIGHT.recentForm },
          confidenceShrink: { from: PROD_CONFIDENCE_SHRINK.recentForm, to: PROD_CONFIDENCE_SHRINK.recentForm },
        },
        hypothesis:
          "Tests whether the S&R blend adds signal or double-counts the separate S&R ensemble vote. Inter-module correlation RF↔S&R is 0.5573 (§2.1), partly structural due to the blend. Removing blend may reduce redundancy without losing directional signal.",
        stage1Finding: "S&R↔RF correlation r=0.5573, partly structural (SERVE_RETURN_BLEND_WEIGHT). Candidate defined in §2.5.",
        baselineA: RF_BASELINE_METRICS,
        baseProductionConfig: { calibration: baseCalibration, ensembleWeights: PROD_ENSEMBLE_WEIGHT, confidenceShrink: PROD_CONFIDENCE_SHRINK },
      },
      holdoutMetrics: {
        baseCalibrationMethod: baseCalibration.method,
        baseIsotonicHoldoutLogLoss: baseCalibration.isotonicHoldoutLogLoss,
        basePlattHoldoutLogLoss: baseCalibration.plattHoldoutLogLoss,
        baseHoldoutSampleSize: baseCalibration.holdoutSampleSize,
        variantMetrics: "pending Stage 3 walk-forward evaluation",
      },
      validationMetrics: {
        baselineStandaloneAccuracy: RF_BASELINE_METRICS.standaloneAccuracy,
        baselineN: RF_BASELINE_METRICS.n,
        variantMetrics: "pending Stage 3 walk-forward evaluation",
        foldsRun: 0,
        stage: "candidate_defined",
      },
      acceptanceChecksPassed: false,
      acceptanceChecks: [
        { check: "stage3_evaluation_complete", passed: false, detail: "Walk-forward comparison against Candidate A not yet run (Stage 3)" },
        { check: "no_regression_vs_baseline", passed: false, detail: "Pending Stage 3 metrics" },
        { check: "sample_size_adequate", passed: true, detail: `Baseline n=${RF_BASELINE_METRICS.n}` },
      ],
    },
    {
      name: `RF-D — Opponent-adjusted + recency, no tour-credibility shrink (${now})`,
      notes:
        "Recent Form Candidate D: Same as C (no S&R blend) but also removes TOUR_CREDIBILITY_FLOOR. Tests whether the tour-level shrink is net-positive on the current Challenger/ITF-heavy corpus (87% of proxy-path predictions are ITF). The shrink was added to prevent ITF form from translating too confidently to tour-level predictions; this candidate tests whether it's miscalibrated in the opposite direction on the actual corpus distribution.",
      weightDiff: { recentForm: { from: PROD_ENSEMBLE_WEIGHT.recentForm, to: PROD_ENSEMBLE_WEIGHT.recentForm } },
      proposedConfig: {
        variant: "D",
        track: "recentForm",
        description: "Opponent-adjusted + recency, no tour-credibility shrink, no S&R blend",
        parameterDelta: {
          opponentAdjustment: { from: "enabled", to: "enabled (unchanged)" },
          serveReturnBlend: { from: "SERVE_RETURN_BLEND_WEIGHT=0.25", to: "0.0 (disabled)" },
          tourCredibilityShrink: { from: "TOUR_CREDIBILITY_FLOOR=0.35", to: "1.0 (disabled — no shrink)" },
          ensembleWeight: { from: PROD_ENSEMBLE_WEIGHT.recentForm, to: PROD_ENSEMBLE_WEIGHT.recentForm },
          confidenceShrink: { from: PROD_CONFIDENCE_SHRINK.recentForm, to: PROD_CONFIDENCE_SHRINK.recentForm },
        },
        hypothesis:
          "TOUR_CREDIBILITY_FLOOR=0.35 shrinks Challenger/ITF form scores toward 50. With 87% of predictions coming from those tiers, this may over-suppress the module's contribution. Tests whether removing the floor improves ensemble accuracy on the full corpus.",
        stage1Finding: "ITF accuracy (61.57%) is highest per-tour. Tour shrink correct in direction but maybe too aggressive given corpus distribution. §3.4.",
        baselineA: RF_BASELINE_METRICS,
        baseProductionConfig: { calibration: baseCalibration, ensembleWeights: PROD_ENSEMBLE_WEIGHT, confidenceShrink: PROD_CONFIDENCE_SHRINK },
      },
      holdoutMetrics: {
        baseCalibrationMethod: baseCalibration.method,
        baseIsotonicHoldoutLogLoss: baseCalibration.isotonicHoldoutLogLoss,
        basePlattHoldoutLogLoss: baseCalibration.plattHoldoutLogLoss,
        baseHoldoutSampleSize: baseCalibration.holdoutSampleSize,
        variantMetrics: "pending Stage 3 walk-forward evaluation",
      },
      validationMetrics: {
        baselineStandaloneAccuracy: RF_BASELINE_METRICS.standaloneAccuracy,
        baselineN: RF_BASELINE_METRICS.n,
        variantMetrics: "pending Stage 3 walk-forward evaluation",
        foldsRun: 0,
        stage: "candidate_defined",
      },
      acceptanceChecksPassed: false,
      acceptanceChecks: [
        { check: "stage3_evaluation_complete", passed: false, detail: "Walk-forward comparison against Candidate A not yet run (Stage 3)" },
        { check: "no_regression_vs_baseline", passed: false, detail: "Pending Stage 3 metrics" },
        { check: "sample_size_adequate", passed: true, detail: `Baseline n=${RF_BASELINE_METRICS.n}` },
      ],
    },
    {
      name: `RF-E — Current A + surface-preference weighting (${now})`,
      notes:
        "Recent Form Candidate E: Add an explicit surface-affinity multiplier (1.3× weight) for wins on the same surface as the upcoming fixture, layered on top of the existing surface-mismatch deweight (0.7×). Tests whether a positive surface-match bonus (vs. just a mismatch penalty) improves Clay and Grass segments. Stage 1 found IndoorHard underperforms (57.96%) — a surface-specific form boost might help differentiate.",
      weightDiff: { recentForm: { from: PROD_ENSEMBLE_WEIGHT.recentForm, to: PROD_ENSEMBLE_WEIGHT.recentForm } },
      proposedConfig: {
        variant: "E",
        track: "recentForm",
        description: "Current A + surface-affinity multiplier (1.3× for same-surface wins, on top of existing 0.7× mismatch deweight)",
        parameterDelta: {
          surfaceMatchBoost: { from: "none (only 0.7× mismatch penalty for off-surface)", to: "1.3× bonus for same-surface wins" },
          everythingElse: "unchanged from production A",
          ensembleWeight: { from: PROD_ENSEMBLE_WEIGHT.recentForm, to: PROD_ENSEMBLE_WEIGHT.recentForm },
          confidenceShrink: { from: PROD_CONFIDENCE_SHRINK.recentForm, to: PROD_CONFIDENCE_SHRINK.recentForm },
        },
        hypothesis:
          "Clay and Grass specialist surfaces have distinct form patterns. Existing mismatch penalty (0.7×) already deweights off-surface matches; adding an affinity boost (1.3×) for on-surface wins may increase directional accuracy on those surfaces. IndoorHard underperform (57.96%) may benefit if surface specificity is the cause.",
        stage1Finding: "IndoorHard underperforms (57.96%) vs Hard (60.38%) and Clay (60.62%). Surface-specific form patterns may explain it. §2.3.",
        byTourMetrics: RF_BASELINE_METRICS.bySurface,
        baseProductionConfig: { calibration: baseCalibration, ensembleWeights: PROD_ENSEMBLE_WEIGHT, confidenceShrink: PROD_CONFIDENCE_SHRINK },
      },
      holdoutMetrics: {
        baseCalibrationMethod: baseCalibration.method,
        baseIsotonicHoldoutLogLoss: baseCalibration.isotonicHoldoutLogLoss,
        basePlattHoldoutLogLoss: baseCalibration.plattHoldoutLogLoss,
        baseHoldoutSampleSize: baseCalibration.holdoutSampleSize,
        variantMetrics: "pending Stage 3 walk-forward evaluation",
      },
      validationMetrics: {
        baselineStandaloneAccuracy: RF_BASELINE_METRICS.standaloneAccuracy,
        baselineN: RF_BASELINE_METRICS.n,
        bySurface: RF_BASELINE_METRICS.bySurface,
        variantMetrics: "pending Stage 3 walk-forward evaluation",
        foldsRun: 0,
        stage: "candidate_defined",
      },
      acceptanceChecksPassed: false,
      acceptanceChecks: [
        { check: "stage3_evaluation_complete", passed: false, detail: "Walk-forward comparison against Candidate A not yet run (Stage 3)" },
        { check: "no_regression_vs_baseline", passed: false, detail: "Pending Stage 3 metrics" },
        { check: "surface_segments_improve", passed: false, detail: "Pending Stage 3 — specific Clay/Grass/IndoorHard delta needed" },
      ],
    },
    {
      name: `RF-F — Reduced ensemble weight 1.3→0.65 (${now})`,
      notes:
        "Recent Form Candidate F: Reduce ENSEMBLE_WEIGHT_PRIOR.recentForm from 1.3 to 0.65 (half), keeping all other parameters identical to production A. Tests whether the module is currently overweighted in the ensemble given its near-50 edge concentration (66.6% of predictions within ≤2pp). The 2026-07-13 ablation found form at full weight produced +6pp accuracy when confirming Elo, but this was on a smaller corpus (n=8,865). With the expanded corpus (n=22,689) and the new Form-Elo conflict gate already applied in production, the effective weight contribution may be lower than the prior warrants.",
      weightDiff: { recentForm: { from: PROD_ENSEMBLE_WEIGHT.recentForm, to: 0.65 } },
      proposedConfig: {
        variant: "F",
        track: "recentForm",
        description: "Current A with ENSEMBLE_WEIGHT_PRIOR.recentForm reduced from 1.3 to 0.65",
        parameterDelta: {
          ensembleWeight: { from: PROD_ENSEMBLE_WEIGHT.recentForm, to: 0.65 },
          confidenceShrink: { from: PROD_CONFIDENCE_SHRINK.recentForm, to: PROD_CONFIDENCE_SHRINK.recentForm },
          everythingElse: "unchanged from production A",
        },
        hypothesis:
          "RF edge is concentrated near 50 (66.6% within ≤2pp). Reducing its weight from 1.3 to 0.65 reduces its influence on borderline predictions where it contributes noise rather than signal. The Form-Elo conflict gate already suppresses RF to 0.1 weight when conflicts, so the net change only affects confirming predictions.",
        rationale: "Prior audit found +6pp confirmation signal. With larger corpus and conflict gate active, weight may be oversized for the current distribution.",
        baselineMetrics: { predictionsWithinTwoPpOfFifty: RF_BASELINE_METRICS.predictionsWithinTwoPpOfFifty, avgEdge: RF_BASELINE_METRICS.avgEdgeFromFifty },
        baseProductionConfig: { calibration: baseCalibration, ensembleWeights: PROD_ENSEMBLE_WEIGHT, confidenceShrink: PROD_CONFIDENCE_SHRINK },
      },
      holdoutMetrics: {
        baseCalibrationMethod: baseCalibration.method,
        baseIsotonicHoldoutLogLoss: baseCalibration.isotonicHoldoutLogLoss,
        basePlattHoldoutLogLoss: baseCalibration.plattHoldoutLogLoss,
        baseHoldoutSampleSize: baseCalibration.holdoutSampleSize,
        variantMetrics: "pending Stage 3 walk-forward evaluation",
      },
      validationMetrics: {
        baselineStandaloneAccuracy: RF_BASELINE_METRICS.standaloneAccuracy,
        baselineN: RF_BASELINE_METRICS.n,
        variantMetrics: "pending Stage 3 walk-forward evaluation",
        foldsRun: 0,
        stage: "candidate_defined",
      },
      acceptanceChecksPassed: false,
      acceptanceChecks: [
        { check: "stage3_evaluation_complete", passed: false, detail: "Walk-forward comparison against Candidate A not yet run (Stage 3)" },
        { check: "no_regression_vs_baseline", passed: false, detail: "Pending Stage 3 metrics" },
        { check: "weight_in_valid_range", passed: true, detail: "0.65 is a positive weight (non-zero ensemble contribution retained)" },
      ],
    },
    {
      name: `RF-G — Removed from ensemble (weight=0) (${now})`,
      notes:
        "Recent Form Candidate G: Full ablation — set ENSEMBLE_WEIGHT_PRIOR.recentForm to 0, removing Recent Form from the ensemble vote entirely. This establishes the lower-bound ablation baseline: if the module contributes net-positive signal, removing it should degrade overall accuracy below the production baseline (64.5%). If it doesn't degrade accuracy, the module should be reconsidered. The 2026-07-13 ablation on n=8,865 found removing RF hurt accuracy; this candidate repeats that test on the expanded corpus (n=22,689) with the current Form-Elo conflict gate active.",
      weightDiff: { recentForm: { from: PROD_ENSEMBLE_WEIGHT.recentForm, to: 0 } },
      proposedConfig: {
        variant: "G",
        track: "recentForm",
        description: "Full ablation: ENSEMBLE_WEIGHT_PRIOR.recentForm = 0 (Recent Form removed from ensemble vote)",
        parameterDelta: {
          ensembleWeight: { from: PROD_ENSEMBLE_WEIGHT.recentForm, to: 0 },
          confidenceShrink: { from: PROD_CONFIDENCE_SHRINK.recentForm, to: PROD_CONFIDENCE_SHRINK.recentForm, note: "irrelevant when weight=0 but kept for schema completeness" },
          everythingElse: "unchanged from production A (Surface Elo, S&R, others at full weight)",
        },
        hypothesis:
          "Baseline ablation candidate. Removing RF entirely should degrade ensemble accuracy if RF contributes net-positive signal. The Form-Elo conflict gate (added in index.ts) already reduces RF weight to 0.1 in conflict scenarios, so the unconflicted-agreement scenarios are the ones whose signal we're measuring here.",
        regressionWarning: "If this candidate IMPROVES accuracy vs. production, it means the current RF weight (1.3) is overfit to the historical corpus — a major finding that would justify immediate weight reduction.",
        baseProductionConfig: { calibration: baseCalibration, ensembleWeights: PROD_ENSEMBLE_WEIGHT, confidenceShrink: PROD_CONFIDENCE_SHRINK },
      },
      holdoutMetrics: {
        baseCalibrationMethod: baseCalibration.method,
        baseIsotonicHoldoutLogLoss: baseCalibration.isotonicHoldoutLogLoss,
        basePlattHoldoutLogLoss: baseCalibration.plattHoldoutLogLoss,
        baseHoldoutSampleSize: baseCalibration.holdoutSampleSize,
        variantMetrics: "pending Stage 3 walk-forward evaluation",
      },
      validationMetrics: {
        baselineStandaloneAccuracy: RF_BASELINE_METRICS.standaloneAccuracy,
        baselineN: RF_BASELINE_METRICS.n,
        variantMetrics: "pending Stage 3 walk-forward evaluation",
        foldsRun: 0,
        stage: "candidate_defined",
      },
      acceptanceChecksPassed: false,
      acceptanceChecks: [
        { check: "stage3_evaluation_complete", passed: false, detail: "Walk-forward comparison against Candidate A not yet run (Stage 3)" },
        { check: "accuracy_below_production_baseline", passed: false, detail: "Pending Stage 3 — if accuracy is ABOVE 64.5%, this is a regression warning not a success" },
        { check: "ablation_interpretation", passed: false, detail: "This is a baseline ablation. Passing means it degrades accuracy (confirming RF's value), not that this should be promoted." },
      ],
    },
  ];

  const ids: number[] = [];
  for (const c of candidates) {
    const [row] = await db
      .insert(candidateConfigsTable)
      .values({
        name: c.name,
        notes: c.notes,
        status: "pending",
        sourceRunId: null,
        weightDiff: c.weightDiff as Record<string, unknown>,
        thresholdDiff: {},
        proposedConfig: c.proposedConfig as Record<string, unknown>,
        holdoutMetrics: c.holdoutMetrics as Record<string, unknown>,
        validationMetrics: c.validationMetrics as Record<string, unknown>,
        acceptanceChecksPassed: c.acceptanceChecksPassed,
        acceptanceChecks: c.acceptanceChecks,
      })
      .returning({ id: candidateConfigsTable.id });
    ids.push(row.id);
    logger.info({ id: row.id, name: c.name }, "Sprint Stage 2: inserted Recent Form candidate");
  }
  return ids;
}

// ─── Track 2: Specialist segment candidates ──────────────────────────────────

/**
 * One candidate_configs row per specialist_models row.
 * Active segments (meetsThreshold=true) carry their full training metrics.
 * Inactive segments (meetsThreshold=false) are stored as Needs More Data.
 */
async function insertSpecialistCandidates(): Promise<number[]> {
  const segments = await db.select().from(specialistModelsTable);
  const now = new Date().toISOString().slice(0, 10);
  const ids: number[] = [];

  for (const seg of segments) {
    const isActive = seg.meetsThreshold;
    const needsMoreData = !isActive;

    const name = needsMoreData
      ? `Specialist ${seg.segmentKey} — Needs More Data (${now})`
      : `Specialist ${seg.segmentKey} — Active segment (${now})`;

    const notes = needsMoreData
      ? `Specialist model for ${seg.label}. Segment has ${seg.historicalMatchCount} historical matches (clears MIN_HISTORICAL_MATCHES=150) but 0 validation samples in the current walk-forward window. The current evaluation window covers August 2025–February 2026 (indoor season); this segment's surface (${seg.surface}) is not covered in that window. A full 4-fold walk-forward extending through spring 2026 (Task #67) would recover validation samples for this segment. Status: Needs More Data — no specialist activation until validation samples clear MIN_VALIDATION_SAMPLES=30.`
      : `Specialist model for ${seg.label}. Trained on ${seg.validationSampleSize} validation-window predictions (n=${seg.historicalMatchCount} historical matches). Specialist accuracy ${seg.accuracy}% vs. general model ${seg.generalAccuracy}% on the same segment-scoped holdout. Ensemble blend weight ${seg.weight} (derived from measured log-loss improvement, not hand-tuned). Status: active in production engine via meets_threshold=true gate. This candidate_configs row documents the current trained state for Stage 3 audit and future comparison.`;

    const proposedConfig = needsMoreData
      ? {
          variant: "specialist_needs_more_data",
          segmentKey: seg.segmentKey,
          tour: seg.tour,
          surface: seg.surface,
          label: seg.label,
          historicalMatchCount: seg.historicalMatchCount,
          meetsThreshold: false,
          validationSampleSize: 0,
          reason: "Zero validation samples in current walk-forward window (Aug 2025–Feb 2026 indoor season). Surface not covered.",
          requiredFix: "Run 4-fold walk-forward extending through spring 2026 (Task #67) to recover Clay/Grass validation samples.",
          minHistoricalMatches: 150,
          minValidationSamples: 30,
          baseProductionConfig: { calibration: CALIBRATION_SNAPSHOT },
        }
      : {
          variant: "specialist_active",
          segmentKey: seg.segmentKey,
          tour: seg.tour,
          surface: seg.surface,
          label: seg.label,
          historicalMatchCount: seg.historicalMatchCount,
          meetsThreshold: true,
          validationSampleSize: seg.validationSampleSize,
          specialistAccuracy: seg.accuracy,
          specialistLogLoss: seg.logLoss,
          specialistBrier: seg.brier,
          generalAccuracy: seg.generalAccuracy,
          generalLogLoss: seg.generalLogLoss,
          generalBrier: seg.generalBrier,
          ensembleBlendWeight: seg.weight,
          calibrationMapping: seg.calibrationMapping,
          minHistoricalMatches: 150,
          minValidationSamples: 30,
          baseProductionConfig: { calibration: CALIBRATION_SNAPSHOT },
        };

    const validationMetrics = needsMoreData
      ? { status: "needs_more_data", validationSampleSize: 0, reason: "No validation samples in current walk-forward window" }
      : {
          status: "trained",
          validationSampleSize: seg.validationSampleSize,
          specialistAccuracy: seg.accuracy,
          specialistLogLoss: seg.logLoss,
          specialistBrier: seg.brier,
          generalAccuracy: seg.generalAccuracy,
          generalLogLoss: seg.generalLogLoss,
          generalBrier: seg.generalBrier,
          logLossImprovement: seg.generalLogLoss !== null && seg.logLoss !== null ? seg.generalLogLoss - seg.logLoss : null,
        };

    const holdoutMetrics = needsMoreData
      ? { status: "needs_more_data" }
      : {
          ensembleBlendWeight: seg.weight,
          specialistLogLoss: seg.logLoss,
          generalLogLoss: seg.generalLogLoss,
          note: "Holdout-validated via fitBestCalibration (isotonic vs. Platt, picked by held-out log loss)",
        };

    const acceptanceChecks = needsMoreData
      ? [
          { check: "min_historical_matches", passed: true, detail: `${seg.historicalMatchCount} >= 150 (threshold met)` },
          { check: "min_validation_samples", passed: false, detail: `0 < 30 (threshold not met — 0 validation samples in current window)` },
          { check: "stage3_evaluation_complete", passed: false, detail: "No validation data to evaluate until Task #67 walk-forward" },
        ]
      : [
          { check: "min_historical_matches", passed: true, detail: `${seg.historicalMatchCount} >= 150` },
          { check: "min_validation_samples", passed: true, detail: `${seg.validationSampleSize} >= 30` },
          { check: "specialist_beats_general_log_loss", passed: seg.logLoss !== null && seg.generalLogLoss !== null && seg.logLoss < seg.generalLogLoss, detail: seg.logLoss !== null && seg.generalLogLoss !== null ? `specialist logLoss ${seg.logLoss?.toFixed(4)} vs. general ${seg.generalLogLoss?.toFixed(4)}` : "log loss comparison unavailable" },
          { check: "weight_in_valid_range", passed: seg.weight > 0 && seg.weight <= 0.85, detail: `weight=${seg.weight}` },
          { check: "stage3_evaluation_complete", passed: false, detail: "Stage 3 walk-forward comparison pending" },
        ];

    const [row] = await db
      .insert(candidateConfigsTable)
      .values({
        name,
        notes,
        status: "pending",
        sourceRunId: null,
        weightDiff: needsMoreData
          ? { specialistWeight: { from: 0, to: 0, note: "no change — segment inactive" } }
          : { specialistWeight: { from: "N/A (first run)", to: seg.weight } },
        thresholdDiff: {},
        proposedConfig: proposedConfig as Record<string, unknown>,
        holdoutMetrics: holdoutMetrics as Record<string, unknown>,
        validationMetrics: validationMetrics as Record<string, unknown>,
        acceptanceChecksPassed: false,
        acceptanceChecks,
      })
      .returning({ id: candidateConfigsTable.id });
    ids.push(row.id);
    logger.info({ id: row.id, name }, "Sprint Stage 2: inserted specialist candidate");
  }
  return ids;
}

// ─── Track 3: Serve & Return candidates A–I (Needs More Data) ────────────────

/**
 * S&R variants A–I are stored as Needs More Data per Stage 1 audit findings.
 *
 * Stage 1 (§5, §6) found:
 *   - The proxy/real-stats accuracy gap (64.4% vs. 58.9%) is fully explained by a
 *     tournament-level confound (87% proxy path = ITF), not a module defect
 *   - ECE is well-behaved on real-stats path (0.018–0.023 on ATP/Challenger)
 *   - S&R retains substantial independent signal (partial r=0.19 after controlling for Elo)
 *   - No CONFIDENCE_SHRINK change is warranted based on this evidence
 *   - "No S&R or specialist pipeline candidates are required based on Stage 1 findings"
 *
 * Per the Sprint Stage 2 rule: "any variant the Stage 1 audit flags as 'insufficient data'
 * is documented as Needs More Data instead of built."
 */
async function insertServeReturnCandidates(): Promise<number[]> {
  const now = new Date().toISOString().slice(0, 10);
  const stage1Finding =
    "Stage 1 audit (§5, §6) found no miscalibration requiring correction. The proxy/real-stats accuracy gap (64.4% vs. 58.9%) is fully explained by a tournament-level confound. ECE is well-behaved (0.018–0.023) on ATP/Challenger (real-stats path). S&R retains substantial independent signal (partial r=0.19 after controlling for Surface Elo). No CONFIDENCE_SHRINK change is warranted. Per Stage 2 rule: variants without a clear evidence-based hypothesis from Stage 1 are stored as Needs More Data.";

  const srVariants = [
    {
      id: "A",
      description: "Recalibrated output only — apply a new S&R-specific calibration curve independently of the ensemble",
      hypothesis: "If S&R systematically misstates confidence, a per-module calibration could correct it.",
      finding: "Stage 1 found ECE is well-behaved (0.018–0.023) on the dominant real-stats path. No systematic confidence miscalibration found. CONFIDENCE_SHRINK.serveReturn=0.45 remains appropriate.",
    },
    {
      id: "B",
      description: "Edge cap — cap S&R's edge contribution at ±X pp to prevent extreme outliers from dominating the ensemble",
      hypothesis: "Extreme S&R edges (e.g. >15pp) may overstate predictive certainty on limited data.",
      finding: "Stage 1 found no evidence of extreme-edge overconfidence. S&R is one of the two highest-weighted modules (1.5) with the largest single-module CONFIDENCE_SHRINK (0.45). No edge cap warrants a build based on current evidence.",
    },
    {
      id: "C",
      description: "Reduced ensemble weight — lower ENSEMBLE_WEIGHT_PRIOR.serveReturn from 1.5",
      hypothesis: "S&R may be overweighted given the proxy-path accuracy confound.",
      finding: "Stage 1 found the accuracy confound is entirely tournament-level, not a module weight issue. Within same tour+level, S&R performs as well as Elo. Partial correlation (r=0.19) justifies current weight. No reduction warranted.",
    },
    {
      id: "D",
      description: "Tour-level weight reduction — reduce S&R weight specifically for ATP/WTA predictions",
      hypothesis: "S&R real-stats path accuracy is lower on ATP/WTA (58.9%) vs. ITF proxy (64.4%). A tour-specific weight could correct.",
      finding: "Stage 1 found the gap is entirely explained by the fact that the real-stats path covers harder matches (competitive parity). ATP/WTA real-stats accuracy (61.1%/61.6%) is BETTER than the overall 58.9% figure. The confound goes the opposite direction from the hypothesis. No tour weight reduction warranted.",
    },
    {
      id: "E",
      description: "Surface-specific calibration — fit separate S&R calibration curves per surface",
      hypothesis: "Serve/return characteristics differ substantially by surface (especially Grass). Surface-specific calibration could improve segment accuracy.",
      finding: "Stage 1 did not audit surface-specific S&R calibration separately. Insufficient evidence from Stage 1 to build this variant. The specialist pipeline already handles surface+tour corrections. Needs More Data — a dedicated surface-accuracy breakdown for S&R would be required first.",
    },
    {
      id: "F",
      description: "Minimum sample-size gate — require ≥N matches with real stats before using the real-stats path; else always use proxy",
      hypothesis: "The real-stats path (MIN_REAL_SAMPLE=3) activates on thin data and may overfit.",
      finding: "Stage 1 found MIN_REAL_SAMPLE=3 is already low. The proxy-path accuracy confound (ITF vs. tour-level) is the dominant signal, not sample-size overfit. Raising the gate would push more tour-level predictions to the proxy path, which performs WORSE on those (ATP proxy: 48.84%, n=129). No gate change warranted.",
    },
    {
      id: "G",
      description: "Remove firstServeWinPct blend — stop blendPointLevel from using firstServeWinPct (only 49.8% available)",
      hypothesis: "firstServeWinPct is only 49.8% available; blending on half-missing data may add noise.",
      finding: "Stage 1 found firstServeWinPct resolves independently via blendPointLevel and has no effect when null (already handled correctly). The other point-level fields (breakPointsConvertedPct=99.7%, serviceGamesHeldPct=100%) still apply when firstServeWinPct is absent. No change to blend logic warranted.",
    },
    {
      id: "H",
      description: "Increase POINT_LEVEL_BLEND_WEIGHT from 0.2 to 0.35 — give more weight to deeper break-point stats",
      hypothesis: "Break-point conversion and service games held are very complete (99.7%/100%) and may contain more signal than the current 20% blend weight captures.",
      finding: "Stage 1 did not produce a direct ablation of POINT_LEVEL_BLEND_WEIGHT vs. outcome accuracy. Insufficient evidence from Stage 1 to justify this change. Needs More Data — a dedicated point-level blend ablation would be required.",
    },
    {
      id: "I",
      description: "Remove S&R from ensemble entirely (weight=0) — full ablation baseline",
      hypothesis: "S&R's correlation with S&R↔Elo (r=0.45) may mean it's partially double-counting Elo. Full removal measures net independent contribution.",
      finding: "Stage 1 found partial r(S&R, outcome|Elo) = 0.19, confirming substantial independent signal. Removing S&R with weight 1.5 is the most aggressive change possible and is unjustified by Stage 1 findings. Existing 2026-07-13 ablation already showed removing S&R hurt accuracy. This ablation candidate is formally documented but is Needs More Data for a larger-corpus re-validation.",
    },
  ];

  const ids: number[] = [];
  for (const v of srVariants) {
    const [row] = await db
      .insert(candidateConfigsTable)
      .values({
        name: `SR-${v.id} — ${v.description.split(" — ")[0]} (${now})`,
        notes: `Serve & Return Candidate ${v.id}: ${v.description}.\n\nHypothesis: ${v.hypothesis}\n\nStage 1 finding: ${v.finding}\n\nStatus: Needs More Data — Stage 1 audit found no evidence-based hypothesis for this variant. No code implementation. Stored for documentation per Sprint Stage 2 spec.`,
        status: "pending",
        sourceRunId: null,
        weightDiff:
          v.id === "C"
            ? { serveReturn: { from: PROD_ENSEMBLE_WEIGHT.serveReturn, to: "TBD — pending Stage 3 definition" } }
            : v.id === "I"
              ? { serveReturn: { from: PROD_ENSEMBLE_WEIGHT.serveReturn, to: 0 } }
              : {},
        thresholdDiff: {},
        proposedConfig: {
          variant: `SR-${v.id}`,
          track: "serveReturn",
          description: v.description,
          hypothesis: v.hypothesis,
          stage1Finding: v.finding,
          generalFinding: stage1Finding,
          status: "needs_more_data",
          implementationStatus: "not_built — Stage 1 found no evidence-based hypothesis",
          baseProductionConfig: {
            calibration: CALIBRATION_SNAPSHOT,
            ensembleWeights: PROD_ENSEMBLE_WEIGHT,
            confidenceShrink: PROD_CONFIDENCE_SHRINK,
            baselineMetrics: SR_BASELINE_METRICS,
          },
        } as Record<string, unknown>,
        holdoutMetrics: {
          status: "needs_more_data",
          baseCalibrationMethod: CALIBRATION_SNAPSHOT.method,
          baseIsotonicHoldoutLogLoss: CALIBRATION_SNAPSHOT.isotonicHoldoutLogLoss,
          baseHoldoutSampleSize: CALIBRATION_SNAPSHOT.holdoutSampleSize,
          variantMetrics: "not applicable — variant not built (Needs More Data per Stage 1 audit)",
        } as Record<string, unknown>,
        validationMetrics: {
          status: "needs_more_data",
          stage1Finding: v.finding,
          baselineMetrics: SR_BASELINE_METRICS,
          variantMetrics: "not applicable — variant not built",
        } as Record<string, unknown>,
        acceptanceChecksPassed: false,
        acceptanceChecks: [
          { check: "stage1_evidence_exists", passed: false, detail: `Stage 1 finding: ${v.finding.slice(0, 100)}…` },
          { check: "implementation_complete", passed: false, detail: "Variant not built — Needs More Data per Stage 1 audit" },
          { check: "stage3_evaluation_complete", passed: false, detail: "Not applicable until Stage 1 evidence exists" },
        ],
      })
      .returning({ id: candidateConfigsTable.id });
    ids.push(row.id);
    logger.info({ id: row.id, variant: `SR-${v.id}` }, "Sprint Stage 2: inserted S&R candidate (Needs More Data)");
  }
  return ids;
}

// ─── Main entry point ────────────────────────────────────────────────────────

export interface Stage2CandidateSummary {
  recentFormCandidateIds: number[];
  specialistCandidateIds: number[];
  serveReturnCandidateIds: number[];
  totalInserted: number;
}

export async function buildSprintStage2Candidates(): Promise<Stage2CandidateSummary> {
  logger.info("Sprint Stage 2: building versioned improvement candidates");

  const [rfIds, specialistIds, srIds] = await Promise.all([
    insertRecentFormCandidates(),
    insertSpecialistCandidates(),
    insertServeReturnCandidates(),
  ]);

  const summary: Stage2CandidateSummary = {
    recentFormCandidateIds: rfIds,
    specialistCandidateIds: specialistIds,
    serveReturnCandidateIds: srIds,
    totalInserted: rfIds.length + specialistIds.length + srIds.length,
  };

  logger.info(summary, "Sprint Stage 2: all candidates inserted");
  return summary;
}
