import { computeSurfaceEloModule } from "./surfaceElo";
import { computeServeReturnModule } from "./serveReturn";
import { computeRecentFormModule } from "./recentForm";
import { computeFatigueModule } from "./fatigue";
import { computeAvailabilityModule } from "./availability";
import { computeStyleMatchupModule } from "./styleMatchup";
import { computeHeadToHeadModule } from "./headToHead";
import { computeDataQuality, computeSurfaceSampleDepth, MODULE_IMPORTANCE, ENSEMBLE_WEIGHT_PRIOR, EXCLUDED_FROM_ENSEMBLE, CONFIDENCE_SHRINK } from "./dataQuality";
import { buildEnsemble, worseAgreement, type ModelVote } from "./ensemble";
import { computeWeightedDisagreement, computeMatchupCloseness, buildDisagreementNote, AGREEMENT_ORDER, type MatchupCloseness } from "./disagreement";
import { calibrateProbability } from "./calibration";
import { applyCalibration } from "../evaluation/calibration";
import { computeUpsetRisk, type UpsetRiskResult } from "./upsetRisk";
import { computeRecommendation } from "./recommendation";
import { deriveServicePointEstimate, runMatchSimulation, deriveMatchSeed, type MatchSimulationResult } from "./simulator";
import { applyTieBreaker } from "./tieBreakers";
import { computeEliteTier, voteFavorsPlayer1 } from "./eliteTier";
import { checkFinalConsistency } from "./finalConsistencyCheck";
import type { PredictionEngineInput } from "./types";
import type { WeatherConditions } from "./weather";

export interface EngineBreakdown {
  surfaceElo: ReturnType<typeof computeSurfaceEloModule>;
  serveReturn: ReturnType<typeof computeServeReturnModule>;
  recentForm: ReturnType<typeof computeRecentFormModule>;
  fatigue: ReturnType<typeof computeFatigueModule>;
  availability: ReturnType<typeof computeAvailabilityModule>;
  styleMatchup: ReturnType<typeof computeStyleMatchupModule>;
  headToHead: ReturnType<typeof computeHeadToHeadModule>;
  models: ModelVote[];
  modelAgreement: ReturnType<typeof buildEnsemble>["modelAgreement"];
  /** Always present when modelAgreement isn't "Strong" -- names the specific meaningfully-weighted models actually in conflict, their probabilities, and their weights (2026-07-13 disagreement recalibration, Part A.F). Null when modelAgreement is "Strong". See `./disagreement.ts`. */
  disagreementNote: string | null;
  /** How near the FINAL probability sits to a coin flip -- deliberately separate from modelAgreement: a match can be close while every model agrees (low disagreement), or genuinely disagree while the blend lands well away from 50 (2026-07-13 spec, Part A.E). Not present on predictions made before this field existed. */
  matchupCloseness: MatchupCloseness;
  reasons: string[];
  risks: string[];
  warnings: string[];
  availabilityNote: string;
  conditionsNote: string;
  weather: WeatherConditions | null;
  /** Segment key (e.g. "ATP-Clay") a specialist was evaluated for, or null when this match's tour isn't a Phase 6 candidate segment at all. */
  segmentKey: string | null;
  segmentLabel: string | null;
  /** True only when a segment specialist actually contributed to the blended probability below. */
  specialistApplied: boolean;
  /** Always present and always visible -- explains whether a specialist was applied, or exactly why the engine fell back to the general model. Never silent. */
  segmentNote: string;
  /** Phase 7: point-by-point Monte Carlo simulation output. Always computed and shown, regardless of whether it's been validated into the ensemble vote below. */
  simulation: MatchSimulationResult;
  /** True only when the simulator's own validated performance earned it a vote in calibratedProbability below. */
  simulatorApplied: boolean;
  /** Always present -- explains whether the simulator is voting, or exactly why not yet. Never silent. */
  simulatorNote: string;
  /**
   * True only when the final calibrated pick crosses the 50% line in the OPPOSITE direction from
   * the raw, reliability-weighted feature-module vote (surface Elo, serve/return, recent form,
   * fatigue, availability, head-to-head) -- i.e. calibration/specialist/simulator blending
   * overrode what the underlying evidence alone pointed to. This is disclosed, never suppressed:
   * calibration is a real, validated statistical process (fitted on actual graded outcomes), so
   * it is not blocked from overriding raw feature consensus, but the override itself is always
   * surfaced with an explanation of which stage flipped it and how each metric voted.
   */
  modelConflict: boolean;
  /** Concise, always-non-null-when-modelConflict-is-true explanation of which metrics favored the other side and which stage of the pipeline (general calibration, segment specialist, or simulator) flipped the final pick. Null when there's no conflict. */
  modelConflictNote: string | null;
  /** True only when this match's raw core signals were genuinely close (within `TIE_BAND` of a coin flip) and the tie-break cascade (see `tieBreakers.ts`) picked a direction instead of leaving an uninformative ~50/50 average. Not present on predictions made before this field existed. */
  tieBreakerApplied: boolean;
  /** Which cascade step (Serve & Return, Surface Elo, Recent Form, surface history, ranking, Fatigue, Head-to-Head) decided the direction, or null when no tie-break was needed/possible. */
  tieBreakerDecidingStep: string | null;
  /** Always present when `tieBreakerApplied` is true -- explains why the raw signals were tied and which step broke it. Null otherwise. */
  tieBreakerNote: string | null;
  /** True only when this prediction clears the Elite Prediction bar -- see `eliteTier.ts`. Not present on predictions made before this field existed. */
  isEliteTier: boolean;
  /** Always present -- explains why a prediction is or isn't elite tier. Never silent. */
  eliteTierReason: string;
  /** Recalibrated upset-risk breakdown (2026-07-13 disagreement/upset-risk spec, Part 2) -- see `upsetRisk.ts`. `EngineOutput.upsetRisk` stays the plain LOW/MODERATE/HIGH/EXTREME tier for existing API/DB consumers; this is the full auditable component breakdown behind it. Not present on predictions made before this field existed. */
  upsetRiskBreakdown: UpsetRiskResult;
  /** Per-matchup count of prior meetings/matches on the relevant surface for each player (same window `surfaceElo.ts` used), surfaced explicitly so a low-sample surface prediction is visibly flagged rather than silently blended in. Not present on predictions made before this field existed. */
  surfaceSampleDepth: ReturnType<typeof computeSurfaceSampleDepth>;
  /**
   * Task 56: output of the final-consistency guard (`finalConsistencyCheck.ts`), run as the very
   * last step before this EngineOutput is returned. Empty in the overwhelming common case --
   * every rule it checks already holds by construction elsewhere in this file. A non-empty array
   * means an upstream invariant broke (e.g. a future change reintroduced the original
   * Elite+HighDisagreement+"no model conflict" contradiction); when that happens, Elite tier is
   * force-withheld below and the violation is surfaced here rather than shown silently.
   */
  consistencyViolations: string[];
}

