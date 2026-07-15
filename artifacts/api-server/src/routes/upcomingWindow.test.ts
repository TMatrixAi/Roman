import { test } from "node:test";
import assert from "node:assert/strict";
import { collectUpcomingWindow } from "./upcomingWindow";
import type { Fixture } from "../services/tennisData/types";

const NOW_MS = new Date("2026-07-13T12:00:00Z").getTime();

function fixture(overrides: Partial<Fixture>): Fixture {
  return {
    id: "1",
    date: "2026-07-13",
    scheduledStart: "2026-07-13T13:00:00Z",
    timeConfirmed: true,
    isLive: false,
    tournamentName: "Test Open",
    tournamentLevel: null,
    round: null,
    surface: "Hard",
    indoor: null,
    matchFormat: "BestOf3",
    player1Id: "p1",
    player1Name: "Player One",
    player2Id: "p2",
    player2Name: "Player Two",
    ...overrides,
  };
}

/**
 * Builds a `fetchRange` stand-in from a plain by-date fixture map, mirroring how the real
 * provider's `getUpcomingFixturesRange` returns every fixture across the whole requested span in
 * one call. Also records how many range calls were made, so tests can assert the "single range
 * call instead of one call per day" performance property directly.
 */
function makeFetchRange(byDate: Record<string, Fixture[]>, callLog?: string[]) {
  return async (dateStart: string, dateStop: string): Promise<Fixture[]> => {
    callLog?.push(`${dateStart}:${dateStop}`);
    const results: Fixture[] = [];
    for (const [date, fixtures] of Object.entries(byDate)) {
      if (date >= dateStart && date <= dateStop) results.push(...fixtures);
    }
    return results;
  };
}

test("collectUpcomingWindow gathers matches across multiple calendar days, sorted soonest-first", async () => {
  const byDate: Record<string, Fixture[]> = {
    "2026-07-13": [fixture({ id: "today-late", scheduledStart: "2026-07-13T20:00:00Z" })],
    "2026-07-14": [fixture({ id: "tomorrow-early", date: "2026-07-14", scheduledStart: "2026-07-14T09:00:00Z" })],
  };

  const result = await collectUpcomingWindow(makeFetchRange(byDate), { limit: 50, nowMs: NOW_MS });

  assert.deepEqual(result.fixtures.map((f) => f.id), ["today-late", "tomorrow-early"]);
  assert.equal(result.hasMore, false);
});

test("collectUpcomingWindow keeps a fixture whose confirmed start time has already passed, flagged live and sorted first", async () => {
  const byDate: Record<string, Fixture[]> = {
    "2026-07-13": [
      fixture({ id: "already-started", scheduledStart: "2026-07-13T08:00:00Z", isLive: true }), // before NOW_MS
      fixture({ id: "not-started-yet", scheduledStart: "2026-07-13T13:00:00Z" }), // after NOW_MS
    ],
  };

  const result = await collectUpcomingWindow(makeFetchRange(byDate), { limit: 50, nowMs: NOW_MS });

  // Live sorts ahead of upcoming even though its own start time is earlier in the day.
  assert.deepEqual(result.fixtures.map((f) => f.id), ["already-started", "not-started-yet"]);
  assert.equal(result.fixtures[0].isLive, true);
});

test("collectUpcomingWindow keeps an unconfirmed (Time TBD) fixture rather than guessing whether it has started", async () => {
  const byDate: Record<string, Fixture[]> = {
    "2026-07-13": [fixture({ id: "tbd", scheduledStart: null, timeConfirmed: false })],
  };

  const result = await collectUpcomingWindow(makeFetchRange(byDate), { limit: 50, nowMs: NOW_MS });

  assert.deepEqual(result.fixtures.map((f) => f.id), ["tbd"]);
});

