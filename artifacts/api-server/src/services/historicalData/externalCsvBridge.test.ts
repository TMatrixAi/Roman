/**
 * Unit + atomicity tests for externalCsvBridge.
 *
 * Pure resolution tests run with no DB.
 * Atomicity tests inject a mock DbLike that can throw mid-migration to verify
 * that runBridgeMigration rejects and therefore lets db.transaction() roll back.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { csvNameParts, resolveCsvPlayerToRealId, runBridgeMigration } from "./externalCsvBridge";
import type { DbLike, ResolutionEntry, EnhancedPlayerIdMap } from "./externalCsvBridge";

// ── csvNameParts ──────────────────────────────────────────────────────────────

describe("csvNameParts", () => {
  it("extracts surname and initial from standard abbreviated name", () => {
    const r = csvNameParts("Djokovic N.");
    assert.equal(r.surname, "djokovic");
    assert.equal(r.initial, "n");
  });

  it("handles compound surname with initial", () => {
    const r = csvNameParts("Davidovich Fokina A.");
    assert.equal(r.surname, "davidovich fokina");
    assert.equal(r.initial, "a");
  });

  it("handles particle surnames", () => {
    const r = csvNameParts("De Minaur A.");
    assert.equal(r.surname, "de minaur");
    assert.equal(r.initial, "a");
  });

  it("handles initial without dot", () => {
    const r = csvNameParts("Osaka N");
    assert.equal(r.surname, "osaka");
    assert.equal(r.initial, "n");
  });

  it("returns null initial when no initial present (single-surname only)", () => {
    const r = csvNameParts("Osaka");
    assert.equal(r.surname, "osaka");
    assert.equal(r.initial, null);
  });

  it("handles full name with no initial (edge case)", () => {
    // "Djokovic" doesn't look like a single-letter initial, so full string is surname
    const r = csvNameParts("Novak Djokovic");
    assert.equal(r.initial, null);
  });
});

// ── resolveCsvPlayerToRealId ──────────────────────────────────────────────────

/** Replicate dbNameParts logic to build an EnhancedPlayerIdMap from a plain player list. */
function makeMap(players: Array<{ id: string; name: string }>): EnhancedPlayerIdMap {
  const byInitial = new Map<string, Array<{ id: string; name: string }>>();
  const bySurname = new Map<string, Array<{ id: string; name: string }>>();

  function addTo(map: Map<string, Array<{ id: string; name: string }>>, key: string, entry: { id: string; name: string }) {
    if (!map.has(key)) map.set(key, []);
    const bucket = map.get(key)!;
    if (!bucket.some(e => e.id === entry.id)) bucket.push(entry);
  }

  for (const p of players) {
    const words = p.name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const initial = words[0][0]?.toLowerCase() ?? "";
    const surname = words.length === 1 ? words[0].toLowerCase() : words.slice(1).join(" ").toLowerCase();
    addTo(bySurname, surname, p);
    if (initial) addTo(byInitial, `${surname}|${initial}`, p);
  }

  return { byInitial, bySurname };
}

