// Integration test for the Phase 4 live paper-trading cycle. A fake TennisDataProvider stands
// in for the real API so the test controls exactly what "now" looks like relative to a fixture's
// cutoff -- the property under test is the cutoff/lock-grace boundary: a fixture must be locked
// once its cutoff arrives, must be marked 'missed' once the lock grace window after cutoff
// elapses (even though the match hasn't started yet), and must never be locked late.
// Run with: pnpm --filter @workspace/api-server run test:evaluation -- (or add to that script)
import test from "node:test";
import assert from "node:assert/strict";
import { db, evaluationPredictionsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { runPaperTradingCycle } from "./paperTrading";
import type {
  TennisDataProvider,
  PlayerSummary,
  PlayerProfile,
  MatchRecord,
  Fixture,
  HeadToHeadRecord,
  ProviderStatusInfo,
} from "../tennisData";

const PROVIDER_NAME = "fake-paper-trade-test-provider";

class FakeProvider implements TennisDataProvider {
  readonly name = PROVIDER_NAME;
  constructor(private fixtures: Fixture[]) {}

  async searchPlayers(): Promise<PlayerSummary[]> {
    return [];
  }
  async getPlayer(playerId: string): Promise<PlayerProfile | null> {
    return { id: playerId, name: playerId, fullName: null, countryCode: null, currentRank: null, tour: "ATP", age: null, plays: null };
  }
  async getPlayerMatches(): Promise<MatchRecord[]> {
    return [];
  }
  async getUpcomingFixtures(date: string): Promise<Fixture[]> {
    return this.fixtures.filter((f) => f.date.slice(0, 10) === date);
  }
  async getUpcomingFixturesRange(dateStart: string, dateStop: string): Promise<Fixture[]> {
    return this.fixtures.filter((f) => f.date.slice(0, 10) >= dateStart && f.date.slice(0, 10) <= dateStop);
  }
  async getHeadToHead(player1Id: string, player2Id: string): Promise<HeadToHeadRecord> {
    return { player1Id, player2Id, meetings: [] };
  }
  async getCompletedMatchesByDateRange(): Promise<never[]> {
    return [];
  }
  getStatus(): ProviderStatusInfo {
    return { provider: this.name, connected: true, lastSuccessfulCallAt: null, lastError: null };
  }
}

function isoDaysFromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function makeFixture(id: string, startOffsetMs: number): Fixture {
  const scheduledStart = isoDaysFromNow(startOffsetMs);
  return {
    id,
    date: scheduledStart.slice(0, 10),
    scheduledStart,
    timeConfirmed: true,
    tournamentName: "Paper Trade Test Series",
    tournamentLevel: "ATP250",
    round: null,
    surface: "Hard",
    indoor: false,
    matchFormat: "BestOf3",
    player1Id: `${id}-p1`,
    player1Name: `${id}-p1`,
    player2Id: `${id}-p2`,
    player2Name: `${id}-p2`,
  };
}

test("paper trading cycle: locks at cutoff, misses once the lock-grace window elapses, never locks late", async (t) => {
  const MINUTE = 60_000;
  const LEAD_MINUTES = 30; // matches predictionSettingsTable default paperTradeLeadMinutes
  const GRACE_MINUTES = 15; // matches LOCK_GRACE_MINUTES in paperTrading.ts

  // A: starts far in the future -- cutoff hasn't arrived yet, must be untouched this cycle.
  const notYetDue = makeFixture("ptt-not-due", (LEAD_MINUTES + 60) * MINUTE);
  // B: cutoff arrived a few minutes ago, well inside the lock grace window -- must be locked.
  const withinGrace = makeFixture("ptt-within-grace", (LEAD_MINUTES - 5) * MINUTE);
  // C: cutoff passed more than the grace window ago, but match hasn't started -- must be missed,
  //    not locked (this is the exact regression this test guards against).
  const pastGrace = makeFixture("ptt-past-grace", (LEAD_MINUTES - GRACE_MINUTES - 5) * MINUTE);
  // D: match has already started with nothing ever locked -- must be missed.
  const alreadyStarted = makeFixture("ptt-already-started", -5 * MINUTE);

  const provider = new FakeProvider([notYetDue, withinGrace, pastGrace, alreadyStarted]);

  t.after(async () => {
    await db.delete(evaluationPredictionsTable).where(eq(evaluationPredictionsTable.provider, PROVIDER_NAME));
  });

  const summary = await runPaperTradingCycle(provider);

  const rows = await db
    .select()
    .from(evaluationPredictionsTable)
    .where(
      inArray(evaluationPredictionsTable.externalFixtureId, [notYetDue.id, withinGrace.id, pastGrace.id, alreadyStarted.id]),
    );
  const byId = Object.fromEntries(rows.map((r) => [r.externalFixtureId, r]));

  assert.equal(byId[notYetDue.id], undefined, "a fixture whose cutoff hasn't arrived must not get any row yet");

  assert.ok(byId[withinGrace.id], "a fixture inside its lock-grace window must be locked");
  assert.equal(byId[withinGrace.id].status, "pending");
  assert.ok(byId[withinGrace.id].predictedWinnerId, "a locked prediction must carry a real predicted winner");

  assert.ok(byId[pastGrace.id], "a fixture whose lock-grace window elapsed must get a terminal row");
  assert.equal(byId[pastGrace.id].status, "missed", "must be marked missed, not locked late, once the grace window elapses");
  assert.equal(byId[pastGrace.id].predictedWinnerId, null, "a missed fixture must never carry a fabricated prediction");

  assert.ok(byId[alreadyStarted.id]);
  assert.equal(byId[alreadyStarted.id].status, "missed");

  assert.equal(summary.locked, 1);
  assert.equal(summary.missed, 2);
});
