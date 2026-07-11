import { computeSurfaceEloModule } from "./surfaceElo";
import { computeServeReturnModule } from "./serveReturn";
import { computeRecentFormModule } from "./recentForm";
import { computeFatigueModule } from "./fatigue";
import { computeStyleMatchupModule } from "./styleMatchup";
import { computeHeadToHeadModule } from "./headToHead";
import { computeDataQuality } from "./dataQuality";
import { buildEnsemble } from "./ensemble";
import { calibrateProbability } from "./calibration";
import { computeUpsetRisk } from "./upsetRisk";
import { computeRecommendation } from "./recommendation";
import type { PredictionEngineInput } from "./types";

export interface EngineBreakdown {
  surfaceElo: ReturnType<typeof computeSurfaceEloModule>;
  serveReturn: ReturnType<typeof computeServeReturnModule>;
  recentForm: ReturnType<typeof computeRecentFormModule>;
  fatigue: ReturnType<typeof computeFatigueModule>;
  styleMatchup: ReturnType<typeof computeStyleMatchupModule>;
  headToHead: ReturnType<typeof computeHeadToHeadModule>;
  models: ReturnType<typeof buildEnsemble>["models"];
  modelAgreement: ReturnType<typeof buildEnsemble>["modelAgreement"];
  reasons: string[];
  risks: string[];
  availabilityNote: string;
  conditionsNote: string;
}

export interface EngineOutput {
  predictedWinnerId: string;
  predictedWinnerName: string;
  calibratedProbability: number; // for player 1
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
  const surfaceElo = computeSurfaceEloModule(input.player1Matches, input.player2Matches, input.surface);
  const serveReturn = computeServeReturnModule(input.player1Matches, input.player2Matches);
  const recentForm = computeRecentFormModule(input.player1Matches, input.player2Matches);
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
        ? ((headToHead.player1Wins - headToHead.player2Wins) / (headToHead.player1Wins + headToHead.player2Wins)) * 40
        : 0,
      reliability: headToHead.reliability,
    },
  ];

  const { models, ensembleProbability, modelAgreement } = buildEnsemble(moduleEdges);

  const { score: dataQuality, label: dataQualityLabel } = computeDataQuality(moduleEdges.map((m) => m.reliability));
  const calibratedProbability = calibrateProbability(ensembleProbability, dataQuality);
  const upsetRisk = computeUpsetRisk(calibratedProbability, modelAgreement);
  const recommendation = computeRecommendation(calibratedProbability, dataQuality, dataQualityLabel, upsetRisk);

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
    availabilityNote:
      "Verified injury/availability tracking is not connected yet -- this prediction assumes both players are fit to compete.",
    conditionsNote:
      "Live weather and court-speed conditions are not connected yet -- surface is taken from tournament history, not measured court speed on the day.",
  };

  return {
    predictedWinnerId,
    predictedWinnerName,
    calibratedProbability,
    dataQuality,
    dataQualityLabel,
    upsetRisk,
    recommendation,
    predictedSetScore,
    engine,
  };
}
