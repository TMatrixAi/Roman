import { db, historicalMatchesTable, matchFeatureSnapshotsTable } from "@workspace/db";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import { logger } from "../../lib/logger";
import type { Surface, TennisDataProvider, HistoricalFixture } from "../tennisData/types";
import { applyMatchResult, computeFeatures, createPlayerState, type PlayerState } from "./features";
import { CUTOFF_MINUTES, DEFAULT_CUTOFF, type BackfillOptions, type BackfillSummary, type CutoffOption } from "./types";

type GameMargins = Array<{ player1Games: number; player2Games: number }>;

interface StoredMatchForFold {
  player1Id: string;
  player2Id: string;
  winnerId: string | null;
  cancelled: boolean;
  surface: Surface | null;
  scheduledStartAt: Date;
  gameMarginsPlayer1: GameMargins;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function chunkDateRange(dateStart: string, dateStop: string, chunkDays: number): Array<[string, string]> {
  const chunks: Array<[string, string]> = [];
  let cursor = dateStart;
  while (cursor <= dateStop) {
    const chunkEnd = addDays(cursor, chunkDays - 1);
    chunks.push([cursor, chunkEnd > dateStop ? dateStop : chunkEnd]);
    cursor = addDays(chunkEnd > dateStop ? dateStop : chunkEnd, 1);
  }
  return chunks;
}

/** Parses provider date+time into a UTC Date. Provider does not disclose the fixture's timezone, so this is treated as-is (a documented limitation, not silently corrected). */
function toScheduledStart(fixture: HistoricalFixture): Date {
  const time = fixture.time ?? "00:00";
  return new Date(`${fixture.date}T${time}:00.000Z`);
}

function gameShareFor(margins: GameMargins, forPlayer1: boolean): number | null {
  if (margins.length === 0) return null;
  let won = 0;
  let total = 0;
  for (const m of margins) {
    won += forPlayer1 ? m.player1Games : m.player2Games;
    total += m.player1Games + m.player2Games;
  }
  return total > 0 ? won / total : null;
}

function getOrCreateState(playerStates: Map<string, PlayerState>, playerId: string): PlayerState {
  let state = playerStates.get(playerId);
  if (!state) {
    state = createPlayerState();
    playerStates.set(playerId, state);
  }
  return state;
}

/**
 * Folds one already-decided match's result into both players' running state. Used for THREE
 * distinct cases that must all agree on the exact same logic: (1) a freshly-inserted match this
 * run, (2) a duplicate match this run already stored by an earlier run (still needs to inform
 * this run's in-memory state), and (3) hydration -- replaying a player's entire prior real
 * history from the database at the start of a run, so a later run always continues from full
 * history rather than cold-starting Elo/form at zero.
 */
function foldMatchIntoStates(playerStates: Map<string, PlayerState>, match: StoredMatchForFold): void {
  if (match.cancelled || match.winnerId === null) return;

  const state1 = getOrCreateState(playerStates, match.player1Id);
  const state2 = getOrCreateState(playerStates, match.player2Id);

  const player1Won = match.winnerId === match.player1Id;
  const gameShare1 = gameShareFor(match.gameMarginsPlayer1, true);
  const gameShare2 = gameShare1 === null ? null : 1 - gameShare1;

  const preMatchElo1 = state1.eloOverall;
  const preMatchElo2 = state2.eloOverall;
  const preMatchEloSurface1 = match.surface ? (state1.eloBySurface[match.surface] ?? null) : null;
  const preMatchEloSurface2 = match.surface ? (state2.eloBySurface[match.surface] ?? null) : null;

  applyMatchResult(state1, preMatchElo2, preMatchEloSurface2, match.scheduledStartAt, match.surface, player1Won, gameShare1);
  applyMatchResult(state2, preMatchElo1, preMatchEloSurface1, match.scheduledStartAt, match.surface, !player1Won, gameShare2);
}

/**
 * Rebuilds every player's running feature state strictly from matches already stored in the
 * database with `scheduledStartAt < beforeTimestamp`, replayed in the same chronological order
 * they originally happened. This is what makes the pipeline safe to run incrementally in
 * separate process invocations: a later run never cold-starts a player's Elo/form history just
 * because it happens to run in a new process.
 */
async function hydratePlayerStates(beforeTimestamp: Date): Promise<Map<string, PlayerState>> {
  const playerStates = new Map<string, PlayerState>();

  const priorMatches = await db
    .select({
      id: historicalMatchesTable.id,
      player1Id: historicalMatchesTable.player1Id,
      player2Id: historicalMatchesTable.player2Id,
      winnerId: historicalMatchesTable.winnerId,
      cancelled: historicalMatchesTable.cancelled,
      surface: historicalMatchesTable.surface,
      scheduledStartAt: historicalMatchesTable.scheduledStartAt,
      gameMarginsPlayer1: historicalMatchesTable.gameMarginsPlayer1,
    })
    .from(historicalMatchesTable)
    .where(lt(historicalMatchesTable.scheduledStartAt, beforeTimestamp))
    .orderBy(asc(historicalMatchesTable.scheduledStartAt), asc(historicalMatchesTable.id));

  for (const row of priorMatches) {
    foldMatchIntoStates(playerStates, {
      player1Id: row.player1Id,
      player2Id: row.player2Id,
      winnerId: row.winnerId,
      cancelled: row.cancelled,
      surface: row.surface as Surface | null,
      scheduledStartAt: row.scheduledStartAt,
      gameMarginsPlayer1: (row.gameMarginsPlayer1 as GameMargins) ?? [],
    });
  }

  logger.info({ beforeTimestamp, priorMatchCount: priorMatches.length, playersHydrated: playerStates.size }, "Hydrated player state from stored history");
  return playerStates;
}

/**
 * Runs a leak-proof historical backfill over [dateStart, dateStop]. Matches are fetched in
 * chronological chunks and processed strictly in ascending (date, time, externalId) order so
 * that every player's running state (Elo, recent form, ...) used to build match N's snapshot
 * contains only matches strictly before match N -- never match N itself, and never anything
 * later. Idempotent: matches already present (by provider + externalId) are skipped, but their
 * presence does not update the in-memory state for THIS run (the fully-reprocessed run always
 * derives features fresh); re-running a fully-imported range is a safe no-op other than
 * refreshing the summary.
 */
export async function runHistoricalBackfill(
  provider: TennisDataProvider,
  options: BackfillOptions,
): Promise<BackfillSummary> {
  const startedAt = Date.now();
  const cutoff = options.cutoff ?? DEFAULT_CUTOFF;
  if (!(cutoff in CUTOFF_MINUTES)) {
    throw new Error(`Invalid cutoff "${cutoff}". Must be one of: ${Object.keys(CUTOFF_MINUTES).join(", ")}`);
  }
  const cutoffMinutes = CUTOFF_MINUTES[cutoff as CutoffOption];

  // Provider is known (verified live 2026-07-11) to return HTTP 500 on ~2-week+ windows during
  // busy periods -- payloads for even a single week can run into the tens of megabytes. 5 days
  // is a safe default; callers can override for known-sparser historical periods.
  const chunkDays = options.chunkDays ?? 5;
  if (!Number.isInteger(chunkDays) || chunkDays < 1) {
    throw new Error(`Invalid chunkDays "${options.chunkDays}". Must be a positive integer.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.dateStart) || Number.isNaN(Date.parse(options.dateStart))) {
    throw new Error(`Invalid dateStart "${options.dateStart}". Must be YYYY-MM-DD.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.dateStop) || Number.isNaN(Date.parse(options.dateStop))) {
    throw new Error(`Invalid dateStop "${options.dateStop}". Must be YYYY-MM-DD.`);
  }
  if (options.dateStart > options.dateStop) {
    throw new Error(`dateStart (${options.dateStart}) must not be after dateStop (${options.dateStop}).`);
  }

  const chunks = chunkDateRange(options.dateStart, options.dateStop, chunkDays);

  const summary: BackfillSummary = {
    dateStart: options.dateStart,
    dateStop: options.dateStop,
    cutoff,
    cutoffMinutes,
    fixturesFetched: 0,
    matchesInserted: 0,
    matchesSkippedDuplicate: 0,
    matchesSkippedNoTerminalResult: 0,
    featureRowsInserted: 0,
    byTour: {},
    bySurface: {},
    earliestImportedMatchDate: null,
    latestImportedMatchDate: null,
    durationMs: 0,
  };

  // Hydrate from everything already stored strictly before this run's window -- this is what
  // makes running the pipeline across multiple separate process invocations safe: a run started
  // fresh never cold-starts a continuing player's Elo/form history.
  const runWindowStart = new Date(`${options.dateStart}T00:00:00.000Z`);
  const playerStates = await hydratePlayerStates(runWindowStart);

  for (const [chunkStart, chunkEnd] of chunks) {
    logger.info({ chunkStart, chunkEnd }, "Fetching historical fixtures chunk");
    const fixtures = await provider.getCompletedMatchesByDateRange(chunkStart, chunkEnd);
    summary.fixturesFetched += fixtures.length;

    // Sort ascending within the chunk; chunks themselves are already non-overlapping and in
    // ascending order, so this guarantees a fully correct global chronological pass.
    const sorted = [...fixtures].sort((a, b) => {
      const aStart = toScheduledStart(a).getTime();
      const bStart = toScheduledStart(b).getTime();
      if (aStart !== bStart) return aStart - bStart;
      return a.id.localeCompare(b.id);
    });

    for (const fixture of sorted) {
      if (!fixture.cancelled && fixture.winnerId === null) {
        summary.matchesSkippedNoTerminalResult += 1;
        continue;
      }

      const [existing] = await db
        .select({
          id: historicalMatchesTable.id,
          winnerId: historicalMatchesTable.winnerId,
          cancelled: historicalMatchesTable.cancelled,
          surface: historicalMatchesTable.surface,
          scheduledStartAt: historicalMatchesTable.scheduledStartAt,
          cutoffAt: historicalMatchesTable.cutoffAt,
          gameMarginsPlayer1: historicalMatchesTable.gameMarginsPlayer1,
        })
        .from(historicalMatchesTable)
        .where(and(eq(historicalMatchesTable.provider, fixture.provider), eq(historicalMatchesTable.externalId, fixture.id)));

      if (existing) {
        // Defense in depth: match row + its feature snapshots are written in one DB transaction
        // (see below), so a match can never legitimately exist without exactly the feature
        // snapshots that WOULD be computed for it right now, given the identical running state.
        // Because we process strictly in chronological order and playerStates has already been
        // folded up through every match before this one (via hydration + this run's own earlier
        // matches), computeFeatures() on that exact state reproduces exactly what the pipeline
        // computed at import time -- not a heuristic, the same function the insert path uses. If
        // the persisted count doesn't match, that's real data loss (e.g. a row from before this
        // transaction was introduced); fail fast rather than silently treating it as a normal
        // duplicate, which would permanently lose the mismatch with no repair path.
        if (!existing.cancelled && existing.winnerId !== null) {
          const state1 = getOrCreateState(playerStates, fixture.player1Id);
          const state2 = getOrCreateState(playerStates, fixture.player2Id);
          const surface = existing.surface as Surface | null;
          const expectedCount =
            computeFeatures(state1, surface).filter((f) => f.sourceTimestamp.getTime() < existing.cutoffAt.getTime()).length +
            computeFeatures(state2, surface).filter((f) => f.sourceTimestamp.getTime() < existing.cutoffAt.getTime()).length;

          if (expectedCount > 0) {
            const [row] = await db
              .select({ count: sql<number>`count(*)::int` })
              .from(matchFeatureSnapshotsTable)
              .where(eq(matchFeatureSnapshotsTable.matchId, existing.id));
            if ((row?.count ?? 0) !== expectedCount) {
              throw new Error(
                `Data integrity violation: historical match id=${existing.id} (provider=${fixture.provider}, externalId=${fixture.id}) ` +
                  `has ${row?.count ?? 0} feature snapshot(s) stored but ${expectedCount} expected from its players' running state at ` +
                  `import time. This should be impossible given transactional writes -- investigate and repair (e.g. delete the ` +
                  `orphaned match row so it can be re-imported) before continuing.`,
              );
            }
          }
        }

        summary.matchesSkippedDuplicate += 1;
        // Already stored (by this run or an earlier one) -- don't re-insert or re-snapshot, but
        // DO fold it into this run's in-memory state so later matches in this same run still see
        // it, matching what hydration would have done had this row existed before the run started.
        foldMatchIntoStates(playerStates, {
          player1Id: fixture.player1Id,
          player2Id: fixture.player2Id,
          winnerId: existing.winnerId,
          cancelled: existing.cancelled,
          surface: existing.surface as Surface | null,
          scheduledStartAt: existing.scheduledStartAt,
          gameMarginsPlayer1: (existing.gameMarginsPlayer1 as GameMargins) ?? [],
        });
        continue;
      }

      const scheduledStartAt = toScheduledStart(fixture);
      const cutoffAt = new Date(scheduledStartAt.getTime() - cutoffMinutes * 60_000);

      const state1 = getOrCreateState(playerStates, fixture.player1Id);
      const state2 = getOrCreateState(playerStates, fixture.player2Id);

      const features1 = computeFeatures(state1, fixture.surface);
      const features2 = computeFeatures(state2, fixture.surface);

      const featureRows = [
        ...features1.map((f) => ({ playerId: fixture.player1Id, ...f })),
        ...features2.map((f) => ({ playerId: fixture.player2Id, ...f })),
      ]
        // Defense in depth: never write a feature whose own source timestamp fails its cutoff
        // check, even though computeFeatures() only ever draws from strictly-earlier matches.
        .filter((f) => f.sourceTimestamp.getTime() < cutoffAt.getTime());

      // The match row and ALL of its frozen feature snapshots must land together or not at all --
      // otherwise a process failure between the two inserts would leave an orphaned match with no
      // snapshots, and the idempotency check above would treat it as already-imported forever,
      // silently and permanently losing that match's features with no repair path.
      await db.transaction(async (tx) => {
        const [insertedMatch] = await tx
          .insert(historicalMatchesTable)
          .values({
            externalId: fixture.id,
            provider: fixture.provider,
            tour: fixture.tour,
            tournamentName: fixture.tournamentName,
            tournamentLevel: fixture.tournamentLevel,
            surface: fixture.surface,
            round: fixture.round,
            matchFormat: fixture.matchFormat,
            player1Id: fixture.player1Id,
            player1Name: fixture.player1Name,
            player2Id: fixture.player2Id,
            player2Name: fixture.player2Name,
            winnerId: fixture.winnerId,
            score: fixture.score,
            retired: fixture.retired,
            walkover: fixture.walkover,
            cancelled: fixture.cancelled,
            scheduledStartAt,
            cutoffMinutes,
            cutoffAt,
            gameMarginsPlayer1: fixture.setGameMargins,
            rawSource: fixture.raw as object,
          })
          .returning({ id: historicalMatchesTable.id });

        if (featureRows.length > 0) {
          await tx.insert(matchFeatureSnapshotsTable).values(
            featureRows.map((f) => ({
              matchId: insertedMatch.id,
              playerId: f.playerId,
              featureName: f.featureName,
              featureValue: f.featureValue,
              sourceTimestamp: f.sourceTimestamp,
              matchCutoffAt: cutoffAt,
              existedBeforeCutoff: true,
            })),
          );
        }
      });

      summary.matchesInserted += 1;
      summary.featureRowsInserted += featureRows.length;
      summary.byTour[fixture.tour ?? "Unknown"] = (summary.byTour[fixture.tour ?? "Unknown"] ?? 0) + 1;
      summary.bySurface[fixture.surface ?? "Unknown"] = (summary.bySurface[fixture.surface ?? "Unknown"] ?? 0) + 1;
      if (!summary.earliestImportedMatchDate || fixture.date < summary.earliestImportedMatchDate) {
        summary.earliestImportedMatchDate = fixture.date;
      }
      if (!summary.latestImportedMatchDate || fixture.date > summary.latestImportedMatchDate) {
        summary.latestImportedMatchDate = fixture.date;
      }

      // Only now, after both snapshots are captured and written, fold this match's own result
      // into each player's running state so it can inform LATER matches (this run's, or a
      // future run's -- via hydration).
      foldMatchIntoStates(playerStates, {
        player1Id: fixture.player1Id,
        player2Id: fixture.player2Id,
        winnerId: fixture.winnerId,
        cancelled: fixture.cancelled,
        surface: fixture.surface,
        scheduledStartAt,
        gameMarginsPlayer1: fixture.setGameMargins,
      });
    }
  }

  summary.durationMs = Date.now() - startedAt;
  logger.info({ summary }, "Historical backfill complete");
  return summary;
}
