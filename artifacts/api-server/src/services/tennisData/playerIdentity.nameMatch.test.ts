/**
 * Unit tests for the extended player name matching added in Task #18:
 *  - normalizePlayerName: accent folding, punctuation stripping, whitespace collapse
 *  - generateNameVariants: produces direct + reversed-order variants
 *  - isInitialNamePattern: detects single-letter first-word forms
 *  - resolvePlayerNameWithAmbiguity: exact hit, reversed hit, ambiguous, null
 *
 * Run with: pnpm --filter @workspace/api-server exec tsx --test src/services/tennisData/playerIdentity.nameMatch.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizePlayerName,
  generateNameVariants,
  isInitialNamePattern,
  resolvePlayerNameWithAmbiguity,
  type PlayerIdentityIndex,
} from "./playerIdentity";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Builds a minimal PlayerIdentityIndex from a map of normalizedName -> canonicalId. */
function buildIndex(entries: Record<string, string>): PlayerIdentityIndex {
  const canonicalIdByName = new Map(Object.entries(entries));
  // Build the by-id map from the entries (treating each value as its own canonical)
  const canonicalIdById = new Map<string, string>();
  const aliasIdsByCanonicalId = new Map<string, string[]>();
  for (const id of Object.values(entries)) {
    canonicalIdById.set(id, id);
    if (!aliasIdsByCanonicalId.has(id)) aliasIdsByCanonicalId.set(id, [id]);
  }
  return { canonicalIdByName, canonicalIdById, aliasIdsByCanonicalId };
}

// ─── normalizePlayerName ──────────────────────────────────────────────────────

test("normalizePlayerName: strips accents", () => {
  assert.equal(normalizePlayerName("Nadal Ráfaél"), "nadal rafael");
});

test("normalizePlayerName: strips dots and apostrophes", () => {
  assert.equal(normalizePlayerName("R. Nadal"), "r nadal");
  assert.equal(normalizePlayerName("O'Brien"), "obrien");
});

test("normalizePlayerName: collapses whitespace", () => {
  assert.equal(normalizePlayerName("  Carlos  Alcaraz  "), "carlos alcaraz");
});

test("normalizePlayerName: handles hyphens", () => {
  assert.equal(normalizePlayerName("Jan-Lennard Struff"), "janlennard struff");
});

test("normalizePlayerName: handles mixed accents and hyphens", () => {
  assert.equal(normalizePlayerName("Novak Đoković"), "novak dokovic");
});

test("normalizePlayerName: empty string returns empty", () => {
  assert.equal(normalizePlayerName(""), "");
});

// ─── isInitialNamePattern ─────────────────────────────────────────────────────

test("isInitialNamePattern: detects single-letter first word", () => {
  assert.equal(isInitialNamePattern("r nadal"), true);
  assert.equal(isInitialNamePattern("n djokovic"), true);
});

test("isInitialNamePattern: rejects full first names", () => {
  assert.equal(isInitialNamePattern("rafael nadal"), false);
  assert.equal(isInitialNamePattern("novak djokovic"), false);
});

test("isInitialNamePattern: rejects single word (no surname)", () => {
  assert.equal(isInitialNamePattern("nadal"), false);
});

// ─── generateNameVariants ────────────────────────────────────────────────────

test("generateNameVariants: returns direct form", () => {
  const variants = generateNameVariants("Rafael Nadal");
  assert.ok(variants.includes("rafael nadal"));
});

test("generateNameVariants: returns reversed form for two-word name", () => {
  const variants = generateNameVariants("Rafael Nadal");
  assert.ok(variants.includes("nadal rafael"), `Expected reversed form, got: ${JSON.stringify(variants)}`);
});

test("generateNameVariants: reversed form for three-word name", () => {
  const variants = generateNameVariants("Carlos Alcaraz Garfia");
  // reversed = "garfia alcaraz carlos"
  assert.ok(variants.includes("garfia alcaraz carlos"), `Got: ${JSON.stringify(variants)}`);
});

test("generateNameVariants: deduplicates (palindrome-like short names)", () => {
  const variants = generateNameVariants("A A");
  const unique = new Set(variants);
  assert.equal(unique.size, variants.length, "Expected no duplicate variants");
});