export interface EngineOutput {
  predictedWinnerId: string;
  predictedWinnerName: string;
  calibratedProbability: number; // for player 1, final -- Phase-4 fitted calibration when available, else the heuristic fallback
  /**
   * Final consistency guarantee: this is always the PREDICTED WINNER's own win probability
   * (>= 50, mirrored from `calibratedProbability` when player 2 is the pick), never player 1's
   * raw number mislabeled as the winner's confidence. `calibratedProbability` stays player-1-
   * relative because calibration fitting, model-conflict detection, and evaluation scoring all
   * depend on that fixed orientation -- this field exists so every display surface (match cards,
   * prediction log, ledger) can show a number that can never contradict the winner it sits next
   * to (e.g. a 44% figure next to the player the engine just called the favorite).
   */
  predictedWinnerProbability: number;
  /** Ensemble probability for player 1 before any calibration is applied -- kept for transparency and future calibration refitting. */
  rawEnsembleProbability: number;
  dataQuality: number;
  dataQualityLabel: ReturnType<typeof computeDataQuality>["label"];
  upsetRisk: UpsetRiskResult["upsetRisk"];
  recommendation: ReturnType<typeof computeRecommendation>;
  predictedSetScore: string;
  engine: EngineBreakdown;
}

/**
 * Discloses exactly what availability data is real vs. missing for THIS match, rather than a
 * flat "not connected" disclaimer -- rest days and recent retirement come straight from verified
 * match records; travel distance depends on venue coverage; pre-match withdrawal (before either
 * player has struck a ball) has no verified feed connected at all (RAPIDAPI_KEY/API_SPORTS_KEY
 * checked live on 2026-07-11 -- neither resolves to a subscribed, working tennis data source) and
 * that gap is always named explicitly.
 */