describe("resolveCsvPlayerToRealId", () => {
  it("resolves by surname+initial (unique match)", () => {
    const map = makeMap([
      { id: "sackmann-100644", name: "Novak Djokovic" },
      { id: "sackmann-100001", name: "Andre Agassi" },
    ]);
    assert.equal(resolveCsvPlayerToRealId("Djokovic N.", map), "sackmann-100644");
  });

  it("disambiguates same surname with different initials", () => {
    const map = makeMap([
      { id: "sackmann-100200", name: "Andy Murray" },
      { id: "sackmann-100201", name: "Jamie Murray" },
    ]);
    assert.equal(resolveCsvPlayerToRealId("Murray A.", map), "sackmann-100200");
    assert.equal(resolveCsvPlayerToRealId("Murray J.", map), "sackmann-100201");
  });

  it("returns null for ambiguous surname+initial (two players share initials)", () => {
    const map = makeMap([
      { id: "sackmann-200001", name: "John Smith" },
      { id: "sackmann-200002", name: "Jack Smith" },
    ]);
    // Both are "smith|j" — unresolvable via initial; bySurname also ambiguous
    assert.equal(resolveCsvPlayerToRealId("Smith J.", map), null);
  });

  it("falls back to surname-only when globally unique", () => {
    const map = makeMap([{ id: "sackmann-300001", name: "Naomi Osaka" }]);
    assert.equal(resolveCsvPlayerToRealId("Osaka", map), "sackmann-300001");
  });

  it("returns null when surname not in map at all", () => {
    const map = makeMap([{ id: "sackmann-100644", name: "Novak Djokovic" }]);
    assert.equal(resolveCsvPlayerToRealId("Federer R.", map), null);
  });

  it("handles compound surnames correctly", () => {
    const map = makeMap([{ id: "sackmann-100999", name: "Alejandro Davidovich Fokina" }]);
    assert.equal(resolveCsvPlayerToRealId("Davidovich Fokina A.", map), "sackmann-100999");
  });

  it("prefers surname+initial match over surname-only when surnames are ambiguous", () => {
    const map = makeMap([
      { id: "sackmann-w1", name: "Serena Williams" },
      { id: "sackmann-w2", name: "Venus Williams" },
    ]);
    assert.equal(resolveCsvPlayerToRealId("Williams S.", map), "sackmann-w1");
    assert.equal(resolveCsvPlayerToRealId("Williams V.", map), "sackmann-w2");
  });

  it("returns null when empty name provided", () => {
    const map = makeMap([{ id: "sackmann-100644", name: "Novak Djokovic" }]);
    assert.equal(resolveCsvPlayerToRealId("", map), null);
  });
});

// ── Cross-tour collision safety ───────────────────────────────────────────────

describe("cross-tour collision safety", () => {
  it("disambiguates players with different surnames in ATP vs WTA context", () => {
    const map = makeMap([
      { id: "sackmann-atp-lee",  name: "Duck-Hee Lee" },
      { id: "sackmann-wta-chan", name: "Hao-Ching Chan" },
    ]);
    assert.equal(resolveCsvPlayerToRealId("Lee D.",  map), "sackmann-atp-lee");
    assert.equal(resolveCsvPlayerToRealId("Chan H.", map), "sackmann-wta-chan");
  });

  it("returns null when identical surname+initial exists in both ATP and WTA records", () => {
    // "Smith A." ambiguous across both tours — bridge correctly refuses to guess
    const map = makeMap([
      { id: "sackmann-atp-smith", name: "Alex Smith" },
      { id: "sackmann-wta-smith", name: "Amanda Smith" },
    ]);
    assert.equal(resolveCsvPlayerToRealId("Smith A.", map), null);
  });

  it("same numeric ext-id in ATP and WTA resolves to different real players by name", () => {
    // "ext-12345" can appear in ATP rows as "Murray A." and WTA rows as "Minella A."
    // Resolution is name-based; tour scoping in the UPDATE layer separates the DB writes.
    const map = makeMap([
      { id: "sackmann-100200",  name: "Andy Murray" },
      { id: "sackmann-wta-999", name: "Mandy Minella" },
    ]);
    assert.equal(resolveCsvPlayerToRealId("Murray A.",  map), "sackmann-100200");
    assert.equal(resolveCsvPlayerToRealId("Minella A.", map), "sackmann-wta-999");
  });
});

// ── runBridgeMigration atomicity ──────────────────────────────────────────────
//
// These tests inject a mock DbLike so we can exercise the control flow of
// runBridgeMigration without a real database. In production the caller wraps
// runBridgeMigration in db.transaction(), which rolls back everything if the
// returned promise rejects — that's the guarantee we're validating here.

