import { db, matchFeatureSnapshotsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { HISTORICAL_MODEL_VERSION, type HistoricalFeatureSnapshot, type PlayerReducedFeatures } from "./types";

/**
 * Scores a historical match using ONLY the reduced, leak-proof feature set Phase 3's backfill
 * actually stored per player before the match's cutoff (Elo overall/surface, recent win% and
 * game-share, sample size). This mirrors the shape of the live ensemble's edge-and-logistic
 * approach but is a deliberately reduced reconstruction -- see HistoricalFeatureSnapshot's
 * docstring for why it cannot be bit-identical to the live multi-module engine.
 *
 * Returns null when either player has zero prior recorded matches -- there is no honest
 * probability to produce for a total debutant, so the caller must treat this match as
 * "insufficient data" rather than force a fabricated 50/50 guess into the accuracy denominator.
 */
export async function scoreHistoricalMatch(
  matchId: number,
  player1Id: string,
  player2Id: string,
): Promise<{ rawProbability: number; snapshot: HistoricalFeatureSnapshot } | null> {
  const rows = await db.select().from(matchFeatureSnapshotsTable).where(eq(matchFeatureSnapshotsTable.matchId, matchId));

  const p1 = reduceFeatures(rows, player1Id);
  const p2 = reduceFeatures(rows, player2Id);

  if (p1.matchesPlayed === 0 || p2.matchesPlayed === 0) return null;

  const elo1 = p1.eloSurface ?? p1.eloOverall ?? 1500;
  const elo2 = p2.eloSurface ?? p2.eloOverall ?? 1500;
  const eloEdge = (elo1 - elo2) / 400;

  const form1 = p1.winPctLast10 ?? 0.5;
  const form2 = p2.winPctLast10 ?? 0.5;
  const formEdge = form1 - form2;

  const gameShare1 = p1.gameShareLast10 ?? 0.5;
  const gameShare2 = p2.gameShareLast10 ?? 0.5;
  const gameShareEdge = gameShare1 - gameShare2;

  // Weighted, logistic-squashed blend: Elo carries the most signal (it already encodes long-run
  // strength), form and game share are secondary corrections. Weights are fixed constants, not
  // fit on any data -- the walk-forward calibration step is what learns from data.
  const combinedEdge = eloEdge * 1.0 + formEdge * 1.5 + gameShareEdge * 1.2;
  const rawProbability = 1 / (1 + Math.exp(-combinedEdge));

  return {
    rawProbability,
    snapshot: {
      modelVersion: HISTORICAL_MODEL_VERSION,
      player1: p1,
      player2: p2,
      eloEdge,
      formEdge,
      gameShareEdge,
    },
  };
}

function reduceFeatures(
  rows: Array<{ playerId: string; featureName: string; featureValue: number }>,
  playerId: string,
): PlayerReducedFeatures {
  const forPlayer = rows.filter((r) => r.playerId === playerId);
  const get = (name: string): number | null => forPlayer.find((r) => r.featureName === name)?.featureValue ?? null;

  return {
    matchesPlayed: get("matchesPlayed") ?? 0,
    eloOverall: get("eloOverall"),
    eloSurface: get("eloSurface"),
    winPctLast10: get("winPctLast10"),
    gameShareLast10: get("gameShareLast10"),
  };
}
