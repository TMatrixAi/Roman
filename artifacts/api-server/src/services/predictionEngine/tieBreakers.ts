import type { computeSurfaceEloModule } from "./surfaceElo";
import type { computeServeReturnModule } from "./serveReturn";
import type { computeRecentFormModule } from "./recentForm";
import type { computeFatigueModule } from "./fatigue";
import type { computeHeadToHeadModule } from "./headToHead";
import type { MatchRecord, PlayerProfile, Surface } from "../tennisData/types";

/** How close the raw ensemble probability has to sit to 50 before the tie-break cascade kicks in. */
export const TIE_BAND = 3;
/** How far the cascade nudges the probability away from 50 once it picks a direction -- a genuine "52/48"-style lean, never a big swing. */
const TIE_NUDGE = 2.5;

export interface TieBreakerInputs {
  surfaceElo: ReturnType<typeof computeSurfaceEloModule>;
  serveReturn: ReturnType<typeof computeServeReturnModule>;
  recentForm: ReturnType<typeof computeRecentFormModule>;
  fatigue: ReturnType<typeof computeFatigueModule>;
  headToHead: ReturnType<typeof computeHeadToHeadModule>;
  player1: PlayerProfile;
  player2: PlayerProfile;
  player1Matches: MatchRecord[];
  player2Matches: MatchRecord[];
  surface: Surface;
}

export interface TieBreakerResult {
  applied: boolean;
  direction: 1 | -1 | 0;
  adjustedProbability: number;
  note: string | null;
  decidingStep: string | null;
}

function surfaceWinRateDiff(player1Matches: MatchRecord[], player2Matches: MatchRecord[], surface: Surface): number {
  const rate = (matches: MatchRecord[]) => {
    const onSurface = matches.filter((m) => m.surface === surface);
    if (onSurface.length === 0) return null;
    return onSurface.filter((m) => m.result === "W").length / onSurface.length;
  };
  const p1 = rate(player1Matches);
  const p2 = rate(player2Matches);
  if (p1 === null || p2 === null) return 0;
  return (p1 - p2) * 100;
}

function sign(value: number, threshold = 0.5): 1 | -1 | 0 {
  if (value > threshold) return 1;
  if (value < -threshold) return -1;
  return 0;
}

/**
 * Explicit priority-ordered tie-break cascade, used ONLY when the raw ensemble is genuinely close
 * to a coin flip (within `TIE_BAND` of 50) -- i.e. when averaging alone would otherwise just
 * report ~50/50 despite real (if individually modest) evidence pointing one way. Walks: Serve &
 * Return -> Surface Elo -> Recent Form -> surface-specific real win-rate history -> ranking ->
 * Fatigue/Head-to-Head as a last resort. The first step with a real, non-trivial signal decides
 * the direction; the engine always still shows a real (if small, e.g. 52/48) lean rather than
 * defaulting to an uninformative exact 50/50, and never inflates beyond the fixed small nudge.
 * When every step is genuinely silent (no data anywhere), the match stays at 50/50 -- an honest
 * "no evidence either way" rather than a manufactured lean.
 */
export function applyTieBreaker(rawEnsembleProbability: number, inputs: TieBreakerInputs): TieBreakerResult {
  if (Math.abs(rawEnsembleProbability - 50) >= TIE_BAND) {
    return { applied: false, direction: 0, adjustedProbability: rawEnsembleProbability, note: null, decidingStep: null };
  }

  const steps: Array<{ label: string; value: number }> = [
    { label: "Serve & Return", value: inputs.serveReturn.player1ServeRating + inputs.serveReturn.player1ReturnRating - inputs.serveReturn.player2ServeRating - inputs.serveReturn.player2ReturnRating },
    { label: "Surface Elo", value: inputs.surfaceElo.eloDifference },
    { label: "Recent Form", value: inputs.recentForm.player1Form - inputs.recentForm.player2Form },
    { label: "Surface-specific win-rate history", value: surfaceWinRateDiff(inputs.player1Matches, inputs.player2Matches, inputs.surface) },
    { label: "Ranking", value: inputs.player1.currentRank !== null && inputs.player2.currentRank !== null ? inputs.player2.currentRank - inputs.player1.currentRank : 0 },
    { label: "Fatigue", value: inputs.fatigue.player2FatigueScore - inputs.fatigue.player1FatigueScore },
    { label: "Head-to-Head", value: inputs.headToHead.weightedEdge * 100 },
  ];

  for (const step of steps) {
    const dir = sign(step.value);
    if (dir !== 0) {
      const adjusted = Math.round((50 + dir * TIE_NUDGE) * 10) / 10;
      return {
        applied: true,
        direction: dir,
        adjustedProbability: adjusted,
        decidingStep: step.label,
        note: `Core signals were essentially tied (raw ${rawEnsembleProbability.toFixed(1)}%), so the tie-break cascade used ${step.label} to settle on a real (if modest) lean toward ${dir === 1 ? inputs.player1.name : inputs.player2.name}.`,
      };
    }
  }

  return {
    applied: true,
    direction: 0,
    adjustedProbability: 50,
    decidingStep: null,
    note: "Core signals were tied and every tie-break step (Serve & Return, Surface Elo, Recent Form, surface history, ranking, Fatigue, Head-to-Head) was also silent -- this is a genuine coin-flip matchup, not an artificial default.",
  };
}
