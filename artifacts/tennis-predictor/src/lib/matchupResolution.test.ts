import { test } from "node:test"
import assert from "node:assert/strict"
import { resolvePlayerCandidate, matchPredictionsToPair } from "./matchupResolution"
import type { LedgerPlayerSummary, PredictionSummary } from "@workspace/api-client-react"

function player(id: string, name: string, predictionCount = 1): LedgerPlayerSummary {
  return { id, name, predictionCount }
}

function prediction(overrides: Partial<PredictionSummary>): PredictionSummary {
  return {
    id: 1,
    player1Id: "p1",
    player1Name: "Player One",
    player2Id: "p2",
    player2Name: "Player Two",
    surface: "Hard",
    tournamentName: null,
    predictedWinnerName: "Player One",
    calibratedProbability: 0.6,
    predictedWinnerProbability: 0.6,
    dataQuality: 60,
    upsetRisk: "MODERATE",
    recommendation: "MODERATE_LEAN",
    actualWinnerName: null,
    createdAt: new Date().toISOString(),
    usedHistoricalMatchFallback: false,
    ...overrides,
  }
}

test("resolvePlayerCandidate: no-match when there are zero candidates", () => {
  const result = resolvePlayerCandidate([], "Someone Unknown")
  assert.equal(result.kind, "no-match")
})

test("resolvePlayerCandidate: resolves the single candidate when there's exactly one", () => {
  const result = resolvePlayerCandidate([player("p1", "Novak Djokovic")], "Djokovic")
  assert.equal(result.kind, "resolved")
  assert.equal(result.kind === "resolved" ? result.player.id : null, "p1")
})

test("resolvePlayerCandidate: an exact name match wins over other substring candidates", () => {
  const candidates = [player("p1", "Carlos Alcaraz"), player("p2", "Alcaraz Jr")]
  const result = resolvePlayerCandidate(candidates, "carlos alcaraz")
  assert.equal(result.kind, "resolved")
  assert.equal(result.kind === "resolved" ? result.player.id : null, "p1")
})

test("resolvePlayerCandidate: multiple non-exact candidates are ambiguous, not auto-picked", () => {
  const candidates = [player("p1", "Alexander Zverev"), player("p2", "Mischa Zverev")]
  const result = resolvePlayerCandidate(candidates, "Zverev")
  assert.equal(result.kind, "ambiguous")
  assert.equal(result.kind === "ambiguous" ? result.candidates.length : 0, 2)
})

test("matchPredictionsToPair: no-match when the pair never played", () => {
  const predictions = [prediction({ player1Id: "p1", player2Id: "p3" })]
  const result = matchPredictionsToPair(predictions, "p1", "p2", null)
  assert.equal(result.kind, "no-match")
})

test("matchPredictionsToPair: resolves the single prediction involving both players, either side", () => {
  const predictions = [prediction({ player1Id: "p2", player2Id: "p1" })]
  const result = matchPredictionsToPair(predictions, "p1", "p2", null)
  assert.equal(result.kind, "resolved")
})

test("matchPredictionsToPair: multiple meetings with no tournament hint are ambiguous", () => {
  const predictions = [
    prediction({ id: 1, player1Id: "p1", player2Id: "p2", tournamentName: "Wimbledon" }),
    prediction({ id: 2, player1Id: "p1", player2Id: "p2", tournamentName: "US Open" }),
  ]
  const result = matchPredictionsToPair(predictions, "p1", "p2", null)
  assert.equal(result.kind, "ambiguous")
})

test("matchPredictionsToPair: a tournament hint narrows multiple meetings down to one", () => {
  const predictions = [
    prediction({ id: 1, player1Id: "p1", player2Id: "p2", tournamentName: "Wimbledon" }),
    prediction({ id: 2, player1Id: "p1", player2Id: "p2", tournamentName: "US Open" }),
  ]
  const result = matchPredictionsToPair(predictions, "p1", "p2", "US Open")
  assert.equal(result.kind, "resolved")
  assert.equal(result.kind === "resolved" ? result.prediction.id : null, 2)
})

test("matchPredictionsToPair: a tournament hint that matches nothing falls back to ambiguous rather than guessing", () => {
  const predictions = [
    prediction({ id: 1, player1Id: "p1", player2Id: "p2", tournamentName: "Wimbledon" }),
    prediction({ id: 2, player1Id: "p1", player2Id: "p2", tournamentName: "US Open" }),
  ]
  const result = matchPredictionsToPair(predictions, "p1", "p2", "French Open")
  assert.equal(result.kind, "ambiguous")
})
