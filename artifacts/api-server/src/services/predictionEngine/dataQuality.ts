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

/**
 * Fixed prior on how much each module's vote counts toward the ACTUAL blended probability
 * (`ensembleProbability` in `ensemble.ts`) -- distinct from `MODULE_IMPORTANCE` above, which only
 * feeds the Data Quality score. Before this existed, ensemble voting weight was driven purely by
 * each module's own `reliability`, so `MODULE_IMPORTANCE`'s "Surface Elo/Serve&Return/Recent Form
 * are the real signal" judgment never actually reached the prediction itself.
 *
 * Re-tuned from the 2026-07-13 ablation report's leave-one-out deltas: Surface Elo, Serve &
 * Return, and Recent Form are the only modules whose removal measurably hurt accuracy (they are
 * the real signal and are now the dominant vote); Fatigue and Head-to-Head were statistically
 * neutral (kept as legitimate minor tie-breakers, not zeroed, in case future data proves them
 * useful in specific segments); Availability is fully excluded from voting (see
 * `EXCLUDED_FROM_ENSEMBLE` below) because removing it measurably IMPROVED accuracy.
 */
export const ENSEMBLE_WEIGHT_PRIOR = {
  surfaceElo: 1.5,
  serveReturn: 1.5,
  recentForm: 1.3,
  fatigue: 0.4,
  headToHead: 0.4,
} as const;

/**
 * Modules excluded from the ensemble VOTE entirely (but still fully computed and shown in
 * `EngineBreakdown` for transparency -- warnings/notes/raw numbers are never hidden). Per the
 * 2026-07-13 ablation report, Availability's leave-one-out removal improved overall accuracy --
 * its signal is net-harmful, not merely weak, so it is disabled rather than just down-weighted.
 */
export const EXCLUDED_FROM_ENSEMBLE = new Set(["availability"]);

/**
 * Per-model confidence shrink (see `EnsembleModuleInput.confidenceShrink`), derived directly from
 * the 2026-07-13 ablation report's confidence-miscalibration numbers: Serve & Return's stated
 * confidence overstated its real observed hit rate by ~9.5pts (66.8% stated vs 57.3% observed --
 * deviation-from-50 ratio 7.3/16.8 ~= 0.43), Recent Form by ~8.8pts (63.2% vs 54.4% -- ratio
 * 4.4/13.2 ~= 0.33). Rounded to 0.45 / 0.35. This shrinks each module's OWN vote toward its real
 * hit rate without reducing its ensemble voting weight (see `ENSEMBLE_WEIGHT_PRIOR`) -- being a
 * "primary" signal and being "recalibrated" are independent fixes.
 */
export const CONFIDENCE_SHRINK = {
  serveReturn: 0.45,
  recentForm: 0.35,
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
