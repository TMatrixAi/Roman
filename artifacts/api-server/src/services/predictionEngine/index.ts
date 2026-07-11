import { computeSurfaceEloModule } from "./surfaceElo";
import { computeServeReturnModule } from "./serveReturn";
import { computeRecentFormModule } from "./recentForm";
import { computeFatigueModule } from "./fatigue";
import { computeStyleMatchupModule } from "./styleMatchup";
import { computeHeadToHeadModule } from "./headToHead";
import { computeDataQuality } from "./dataQuality";
import { buildEnsemble, agreementFromSpread, worseAgreement, type ModelVote } from "./ensemble";
import { calibrateProbability } from "./calibration";
import { applyCalibration } from "../evaluation/calibration";
import { computeUpsetRisk } from "./upsetRisk";
import { computeRecommendation } from "./recommendation";
import type { PredictionEngineInput } from "./types";
import type { WeatherConditions } from "./weather";

export interface EngineBreakdown {
  surfaceElo: ReturnType<typeof computeSurfaceEloModule>;
  serveReturn: ReturnType<typeof computeServeReturnModule>;
  recentForm: ReturnType<typeof computeRecentFormModule>;
  fatigue: ReturnType<typeof computeFatigueModule>;
  styleMatchup: ReturnType<typeof computeStyleMatchupModule>;
  headToHead: ReturnType<typeof computeHeadToHeadModule>;
  models: ModelVote[];
  modelAgreement: ReturnType<typeof buildEnsemble>["modelAgreement"];
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
}

export interface EngineOutput {
  predictedWinnerId: string;
  predictedWinnerName: string;
  calibratedProbability: number; // for player 1, final -- Phase-4 fitted calibration when available, else the heuristic fallback
  /** Ensemble probability for player 1 before any calibration is applied -- kept for transparency and future calibration refitting. */
  rawEnsembleProbability: number;
  dataQuality: number;
  dataQualityLabel: ReturnType<typeof computeDataQuality>["label"];
  upsetRisk: ReturnType<typeof computeUpsetRisk>;
  recommendation: ReturnType<typeof computeRecommendation>;
  predictedSetScore: string;
  engine: EngineBreakdown;
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
  const recentForm = computeRecentFormModule(input.player1Matches, input.player2Matches, player1OpponentElo, player2OpponentElo);
  const fatigue = computeFatigueModule(input.player1Matches, input.player2Matches);
  const styleMatchup = computeStyleMatchupModule(input.player1Matches, input.player2Matches);
  const headToHead = computeHeadToHeadModule(input.headToHead, input.surface);

  const moduleEdges = [
    { name: "Surface Elo", player1Edge: surfaceElo.eloDifference / 8, reliability: surfaceElo.reliability },
    {
      name: "Serve & Return",
      player1Edge: serveReturn.player1ServeRating + serveReturn.player1ReturnRating - serveReturn.player2ServeRating - serveReturn.player2ReturnRating,
      reliability: serveReturn.reliability,
    },
    { name: "Recent Form", player1Edge: (recentForm.player1Form - recentForm.player2Form) / 2, reliability: recentForm.reliability },
    { name: "Fatigue", player1Edge: (fatigue.player2FatigueScore - fatigue.player1FatigueScore) / 2, reliability: fatigue.reliability },
    {
      name: "Head-to-Head",
      player1Edge: headToHead.player1Wins + headToHead.player2Wins > 0
        ? ((headToHead.player1Wins - headToHead.player2Wins) / (headToHead.player1Wins + headToHead.player2Wins)) * 25 + headToHead.weightedEdge * 15
        : 0,
      reliability: headToHead.reliability,
    },
  ];

  const { models: featureModels, ensembleProbability, modelAgreement: featureAgreement } = buildEnsemble(moduleEdges);

  const { score: dataQuality, label: dataQualityLabel } = computeDataQuality(moduleEdges.map((m) => m.reliability));

  // Prefer the real, Phase-4-fitted isotonic calibration (learned from actual walk-forward
  // validation outcomes) whenever one exists. Only fall back to the hand-tuned dataQuality-shrink
  // heuristic before any evaluation run has ever produced a fitted model -- that heuristic is a
  // documented stand-in, not the validated calibration this engine should prefer.
  const generalProbability =
    input.activeCalibration && input.activeCalibration.length > 0
      ? Math.round(applyCalibration(input.activeCalibration, ensembleProbability / 100) * 1000) / 10
      : calibrateProbability(ensembleProbability, dataQuality);

