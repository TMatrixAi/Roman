# Task #146: correlated core-module double-counting

**Question:** Surface Elo, Serve & Return, and Recent Form all derive their edges from largely the
same underlying recent-match history for each player. Does the ensemble's agreement scoring
(`computeWeightedDisagreement`, `modelAgreement` -- feeding `NO_STRONG_SIGNAL`/Elite-tier/upset-risk
gating) treat their agreement as three independent confirmations when it's often the same evidence
expressed three ways, and does that show up as real overconfidence in graded outcomes?

**Method:** Read-only analysis (`src/scripts/analyzeCorrelatedCoreClusterOverconfidence.ts`) over
1,031 real graded `historical_test`(test segment)/`paper_trade`/`live` rows with a stored engine
breakdown -- no new walk-forward run (re-running that suite wipes prior evaluation history, see
Task #135's still-open danger).

**Findings:**
- The trio's pairwise same-direction rate is 74.2% (n=3,093 pairs) -- well above the ~50% a
  genuinely independent trio would show by chance.
- Fatigue/Availability/Match Load Recovery are excluded from the ensemble vote
  (`EXCLUDED_FROM_ENSEMBLE`, dataQuality.ts) and never appear in `engine.models`; Head-to-Head is
  the only other module that ever votes alongside the trio, and it never reaches
  `MEANINGFUL_WEIGHT_SHARE` (15%) in this corpus. In practice, every "Strong" `modelAgreement`
  reading today is driven by the trio alone, with no other module's meaningfully-weighted vote
  behind it.
- Rows where "Strong" agreement is driven ONLY by the trio (n=389): accuracy 53.7%, log loss
  0.715 (worse than a coin flip's 0.693), calibrated ECE 0.079.
- Rows where the trio genuinely disagrees (n=387, correctly read as more uncertain): accuracy
  49.1%, log loss 0.692, calibrated ECE 0.040 -- lower log loss and much lower ECE than the
  "Strong, trio-only" cohort above, despite carrying the *lowest* confidence label.

**Conclusion:** the trio's mutual agreement is not adding real, validated confidence -- rows where
it's the sole driver of a "Strong" reading are less well-calibrated than rows correctly flagged as
uncertain. This supports collapsing the correlated trio into a single combined vote (weight and
weighted-average probability preserved) before computing `modelAgreement`'s spread/support
statistics, so three-way agreement among them reads as exactly the confirmation a single vote of
that size would provide -- no more. See `disagreement.ts`'s `collapseCorrelatedCluster` for the
implementation; it only collapses when the trio's members actually agree on direction, so a real
internal split is never hidden (`coreModelsConflict` still reads the raw, uncollapsed votes and
continues to force `HighDisagreement` regardless of collapsing).

**Explicitly out of scope (per the task spec):** `ensembleProbability` itself (`ensemble.ts`'s
weighted average) is unchanged -- averaging three correlated signals to the same value it would
converge to with just one is already mathematically a no-op, so there was no overconfidence bug in
the probability number itself. The bug was in the SEPARATE `modelAgreement`
spread/support statistic (and everything gated on it: `NO_STRONG_SIGNAL` suppression, Elite Tier
eligibility, `upsetRisk`'s agreement band) reading three correlated confirmations as if they were
independent. `eliteTier.ts`'s own "all three signals agree on direction" gate is a separate,
already-validated business rule (Task #66's `ELITE_MIN_CALIBRATED_MARGIN`) and was left untouched.
