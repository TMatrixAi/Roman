/**
 * Unit + atomicity tests for externalCsvBridge.
 *
 * Pure resolution tests run with no DB.
 * Atomicity tests inject a mock DbLike that can throw mid-migration to verify
 * that runBridgeMigration rejects and therefore lets db.transaction() roll back.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  csvNameParts,
  resolveCsvPlayerToRealId,
  collapseByInitialDuplicates,
  idProviderBucket,
  isAbbreviatedFirstName,
  runBridgeMigration,
} from "./externalCsvBridge";
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

// ── idProviderBucket ──────────────────────────────────────────────────────────

describe("idProviderBucket", () => {
  it("classifies numeric IDs as api-tennis", () => {
    assert.equal(idProviderBucket("2382"), "api-tennis");
    assert.equal(idProviderBucket("100644"), "api-tennis");
  });
  it("classifies sackmann- prefix as sackmann", () => {
    assert.equal(idProviderBucket("sackmann-207989"), "sackmann");
  });
  it("classifies tennis-data-co-uk- prefix", () => {
    assert.equal(idProviderBucket("tennis-data-co-uk-barty_a"), "tennis-data-co-uk");
  });
  it("classifies unknown formats as other", () => {
    assert.equal(idProviderBucket("ext-atp-123"), "other");
    assert.equal(idProviderBucket("sofascore-999"), "other");
  });
});

// ── isAbbreviatedFirstName ────────────────────────────────────────────────────

describe("isAbbreviatedFirstName", () => {
  it("detects single-letter initial with dot", () => {
    assert.equal(isAbbreviatedFirstName("C. Alcaraz"), true);
    assert.equal(isAbbreviatedFirstName("N. Djokovic"), true);
  });
  it("detects single-letter initial without dot", () => {
    assert.equal(isAbbreviatedFirstName("C Alcaraz"), true);
  });
  it("returns false for full first names", () => {
    assert.equal(isAbbreviatedFirstName("Carlos Alcaraz"), false);
    assert.equal(isAbbreviatedFirstName("Novak Djokovic"), false);
    assert.equal(isAbbreviatedFirstName("John Smith"), false);
  });
  it("returns false for single-word names (whole name is surname)", () => {
    assert.equal(isAbbreviatedFirstName("Osaka"), false);
  });
});

// ── collapseByInitialDuplicates ───────────────────────────────────────────────

describe("collapseByInitialDuplicates", () => {
  // ── Rule A: exactly one full first name, rest abbreviated ──

  it("Rule A: collapses abbreviated+full-name pair (numeric ID preferred)", () => {
    // "C. Alcaraz" (API-Tennis abbreviated) + "Carlos Alcaraz" (Sackmann full)
    // → one full name proves identity; collapse to numeric ID
    const byInitial = new Map([
      [
        "ATP:alcaraz|c",
        [
          { id: "2382",            name: "C. Alcaraz" },
          { id: "sackmann-207989", name: "Carlos Alcaraz" },
        ],
      ],
    ]);
    collapseByInitialDuplicates(byInitial);
    const result = byInitial.get("ATP:alcaraz|c")!;
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "2382"); // numeric preferred over sackmann
  });

  it("Rule A: collapses to sackmann when no numeric ID present", () => {
    // "N. Osaka" (API-Tennis abbreviated, initial.surname format)
    // + "Naomi Osaka" (sackmann full name)
    // Note: "Osaka N." (last.initial format from tennis-data-co-uk) would be
    // indexed under a garbage key "wta:n.|o" by dbNameParts, so it never
    // appears in the "WTA:osaka|n" bucket — only "Initial. Surname" entries do.
    const byInitial = new Map([
      [
        "WTA:osaka|n",
        [
          { id: "sackmann-300001", name: "Naomi Osaka" },
          { id: "tennis-data-co-uk-osaka", name: "N. Osaka" },
        ],
      ],
    ]);
    collapseByInitialDuplicates(byInitial);
    const result = byInitial.get("WTA:osaka|n")!;
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "sackmann-300001");
  });

  it("Rule A: multiple abbreviated entries (Initial. Surname format) + one full name → collapse", () => {
    // Two providers have abbreviated names in "Initial. Surname" format;
    // a third has the full first name — one full name proves identity.
    const byInitial = new Map([
      [
        "ATP:djokovic|n",
        [
          { id: "100",             name: "N. Djokovic" },
          { id: "sackmann-100644", name: "Novak Djokovic" },
          { id: "99",              name: "N. Djokovic" },
        ],
      ],
    ]);
    collapseByInitialDuplicates(byInitial);
    assert.equal(byInitial.get("ATP:djokovic|n")!.length, 1);
    assert.equal(byInitial.get("ATP:djokovic|n")![0].id, "100"); // numeric first
  });

  // ── Rule B: all full names normalizing identically ──

  it("Rule B: same full name from two providers → collapse", () => {
    // "Carlos Alcaraz" from both Sackmann and tennis-data-co-uk → same person
    const byInitial = new Map([
      [
        "ATP:alcaraz|c",
        [
          { id: "sackmann-207989",             name: "Carlos Alcaraz" },
          { id: "tennis-data-co-uk-alcaraz_c",  name: "Carlos Alcaraz" },
        ],
      ],
    ]);
    collapseByInitialDuplicates(byInitial);
    assert.equal(byInitial.get("ATP:alcaraz|c")!.length, 1);
  });

  // ── Cases that must NOT collapse ──

  it("NOT collapsed: two distinct full names sharing surname+initial (different people)", () => {
    // "John Smith" (API-Tennis) and "James Smith" (Sackmann) — both full names,
    // different normalizations → genuine ambiguity → must NOT collapse
    const byInitial = new Map([
      [
        "ATP:smith|j",
        [
          { id: "1111",          name: "John Smith" },
          { id: "sackmann-9999", name: "James Smith" },
        ],
      ],
    ]);
    collapseByInitialDuplicates(byInitial);
    assert.equal(byInitial.get("ATP:smith|j")!.length, 2); // untouched
  });

  it("NOT collapsed: all abbreviated initials — identity unverifiable", () => {
    // Both "J. Smith" entries are abbreviated; could be John or James → don't collapse
    const byInitial = new Map([
      [
        "ATP:smith|j",
        [
          { id: "1111", name: "J. Smith" },
          { id: "2222", name: "J. Smith" },
        ],
      ],
    ]);
    collapseByInitialDuplicates(byInitial);
    assert.equal(byInitial.get("ATP:smith|j")!.length, 2);
  });

  it("NOT collapsed: mixed full names with different normalizations + abbreviated", () => {
    // Two full-name entries that differ → unsafe even with an abbreviated entry
    const byInitial = new Map([
      [
        "ATP:smith|j",
        [
          { id: "1111",          name: "John Smith" },
          { id: "sackmann-9999", name: "James Smith" },
          { id: "2222",          name: "J. Smith" },
        ],
      ],
    ]);
    collapseByInitialDuplicates(byInitial);
    assert.equal(byInitial.get("ATP:smith|j")!.length, 3); // untouched
  });

  it("leaves single-entry buckets unchanged", () => {
    const byInitial = new Map([
      ["ATP:djokovic|n", [{ id: "100644", name: "Novak Djokovic" }]],
    ]);
    collapseByInitialDuplicates(byInitial);
    assert.equal(byInitial.get("ATP:djokovic|n")!.length, 1);
    assert.equal(byInitial.get("ATP:djokovic|n")![0].id, "100644");
  });

  it("ATP and WTA buckets are independent — no cross-tour collapse", () => {
    const byInitial = new Map([
      ["ATP:smith|a", [{ id: "1111",               name: "Alex Smith" }]],
      ["WTA:smith|a", [{ id: "sackmann-wta-smith",  name: "Amanda Smith" }]],
    ]);
    collapseByInitialDuplicates(byInitial);
    assert.equal(byInitial.get("ATP:smith|a")!.length, 1);
    assert.equal(byInitial.get("WTA:smith|a")!.length, 1);
  });
});

// ── resolveCsvPlayerToRealId ──────────────────────────────────────────────────

/**
 * Build an EnhancedPlayerIdMap with tour-scoped keys from a list of
 * { id, name, tour } triples — same logic as buildEnhancedPlayerIdMap
 * but synchronous and DB-free for testing.
 */