/**
 * Build a mock DbLike whose execute() calls are counted and optionally fail.
 *
 * runBridgeMigration always executes in a fixed order:
 *   call 1 → player1_id UPDATE on historical_matches
 *   call 2 → player2_id UPDATE on historical_matches
 *   call 3 → winner_id  UPDATE on historical_matches
 *   call 4 → player_id  UPDATE on match_feature_snapshots
 *
 * We use the call index (1-based) to identify each step rather than parsing
 * drizzle SQL objects, whose internal queryChunks structure is opaque at runtime.
 */
function makeMockTx(options: {
  /** Throw on the Nth execute() call (1-indexed). Undefined = never throw. */
  throwOnCall?: number;
  rowCount?: number;
}): { tx: DbLike; callCount: () => number } {
  let callIndex = 0;

  const tx: DbLike = {
    async execute(_query: unknown) {
      callIndex++;
      if (options.throwOnCall !== undefined && callIndex === options.throwOnCall) {
        throw new Error(`Simulated DB failure on call ${callIndex}`);
      }
      return { rowCount: options.rowCount ?? 1 };
    },
  };

  return { tx, callCount: () => callIndex };
}

const testEntries: ResolutionEntry[] = [
  { extId: "ext-atp-100", tour: "ATP", realId: "sackmann-djokovic" },
  { extId: "ext-wta-200", tour: "WTA", realId: "sackmann-swiatek" },
];

describe("runBridgeMigration atomicity", () => {
  it("makes exactly four execute() calls in order (p1, p2, winner, snapshots)", async () => {
    const { tx, callCount } = makeMockTx({});
    await runBridgeMigration(tx, testEntries);
    // 1=player1_id, 2=player2_id, 3=winner_id, 4=match_feature_snapshots
    assert.equal(callCount(), 4);
  });

  it("returns correct row counts from the mock", async () => {
    const { tx } = makeMockTx({ rowCount: 5 });
    const result = await runBridgeMigration(tx, testEntries);
    assert.equal(result.p1Rows, 5);
    assert.equal(result.p2Rows, 5);
    assert.equal(result.winRows, 5);
    assert.equal(result.featureRowsUpdated, 5);
  });

  it("rejects if player1_id update (call 1) fails — caller's db.transaction() will roll back", async () => {
    const { tx, callCount } = makeMockTx({ throwOnCall: 1 });
    await assert.rejects(
      () => runBridgeMigration(tx, testEntries),
      (err: Error) => err.message.includes("Simulated DB failure on call 1"),
    );
    // Only the first call was attempted; calls 2–4 never ran
    assert.equal(callCount(), 1);
  });

  it("rejects if snapshot update (call 4) fails — caller's db.transaction() rolls back all three match updates", async () => {
    const { tx, callCount } = makeMockTx({ throwOnCall: 4 });
    await assert.rejects(
      () => runBridgeMigration(tx, testEntries),
      (err: Error) => err.message.includes("Simulated DB failure on call 4"),
    );
    // All four statements were attempted; the fourth threw after three match updates
    assert.equal(callCount(), 4);
  });

  it("a retry after simulated rollback succeeds and makes all four calls", async () => {
    // First attempt: fails on snapshot update (call 4)
    const { tx: failingTx } = makeMockTx({ throwOnCall: 4 });
    await assert.rejects(() => runBridgeMigration(failingTx, testEntries));

    // Second attempt (simulates retry after DB rollback restored original ext-{id} rows)
    const { tx: retryTx, callCount } = makeMockTx({ rowCount: 2 });
    const result = await runBridgeMigration(retryTx, testEntries);
    assert.equal(callCount(), 4); // all four calls succeeded
    assert.equal(result.p1Rows, 2);
    assert.equal(result.featureRowsUpdated, 2);
  });

  it("returns all-zero counts for empty entries without touching the DB", async () => {
    const { tx, callCount } = makeMockTx({});
    const result = await runBridgeMigration(tx, []);
    assert.equal(callCount(), 0); // no DB calls at all
    assert.equal(result.p1Rows, 0);
    assert.equal(result.p2Rows, 0);
    assert.equal(result.winRows, 0);
    assert.equal(result.featureRowsUpdated, 0);
  });
});
