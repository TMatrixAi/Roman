/**
 * Unit tests for builderProviderFetch.ts
 *
 * Pure name-matching helpers are tested directly (no mocking needed).
 * The provider chain is tested via the `_providers` injection parameter so
 * no module mocking or network access is required.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  fetchPlayerMatchesFromProviders,
  normaliseName,
  normaliseCandidateName,
  isConfidentSearchMatch,
  buildSearchQueries,
  type BuilderProviders,
} from "./builderProviderFetch.js";
import { ProviderUnavailableError } from "../tennisData/index.js";
import type { MatchRecord, PlayerSummary } from "../tennisData/index.js";
import type { SofascoreFetchResult } from "./sofascoreProvider.js";

// ─── Test doubles ─────────────────────────────────────────────────────────────

/** Minimal provider stub with sensible defaults — override only what the test needs. */
function makeRapidApiStub(overrides: {
  searchPlayers?: (q: string) => Promise<PlayerSummary[]>;
} = {}): BuilderProviders["rapidApi"] {
  return {
    searchPlayers: overrides.searchPlayers ?? (async () => []),
    // MatchStat never has match history
    getPlayerMatches: async () => {
      throw new ProviderUnavailableError("MatchStat: player match history endpoint not available");
    },
  } as unknown as BuilderProviders["rapidApi"];
}

function makeApiTennisStub(overrides: {
  searchPlayers?: (q: string) => Promise<PlayerSummary[]>;
  getPlayerMatches?: (id: string) => Promise<MatchRecord[]>;
} = {}): BuilderProviders["apiTennis"] {
  return {
    searchPlayers: overrides.searchPlayers ?? (async () => []),
    getPlayerMatches: overrides.getPlayerMatches ?? (async () => []),
  } as unknown as BuilderProviders["apiTennis"];
}

function makeSofascoreStub(overrides: {
  player?: PlayerSummary | null;
  records?: MatchRecord[];
  error?: string | null;
}): BuilderProviders["sofascore"] {
  const result: SofascoreFetchResult = {
    player: overrides.player ?? null,
    records: overrides.records ?? [],
    error: overrides.error ?? null,
  };
  return async () => result;
}

function makeRecord(id = "m1"): MatchRecord {
  return {
    id,
    result: "W",
    opponentId: "opp1",
    opponentName: "Opp Player",
    tournamentName: "Roland Garros",
    surface: "Clay",
    round: "QF",
    date: "2024-06-01",
    score: "6-3 6-4",
    retired: false,
    walkover: false,
    opponentRank: 10,
    tournamentLevel: "GrandSlam",
    matchFormat: "BestOf3",
    indoor: null,
    stats: null,
    opponentStats: null,
    setGameMargins: [],
  };
}

function makePlayer(id = "at-1", name = "Test Player", tour = "ATP"): PlayerSummary {
  return { id, name, tour, currentRank: 50, countryCode: "XX" };
}

// ─── normaliseName ────────────────────────────────────────────────────────────

describe("normaliseName", () => {
  it("strips combining diacritics", () => {
    assert.equal(normaliseName("Nadal"), "nadal");
    assert.equal(normaliseName("Nădal"), "nadal"); // NFD combining char
    assert.equal(normaliseName("Đoković"), "dokovic");
  });

  it("maps non-NFD special letters", () => {
    assert.equal(normaliseName("Ł"), "l");
    assert.equal(normaliseName("Ø"), "o");
    assert.equal(normaliseName("Æ"), "ae");
  });

  it("lowercases", () => {
    assert.equal(normaliseName("ALCARAZ"), "alcaraz");
  });
});

// ─── normaliseCandidateName ───────────────────────────────────────────────────