function makeMap(
  players: Array<{ id: string; name: string; tour: string }>,
): EnhancedPlayerIdMap {
  const byInitial = new Map<string, Array<{ id: string; name: string }>>();
  const bySurname = new Map<string, Array<{ id: string; name: string }>>();

  function addTo(
    map: Map<string, Array<{ id: string; name: string }>>,
    key: string,
    entry: { id: string; name: string },
  ) {
    if (!map.has(key)) map.set(key, []);
    const bucket = map.get(key)!;
    if (!bucket.some(e => e.id === entry.id)) bucket.push(entry);
  }

  for (const p of players) {
    const words = p.name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const initial = words[0][0]?.toLowerCase() ?? "";
    const surname =
      words.length === 1 ? words[0].toLowerCase() : words.slice(1).join(" ").toLowerCase();
    const t = p.tour.toUpperCase();
    addTo(bySurname, `${t}:${surname}`, p);
    if (initial) addTo(byInitial, `${t}:${surname}|${initial}`, p);
  }

  return { byInitial, bySurname };
}

describe("resolveCsvPlayerToRealId", () => {
  it("resolves by surname+initial (unique match within tour)", () => {
    const map = makeMap([
      { id: "sackmann-100644", name: "Novak Djokovic", tour: "ATP" },
      { id: "sackmann-100001", name: "Andre Agassi",   tour: "ATP" },
    ]);
    assert.equal(resolveCsvPlayerToRealId("Djokovic N.", map, "ATP"), "sackmann-100644");
  });

  it("disambiguates same surname with different initials", () => {
    const map = makeMap([
      { id: "sackmann-100200", name: "Andy Murray",  tour: "ATP" },
      { id: "sackmann-100201", name: "Jamie Murray", tour: "ATP" },
    ]);
    assert.equal(resolveCsvPlayerToRealId("Murray A.", map, "ATP"), "sackmann-100200");
    assert.equal(resolveCsvPlayerToRealId("Murray J.", map, "ATP"), "sackmann-100201");
  });

  it("returns null for ambiguous surname+initial within the same tour", () => {
    const map = makeMap([
      { id: "sackmann-200001", name: "John Smith", tour: "ATP" },
      { id: "sackmann-200002", name: "Jack Smith", tour: "ATP" },
    ]);
    // Both are "ATP:smith|j" — unresolvable
    assert.equal(resolveCsvPlayerToRealId("Smith J.", map, "ATP"), null);
  });

  it("falls back to surname-only when globally unique within tour", () => {
    const map = makeMap([{ id: "sackmann-300001", name: "Naomi Osaka", tour: "WTA" }]);
    assert.equal(resolveCsvPlayerToRealId("Osaka", map, "WTA"), "sackmann-300001");
  });

  it("returns null when surname not in map at all", () => {
    const map = makeMap([{ id: "sackmann-100644", name: "Novak Djokovic", tour: "ATP" }]);
    assert.equal(resolveCsvPlayerToRealId("Federer R.", map, "ATP"), null);
  });

  it("handles compound surnames correctly", () => {
    const map = makeMap([
      { id: "sackmann-100999", name: "Alejandro Davidovich Fokina", tour: "ATP" },
    ]);
    assert.equal(resolveCsvPlayerToRealId("Davidovich Fokina A.", map, "ATP"), "sackmann-100999");
  });

  it("prefers surname+initial match over surname-only when surnames are ambiguous", () => {
    const map = makeMap([
      { id: "sackmann-w1", name: "Serena Williams", tour: "WTA" },
      { id: "sackmann-w2", name: "Venus Williams",  tour: "WTA" },
    ]);
    assert.equal(resolveCsvPlayerToRealId("Williams S.", map, "WTA"), "sackmann-w1");
    assert.equal(resolveCsvPlayerToRealId("Williams V.", map, "WTA"), "sackmann-w2");
  });

  it("returns null when empty name provided", () => {
    const map = makeMap([{ id: "sackmann-100644", name: "Novak Djokovic", tour: "ATP" }]);
    assert.equal(resolveCsvPlayerToRealId("", map, "ATP"), null);
  });

  it("tour parameter scopes lookup — ATP player not found under WTA tour", () => {
    const map = makeMap([
      { id: "2382", name: "C. Alcaraz", tour: "ATP" },
    ]);
    // Correct tour → resolves
    assert.equal(resolveCsvPlayerToRealId("Alcaraz C.", map, "ATP"), "2382");
    // Wrong tour → not found (no cross-tour bleed)
    assert.equal(resolveCsvPlayerToRealId("Alcaraz C.", map, "WTA"), null);
  });
});