  // Phase 6: blend in a tour/surface segment specialist -- literally the same ensemble
  // probability run through a SEGMENT-ONLY isotonic calibration instead of the pooled one -- when
  // (and only when) that segment has cleared its own data-sufficiency thresholds. Everything else
  // falls back to the general model alone, with a visible reason why (never silently).
  const segment = input.segment ?? null;
  const specialistApplied = !!(segment?.meetsThreshold && segment.calibrationMapping && segment.calibrationMapping.length > 0 && typeof segment.weight === "number");

  let specialistProbability: number | null = null;
  let specialistWeight = 0;
  if (specialistApplied && segment) {
    specialistProbability = Math.round(applyCalibration(segment.calibrationMapping!, ensembleProbability / 100) * 1000) / 10;
    specialistWeight = segment.weight!;
  }

  const calibratedProbability = specialistApplied && specialistProbability !== null
    ? Math.round((specialistWeight * specialistProbability + (1 - specialistWeight) * generalProbability) * 10) / 10
    : generalProbability;

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
    const generalVsSpecialistSpread = Math.abs(generalProbability - specialistProbability);
    modelAgreement = worseAgreement(featureAgreement, agreementFromSpread(generalVsSpecialistSpread));
  }

  let segmentNote: string;
  if (!segment) {
    segmentNote = "This match's tour isn't one of Phase 6's candidate specialist segments (ATP/WTA on Hard, Clay, Grass, or IndoorHard) -- using the general model only.";
  } else if (specialistApplied) {
    segmentNote = `Segment specialist for ${segment.label} applied (blend weight ${Math.round(specialistWeight * 100)}%), measured on ${segment.validationSampleSize} validation-segment predictions across ${segment.historicalMatchCount} real historical ${segment.label} matches.`;
  } else {
    segmentNote = `No segment specialist for ${segment.label} yet -- only ${segment.historicalMatchCount} historical match(es) and ${segment.validationSampleSize} validation prediction(s) recorded so far (needs at least ${segment.minHistoricalMatches} matches and ${segment.minValidationSamples} validation predictions). Using the general model only.`;
  }

  const upsetRisk = computeUpsetRisk(calibratedProbability, modelAgreement);
  const recommendation = computeRecommendation(calibratedProbability, dataQuality, dataQualityLabel, upsetRisk, modelAgreement);

  const favorsPlayer1 = calibratedProbability >= 50;
  const predictedWinnerId = favorsPlayer1 ? input.player1.id : input.player2.id;
  const predictedWinnerName = favorsPlayer1 ? input.player1.name : input.player2.name;
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

  if (modelAgreement === "HighDisagreement" || modelAgreement === "Mixed") {
    const agreementLabel = modelAgreement.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    risks.push(`Engine models disagree (${agreementLabel}) -- treat the edge with caution.`);
  }

  if (recommendation === "NO_STRONG_SIGNAL") {
    risks.push("Probability is close to a coin flip and the underlying models don't agree -- there is no strong signal either way for this matchup.");
  }

  const warnings = [
    ...surfaceElo.warnings,
    ...serveReturn.warnings,
    ...recentForm.warnings,
    ...fatigue.warnings,
    ...styleMatchup.warnings,
    ...headToHead.warnings,
  ];

  const weather = input.weather ?? null;

  const engine: EngineBreakdown = {
    surfaceElo,
    serveReturn,
    recentForm,
    fatigue,
    styleMatchup,
    headToHead,
    models,
    modelAgreement,
    reasons,
    risks,
    warnings,
    availabilityNote:
      "Verified injury/availability tracking is not connected yet (evaluated in Phase 5: no reliable timestamped withdrawal/injury feed was found) -- this prediction assumes both players are fit to compete.",
    conditionsNote: weather
      ? `Forecast conditions for ${weather.venueName}: ${weather.temperatureC}°C, wind ${weather.windSpeedKph} km/h, ${weather.precipitationProbability}% chance of precipitation. ${weather.note}`
      : "Live weather and court-speed conditions are not connected for this matchup -- either the fixture isn't a genuinely upcoming one with a known venue/date, or it's beyond the forecast horizon.",
    weather,
    segmentKey: segment?.segmentKey ?? null,
    segmentLabel: segment?.label ?? null,
    specialistApplied,
    segmentNote,
  };

  return {
    predictedWinnerId,
    predictedWinnerName,
    calibratedProbability,
    rawEnsembleProbability: ensembleProbability,
    dataQuality,
    dataQualityLabel,
    upsetRisk,
    recommendation,
    predictedSetScore,
    engine,
  };
}
