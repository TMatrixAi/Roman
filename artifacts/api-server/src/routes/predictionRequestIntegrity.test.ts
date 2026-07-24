import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertPredictionIdentityIntegrity,
  getExternalFixtureIdFromRequestMatchId,
  normalizePersonName,
  parsePredictionRequestIntegrityHeaders,
  type PredictionRequestIntegrity,
} from "./predictionRequestIntegrity";

test("getExternalFixtureIdFromRequestMatchId extracts fixture id for fixture-prefixed request match ids", () => {
  assert.equal(getExternalFixtureIdFromRequestMatchId("fixture:abc-123"), "abc-123");
  assert.equal(getExternalFixtureIdFromRequestMatchId("fixture:  xyz-789  "), "xyz-789");
});

test("getExternalFixtureIdFromRequestMatchId returns null for non-fixture request match ids", () => {
  assert.equal(getExternalFixtureIdFromRequestMatchId("manual:abc-123"), null);
  assert.equal(getExternalFixtureIdFromRequestMatchId("fixture:   "), null);
});

test("parsePredictionRequestIntegrityHeaders rejects missing request id", () => {
  const parsed = parsePredictionRequestIntegrityHeaders({ "x-prediction-match-id": "fixture:123" });
  assert.equal("code" in parsed ? parsed.code : null, "BAD_REQUEST");
});

test("parsePredictionRequestIntegrityHeaders accepts valid integrity headers", () => {
  const parsed = parsePredictionRequestIntegrityHeaders({
    "x-prediction-request-id": "0d049473-090f-4b43-944e-8e5f661ff5e6",
    "x-prediction-match-id": "fixture:atp-123",
    "x-submitted-player1-name": "Carlos Alcaraz",
    "x-submitted-player2-name": "Jannik Sinner",
  });
  assert.equal("requestId" in parsed, true);
  if ("requestId" in parsed) {
    assert.equal(parsed.requestId, "0d049473-090f-4b43-944e-8e5f661ff5e6");
    assert.equal(parsed.requestMatchId, "fixture:atp-123");
    assert.equal(parsed.submittedPlayer1Name, "Carlos Alcaraz");
  }
});

test("normalizePersonName strips accents and apostrophes for integrity compare", () => {
  assert.equal(normalizePersonName("Carreño O'Brien"), normalizePersonName("Carreno Obrien"));
});

test("assertPredictionIdentityIntegrity blocks mismatched submitted names", () => {
  const integrity: PredictionRequestIntegrity = {
    requestId: "9b685f17-d39f-49a4-98da-ae3794722268",
    requestMatchId: "fixture:test-1",
    submittedPlayer1Name: "Rafael Nadal",
    submittedPlayer2Name: "Novak Djokovic",
  };

  const out = assertPredictionIdentityIntegrity(
    {
      player1Id: "p1",
      player2Id: "p2",
      surface: "Hard",
      matchFormat: "BestOf3",
      tournamentLevel: "ATP250",
      tournamentName: "Doha",
      indoor: null,
    },
    integrity,
    {
      id: "p1",
      name: "Carlos Alcaraz",
      fullName: null,
      countryCode: null,
      currentRank: 1,
      age: null,
      plays: null,
      tour: "ATP",
    },
    {
      id: "p2",
      name: "Jannik Sinner",
      fullName: null,
      countryCode: null,
      currentRank: 2,
      age: null,
      plays: null,
      tour: "ATP",
    },
  );

  assert.equal(out?.code, "INTEGRITY_MISMATCH");
  assert.match(out?.message ?? "", /submitted player1 name/i);
});