// ── Cross-tour collision safety ───────────────────────────────────────────────

describe("cross-tour collision safety", () => {
  it("disambiguates players with different surnames in ATP vs WTA context", () => {
    const map = makeMap([
      { id: "sackmann-atp-lee",  name: "Duck-Hee Lee",   tour: "ATP" },
      { id: "sackmann-wta-chan", name: "Hao-Ching Chan",  tour: "WTA" },
    ]);
    assert.equal(resolveCsvPlayerToRealId("Lee D.",  map, "ATP"), "sackmann-atp-lee");
    assert.equal(resolveCsvPlayerToRealId("Chan H.", map, "WTA"), "sackmann-wta-chan");
  });

  it("resolves ATP and WTA players sharing surname+initial independently via tour scoping", () => {
    // "Smith A." exists in both tours — tour-scoped keys keep them separate so
    // each resolves correctly to its own player (no cross-tour false merge).
    const map = makeMap([
      { id: "1111",               name: "Alex Smith",   tour: "ATP" },
      { id: "sackmann-wta-smith", name: "Amanda Smith", tour: "WTA" },
    ]);
    assert.equal(resolveCsvPlayerToRealId("Smith A.", map, "ATP"), "1111");
    assert.equal(resolveCsvPlayerToRealId("Smith A.", map, "WTA"), "sackmann-wta-smith");
  });

  it("same numeric ext-id in ATP and WTA resolves to different real players by name + tour", () => {
    // "ext-12345" can appear in ATP rows as "Murray A." and WTA rows as "Minella A."
    // Resolution is name-based; tour scoping separates the lookups.
    const map = makeMap([
      { id: "sackmann-100200",  name: "Andy Murray",    tour: "ATP" },
      { id: "sackmann-wta-999", name: "Mandy Minella",  tour: "WTA" },
    ]);
    assert.equal(resolveCsvPlayerToRealId("Murray A.",  map, "ATP"), "sackmann-100200");
    assert.equal(resolveCsvPlayerToRealId("Minella A.", map, "WTA"), "sackmann-wta-999");
  });

  it("cross-provider same-player duplicate resolves after collapseByInitialDuplicates", () => {
    // Simulates "Carlos Alcaraz" appearing as API-Tennis 2382 and Sackmann sackmann-207989
    // in the same ATP tour — the collapse merges them and the slot resolves.
    const map = makeMap([
      { id: "2382",            name: "C. Alcaraz",     tour: "ATP" },
      { id: "sackmann-207989", name: "Carlos Alcaraz", tour: "ATP" },
    ]);
    // Before collapse: ambiguous (2 ATP:alcaraz|c entries)
    assert.equal(resolveCsvPlayerToRealId("Alcaraz C.", map, "ATP"), null);

    // After collapse: one entry, resolves
    collapseByInitialDuplicates(map.byInitial);
    assert.equal(resolveCsvPlayerToRealId("Alcaraz C.", map, "ATP"), "2382");
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
 */
function makeMockTx(options: {
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
    assert.equal(callCount(), 1);
  });

  it("rejects if snapshot update (call 4) fails — caller's db.transaction() rolls back all three match updates", async () => {
    const { tx, callCount } = makeMockTx({ throwOnCall: 4 });
    await assert.rejects(
      () => runBridgeMigration(tx, testEntries),
      (err: Error) => err.message.includes("Simulated DB failure on call 4"),
    );
    assert.equal(callCount(), 4);
  });

  it("a retry after simulated rollback succeeds and makes all four calls", async () => {
    const { tx: failingTx } = makeMockTx({ throwOnCall: 4 });
    await assert.rejects(() => runBridgeMigration(failingTx, testEntries));

    const { tx: retryTx, callCount } = makeMockTx({ rowCount: 2 });
    const result = await runBridgeMigration(retryTx, testEntries);
    assert.equal(callCount(), 4);
    assert.equal(result.p1Rows, 2);
    assert.equal(result.featureRowsUpdated, 2);
  });

  it("returns all-zero counts for empty entries without touching the DB", async () => {
    const { tx, callCount } = makeMockTx({});
    const result = await runBridgeMigration(tx, []);
    assert.equal(callCount(), 0);
    assert.equal(result.p1Rows, 0);
    assert.equal(result.p2Rows, 0);
    assert.equal(result.winRows, 0);
    assert.equal(result.featureRowsUpdated, 0);
  });
});
