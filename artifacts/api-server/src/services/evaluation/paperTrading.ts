import { db, evaluationPredictionsTable, calibrationModelsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { getTennisDataProvider, ProviderUnavailableError, type TennisDataProvider } from "../tennisData";
import { runPredictionEngine } from "../predictionEngine";
import { resolveOpponentStrength } from "../predictionEngine/opponentStrength";
import { getUpcomingConditions } from "../predictionEngine/weather";
import { getPredictionSettings, settleEvaluationPrediction } from "./settle";
import { LIVE_MODEL_VERSION, type LiveFeatureSnapshot } from "./types";
import { logger } from "../../lib/logger";

/**
 * How long after a fixture's cutoff instant the cycle will still lock a fresh prediction for it.
 * This exists only to absorb the polling cadence of the periodic cycle (so a fixture whose
 * cutoff fell between two runs still gets caught) -- it is NOT a second, looser cutoff. Once this
 * grace period elapses with nothing locked, the fixture is marked 'missed' immediately, even
 * though the match itself may not have started yet. Locking a "pre-match" prediction late (close
 * to or after the intended cutoff) would defeat the point of a cutoff, so this window is kept
 * tight -- matched to the cycle's own polling interval, not to the match start time.
 */
const LOCK_GRACE_MINUTES = 15;

function todayPlus(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function getActiveCalibration() {
  const [active] = await db.select().from(calibrationModelsTable).where(eq(calibrationModelsTable.active, true)).limit(1);
  return active ?? null;
}

export interface PaperTradingCycleSummary {
  locked: number;
  missed: number;
  graded: number;
  errors: string[];
}

/**
 * One paper-trading cycle: (1) lock predictions for real upcoming fixtures whose cutoff has just
 * arrived, (2) mark fixtures whose cutoff passed unlocked as 'missed' (never backfilled), (3)
 * grade any pending predictions whose real result is now available. Safe to call repeatedly
 * (e.g. on a timer) -- every step is idempotent via the unique (runKind, provider,
 * externalFixtureId) index and the pending-only settlement guard.
 */
export async function runPaperTradingCycle(providerOverride?: TennisDataProvider): Promise<PaperTradingCycleSummary> {
  const summary: PaperTradingCycleSummary = { locked: 0, missed: 0, graded: 0, errors: [] };
  const settings = await getPredictionSettings();
  const provider = providerOverride ?? getTennisDataProvider();

  let fixtures;
  try {
    const [today, tomorrow] = await Promise.all([provider.getUpcomingFixtures(todayPlus(0)), provider.getUpcomingFixtures(todayPlus(1))]);
    fixtures = [...today, ...tomorrow];
  } catch (err) {
    if (err instanceof ProviderUnavailableError) {
      summary.errors.push(`Provider unavailable while fetching fixtures: ${err.message}`);
      return summary;
    }
    throw err;
  }

  const now = Date.now();

  for (const fixture of fixtures) {
    const scheduledStartAt = new Date(fixture.date);
    if (Number.isNaN(scheduledStartAt.getTime())) continue;

    const cutoffAt = new Date(scheduledStartAt.getTime() - settings.paperTradeLeadMinutes * 60_000);

    const [existing] = await db
      .select({ id: evaluationPredictionsTable.id })
      .from(evaluationPredictionsTable)
      .where(
        and(
          eq(evaluationPredictionsTable.runKind, "paper_trade"),
          eq(evaluationPredictionsTable.provider, provider.name),
          eq(evaluationPredictionsTable.externalFixtureId, fixture.id),
        ),
      );
    if (existing) continue;

    const lockDeadline = new Date(cutoffAt.getTime() + LOCK_GRACE_MINUTES * 60_000);

    if (now >= scheduledStartAt.getTime() || now >= lockDeadline.getTime()) {
      // Either the match has already started, or the lock grace window after cutoff has already
      // elapsed with nothing locked. Either way this is a miss -- we never generate a prediction
      // after the cutoff has meaningfully passed, and we never backfill.
      await db.insert(evaluationPredictionsTable).values({
        runKind: "paper_trade",
        provider: provider.name,
        externalFixtureId: fixture.id,
        player1Id: fixture.player1Id,
        player1Name: fixture.player1Name,
        player2Id: fixture.player2Id,
        player2Name: fixture.player2Name,
        surface: fixture.surface,
        matchFormat: fixture.matchFormat,
        tournamentLevel: fixture.tournamentLevel,
        tournamentName: fixture.tournamentName,
        scheduledStartAt,
        cutoffAt,
        lockedAt: new Date(),
        modelVersion: LIVE_MODEL_VERSION,
        featureSnapshot: null,
        rawProbability: null,
        calibratedProbability: null,
        predictedWinnerId: null,
        predictedWinnerName: null,
        status: "missed",
      });
      summary.missed += 1;
      continue;
    }

    if (now < cutoffAt.getTime()) continue; // not yet time to lock this one

    try {
      const [player1, player2] = await Promise.all([provider.getPlayer(fixture.player1Id), provider.getPlayer(fixture.player2Id)]);
      if (!player1 || !player2 || !fixture.surface || !fixture.matchFormat) {
        summary.errors.push(`Fixture ${fixture.id}: missing player profile or surface/format, skipped this cycle`);
        continue;
      }
      const [player1Matches, player2Matches, headToHead] = await Promise.all([
        provider.getPlayerMatches(fixture.player1Id),
        provider.getPlayerMatches(fixture.player2Id),
        provider.getHeadToHead(fixture.player1Id, fixture.player2Id),
      ]);

      const [player1OpponentStrength, player2OpponentStrength, activeCalibration, weather] = await Promise.all([
        resolveOpponentStrength(player1Matches),
        resolveOpponentStrength(player2Matches),
        getActiveCalibration(),
        getUpcomingConditions(fixture.tournamentName, scheduledStartAt),
      ]);

      const output = runPredictionEngine({
        player1,
        player2,
        player1Matches,
        player2Matches,
        headToHead,
        surface: fixture.surface,
        matchFormat: fixture.matchFormat,
        player1OpponentElo: player1OpponentStrength.lookup,
        player2OpponentElo: player2OpponentStrength.lookup,
        activeCalibration: activeCalibration?.mapping ?? null,
        weather,
      });

      // The engine already applies the active Phase-4 calibration internally when one exists (see
      // predictionEngine/index.ts), so its own `calibratedProbability` output IS the final,
      // validated probability here -- no separate post-hoc calibration step is needed anymore.
      const calibratedProbability = output.calibratedProbability;
      const rawProbability = output.rawEnsembleProbability; // pre-calibration, kept for transparency/future refitting

      const favorsPlayer1 = calibratedProbability >= 50;
      const snapshot: LiveFeatureSnapshot = {
        modelVersion: LIVE_MODEL_VERSION,
        engine: output.engine,
        preCalibrationProbability: rawProbability,
      };

      await db.insert(evaluationPredictionsTable).values({
        runKind: "paper_trade",
        provider: provider.name,
        externalFixtureId: fixture.id,
        player1Id: player1.id,
        player1Name: player1.name,
        player2Id: player2.id,
        player2Name: player2.name,
        surface: fixture.surface,
        matchFormat: fixture.matchFormat,
        tournamentLevel: fixture.tournamentLevel,
        tournamentName: fixture.tournamentName,
        scheduledStartAt,
        cutoffAt,
        lockedAt: new Date(),
        modelVersion: LIVE_MODEL_VERSION,
        featureSnapshot: snapshot,
        rawProbability,
        calibratedProbability,
        predictedWinnerId: favorsPlayer1 ? player1.id : player2.id,
        predictedWinnerName: favorsPlayer1 ? player1.name : player2.name,
        status: "pending",
      });
      summary.locked += 1;
    } catch (err) {
      if (err instanceof ProviderUnavailableError) {
        summary.errors.push(`Fixture ${fixture.id}: provider unavailable (${err.message})`);
        continue;
      }
      throw err;
    }
  }

  summary.graded = await gradePendingPaperTrades(summary.errors, provider);
  return summary;
}

async function gradePendingPaperTrades(errors: string[], providerOverride?: TennisDataProvider): Promise<number> {
  const settings = await getPredictionSettings();
  const provider = providerOverride ?? getTennisDataProvider();
  const pending = await db
    .select()
    .from(evaluationPredictionsTable)
    .where(and(eq(evaluationPredictionsTable.runKind, "paper_trade"), eq(evaluationPredictionsTable.status, "pending")));

  let gradedCount = 0;
  for (const row of pending) {
    // Only attempt grading once the match's scheduled start is safely in the past.
    if (Date.now() < row.scheduledStartAt.getTime() + 60 * 60_000) continue;

    try {
      const matches = await provider.getPlayerMatches(row.player1Id);
      const scheduledDay = row.scheduledStartAt.toISOString().slice(0, 10);
      const match = matches.find((m) => m.opponentId === row.player2Id && Math.abs(new Date(m.date).getTime() - row.scheduledStartAt.getTime()) < 3 * 24 * 60 * 60_000);

      if (!match) {
        // No result surfaced after a generous window -- treat as cancelled rather than leaving
        // it pending forever or silently discarding it.
        if (Date.now() > row.scheduledStartAt.getTime() + 48 * 60 * 60_000) {
          await settleEvaluationPrediction(row.id, { actualWinnerId: null, actualWinnerName: null, resultType: "cancelled" }, settings);
          gradedCount += 1;
        }
        continue;
      }

      const winnerId = match.result === "W" ? row.player1Id : row.player2Id;
      const winnerName = winnerId === row.player1Id ? row.player1Name : row.player2Name;
      const resultType = match.walkover ? "walkover" : match.retired ? "retired" : "normal";

      await settleEvaluationPrediction(row.id, { actualWinnerId: winnerId, actualWinnerName: winnerName, resultType }, settings);
      gradedCount += 1;
    } catch (err) {
      if (err instanceof ProviderUnavailableError) {
        errors.push(`Grading prediction ${row.id}: provider unavailable (${err.message})`);
        continue;
      }
      logger.error({ err, predictionId: row.id }, "Unexpected error grading paper-trade prediction");
      errors.push(`Grading prediction ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return gradedCount;
}
