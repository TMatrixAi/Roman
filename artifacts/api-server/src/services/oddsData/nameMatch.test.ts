import assert from "node:assert/strict";
import { test } from "node:test";
import { matchPlayersToEvent, namesLikelyMatch } from "./nameMatch";

test("namesLikelyMatch matches real surname spelling variants across providers", () => {
  assert.equal(namesLikelyMatch("Carlos Alcaraz", "C. Alcaraz"), true);
  assert.equal(namesLikelyMatch("Carlos Alcaraz", "Alcaraz Carlos"), true);
  assert.equal(namesLikelyMatch("Novak Djokovic", "N. Djokovic"), true);
});

test("namesLikelyMatch rejects short/common surnames as accidental substrings", () => {
  // "Li" must never match just because it appears as a substring inside an unrelated token.
  assert.equal(namesLikelyMatch("Zheng Li", "Emilia Romagna Open"), false);
  assert.equal(namesLikelyMatch("Zheng Li", "Milan Open"), false);
});

test("namesLikelyMatch does not match on unrelated tokens even if longer surname is a substring", () => {
  // "Wang" (a real surname) must not match just because it's a substring of another word.
  assert.equal(namesLikelyMatch("Yafan Wang", "Schwangau Challenger"), false);
});

test("namesLikelyMatch matches a real short-ish surname when it appears as an exact token", () => {
  assert.equal(namesLikelyMatch("Zheng Li", "Li Zheng"), true);
});

test("matchPlayersToEvent picks the correct slot for a real matchup, either order", () => {
  assert.equal(matchPlayersToEvent("Carlos Alcaraz", "Novak Djokovic", "C. Alcaraz", "N. Djokovic"), "aIsPlayer1");
  assert.equal(matchPlayersToEvent("Carlos Alcaraz", "Novak Djokovic", "N. Djokovic", "C. Alcaraz"), "bIsPlayer1");
});

test("matchPlayersToEvent returns null instead of guessing on an unrelated event", () => {
  assert.equal(matchPlayersToEvent("Carlos Alcaraz", "Novak Djokovic", "Emilia Romagna Open", "Milan Open"), null);
});

test("matchPlayersToEvent does not false-positive-match a short-surname player against an unrelated event", () => {
  // Regression: "Li" as a raw substring used to match inside "Milan"/"Emilia" tokens.
  assert.equal(matchPlayersToEvent("Zheng Li", "Novak Djokovic", "Milan Open", "N. Djokovic"), null);
});