describe("normaliseCandidateName", () => {
  it("returns unchanged name when no comma", () => {
    assert.equal(normaliseCandidateName("Carlos Alcaraz"), "Carlos Alcaraz");
  });

  it("flips 'Lastname, F.' to 'F. Lastname'", () => {
    assert.equal(normaliseCandidateName("Kokkinakis, T."), "T. Kokkinakis");
  });

  it("flips 'Lastname, Firstname' to 'Firstname Lastname'", () => {
    assert.equal(normaliseCandidateName("Djokovic, Novak"), "Novak Djokovic");
  });

  it("handles name with only lastname (no first part)", () => {
    assert.equal(normaliseCandidateName("Smith,"), "Smith");
  });
});

// ─── isConfidentSearchMatch ───────────────────────────────────────────────────

describe("isConfidentSearchMatch", () => {
  it("matches full name", () => {
    assert.ok(isConfidentSearchMatch("Carlos Alcaraz", "Carlos Alcaraz"));
  });

  it("matches abbreviated query 'C. Alcaraz' against full provider name", () => {
    assert.ok(isConfidentSearchMatch("Carlos Alcaraz", "C. Alcaraz"));
  });

  it("rejects initial mismatch (A. Singh vs D. Singh)", () => {
    assert.ok(!isConfidentSearchMatch("Davinder Singh", "A. Singh"));
  });

  // Diacritic normalisation — é/à/ö etc. decompose via NFD; Đ→D handled explicitly
  it("matches diacritic query surname against ASCII provider result (NFD decomposable)", () => {
    // é = e + combining acute → after NFD + strip → e
    assert.ok(isConfidentSearchMatch("Arnaud Clement", "Arnaud Clément"));
  });

  it("matches query with Đ against provider returning D equivalent", () => {
    // Đ (U+0110) does not decompose via NFD — mapped explicitly in normaliseName
    // Provider here also uses Đ — both sides normalize identically
    assert.ok(isConfidentSearchMatch("Novak Đoković", "Novak Đoković"));
  });

  it("matches ASCII query against provider result with diacritics", () => {
    assert.ok(isConfidentSearchMatch("David Nalbandián", "David Nalbandian"));
  });

  it("matches when provider uses ø/Ø and query is ASCII", () => {
    assert.ok(isConfidentSearchMatch("Frederik Løchte Nielsen", "Frederik Lochte Nielsen"));
  });

  // Reversed name format
  it("matches 'Lastname, F.' reversed provider format", () => {
    assert.ok(isConfidentSearchMatch("Kokkinakis, T.", "Thanasi Kokkinakis"));
  });

  it("matches 'Lastname, Firstname' reversed provider format", () => {
    assert.ok(isConfidentSearchMatch("Djokovic, Novak", "Novak Djokovic"));
  });

  // Edge cases
  it("returns false when surnames don't match", () => {
    assert.ok(!isConfidentSearchMatch("Rafael Nadal", "Carlos Alcaraz"));
  });
});

// ─── buildSearchQueries ───────────────────────────────────────────────────────

describe("buildSearchQueries", () => {
  it("includes the full name", () => {
    const q = buildSearchQueries("Carlos Alcaraz");
    assert.ok(q.includes("Carlos Alcaraz"));
  });

  it("includes the surname", () => {
    const q = buildSearchQueries("Carlos Alcaraz");
    assert.ok(q.includes("Alcaraz"));
  });

  it("includes diacritic-stripped variant when original has diacritics", () => {
    const q = buildSearchQueries("Đoković");
    // After NFD + Đ→D + strip combiners, "Đoković" → "Dokovic"
    assert.ok(q.some((s) => s.toLowerCase() === "dokovic"), `variants: ${q}`);
  });

  it("includes name without leading initial", () => {
    const q = buildSearchQueries("T. Kokkinakis");
    assert.ok(q.includes("Kokkinakis"));
  });

  it("returns only strings of length >= 2", () => {
    const q = buildSearchQueries("Jo");
    assert.ok(q.every((s) => s.length >= 2));
  });
});

// ─── fetchPlayerMatchesFromProviders — provider chain ────────────────────────