test("collectUpcomingWindow auto-extends the window further out when the near term is sparse", async () => {
  // Nothing at all for the first two 7-day batches -- the window must widen into a later batch
  // instead of returning an empty/truncated list.
  const byDate: Record<string, Fixture[]> = {
    "2026-07-27": [fixture({ id: "two-weeks-out", date: "2026-07-27", scheduledStart: "2026-07-27T13:00:00Z" })],
  };
  const callLog: string[] = [];

  const result = await collectUpcomingWindow(makeFetchRange(byDate, callLog), { limit: 50, nowMs: NOW_MS });

  assert.deepEqual(result.fixtures.map((f) => f.id), ["two-weeks-out"]);
  // A single real match found doesn't satisfy `limit: 50`, so the window keeps widening through
  // every batch up to MAX_LOOKAHEAD_DAYS (35 days / 7-day batches = 5 batches) -- but each batch
  // is still exactly ONE range call, never one call per day.
  assert.equal(callLog.length, 5);
  assert.deepEqual(callLog, [
    "2026-07-13:2026-07-19",
    "2026-07-20:2026-07-26",
    "2026-07-27:2026-08-02",
    "2026-08-03:2026-08-09",
    "2026-08-10:2026-08-16",
  ]);
});

test("collectUpcomingWindow fetches one range call per batch instead of one call per day", async () => {
  // Fills `limit` immediately in the first batch, so the window must stop widening right away --
  // and even that first batch is a single range call covering all 7 days, not 7 per-day calls.
  const byDate: Record<string, Fixture[]> = {
    "2026-07-13": Array.from({ length: 5 }, (_, i) => fixture({ id: `m${i}`, scheduledStart: `2026-07-13T${13 + i}:00:00Z` })),
  };
  const callLog: string[] = [];

  await collectUpcomingWindow(makeFetchRange(byDate, callLog), { limit: 3, nowMs: NOW_MS });

  assert.deepEqual(callLog, ["2026-07-13:2026-07-19"]); // one 7-day range call, not 7 per-day calls
});

test("collectUpcomingWindow caps the result at `limit`, keeping the soonest matches", async () => {
  const byDate: Record<string, Fixture[]> = {
    "2026-07-13": Array.from({ length: 5 }, (_, i) =>
      fixture({ id: `m${i}`, scheduledStart: `2026-07-13T${13 + i}:00:00Z` }),
    ),
  };

  const result = await collectUpcomingWindow(makeFetchRange(byDate), { limit: 3, nowMs: NOW_MS });

  assert.deepEqual(result.fixtures.map((f) => f.id), ["m0", "m1", "m2"]);
  assert.equal(result.hasMore, true);
});

test("collectUpcomingWindow pages further into the window using `offset`, and reports `hasMore` accurately", async () => {
  const byDate: Record<string, Fixture[]> = {
    "2026-07-13": Array.from({ length: 5 }, (_, i) =>
      fixture({ id: `m${i}`, scheduledStart: `2026-07-13T${13 + i}:00:00Z` }),
    ),
  };
  const fetchRange = makeFetchRange(byDate);

  const page1 = await collectUpcomingWindow(fetchRange, { limit: 3, nowMs: NOW_MS, offset: 0 });
  assert.deepEqual(page1.fixtures.map((f) => f.id), ["m0", "m1", "m2"]);
  assert.equal(page1.hasMore, true);

  const page2 = await collectUpcomingWindow(fetchRange, { limit: 3, nowMs: NOW_MS, offset: 3 });
  assert.deepEqual(page2.fixtures.map((f) => f.id), ["m3", "m4"]);
  assert.equal(page2.hasMore, false);
});

test("collectUpcomingWindow de-duplicates a fixture id seen more than once", async () => {
  const byDate: Record<string, Fixture[]> = {
    "2026-07-13": [fixture({ id: "dup", scheduledStart: "2026-07-13T13:00:00Z" }), fixture({ id: "dup", scheduledStart: "2026-07-13T13:00:00Z" })],
  };

  const result = await collectUpcomingWindow(makeFetchRange(byDate), { limit: 50, nowMs: NOW_MS });

  assert.equal(result.fixtures.length, 1);
});
