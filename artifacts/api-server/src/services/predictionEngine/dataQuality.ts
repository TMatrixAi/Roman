export type DataQualityLabel = "Excellent" | "Strong" | "Acceptable" | "Limited" | "Poor";

/**
 * Fixed prior weight for how much each engine module should count toward the overall Data
 * Quality score. This is NOT a measure of how much real data resolved for a given match --
 * that's exactly what the module's own `reliability` already measures -- it's a prior on how
 * central the module actually is to the prediction, and on how meaningfully its reliability
 * really varies with real data richness (vs. being structurally low/constant for reasons that
 * have nothing to do with this match being under-supported).
 *
 * Surface Elo, Serve & Return, and Recent Form carry most of the real predictive signal in the
 * ensemble, and their reliability genuinely tracks how much real per-match data resolved for
 * this specific matchup -- weighted highest.
 *
 * Availability's reliability also genuinely tracks per-match data resolution (rest days almost
 * always resolve from real match records; travel distance depends on venue coverage) -- weighted
 * just under the core three.
 *
 * Head-to-Head's reliability collapses toward its floor whenever two players simply haven't met
 * before -- the NORMAL case for most real matchups (especially first rounds and lower tiers), not
 * a fixable data gap. Weighting it at parity with the core signals would let this expected rarity
 * single-handedly cap an otherwise well-supported prediction's Data Quality. Weighting it low
 * still lets it meaningfully lift the score once real meetings exist, without letting its absence
 * drag down matches that are otherwise strongly supported.
 *
 * Fatigue's reliability is currently a fixed constant (see fatigue.ts) rather than a real
 * per-match signal of data richness -- it is weighted low enough that this constant can't
 * dominate the blended score or mask genuine weakness in the core signals.
 */
export const MODULE_IMPORTANCE = {
  surfaceElo: 1.3,
  serveReturn: 1.2,
  recentForm: 1.1,
  availability: 0.9,
  fatigue: 0.7,
  headToHead: 0.5,
} as const;

export interface DataQualityModuleInput {
  reliability: number;
  /** One of the `MODULE_IMPORTANCE` weights above -- how much this module should count toward the blended score. */
  importance: number;
}

/**
 * Blends per-module reliabilities into one overall Data Quality score, weighted by each module's
 * fixed importance prior (see `MODULE_IMPORTANCE`) rather than a flat average. A flat average
 * would let a structurally rare-but-real gap (no prior head-to-head meetings, unresolved travel
 * distance) cap the score just as hard as a genuinely thin core signal -- this blend instead lets
 * the modules that actually drive the prediction (and whose reliability genuinely tracks real
 * data richness) carry most of the weight, while low-importance modules can still nudge the score
 * up when their data happens to be strong.
 */
export function computeDataQuality(modules: DataQualityModuleInput[]): { score: number; label: DataQualityLabel } {
  const weightTotal = modules.reduce((sum, m) => sum + m.importance, 0);
  const weightedSum = modules.reduce((sum, m) => sum + m.reliability * m.importance, 0);
  const score = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;
  const label: DataQualityLabel = score >= 85 ? "Excellent" : score >= 65 ? "Strong" : score >= 45 ? "Acceptable" : score >= 25 ? "Limited" : "Poor";
  return { score, label };
}