function buildAvailabilityNote(availability: ReturnType<typeof computeAvailabilityModule>): string {
  const parts: string[] = [];

  const rest: string[] = [];
  if (availability.player1.daysSinceLastMatch !== null) rest.push(`P1 rested ${availability.player1.daysSinceLastMatch}d`);
  if (availability.player2.daysSinceLastMatch !== null) rest.push(`P2 rested ${availability.player2.daysSinceLastMatch}d`);
  if (rest.length > 0) parts.push(`Real rest days since last match: ${rest.join(", ")}.`);

  const travel: string[] = [];
  if (availability.player1.travelDistanceKm !== null) travel.push(`P1 traveled ~${availability.player1.travelDistanceKm}km since their last match`);
  if (availability.player2.travelDistanceKm !== null) travel.push(`P2 traveled ~${availability.player2.travelDistanceKm}km since their last match`);
  parts.push(travel.length > 0 ? `${travel.join(", ")}.` : "Travel distance unavailable for this match (venue coverage is limited to recognized tournaments).");

  if (availability.player1.recentRetirementOrWithdrawal) {
    parts.push(`P1 retired mid-match at ${availability.player1.recentRetirementTournament ?? "a recent tournament"} within the last 3 weeks -- a real recorded fact worth weighing, not a confirmed current injury.`);
  }
  if (availability.player2.recentRetirementOrWithdrawal) {
    parts.push(`P2 retired mid-match at ${availability.player2.recentRetirementTournament ?? "a recent tournament"} within the last 3 weeks -- a real recorded fact worth weighing, not a confirmed current injury.`);
  }

  parts.push(
    "No verified pre-match withdrawal/injury-status feed is connected -- this prediction cannot see an injury that hasn't yet caused a retirement or walkover in the match record.",
  );

  return parts.join(" ");
}

function predictSetScore(matchFormat: "BestOf3" | "BestOf5", calibratedProbability: number, favorsPlayer1: boolean): string {
  const margin = Math.abs(calibratedProbability - 50);
  const setsToWin = matchFormat === "BestOf5" ? 3 : 2;
  const decisive = margin >= 20;
  const winnerSets = setsToWin;
  const loserSets = decisive ? Math.max(0, setsToWin - 2) : setsToWin - 1;
  return favorsPlayer1 ? `${winnerSets}-${loserSets}` : `${loserSets}-${winnerSets}`;
}