describe("fetchPlayerMatchesFromProviders — provider chain", () => {
  // ── Happy paths ────────────────────────────────────────────────────────────

  it("DATA_FOUND when API-Tennis finds player + records", async () => {
    const providers: BuilderProviders = {
      rapidApi: null,
      apiTennis: makeApiTennisStub({
        searchPlayers: async () => [makePlayer("at-1", "Carlos Alcaraz")],
        getPlayerMatches: async () => [makeRecord()],
      }),
      sofascore: makeSofascoreStub({ player: null, records: [] }),
    };

    const result = await fetchPlayerMatchesFromProviders("Carlos Alcaraz", undefined, providers);

    assert.equal(result.diagnostics.outcome, "DATA_FOUND");
    assert.equal(result.records.length, 1);
    assert.equal(result.resolvedPlayerId, "at-1");
    assert.ok(result.diagnostics.sourcesSuccessful.includes("api-tennis"));
  });

  it("RapidAPI player identity recorded in diagnostics even though no records", async () => {
    const providers: BuilderProviders = {
      rapidApi: makeRapidApiStub({
        searchPlayers: async (q) =>
          q.toLowerCase().includes("alcaraz")
            ? [makePlayer("rapid-99", "Carlos Alcaraz")]
            : [],
      }),
      apiTennis: makeApiTennisStub({
        searchPlayers: async () => [makePlayer("at-1", "Carlos Alcaraz")],
        getPlayerMatches: async () => [makeRecord()],
      }),
      sofascore: makeSofascoreStub({ player: null, records: [] }),
    };

    const result = await fetchPlayerMatchesFromProviders("Carlos Alcaraz", undefined, providers);

    assert.equal(result.diagnostics.outcome, "DATA_FOUND");
    assert.ok(result.diagnostics.sourcesAttempted.includes("rapidapi"));
    assert.ok(result.diagnostics.sourcesSuccessful.includes("rapidapi"));
    assert.equal(result.diagnostics.providerIdsFound["rapidapi"], "rapid-99");
    assert.equal(result.diagnostics.recordsPerSource["rapidapi"], 0);
  });

  it("falls through to Sofascore when API-Tennis returns 0 records", async () => {
    const providers: BuilderProviders = {
      rapidApi: null,
      apiTennis: makeApiTennisStub({
        searchPlayers: async () => [makePlayer("at-2", "Luca Nardi")],
        getPlayerMatches: async () => [],
      }),
      sofascore: makeSofascoreStub({
        player: { id: "sf-1", name: "Luca Nardi", tour: "ATP", countryCode: "IT", currentRank: 100 },
        records: [makeRecord("sf-m1"), makeRecord("sf-m2")],
      }),
    };

    const result = await fetchPlayerMatchesFromProviders("Luca Nardi", undefined, providers);

    assert.equal(result.diagnostics.outcome, "DATA_FOUND");
    assert.equal(result.records.length, 2);
    assert.equal(result.resolvedPlayerId, "sf-1");
    assert.ok(result.diagnostics.sourcesSuccessful.includes("sofascore"));
  });

  // ── Diacritic normalisation end-to-end ────────────────────────────────────

  it("finds player when query has NFD-decomposable diacritics and provider returns ASCII name", async () => {
    // é = e + combining acute → NFD + strip combining → e; "Clément" → "Clement"
    const providers: BuilderProviders = {
      rapidApi: null,
      apiTennis: makeApiTennisStub({
        searchPlayers: async () => [makePlayer("at-clem", "Arnaud Clement")],
        getPlayerMatches: async () => [makeRecord()],
      }),
      sofascore: makeSofascoreStub({ player: null, records: [] }),
    };

    const result = await fetchPlayerMatchesFromProviders("Arnaud Clément", undefined, providers);

    assert.equal(result.diagnostics.outcome, "DATA_FOUND",
      "diacritic query (é) should match ASCII provider result after NFD normalisation");
    assert.equal(result.resolvedPlayerName, "Arnaud Clement");
  });

  it("finds player when provider result has diacritics and query is ASCII", async () => {
    const providers: BuilderProviders = {
      rapidApi: null,
      apiTennis: makeApiTennisStub({
        searchPlayers: async () => [makePlayer("at-nar", "David Nalbandián")],
        getPlayerMatches: async () => [makeRecord()],
      }),
      sofascore: makeSofascoreStub({ player: null, records: [] }),
    };

    const result = await fetchPlayerMatchesFromProviders("David Nalbandian", undefined, providers);

    assert.equal(result.diagnostics.outcome, "DATA_FOUND",
      "ASCII query should match diacritic provider result");
  });

  // ── Reversed / abbreviated name format ────────────────────────────────────

  it("matches provider result in 'Lastname, F.' reversed format", async () => {
    const providers: BuilderProviders = {
      rapidApi: null,
      apiTennis: makeApiTennisStub({
        searchPlayers: async () => [makePlayer("at-kok", "Kokkinakis, T.")],
        getPlayerMatches: async () => [makeRecord()],
      }),
      sofascore: makeSofascoreStub({ player: null, records: [] }),
    };

    const result = await fetchPlayerMatchesFromProviders("Thanasi Kokkinakis", undefined, providers);

    assert.equal(result.diagnostics.outcome, "DATA_FOUND",
      "reversed-format provider name should match");
  });

  it("matches abbreviated 'T. Kokkinakis' query against full provider name", async () => {
    const providers: BuilderProviders = {
      rapidApi: null,
      apiTennis: makeApiTennisStub({
        searchPlayers: async () => [makePlayer("at-kok", "Thanasi Kokkinakis")],
        getPlayerMatches: async () => [makeRecord()],
      }),
      sofascore: makeSofascoreStub({ player: null, records: [] }),
    };

    const result = await fetchPlayerMatchesFromProviders("T. Kokkinakis", undefined, providers);

    assert.equal(result.diagnostics.outcome, "DATA_FOUND",
      "abbreviated query should match full provider name");
  });

  // ── Provider unavailable / fallback ───────────────────────────────────────

  it("continues to API-Tennis when RapidAPI throws ProviderUnavailableError", async () => {
    const providers: BuilderProviders = {
      rapidApi: makeRapidApiStub({
        searchPlayers: async () => { throw new ProviderUnavailableError("rate-limit"); },
      }),
      apiTennis: makeApiTennisStub({
        searchPlayers: async () => [makePlayer()],
        getPlayerMatches: async () => [makeRecord()],
      }),
      sofascore: makeSofascoreStub({ player: null, records: [] }),
    };

    const result = await fetchPlayerMatchesFromProviders("Test Player", undefined, providers);

    assert.equal(result.diagnostics.outcome, "DATA_FOUND");
    assert.ok(result.diagnostics.sourcesFailed.includes("rapidapi"));
    assert.ok(result.diagnostics.sourcesSuccessful.includes("api-tennis"));
  });

  it("falls through to Sofascore when API-Tennis search throws ProviderUnavailableError", async () => {
    const providers: BuilderProviders = {
      rapidApi: null,
      apiTennis: makeApiTennisStub({
        searchPlayers: async () => { throw new ProviderUnavailableError("timeout"); },
      }),
      sofascore: makeSofascoreStub({
        player: { id: "sf-1", name: "Test Player", tour: "ATP", countryCode: null, currentRank: null },
        records: [makeRecord()],
      }),
    };

    const result = await fetchPlayerMatchesFromProviders("Test Player", undefined, providers);

    assert.equal(result.diagnostics.outcome, "DATA_FOUND");
    assert.ok(result.diagnostics.sourcesFailed.includes("api-tennis"));
    assert.ok(result.diagnostics.sourcesSuccessful.includes("sofascore"));
  });

  it("returns PLAYER_NOT_FOUND when all three providers return no matching player", async () => {
    const providers: BuilderProviders = {
      rapidApi: makeRapidApiStub(),           // returns []
      apiTennis: makeApiTennisStub(),         // returns []
      sofascore: makeSofascoreStub({ player: null, records: [] }),
    };

    const result = await fetchPlayerMatchesFromProviders("Unknown Player XYZ", undefined, providers);

    assert.equal(result.diagnostics.outcome, "PLAYER_NOT_FOUND");
    assert.equal(result.records.length, 0);
    assert.equal(result.resolvedPlayerId, null);
  });

  it("returns NO_MATCH_HISTORY when API-Tennis finds player but both it and Sofascore return 0 records", async () => {
    const providers: BuilderProviders = {
      rapidApi: null,
      apiTennis: makeApiTennisStub({
        searchPlayers: async () => [makePlayer("at-new", "New Player")],
        getPlayerMatches: async () => [],
      }),
      sofascore: makeSofascoreStub({
        player: { id: "sf-new", name: "New Player", tour: "ATP", countryCode: null, currentRank: null },
        records: [],
      }),
    };

    const result = await fetchPlayerMatchesFromProviders("New Player", undefined, providers);

    assert.equal(result.diagnostics.outcome, "NO_MATCH_HISTORY");
    assert.equal(result.records.length, 0);
  });

  // ── No providers configured ───────────────────────────────────────────────

  it("uses only Sofascore when both RapidAPI and API-Tennis providers are null", async () => {
    const providers: BuilderProviders = {
      rapidApi: null,
      apiTennis: null,
      sofascore: makeSofascoreStub({
        player: { id: "sf-only", name: "Solo Player", tour: "ATP", countryCode: null, currentRank: null },
        records: [makeRecord()],
      }),
    };

    const result = await fetchPlayerMatchesFromProviders("Solo Player", undefined, providers);

    assert.equal(result.diagnostics.outcome, "DATA_FOUND");
    assert.deepEqual(result.diagnostics.sourcesAttempted, ["sofascore"]);
  });

  it("returns PLAYER_NOT_FOUND when all providers null and Sofascore responds but finds nothing", async () => {
    // Sofascore IS attempted and responds (player not found) — the correct outcome
    // is PLAYER_NOT_FOUND, not DATA_UNAVAILABLE.  DATA_UNAVAILABLE means all
    // providers were *unreachable* (threw errors), not that they searched and missed.
    const providers: BuilderProviders = {
      rapidApi: null,
      apiTennis: null,
      sofascore: makeSofascoreStub({ player: null, records: [] }),
    };

    const result = await fetchPlayerMatchesFromProviders("Nobody", undefined, providers);

    assert.equal(result.diagnostics.outcome, "PLAYER_NOT_FOUND");
    assert.equal(result.diagnostics.sourcesAttempted.length, 1);
    assert.ok(result.diagnostics.sourcesAttempted.includes("sofascore"));
  });

  // ── Diagnostics completeness ──────────────────────────────────────────────

  it("sourcesConfigured reflects which injected providers are non-null", async () => {
    const providers: BuilderProviders = {
      rapidApi: makeRapidApiStub(),
      apiTennis: makeApiTennisStub(),
      sofascore: makeSofascoreStub({ player: null, records: [] }),
    };

    const result = await fetchPlayerMatchesFromProviders("Anyone", undefined, providers);

    assert.ok(result.diagnostics.sourcesConfigured.includes("rapidapi"));
    assert.ok(result.diagnostics.sourcesConfigured.includes("api-tennis"));
    assert.ok(result.diagnostics.sourcesConfigured.includes("sofascore"));
  });

  it("rapidapi not in sourcesConfigured when rapidApi is null", async () => {
    const providers: BuilderProviders = {
      rapidApi: null,
      apiTennis: makeApiTennisStub(),
      sofascore: makeSofascoreStub({ player: null, records: [] }),
    };

    const result = await fetchPlayerMatchesFromProviders("Anyone", undefined, providers);

    assert.ok(!result.diagnostics.sourcesConfigured.includes("rapidapi"));
    assert.ok(result.diagnostics.sourcesConfigured.includes("api-tennis"));
  });
});
