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

test("collectUpcomingWindow gathers matches across multiple calendar days, sorted soonest-first", async () => {
  const byDate: Record<string, Fixture[]> = {
    "2026-07-13": [fixture({ id: "today-late", scheduledStart: "2026-07-13T20:00:00Z" })],
    "2026-07-14": [fixture({ id: "tomorrow-early", date: "2026-07-14", scheduledStart: "2026-07-14T09:00:00Z" })],
  };
  const fetchDay = async (date: string) => byDate[date] ?? [];

  const result = await collectUpcomingWindow(fetchDay, { limit: 50, nowMs: NOW_MS });

  assert.deepEqual(result.fixtures.map((f) => f.id), ["today-late", "tomorrow-early"]);
  assert.equal(result.hasMore, false);
});

test("collectUpcomingWindow excludes a fixture whose confirmed start time has already passed (in-progress)", async () => {
  const byDate: Record<string, Fixture[]> = {
    "2026-07-13": [
      fixture({ id: "already-started", scheduledStart: "2026-07-13T08:00:00Z" }), // before NOW_MS
      fixture({ id: "not-started-yet", scheduledStart: "2026-07-13T13:00:00Z" }), // after NOW_MS
    ],
  };
  const fetchDay = async (date: string) => byDate[date] ?? [];

  const result = await collectUpcomingWindow(fetchDay, { limit: 50, nowMs: NOW_MS });

  assert.deepEqual(result.fixtures.map((f) => f.id), ["not-started-yet"]);
});

test("collectUpcomingWindow keeps an unconfirmed (Time TBD) fixture rather than guessing whether it has started", async () => {
  const byDate: Record<string, Fixture[]> = {
    "2026-07-13": [fixture({ id: "tbd", scheduledStart: null, timeConfirmed: false })],
  };
  const fetchDay = async (date: string) => byDate[date] ?? [];

  const result = await collectUpcomingWindow(fetchDay, { limit: 50, nowMs: NOW_MS });

  assert.deepEqual(result.fixtures.map((f) => f.id), ["tbd"]);
});

test("collectUpcomingWindow auto-extends the window further out when the near term is sparse", async () => {
  // Nothing at all for the first 7 days (an entire BATCH_DAYS round comes back empty) -- the
  // window must widen into the next batch instead of returning an empty/truncated list.
  const byDate: Record<string, Fixture[]> = {
    "2026-07-27": [fixture({ id: "two-weeks-out", date: "2026-07-27", scheduledStart: "2026-07-27T13:00:00Z" })],
  };
  const fetchDay = async (date: string) => byDate[date] ?? [];

  const result = await collectUpcomingWindow(fetchDay, { limit: 50, nowMs: NOW_MS });

  assert.deepEqual(result.fixtures.map((f) => f.id), ["two-weeks-out"]);
});

test("collectUpcomingWindow caps the result at `limit`, keeping the soonest matches", async () => {
  const byDate: Record<string, Fixture[]> = {
    "2026-07-13": Array.from({ length: 5 }, (_, i) =>
      fixture({ id: `m${i}`, scheduledStart: `2026-07-13T${13 + i}:00:00Z` }),
    ),
  };
  const fetchDay = async (date: string) => byDate[date] ?? [];

  const result = await collectUpcomingWindow(fetchDay, { limit: 3, nowMs: NOW_MS });

  assert.deepEqual(result.fixtures.map((f) => f.id), ["m0", "m1", "m2"]);
  assert.equal(result.hasMore, true);
});

test("collectUpcomingWindow pages further into the window using `offset`, and reports `hasMore` accurately", async () => {
  const byDate: Record<string, Fixture[]> = {
    "2026-07-13": Array.from({ length: 5 }, (_, i) =>
      fixture({ id: `m${i}`, scheduledStart: `2026-07-13T${13 + i}:00:00Z` }),
    ),
  };
  const fetchDay = async (date: string) => byDate[date] ?? [];

  const page1 = await collectUpcomingWindow(fetchDay, { limit: 3, nowMs: NOW_MS, offset: 0 });
  assert.deepEqual(page1.fixtures.map((f) => f.id), ["m0", "m1", "m2"]);
  assert.equal(page1.hasMore, true);

  const page2 = await collectUpcomingWindow(fetchDay, { limit: 3, nowMs: NOW_MS, offset: 3 });
  assert.deepEqual(page2.fixtures.map((f) => f.id), ["m3", "m4"]);
  assert.equal(page2.hasMore, false);
});

test("collectUpcomingWindow de-duplicates a fixture id seen more than once", async () => {
  const byDate: Record<string, Fixture[]> = {
    "2026-07-13": [fixture({ id: "dup", scheduledStart: "2026-07-13T13:00:00Z" }), fixture({ id: "dup", scheduledStart: "2026-07-13T13:00:00Z" })],
  };
  const fetchDay = async (date: string) => byDate[date] ?? [];

  const result = await collectUpcomingWindow(fetchDay, { limit: 50, nowMs: NOW_MS });

  assert.equal(result.fixtures.length, 1);
});
