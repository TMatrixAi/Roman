import assert from "node:assert/strict"
import test from "node:test"
import { normalizePredictionInput } from "./predictionInput"

test("Search and Bulk style inputs normalize to identical engine payloads", () => {
  const searchPayload = normalizePredictionInput({
    player1Id: "p1",
    player2Id: "p2",
    surface: "Hard",
    matchFormat: "BestOf3",
    tournamentLevel: "ITF",
    tournamentName: "2026 W15 Brisbane Quarterfinal",
    player1Tour: "WTA",
    player2Tour: "WTA",
  })

  const bulkPayload = normalizePredictionInput({
    player1Id: "p1",
    player2Id: "p2",
    surface: "Hard",
    matchFormat: "BestOf3",
    tournamentLevel: null,
    tournamentName: "2026 W15 Brisbane Quarterfinal",
    player1Tour: "WTA",
    player2Tour: "WTA",
  })

  assert.deepEqual(searchPayload, bulkPayload)
  assert.equal(searchPayload.tournamentLevel, "ITF")
})

test("W15/M15 tournament names are always normalized as ITF", () => {
  const payload = normalizePredictionInput({
    player1Id: "p1",
    player2Id: "p2",
    surface: "Hard",
    matchFormat: "BestOf3",
    tournamentLevel: "ATP250",
    tournamentName: "W15 Brisbane",
    player1Tour: "WTA",
    player2Tour: "WTA",
  })

  assert.equal(payload.tournamentLevel, "ITF")
})

test("optional data gaps do not crash normalization", () => {
  const payload = normalizePredictionInput({
    player1Id: "p1",
    player2Id: "p2",
    tournamentName: "",
    tournamentLevel: null,
    surface: null,
    matchFormat: null,
  })

  assert.equal(payload.surface, "Hard")
  assert.equal(payload.matchFormat, "BestOf3")
  assert.equal(payload.tournamentName, undefined)
  assert.equal(payload.tournamentLevel, "ATP250")
})
