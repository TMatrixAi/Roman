// Targeted unit tests for the self-advancing incremental backfill (Task #144). Uses a synthetic
// row inserted directly (not a real provider fetch) to pin down "latest covered date" precisely,
// and a fake provider so a "nothing new yet" run can assert it never even calls the provider --
// running the REAL pipeline over a real multi-hundred-day gap against the live provider (as the
// job would need to on first use after this task) is far too slow/expensive for a unit test; see
// `leakage.test.ts` for the tests that exercise `runHistoricalBackfill` itself against real data.
//
// Never wipes or assumes an exact count of the shared `historical_matches` table (Task #144 memory
// re: test isolation against live tables) -- inserts one synthetic row far enough in the future to
// deterministically be the new global max, then deletes exactly that row in a `finally`.
import test from "node:test";
import assert from "node:assert/strict";
import { db, historicalMatchesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getLatestCoveredMatchDate, runIncrementalHistoricalBackfill } from "./backfill";
import type { TennisDataProvider } from "../tennisData/types";

const SYNTHETIC_EXTERNAL_ID = "test-backfill-incremental-synthetic-row";

async function insertSyntheticMatch(scheduledStartAt: Date): Promise<number> {
  const [row] = await db
    .insert(historicalMatchesTable)
    .values({
      externalId: SYNTHETIC_EXTERNAL_ID,
      provider: "API-Tennis",
      tour: "ATP",
      tournamentName: "Test Synthetic Tournament",
      tournamentLevel: "ATP250",
      surface: "Hard",
      round: "F",
      matchFormat: "BestOf3",
      player1Id: "test-player-1",
      player1Name: "Test Playerone",
      player2Id: "test-player-2",
      player2Name: "Test Playertwo",
      winnerId: "test-player-1",
      score: "6-4 6-4",
      retired: false,
      walkover: false,
      cancelled: false,
      gameMarginsPlayer1: [],
      scheduledStartAt,
      scheduledStartTimeConfirmed: true,
      cutoffMinutes: 30,
      cutoffAt: new Date(scheduledStartAt.getTime() - 30 * 60_000),
      rawSource: {},
    })
    .returning({ id: historicalMatchesTable.id });
  return row.id;
}

async function deleteSyntheticMatch(id: number): Promise<void> {
  await db.delete(historicalMatchesTable).where(eq(historicalMatchesTable.id, id));
}

const rejectingProvider: TennisDataProvider = new Proxy(
  {},
  {
    get() {
      throw new Error("Provider must not be called when there is nothing new to fetch");
    },
  },
) as TennisDataProvider;

test("getLatestCoveredMatchDate reflects the most recent scheduledStartAt in historical_matches", async () => {
  // Far enough in the future to be guaranteed the new global max regardless of real data.
  const future = new Date("2099-06-15T12:00:00.000Z");
  const id = await insertSyntheticMatch(future);
  try {
    const latest = await getLatestCoveredMatchDate();
    assert.equal(latest, "2099-06-15");
  } finally {
    await deleteSyntheticMatch(id);
  }
});

test("runIncrementalHistoricalBackfill skips (without calling the provider) once already caught up through yesterday", async () => {
  // "Today" as the latest covered date means dateStart (tomorrow) > dateStop (yesterday) -- the
  // job must recognize there's nothing new to fetch yet and skip, not call the provider at all.
  const today = new Date();
  const id = await insertSyntheticMatch(today);
  try {
    const result = await runIncrementalHistoricalBackfill(rejectingProvider);
    assert.equal(result.skipped, true);
    assert.equal(result.summary, null);
    assert.ok(result.skippedReason && result.skippedReason.length > 0);
  } finally {
    await deleteSyntheticMatch(id);
  }
});