export function runPredictionEngine(input: PredictionEngineInput): EngineOutput {
  const player1OpponentElo = input.player1OpponentElo ?? new Map();
  const player2OpponentElo = input.player2OpponentElo ?? new Map();

  const surfaceElo = computeSurfaceEloModule(input.player1Matches, input.player2Matches, input.surface, player1OpponentElo, player2OpponentElo);
  const serveReturn = computeServeReturnModule(input.player1Matches, input.player2Matches, player1OpponentElo, player2OpponentElo);
  const recentForm = computeRecentFormModule(input.player1Matches, input.player2Matches, input.surface, player1OpponentElo, player2OpponentElo);
  const fatigue = computeFatigueModule(input.player1Matches, input.player2Matches);
  const availability = computeAvailabilityModule(input.player1Matches, input.player2Matches, input.tournamentName ?? null);
  const styleMatchup = computeStyleMatchupModule(input.player1Matches, input.player2Matches);
  const headToHead = computeHeadToHeadModule(input.headToHead, input.surface);

  const excludedModels = input.excludedModels ?? null;

  const moduleEdges = [
    {
      key: "surfaceElo" as const,
      name: "Surface Elo",
      player1Edge: surfaceElo.eloDifference / 8,
      reliability: surfaceElo.reliability,
      importance: MODULE_IMPORTANCE.surfaceElo,
      weightPrior: ENSEMBLE_WEIGHT_PRIOR.surfaceElo,
    },
    {
      key: "serveReturn" as const,
      name: "Serve & Return",
      player1Edge: serveReturn.player1ServeRating + serveReturn.player1ReturnRating - serveReturn.player2ServeRating - serveReturn.player2ReturnRating,
      reliability: serveReturn.reliability,
      importance: MODULE_IMPORTANCE.serveReturn,
      weightPrior: ENSEMBLE_WEIGHT_PRIOR.serveReturn,
      confidenceShrink: CONFIDENCE_SHRINK.serveReturn,
    },
    {
      key: "recentForm" as const,
      name: "Recent Form",
      player1Edge: (recentForm.player1Form - recentForm.player2Form) / 2,
      reliability: recentForm.reliability,
      importance: MODULE_IMPORTANCE.recentForm,
      weightPrior: ENSEMBLE_WEIGHT_PRIOR.recentForm,
      confidenceShrink: CONFIDENCE_SHRINK.recentForm,
    },
    {
      key: "fatigue" as const,
      name: "Fatigue",
      player1Edge: (fatigue.player2FatigueScore - fatigue.player1FatigueScore) / 2,
      reliability: fatigue.reliability,
      importance: MODULE_IMPORTANCE.fatigue,
      weightPrior: ENSEMBLE_WEIGHT_PRIOR.fatigue,
    },
    {
      key: "availability" as const,
      name: "Availability",
      player1Edge: (availability.player1AvailabilityScore - availability.player2AvailabilityScore) / 2,
      reliability: availability.reliability,
      importance: MODULE_IMPORTANCE.availability,
      weightPrior: ENSEMBLE_WEIGHT_PRIOR.availability,
    },
    {
      key: "headToHead" as const,
      name: "Head-to-Head",
      player1Edge: headToHead.player1Wins + headToHead.player2Wins > 0
        ? ((headToHead.player1Wins - headToHead.player2Wins) / (headToHead.player1Wins + headToHead.player2Wins)) * 25 + headToHead.weightedEdge * 15
        : 0,
      reliability: headToHead.reliability,
      importance: MODULE_IMPORTANCE.headToHead,
      weightPrior: ENSEMBLE_WEIGHT_PRIOR.headToHead,
    },
  ].filter((m) => !excludedModels?.has(m.key) && !EXCLUDED_FROM_ENSEMBLE.has(m.key));

  const { models: featureModels, ensembleProbability: rawEnsembleProbability, modelAgreement: featureAgreement } = buildEnsemble(moduleEdges);
  // Recomputed (pure, deterministic) so we keep the full weighted-disagreement breakdown --
  // stddev/support/conflicting models -- for the disagreement explanation below, not just the
  // category buildEnsemble already returned.
  let governingDisagreement = computeWeightedDisagreement(featureModels);

  // Requirement 6/7 of the fix-the-engine spec: when the core signals are genuinely close to a
  // coin flip, use an explicit priority cascade instead of just accepting an uninformative ~50/50
  // average -- always surface a real (if modest) lean when evidence supports one, never inflate
  // beyond a small fixed nudge, and only stay at exactly 50/50 when every tie-break step is also
  // silent (a genuine coin-flip matchup).
  const tieBreaker = applyTieBreaker(rawEnsembleProbability, {
    surfaceElo,
    serveReturn,
    recentForm,
    fatigue,
    headToHead,
    player1: input.player1,
    player2: input.player2,
    player1Matches: input.player1Matches,
    player2Matches: input.player2Matches,
    surface: input.surface,
  });
  const ensembleProbability = tieBreaker.applied ? tieBreaker.adjustedProbability : rawEnsembleProbability;

  // Availability is still fully computed and shown (below, via `availability`/`availabilityNote`)
  // but excluded from both the ensemble vote and the Data Quality blend -- see
  // `EXCLUDED_FROM_ENSEMBLE`'s rationale: its own leave-one-out removal measurably improved
  // accuracy in the 2026-07-13 ablation report, so it is disabled rather than merely down-weighted.
  const { score: dataQuality, label: dataQualityLabel } = computeDataQuality(
    moduleEdges.map((m) => ({ reliability: m.reliability, importance: m.importance })),
  );

  // Requirement 2 of this phase: expose the surface sample-depth count that `surfaceElo.ts`
  // already tracks internally, so a low-sample surface matchup is visibly flagged rather than
  // silently blended into a single probability number.
  const surfaceSampleDepth = computeSurfaceSampleDepth(surfaceElo.sampleSizePlayer1, surfaceElo.sampleSizePlayer2);

  // Phase 7: point-by-point Monte Carlo simulation, always computed for display/transparency.
  // Seeded deterministically from match identity (see simulator.ts) so re-predicting the exact
  // same match (quick-start, custom match, or a plain re-run) always simulates the same outcome
  // instead of drifting between calls -- this is what let same-match duplicates disagree on
  // predicted winner and slip past the ledger's duplicate detector.
  const servicePointEstimate = deriveServicePointEstimate(surfaceElo, serveReturn);
  const simulatorSeed = deriveMatchSeed(input.player1.id, input.player2.id, input.surface, input.matchFormat);
  const simulation = runMatchSimulation(servicePointEstimate, input.matchFormat, { seed: simulatorSeed });

  // Prefer the real, Phase-4-fitted isotonic calibration (learned from actual walk-forward
  // validation outcomes) whenever one exists. Only fall back to the hand-tuned dataQuality-shrink
  // heuristic before any evaluation run has ever produced a fitted model -- that heuristic is a
  // documented stand-in, not the validated calibration this engine should prefer.
  // Ablation-only: "generalEnsemble" removed means skip the calibration transform entirely and
  // use the raw, reliability-weighted ensemble probability as the blend base below -- there is no
  // other honest stand-in for "the general model didn't vote".
  const generalEnsembleExcluded = !!excludedModels?.has("generalEnsemble");
  const generalProbability = generalEnsembleExcluded
    ? ensembleProbability
    : input.activeCalibration && input.activeCalibration.length > 0
      ? Math.round(applyCalibration(input.activeCalibration, ensembleProbability / 100) * 1000) / 10
      : calibrateProbability(ensembleProbability, dataQuality);

  // Phase 6: blend in a tour/surface segment specialist -- literally the same ensemble
  // probability run through a SEGMENT-ONLY isotonic calibration instead of the pooled one -- when
  // (and only when) that segment has cleared its own data-sufficiency thresholds. Everything else
  // falls back to the general model alone, with a visible reason why (never silently).
  // Ablation-only: "segmentSpecialist" removed forces the specialist off regardless of `segment`.
  const segment = excludedModels?.has("segmentSpecialist") ? null : (input.segment ?? null);
  const specialistApplied = !!(segment?.meetsThreshold && segment.calibrationMapping && segment.calibrationMapping.length > 0 && typeof segment.weight === "number");

  let specialistProbability: number | null = null;
  let specialistWeight = 0;
  if (specialistApplied && segment) {
    specialistProbability = Math.round(applyCalibration(segment.calibrationMapping!, ensembleProbability / 100) * 1000) / 10;
    specialistWeight = segment.weight!;
  }

  const preSimulatorProbability = specialistApplied && specialistProbability !== null
    ? Math.round((specialistWeight * specialistProbability + (1 - specialistWeight) * generalProbability) * 10) / 10
    : generalProbability;

  // Phase 7: only blend the simulator's own vote into the final probability once it has been
  // validated (against real historical/live outcomes) to actually earn one -- see
  // services/evaluation/simulatorValidation.ts. Until then it stays supplementary/display-only,
  // with an honest note explaining exactly why.
  const simulatorAdoption = input.simulatorAdoption ?? null;
  const simulatorApplied = !!(simulatorAdoption?.adopted && typeof simulatorAdoption.weight === "number");
  const simulatorWeight = simulatorApplied ? simulatorAdoption!.weight! : 0;

  const calibratedProbability = simulatorApplied
    ? Math.round((simulatorWeight * simulation.player1WinProbability + (1 - simulatorWeight) * preSimulatorProbability) * 10) / 10
    : preSimulatorProbability;

  const models: ModelVote[] = [...featureModels];
  models.push({
    modelName: "General Model",
    player1Probability: generalProbability,
    weightUsed: specialistApplied ? Math.round((1 - specialistWeight) * 1000) / 1000 : 1,
    reliability: dataQuality,
  });
  let modelAgreement = featureAgreement;
  if (specialistApplied && specialistProbability !== null && segment) {
    models.push({
      modelName: `Segment Specialist (${segment.label})`,
      player1Probability: specialistProbability,
      weightUsed: Math.round(specialistWeight * 1000) / 1000,
      // Reliability scales with the validation sample the specialist was actually measured on,
      // capped at 100 -- a specialist barely over threshold is voted on, but not trusted blindly.
      reliability: Math.min(100, Math.round((segment.validationSampleSize / segment.minValidationSamples) * 50)),
    });
    // Weighted the same way as the level-1 feature vote (see disagreement.ts) using the actual
    // general/specialist blend weights as effective weight, instead of a flat two-way spread.
    const generalVsSpecialistDisagreement = computeWeightedDisagreement([
      { modelName: "General Model", player1Probability: generalProbability, weightUsed: 1 - specialistWeight },
      { modelName: `Segment Specialist (${segment.label})`, player1Probability: specialistProbability, weightUsed: specialistWeight },
    ]);
    if (AGREEMENT_ORDER.indexOf(generalVsSpecialistDisagreement.modelAgreement) > AGREEMENT_ORDER.indexOf(governingDisagreement.modelAgreement)) {
      governingDisagreement = generalVsSpecialistDisagreement;
    }
    modelAgreement = worseAgreement(featureAgreement, generalVsSpecialistDisagreement.modelAgreement);
  }

  if (simulatorApplied) {
    models.push({
      modelName: "Monte Carlo Simulator",
      player1Probability: simulation.player1WinProbability,
      weightUsed: Math.round(simulatorWeight * 1000) / 1000,
      reliability: simulation.inputReliability,
    });
    const preSimulatorVsSimulatorDisagreement = computeWeightedDisagreement([
      { modelName: "Pre-Simulator Blend", player1Probability: preSimulatorProbability, weightUsed: 1 - simulatorWeight },
      { modelName: "Monte Carlo Simulator", player1Probability: simulation.player1WinProbability, weightUsed: simulatorWeight },
    ]);
    if (AGREEMENT_ORDER.indexOf(preSimulatorVsSimulatorDisagreement.modelAgreement) > AGREEMENT_ORDER.indexOf(governingDisagreement.modelAgreement)) {
      governingDisagreement = preSimulatorVsSimulatorDisagreement;
    }
    modelAgreement = worseAgreement(modelAgreement, preSimulatorVsSimulatorDisagreement.modelAgreement);
  }

  const disagreementNote = buildDisagreementNote(governingDisagreement, input.player1.name, input.player2.name);
  const matchupCloseness = computeMatchupCloseness(calibratedProbability);

  const simulatorNote = simulatorAdoption?.note ??
    `The Monte Carlo simulator has not been validated against enough real graded outcomes yet (needs a minimum sample; see the evaluation dashboard) -- shown for transparency only and not yet voted into the final probability.`;

  let segmentNote: string;
  if (!segment) {
    segmentNote = "This match's tour isn't one of Phase 6's candidate specialist segments (ATP/WTA on Hard, Clay, Grass, or IndoorHard) -- using the general model only.";
  } else if (specialistApplied) {
    segmentNote = `Segment specialist for ${segment.label} applied (blend weight ${Math.round(specialistWeight * 100)}%), measured on ${segment.validationSampleSize} validation-segment predictions across ${segment.historicalMatchCount} real historical ${segment.label} matches.`;
  } else {
    segmentNote = `No segment specialist for ${segment.label} yet -- only ${segment.historicalMatchCount} historical match(es) and ${segment.validationSampleSize} validation prediction(s) recorded so far (needs at least ${segment.minHistoricalMatches} matches and ${segment.minValidationSamples} validation predictions). Using the general model only.`;
  }

  // Model Conflict: compare the final pick against the raw, reliability-weighted vote of the
  // underlying evidence modules alone (ensembleProbability, before any calibration/specialist/
  // simulator blending). If calibration flips which side of 50% the pick lands on, that's a real,
  // disclosable event -- never silently absorbed into a single probability number.
  const rawFavorsPlayer1 = ensembleProbability >= 50;
  const finalFavorsPlayer1 = calibratedProbability >= 50;
  const modelConflict = rawFavorsPlayer1 !== finalFavorsPlayer1;

  let modelConflictNote: string | null = null;
  if (modelConflict) {
    const metricVotes = featureModels
      .map((m) => `${m.modelName} \u2192 ${m.player1Probability >= 50 ? input.player1.name : input.player2.name} (${m.player1Probability.toFixed(0)}%, weight ${m.weightUsed.toFixed(2)})`)
      .join("; ");

    let flipStage = "an unidentified stage";
    if ((generalProbability >= 50) !== rawFavorsPlayer1) {
      flipStage = "the fitted probability calibration (isotonic mapping learned from real graded outcomes)";
    } else if (specialistApplied && (preSimulatorProbability >= 50) !== (generalProbability >= 50)) {
      flipStage = `the ${segment?.label ?? "segment"} specialist blend`;
    } else if (simulatorApplied && (calibratedProbability >= 50) !== (preSimulatorProbability >= 50)) {
      flipStage = "the Monte Carlo simulator blend";
    }

    modelConflictNote = `The raw, reliability-weighted evidence (${metricVotes}) favored ${rawFavorsPlayer1 ? input.player1.name : input.player2.name}, but ${flipStage} shifted the final pick to ${finalFavorsPlayer1 ? input.player1.name : input.player2.name}. This is a real statistical adjustment, not an error -- but treat the edge with extra caution.`;
  }

  // Uncertainty warnings feeding the upset-risk `uncertainty` component -- deliberately excludes
  // surfaceElo.warnings (already counted once, in the `sampleDepth` component) and
  // headToHead.warnings (a missing/thin H2H is the common case for most matchups, not a real
  // outlier signal -- same reasoning `dataQuality.ts`'s importance weighting already applies).
  // Player-identity warnings (`buildPlayerProfileWarnings`) are appended by callers AFTER this
  // function returns, so they aren't visible here yet -- an honest gap, not a fabricated count.
  const upsetRiskUncertaintyWarnings = [...serveReturn.warnings, ...availability.warnings, ...fatigue.warnings, ...styleMatchup.warnings];
  const upsetRiskBreakdown = computeUpsetRisk({
    calibratedProbability,
    disagreement: governingDisagreement,
    rawVsCalibratedConflict: modelConflict,
    uncertaintyWarningCount: upsetRiskUncertaintyWarnings.length,
    minSurfaceSampleSize: Math.min(surfaceElo.sampleSizePlayer1, surfaceElo.sampleSizePlayer2),
    tournamentLevel: input.tournamentLevel ?? null,
  });
  const upsetRisk = upsetRiskBreakdown.upsetRisk;
  const recommendation = computeRecommendation(calibratedProbability, dataQuality, dataQualityLabel, upsetRisk, modelAgreement);

  const favorsPlayer1 = calibratedProbability >= 50;
  const predictedWinnerId = favorsPlayer1 ? input.player1.id : input.player2.id;
  const predictedWinnerName = favorsPlayer1 ? input.player1.name : input.player2.name;
  // Guardrail (final consistency check): the predicted winner's own probability, mirrored from
  // player 1's when player 2 is the pick. By construction this can never read below 50 next to
  // the player the engine just named the favorite -- see the field doc on EngineOutput.
  const predictedWinnerProbability = Math.round((favorsPlayer1 ? calibratedProbability : 100 - calibratedProbability) * 10) / 10;
  const predictedSetScore = predictSetScore(input.matchFormat, calibratedProbability, favorsPlayer1);

  const reasons: string[] = [];
  const risks: string[] = [];

  if (surfaceElo.sampleSizePlayer1 >= 3 && surfaceElo.sampleSizePlayer2 >= 3) {
    reasons.push(
      `Surface Elo favors ${surfaceElo.eloDifference >= 0 ? input.player1.name : input.player2.name} on ${input.surface} (${surfaceElo.player1SurfaceElo} vs ${surfaceElo.player2SurfaceElo}).`,
    );
  } else {
    risks.push(`Limited ${input.surface} match history for one or both players -- surface Elo reliability is low.`);
  }

  if (recentForm.player1Trend === "declining" || recentForm.player2Trend === "declining") {
    risks.push(
      `${recentForm.player1Trend === "declining" ? input.player1.name : input.player2.name} is trending down in recent form.`,
    );
  }

  if (headToHead.player1Wins + headToHead.player2Wins > 0) {
    if (headToHead.player1Wins === headToHead.player2Wins) {
      reasons.push(`Head-to-head is tied ${headToHead.player1Wins}-${headToHead.player2Wins}.`);
    } else {
      const leader = headToHead.player1Wins > headToHead.player2Wins ? input.player1.name : input.player2.name;
      reasons.push(
        `Head-to-head: ${leader} leads ${Math.max(headToHead.player1Wins, headToHead.player2Wins)}-${Math.min(headToHead.player1Wins, headToHead.player2Wins)}.`,
      );
    }
  } else {
    risks.push("No prior head-to-head meetings found -- this matchup has no direct precedent.");
  }

  if (disagreementNote) {
    risks.push(disagreementNote);
  }

  if (recommendation === "NO_STRONG_SIGNAL") {
    risks.push("Probability is close to a coin flip and the underlying models don't agree -- there is no strong signal either way for this matchup.");
  }

  // Auditable upset-risk explanation (2026-07-13 spec, Part 2D) -- named top contributors, never
  // a silent tier label. Shown whenever the tier is above LOW.
  if (upsetRisk !== "LOW") {
    risks.push(upsetRiskBreakdown.note);
  }

  if (modelConflict && modelConflictNote) {
    risks.unshift(`MODEL CONFLICT: ${modelConflictNote}`);
  }

  // Requirement 8 of the fix-the-engine spec: a strictly narrower "Elite Prediction" tier -- see
  // `eliteTier.ts` for the exact gating conditions. Extended by the 2026-07-13 spec's Elite-vs-
  // risk consistency guardrail (Part 2E): Elite additionally requires modelAgreement not to be
  // High Disagreement and upsetRisk not to be High/Extreme.
  const { isEliteTier: eliteTierBeforeGuard, reason: eliteTierReasonBeforeGuard } = computeEliteTier({
    dataQuality,
    surfaceEloFavorsPlayer1: voteFavorsPlayer1(featureModels, "Surface Elo"),
    serveReturnFavorsPlayer1: voteFavorsPlayer1(featureModels, "Serve & Return"),
    recentFormFavorsPlayer1: voteFavorsPlayer1(featureModels, "Recent Form"),
    specialistApplied,
    segmentLabel: segment?.label ?? null,
    modelConflict,
    modelAgreement,
    upsetRisk,
  });

  const warnings = [
    ...surfaceElo.warnings,
    ...serveReturn.warnings,
    ...recentForm.warnings,
    ...fatigue.warnings,
    ...availability.warnings,
    ...styleMatchup.warnings,
    ...headToHead.warnings,
  ];

  const weather = input.weather ?? null;

  // Task 56: final-consistency guard, run against the pre-guard Elite verdict. Checked BEFORE
  // isEliteTier is fixed for real, so a violation can force it false rather than ship it.
  const { violations: consistencyViolations } = checkFinalConsistency({
    player1Id: input.player1.id,
    player2Id: input.player2.id,
    calibratedProbability,
    predictedWinnerId,
    predictedWinnerProbability,
    isEliteTier: eliteTierBeforeGuard,
    eliteTierReason: eliteTierReasonBeforeGuard,
    modelAgreement,
    upsetRisk,
    upsetRiskBreakdownTier: upsetRiskBreakdown.upsetRisk,
  });
  const isEliteTier = consistencyViolations.length === 0 && eliteTierBeforeGuard;
  const eliteTierReason =
    consistencyViolations.length === 0
      ? eliteTierReasonBeforeGuard
      : `Not elite tier -- final-consistency guard caught an invariant violation and withheld Elite regardless of the underlying gates: ${consistencyViolations.join(" ")}`;
  if (consistencyViolations.length > 0) {
    risks.unshift(`CONSISTENCY GUARD: ${consistencyViolations.join(" ")}`);
  }

  const engine: EngineBreakdown = {
    surfaceElo,
    serveReturn,
    recentForm,
    fatigue,
    availability,
    styleMatchup,
    headToHead,
    models,
    modelAgreement,
    disagreementNote,
    matchupCloseness,
    reasons,
    risks,
    warnings,
    availabilityNote: buildAvailabilityNote(availability),
    conditionsNote: weather
      ? `Forecast conditions for ${weather.venueName}: ${weather.temperatureC}°C, wind ${weather.windSpeedKph} km/h, ${weather.precipitationProbability}% chance of precipitation. ${weather.note}`
      : "Live weather and court-speed conditions are not connected for this matchup -- either the fixture isn't a genuinely upcoming one with a known venue/date, or it's beyond the forecast horizon.",
    weather,
    segmentKey: segment?.segmentKey ?? null,
    segmentLabel: segment?.label ?? null,
    specialistApplied,
    segmentNote,
    simulation,
    simulatorApplied,
    simulatorNote,
    modelConflict,
    modelConflictNote,
    tieBreakerApplied: tieBreaker.applied,
    tieBreakerDecidingStep: tieBreaker.decidingStep,
    tieBreakerNote: tieBreaker.applied ? tieBreaker.note : null,
    isEliteTier,
    eliteTierReason,
    upsetRiskBreakdown,
    surfaceSampleDepth,
    consistencyViolations,
  };

  return {
    predictedWinnerId,
    predictedWinnerName,
    calibratedProbability,
    predictedWinnerProbability,
    rawEnsembleProbability: ensembleProbability,
    dataQuality,
    dataQualityLabel,
    upsetRisk,
    recommendation,
    predictedSetScore,
    engine,
  };
}