test("generateNameVariants: initial form produces reversed variant", () => {
  const variants = generateNameVariants("R. Nadal");
  // direct = "r nadal", reversed = "nadal r"
  assert.ok(variants.includes("r nadal"), `Missing direct, got: ${JSON.stringify(variants)}`);
  assert.ok(variants.includes("nadal r"), `Missing reversed, got: ${JSON.stringify(variants)}`);
});

// ─── resolvePlayerNameWithAmbiguity ──────────────────────────────────────────

test("resolvePlayerNameWithAmbiguity: exact match returns confident hit", () => {
  const index = buildIndex({ "rafael nadal": "p-nadal" });
  const result = resolvePlayerNameWithAmbiguity(index, "Rafael Nadal");
  assert.ok(result !== null);
  assert.equal(result.ambiguous, false);
  if (!result.ambiguous) {
    assert.equal(result.id, "p-nadal");
    assert.equal(result.confidence, "exact");
  }
});

test("resolvePlayerNameWithAmbiguity: reversed name matches as 'reversed' confidence", () => {
  // Index has "nadal rafael" stored (provider reported last-name first)
  const index = buildIndex({ "nadal rafael": "p-nadal" });
  const result = resolvePlayerNameWithAmbiguity(index, "Rafael Nadal");
  assert.ok(result !== null);
  assert.equal(result.ambiguous, false);
  if (!result.ambiguous) {
    assert.equal(result.id, "p-nadal");
    assert.equal(result.confidence, "reversed");
  }
});

test("resolvePlayerNameWithAmbiguity: returns null when no match", () => {
  const index = buildIndex({ "rafael nadal": "p-nadal" });
  const result = resolvePlayerNameWithAmbiguity(index, "Novak Djokovic");
  assert.equal(result, null);
});

test("resolvePlayerNameWithAmbiguity: ambiguous when direct and reversed map to different players", () => {
  // "carlos alcaraz" -> player A, but "alcaraz carlos" -> player B (different person in history)
  const index = buildIndex({
    "carlos alcaraz": "p-alcaraz",
    "alcaraz carlos": "p-carlos",
  });
  const result = resolvePlayerNameWithAmbiguity(index, "Carlos Alcaraz");
  assert.ok(result !== null);
  assert.equal(result.ambiguous, true);
  if (result.ambiguous) {
    assert.ok(result.candidates.includes("p-alcaraz"));
    assert.ok(result.candidates.includes("p-carlos"));
  }
});

test("resolvePlayerNameWithAmbiguity: Đ folds to d (Đoković → dokovic)", () => {
  // Đ (U+0110) does not decompose under NFD — explicit transliteration maps it to 'd'.
  // "Đoković" → "dokovic" (not "djokovic" which is a romanization convention, not Unicode math).
  const index = buildIndex({ "novak dokovic": "p-djokovic" });
  const result = resolvePlayerNameWithAmbiguity(index, "Novak Đoković");
  assert.ok(result !== null, `Expected a match for 'Novak Đoković' against 'novak dokovic'`);
  assert.equal(result.ambiguous, false);
  if (!result.ambiguous) assert.equal(result.id, "p-djokovic");
});

test("resolvePlayerNameWithAmbiguity: standard accent (Djoković → djokovic)", () => {
  // When the name uses a regular accented ć rather than the Serbian stroke Đ
  const index = buildIndex({ "novak djokovic": "p-djokovic" });
  const result = resolvePlayerNameWithAmbiguity(index, "Novak Djoković");
  assert.ok(result !== null, `Expected a match for 'Novak Djoković' against 'novak djokovic'`);
  assert.equal(result.ambiguous, false);
  if (!result.ambiguous) assert.equal(result.id, "p-djokovic");
});

test("resolvePlayerNameWithAmbiguity: initial form (R. Nadal) matches stored full name via reversed variant", () => {
  // Stored as "nadal r" when the historical match had last-name-first with initial
  const index = buildIndex({ "nadal r": "p-nadal" });
  const result = resolvePlayerNameWithAmbiguity(index, "R. Nadal");
  // "R. Nadal" -> direct "r nadal", reversed "nadal r" -> hits "p-nadal"
  assert.ok(result !== null);
  assert.equal(result.ambiguous, false);
  if (!result.ambiguous) assert.equal(result.id, "p-nadal");
});
