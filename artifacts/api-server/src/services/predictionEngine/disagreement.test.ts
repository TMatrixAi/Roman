import test from "node:test";
import assert from "node:assert/strict";
import { computeWeightedDisagreement, computeMatchupCloseness, buildDisagreementNote, type DisagreementModelInput } from "./disagreement";

function models(overrides: Partial<Record<string, DisagreementModelInput>>): DisagreementModelInput[] {
  return Object.values(overrides).filter((v): v is DisagreementModelInput => v !== undefined);
}

test("a low-reliability/near-zero-weight secondary model cannot flip the category by itself", () => {
  // Core models all clustered and agreeing (real signal); Fatigue votes wildly opposite but
  // carries almost none of the effective weight (as it would with reliability ~5, prior 0.4
  // against core reliabilities ~70-80 with priors 1.3-1.5).
  const withOutlier = computeWeightedDisagreement(
    models({
      surfaceElo: { modelName: "Surface Elo", player1Probability: 62, weightUsed: 0.35 },
      serveReturn: { modelName: "Serve & Return", player1Probability: 60, weightUsed: 0.35 },
      recentForm: { modelName: "Recent Form", player1Probability: 58, weightUsed: 0.29 },
      fatigue: { modelName: "Fatigue", player1Probability: 3, weightUsed: 0.01 },
    }),
  );
  const withoutOutlier = computeWeightedDisagreement(
    models({
      surfaceElo: { modelName: "Surface Elo", player1Probability: 62, weightUsed: 0.35 },
      serveReturn: { modelName: "Serve & Return", player1Probability: 60, weightUsed: 0.35 },
      recentForm: { modelName: "Recent Form", player1Probability: 58, weightUsed: 0.3 },
    }),
  );

  assert.equal(withOutlier.modelAgreement, withoutOutlier.modelAgreement, "a near-zero-weight outlier should not change the category at all");
  assert.equal(withOutlier.coreModelsConflict, false);
  assert.ok(withOutlier.modelAgreement === "Strong" || withOutlier.modelAgreement === "Moderate", `expected a healthy category, got ${withOutlier.modelAgreement}`);
});

test("core validated models genuinely conflicting in direction with real weight triggers HighDisagreement", () => {
  const { modelAgreement, coreModelsConflict } = computeWeightedDisagreement(
    models({
      surfaceElo: { modelName: "Surface Elo", player1Probability: 68, weightUsed: 0.38 },
      serveReturn: { modelName: "Serve & Return", player1Probability: 39, weightUsed: 0.33 },
      recentForm: { modelName: "Recent Form", player1Probability: 66, weightUsed: 0.29 },
    }),
  );

  assert.equal(coreModelsConflict, true);
  assert.equal(modelAgreement, "HighDisagreement");
});

test("a close matchup where every model agrees on direction is low disagreement, not high, just because the probability is near 50", () => {
  // Surface Elo 53%, Serve/Return 55%, Recent Form 52% -- all favor the same player, spec Part A.E's example.
  const { modelAgreement, leadingSupportPercent, weightedStdDev } = computeWeightedDisagreement(
    models({
      surfaceElo: { modelName: "Surface Elo", player1Probability: 53, weightUsed: 0.38 },
      serveReturn: { modelName: "Serve & Return", player1Probability: 55, weightUsed: 0.33 },
      recentForm: { modelName: "Recent Form", player1Probability: 52, weightUsed: 0.29 },
    }),
  );

  assert.equal(leadingSupportPercent, 100, "every model favors the same player, so support should be 100%");
  assert.ok(weightedStdDev < 6, `expected a tight cluster, got stddev ${weightedStdDev}`);
  assert.equal(modelAgreement, "Strong");
});

test("real disagreement can exist even when the blended probability lands well away from 50", () => {
  // Elo 68% for A, Serve/Return 61% for B (=39% for A), Recent Form 66% for A -- spec Part A.E's second example.
  const { modelAgreement, weightedStdDev } = computeWeightedDisagreement(
    models({
      surfaceElo: { modelName: "Surface Elo", player1Probability: 68, weightUsed: 0.36 },
      serveReturn: { modelName: "Serve & Return", player1Probability: 39, weightUsed: 0.33 },
      recentForm: { modelName: "Recent Form", player1Probability: 66, weightUsed: 0.31 },
    }),
  );

  assert.ok(weightedStdDev > 11, `expected a wide weighted spread despite the eventual blend landing near 57%, got ${weightedStdDev}`);
  assert.equal(modelAgreement, "HighDisagreement");
});

test("buildDisagreementNote is null exactly when modelAgreement is Strong, and names the real conflicting models otherwise", () => {
  const strong = computeWeightedDisagreement(
    models({
      surfaceElo: { modelName: "Surface Elo", player1Probability: 61, weightUsed: 0.5 },
      serveReturn: { modelName: "Serve & Return", player1Probability: 60, weightUsed: 0.5 },
    }),
  );
  assert.equal(buildDisagreementNote(strong, "Alice", "Bob"), null);

  const high = computeWeightedDisagreement(
    models({
      surfaceElo: { modelName: "Surface Elo", player1Probability: 68, weightUsed: 0.36 },
      serveReturn: { modelName: "Serve & Return", player1Probability: 39, weightUsed: 0.33 },
      recentForm: { modelName: "Recent Form", player1Probability: 66, weightUsed: 0.31 },
    }),
  );
  const note = buildDisagreementNote(high, "Alice", "Bob");
  assert.ok(note, "expected a non-null note for HighDisagreement");
  assert.match(note!, /Serve & Return favors Bob/);
  assert.match(note!, /Surface Elo favors Alice/);
  assert.match(note!, /Recent Form favors Alice/);
});

test("matchupCloseness is independent of the disagreement category", () => {
  assert.equal(computeMatchupCloseness(51), "VeryClose");
  assert.equal(computeMatchupCloseness(60), "Close");
  assert.equal(computeMatchupCloseness(75), "Moderate");
  assert.equal(computeMatchupCloseness(90), "Clear");
});
